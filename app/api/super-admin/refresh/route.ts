import { NextRequest, NextResponse } from 'next/server'
import { verifyRefreshToken, generateRefreshToken, generateToken, normalizeRole } from '@/lib/auth'
import { setSession, clearSession } from '@/lib/session'
import { getRequestIp } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { getSessionCookieNameCandidates } from '@/lib/session-cookies'
import { env } from '@/lib/config'

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
    const refreshToken =
      getSessionCookieNameCandidates('super_admin', scopeSource)
        .map((cookieNames) => request.cookies.get(cookieNames.refreshToken)?.value)
        .find((value): value is string => Boolean(value)) || null

    if (!refreshToken) {
      return NextResponse.json({ error: 'No refresh token provided' }, { status: 401 })
    }

    const payload = verifyRefreshToken(refreshToken)

    if (!payload) {
      await clearSession(undefined, 'super_admin', scopeSource)
      return NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 })
    }

    const user = await prisma.user.findFirst({
      where: {
        userId: payload.userId,
        traderId: payload.traderId,
        deletedAt: null
      },
      include: {
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
      !user ||
      normalizeRole(user.role) !== 'super_admin' ||
      user.locked ||
      user.trader?.locked ||
      user.trader?.deletedAt ||
      user.company?.locked ||
      user.company?.deletedAt
    ) {
      await clearSession(undefined, 'super_admin', scopeSource)
      return NextResponse.json({ error: 'Account is locked or inactive' }, { status: 403 })
    }

    const refreshedPayload = {
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || undefined,
      role: normalizeRole(user.role) || undefined
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
