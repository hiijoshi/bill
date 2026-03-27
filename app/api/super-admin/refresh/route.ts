import { NextRequest, NextResponse } from 'next/server'
import { verifyRefreshTokenWithMetadata, generateRefreshToken, generateToken, normalizeRole } from '@/lib/auth'
import { setSession, clearSession } from '@/lib/session'
import { getRequestIp } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { getSessionCookieNameCandidates } from '@/lib/session-cookies'
import { env } from '@/lib/config'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { getSupabaseClaimsFromRequest, hasSupabaseAppContext } from '@/lib/supabase/auth-bridge'

const SUPER_ADMIN_ACCESS_EXPIRES_IN: Parameters<typeof generateToken>[1] =
  (env.SUPER_ADMIN_ACCESS_EXPIRES_IN || '30m') as Parameters<typeof generateToken>[1]
const SUPER_ADMIN_REFRESH_EXPIRES_IN: Parameters<typeof generateRefreshToken>[1] =
  (env.SUPER_ADMIN_REFRESH_EXPIRES_IN || '8h') as Parameters<typeof generateRefreshToken>[1]

const refreshRateLimit = new Map<string, { count: number; resetTime: number }>()
const ENABLE_REFRESH_RATE_LIMIT = false

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

    if (isSupabaseConfigured()) {
      const supabaseContext = await getSupabaseClaimsFromRequest(request)
      if (!supabaseContext || !hasSupabaseAppContext(supabaseContext.claims)) {
        const response = NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })
        await clearSession(response, 'super_admin', scopeSource)
        return response
      }

      const supabaseUserId =
        (typeof supabaseContext.claims.user_code === 'string' && supabaseContext.claims.user_code.trim()) ||
        supabaseContext.claims.user_db_id

      const user = await prisma.user.findFirst({
        where: {
          ...(typeof supabaseContext.claims.user_db_id === 'string'
            ? { id: supabaseContext.claims.user_db_id }
            : { userId: supabaseUserId, traderId: supabaseContext.claims.trader_id }),
          deletedAt: null
        },
        select: {
          id: true,
          userId: true,
          traderId: true,
          name: true,
          role: true,
          locked: true,
          updatedAt: true,
          trader: {
            select: {
              locked: true,
              deletedAt: true
            }
          },
          company: {
            select: {
              locked: true,
              deletedAt: true
            }
          }
        }
      })

      if (
        user &&
        typeof supabaseContext.claims.iat === 'number' &&
        user.updatedAt.getTime() > supabaseContext.claims.iat * 1000 + 1000
      ) {
        const response = NextResponse.json({ error: 'Session expired due to account changes' }, { status: 401 })
        await clearSession(response, 'super_admin', scopeSource)
        return supabaseContext.applyCookies(response)
      }

      if (
        !user ||
        normalizeRole(user.role) !== 'super_admin' ||
        user.locked ||
        user.trader?.locked ||
        user.trader?.deletedAt ||
        user.company?.locked ||
        user.company?.deletedAt
      ) {
        const response = NextResponse.json({ error: 'Account is locked or inactive' }, { status: 403 })
        await clearSession(response, 'super_admin', scopeSource)
        return supabaseContext.applyCookies(response)
      }

      const refreshedPayload = {
        userId: user.userId,
        traderId: user.traderId,
        name: user.name || undefined,
        role: normalizeRole(user.role) || undefined,
        userDbId: user.id
      }
      const newAccessToken = generateToken(refreshedPayload, SUPER_ADMIN_ACCESS_EXPIRES_IN)
      const nextRefreshToken = generateRefreshToken(refreshedPayload, SUPER_ADMIN_REFRESH_EXPIRES_IN)
      let response = NextResponse.json({
        success: true,
        token: newAccessToken
      })
      response = supabaseContext.applyCookies(response)
      await setSession(newAccessToken, nextRefreshToken, response, 'super_admin', scopeSource)
      return response
    }

    const refreshToken =
      getSessionCookieNameCandidates('super_admin', scopeSource)
        .map((cookieNames) => request.cookies.get(cookieNames.refreshToken)?.value)
        .find((value): value is string => Boolean(value)) || null

    if (!refreshToken) {
      return NextResponse.json({ error: 'No refresh token provided' }, { status: 401 })
    }

    const payload = verifyRefreshTokenWithMetadata(refreshToken)
    if (!payload) {
      const response = NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 })
      await clearSession(response, 'super_admin', scopeSource)
      return response
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
        name: true,
        role: true,
        locked: true,
        updatedAt: true,
        trader: {
          select: {
            locked: true,
            deletedAt: true
          }
        },
        company: {
          select: {
            locked: true,
            deletedAt: true
          }
        }
      }
    })

    if (user && payload.iat && user.updatedAt.getTime() > payload.iat * 1000 + 1000) {
      const response = NextResponse.json({ error: 'Session expired due to account changes' }, { status: 401 })
      await clearSession(response, 'super_admin', scopeSource)
      return response
    }

    if (
      !user ||
      normalizeRole(user.role) !== 'super_admin' ||
      user.locked ||
      user.trader?.locked ||
      user.trader?.deletedAt ||
      user.company?.locked ||
      user.company?.deletedAt
    ) {
      const response = NextResponse.json({ error: 'Account is locked or inactive' }, { status: 403 })
      await clearSession(response, 'super_admin', scopeSource)
      return response
    }

    const refreshedPayload = {
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || undefined,
      role: normalizeRole(user.role) || undefined,
      userDbId: user.id
    }
    const newAccessToken = generateToken(refreshedPayload, SUPER_ADMIN_ACCESS_EXPIRES_IN)
    const nextRefreshToken = generateRefreshToken(refreshedPayload, SUPER_ADMIN_REFRESH_EXPIRES_IN)
    const response = NextResponse.json({
      success: true,
      token: newAccessToken
    })
    await setSession(newAccessToken, nextRefreshToken, response, 'super_admin', scopeSource)
    return response
  } catch (error) {
    void error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
