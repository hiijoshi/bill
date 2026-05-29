import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { setSession } from '@/lib/session'
import { generateRefreshToken, generateToken, normalizeRole } from '@/lib/auth'
import { env } from '@/lib/config'
import { shouldUseSecureCookies } from '@/lib/request-cookie-security'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { createSupabaseRouteClient } from '@/lib/supabase/route'
import { ensureSupabaseIdentityForLegacyUser, loadLegacyUserForSupabaseSync } from '@/lib/supabase/legacy-user-sync'
import { createTwoFactorSetupPayload, isValidOtpTokenFormat, verifyTwoFactorToken } from '@/lib/two-factor'

const SUPER_ADMIN_ACCESS_EXPIRES_IN: Parameters<typeof generateToken>[1] =
  (env.SUPER_ADMIN_ACCESS_EXPIRES_IN || '30m') as Parameters<typeof generateToken>[1]
const SUPER_ADMIN_REFRESH_EXPIRES_IN: Parameters<typeof generateRefreshToken>[1] =
  (env.SUPER_ADMIN_REFRESH_EXPIRES_IN || '8h') as Parameters<typeof generateRefreshToken>[1]

type SuperAdminAuthAction = 'login' | 'setup_2fa' | 'verify_2fa'

type RateLimitEntry = {
  count: number
  resetAt: number
}

const otpRateLimit = new Map<string, RateLimitEntry>()

function consumeOtpAttempts(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const current = otpRateLimit.get(key)
  if (!current || now > current.resetAt) {
    otpRateLimit.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true as const }
  }
  if (current.count >= max) {
    return {
      allowed: false as const,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    }
  }
  current.count += 1
  return { allowed: true as const }
}

function normalizeAction(value: unknown): SuperAdminAuthAction {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'setup_2fa') return 'setup_2fa'
  if (normalized === 'verify_2fa') return 'verify_2fa'
  return 'login'
}

function getRequestIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') || 'unknown'
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().split(':')[0]
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1'
}

function isRemoteSuperAdminEnabled(): boolean {
  const flag = String(env.SUPER_ADMIN_REMOTE_ACCESS || '').trim().toLowerCase()
  return !['0', 'false', 'no', 'off'].includes(flag)
}

export async function POST(request: NextRequest) {
  try {
    const requestHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
    if (env.NODE_ENV === 'production' && !isRemoteSuperAdminEnabled() && !isLoopbackHost(requestHost)) {
      return NextResponse.json(
        { error: 'Super admin remote access is disabled. Remove SUPER_ADMIN_REMOTE_ACCESS or set it to true to allow deployed login.' },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const action = normalizeAction((body as { action?: unknown })?.action)
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const secondSecret = typeof body?.secondSecret === 'string' ? body.secondSecret : ''
    const token = typeof body?.token === 'string' ? body.token.trim() : ''

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if ((action === 'login' || action === 'setup_2fa') && !password) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    // Backward-compatible optional check: if second secret is configured and provided, it must match.
    if (env.SUPER_ADMIN_SECOND_SECRET && secondSecret && secondSecret !== env.SUPER_ADMIN_SECOND_SECRET) {
      return NextResponse.json({ error: 'Invalid second secret' }, { status: 401 })
    }

    const user = await prisma.user.findFirst({
      where: {
        traderId: 'system',
        userId,
        deletedAt: null
      },
      select: {
        id: true,
        userId: true,
        traderId: true,
        name: true,
        role: true,
        password: true,
        locked: true,
        deletedAt: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        trader: {
          select: {
            locked: true,
            deletedAt: true
          }
        },
        company: {
          select: {
            locked: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    if (user.deletedAt || user.trader?.deletedAt) {
      return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
    }

    const userRole = normalizeRole(user.role)
    if (userRole !== 'super_admin') {
      return NextResponse.json({ error: 'Insufficient privileges' }, { status: 403 })
    }

    if (user.locked || user.trader?.locked || user.company?.locked) {
      return NextResponse.json({ error: 'Account is locked' }, { status: 403 })
    }

    if (action === 'setup_2fa') {
      const isPasswordValid = await bcrypt.compare(password, user.password)
      if (!isPasswordValid) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
      }

      const setupPayload = await createTwoFactorSetupPayload(user.userId)

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorSecret: setupPayload.secret,
          twoFactorEnabled: false
        }
      })

      return NextResponse.json({
        success: true,
        userId: user.userId,
        qrCode: setupPayload.qrCodeDataUrl,
        otpauthUrl: setupPayload.otpauthUrl,
        requiresTwoFactorSetup: true
      })
    }

    if (action === 'verify_2fa') {
      if (!token) {
        return NextResponse.json({ error: 'OTP token is required' }, { status: 400 })
      }

      if (!isValidOtpTokenFormat(token)) {
        return NextResponse.json({ error: 'Invalid token format' }, { status: 400 })
      }

      const limit = consumeOtpAttempts(`${userId}:${getRequestIp(request)}:verify`, 8, 5 * 60_000)
      if (!limit.allowed) {
        return NextResponse.json(
          { error: 'Too many attempts. Try again shortly.' },
          { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
        )
      }

      if (!user.twoFactorSecret) {
        return NextResponse.json({ error: '2FA setup not found. Run setup first.' }, { status: 400 })
      }

      const valid = verifyTwoFactorToken(user.twoFactorSecret, token)
      if (!valid) {
        return NextResponse.json({ error: 'Invalid authenticator code' }, { status: 401 })
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: true
        }
      })

      return NextResponse.json({ success: true, twoFactorEnabled: true })
    }

    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    if (user.twoFactorEnabled) {
      if (!user.twoFactorSecret) {
        return NextResponse.json(
          {
            success: false,
            requiresTwoFactorSetup: true,
            userId: user.userId,
            error: '2FA setup required before super admin login.'
          },
          { status: 428 }
        )
      }

      if (!token) {
        return NextResponse.json({
          success: false,
          requiresTwoFactor: true,
          userId: user.userId,
          message: 'OTP required'
        })
      }

      if (!isValidOtpTokenFormat(token)) {
        return NextResponse.json({ error: 'Invalid token format' }, { status: 400 })
      }

      const loginLimit = consumeOtpAttempts(`${userId}:${getRequestIp(request)}:login`, 12, 5 * 60_000)
      if (!loginLimit.allowed) {
        return NextResponse.json(
          { error: 'Too many OTP attempts. Try again shortly.' },
          { status: 429, headers: { 'Retry-After': String(loginLimit.retryAfter) } }
        )
      }

      const validTwoFactorToken = verifyTwoFactorToken(user.twoFactorSecret, token)
      if (!validTwoFactorToken) {
        return NextResponse.json({ error: 'Invalid authenticator code' }, { status: 401 })
      }
    }

    const authPayload = {
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || 'System Administrator',
      role: user.role || undefined,
      userDbId: user.id
    }

    const sessionToken = generateToken(authPayload, SUPER_ADMIN_ACCESS_EXPIRES_IN)
    const refreshToken = generateRefreshToken(authPayload, SUPER_ADMIN_REFRESH_EXPIRES_IN)

    let response = NextResponse.json({
      success: true,
      user: {
        userId: user.userId,
        name: user.name,
        role: user.role,
        traderId: user.traderId
      }
    })

    if (isSupabaseConfigured()) {
      const routeClient = createSupabaseRouteClient(request)
      if (!routeClient) {
        return NextResponse.json({ error: 'Supabase client is not configured correctly' }, { status: 500 })
      }

      const legacyUser = await loadLegacyUserForSupabaseSync(user.id)
      if (!legacyUser) {
        return NextResponse.json({ error: 'Super admin account is not active for cloud login' }, { status: 403 })
      }

      const identity = await ensureSupabaseIdentityForLegacyUser({
        legacyUser,
        password
      })

      const signInResult = await routeClient.supabase.auth.signInWithPassword({
        email: identity.loginEmail,
        password
      })

      if (signInResult.error) {
        return NextResponse.json(
          { error: `Supabase super admin sign-in failed: ${signInResult.error.message}` },
          { status: 503 }
        )
      }

      response = routeClient.applyCookies(response)
    }

    await setSession(
      sessionToken,
      refreshToken,
      response,
      'super_admin',
      requestHost,
      shouldUseSecureCookies(request)
    )
    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
