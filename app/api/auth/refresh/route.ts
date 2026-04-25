import { NextRequest, NextResponse } from 'next/server'
import { verifyRefreshTokenWithMetadata, generateRefreshToken, generateToken, normalizeRole } from '@/lib/auth'
import { setSession, clearSession } from '@/lib/session'
import { getRequestIp } from '@/lib/api-security'
import { env } from '@/lib/config'
import { prisma } from '@/lib/prisma'
import { shouldUseSecureCookies } from '@/lib/request-cookie-security'
import { getSessionCookieNameCandidates } from '@/lib/session-cookies'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { getSupabaseClaimsFromRequest, hasSupabaseAppContext } from '@/lib/supabase/auth-bridge'

const refreshRateLimit = new Map<string, { count: number; resetTime: number }>()
const ENABLE_REFRESH_RATE_LIMIT = env.NODE_ENV === 'production'

function isRefreshAllowed(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  let entry = refreshRateLimit.get(ip)
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + 5 * 60 * 1000 }
    refreshRateLimit.set(ip, entry)
  }
  if (entry.count >= 30) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetTime - now) / 1000) }
  }
  entry.count += 1
  return { allowed: true }
}

export async function POST(request: NextRequest) {
  try {
    if (ENABLE_REFRESH_RATE_LIMIT) {
      const rateLimitResult = isRefreshAllowed(getRequestIp(request))
      if (!rateLimitResult.allowed) {
        return NextResponse.json(
          { error: 'Too many refresh requests' },
          { status: 429, headers: { 'Retry-After': String(rateLimitResult.retryAfter || 60) } }
        )
      }
    }

    const scopeSource = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
    const secureCookies = shouldUseSecureCookies(request)
    let payload = null as ReturnType<typeof verifyRefreshTokenWithMetadata>

    // Prefer the cloud session when it is available, but never make it a hard
    // requirement for refreshing an otherwise-valid legacy ERP session.
    if (isSupabaseConfigured()) {
      const supabaseContext = await getSupabaseClaimsFromRequest(request)
      if (supabaseContext && hasSupabaseAppContext(supabaseContext.claims)) {
        payload = {
          userId:
            (typeof supabaseContext.claims.user_code === 'string' && supabaseContext.claims.user_code.trim()) ||
            supabaseContext.claims.user_db_id,
          traderId: supabaseContext.claims.trader_id,
          name: undefined,
          role: normalizeRole(supabaseContext.claims.app_role) || undefined,
          userDbId:
            typeof supabaseContext.claims.user_db_id === 'string'
              ? supabaseContext.claims.user_db_id
              : null,
          iat: typeof supabaseContext.claims.iat === 'number' ? supabaseContext.claims.iat : undefined,
          exp: typeof supabaseContext.claims.exp === 'number' ? supabaseContext.claims.exp : undefined
        }
      }
    }

    if (!payload) {
      const refreshToken =
        getSessionCookieNameCandidates('app', scopeSource)
          .map((cookieNames) => request.cookies.get(cookieNames.refreshToken)?.value)
          .find((value): value is string => Boolean(value)) || null

      if (!refreshToken) {
        return NextResponse.json({ error: 'No refresh token provided' }, { status: 401 })
      }

      payload = verifyRefreshTokenWithMetadata(refreshToken)
      if (!payload) {
        const response = NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 })
        await clearSession(response, 'app', scopeSource)
        return response
      }
    }

    const user = await prisma.user.findFirst({
      where: {
        ...(payload.userDbId ? { id: payload.userDbId } : { userId: payload.userId, traderId: payload.traderId }),
        deletedAt: null
      },
      select: {
        id: true,
        userId: true,
        traderId: true,
        companyId: true,
        name: true,
        role: true,
        locked: true,
        updatedAt: true,
        trader: {
          select: {
            locked: true,
            deletedAt: true
          }
        }
      }
    })

    if (user && payload.iat && user.updatedAt.getTime() > payload.iat * 1000 + 1000) {
      const response = NextResponse.json({ error: 'Session expired due to account changes' }, { status: 401 })
      await clearSession(response, 'app', scopeSource)
      return response
    }

    if (!user || user.locked || user.trader?.locked || user.trader?.deletedAt) {
      const response = NextResponse.json({ error: 'Account is locked or inactive' }, { status: 403 })
      await clearSession(response, 'app', scopeSource)
      return response
    }

    const permissionRows = await prisma.userPermission.findMany({
      where: {
        userId: user.id,
        OR: [{ canRead: true }, { canWrite: true }],
        company: {
          deletedAt: null,
          locked: false,
          OR: [{ traderId: user.traderId }, { traderId: null }]
        }
      },
      select: {
        companyId: true
      }
    })

    const allowedCompanyIds = Array.from(
      new Set([
        ...(user.companyId ? [user.companyId] : []),
        ...permissionRows.map((row) => row.companyId),
        ...(Array.isArray(payload.companyIds) ? payload.companyIds : [])
      ].map((entry) => String(entry || '').trim()).filter(Boolean))
    )

    const refreshedPayload = {
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || undefined,
      role: normalizeRole(user.role) || undefined,
      userDbId: user.id,
      companyIds: allowedCompanyIds
    }
    const newAccessToken = generateToken(refreshedPayload)
    const nextRefreshToken = generateRefreshToken(refreshedPayload)

    const response = NextResponse.json({
      success: true,
      token: newAccessToken
    })
    await setSession(newAccessToken, nextRefreshToken, response, 'app', scopeSource, secureCookies)
    return response
  } catch (error) {
    void error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
