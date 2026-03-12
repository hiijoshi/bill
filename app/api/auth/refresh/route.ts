import { NextRequest, NextResponse } from 'next/server'
import { verifyRefreshToken, generateToken } from '@/lib/auth'
import { setSession, clearSession } from '@/lib/session'
import { getRequestIp } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'

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

    const refreshToken = request.cookies.get('refresh-token')?.value

    if (!refreshToken) {
      return NextResponse.json(
        { error: 'No refresh token provided' },
        { status: 401 }
      )
    }

    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken)
    
    if (!payload) {
      // Clear invalid refresh token
      await clearSession()
      return NextResponse.json(
        { error: 'Invalid or expired refresh token' },
        { status: 401 }
      )
    }

    // Generate new access token
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

    if (!user || user.locked || user.trader?.locked || user.trader?.deletedAt || user.company?.locked || user.company?.deletedAt) {
      await clearSession()
      return NextResponse.json(
        { error: 'Account is locked or inactive' },
        { status: 403 }
      )
    }

    const newAccessToken = generateToken(payload)
    
    // Set new session with fresh access token on the outgoing response
    const response = NextResponse.json({
      success: true,
      token: newAccessToken
    })
    await setSession(newAccessToken, refreshToken, response)

    return response

  } catch (error) {
    void error
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
