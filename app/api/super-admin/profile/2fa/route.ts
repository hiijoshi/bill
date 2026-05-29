import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createTwoFactorQrFromSecret, createTwoFactorSetupPayload, isValidOtpTokenFormat, verifyTwoFactorToken } from '@/lib/two-factor'
import { resolveServerAuth } from '@/lib/server-auth'

const toggleSchema = z.object({
  enabled: z.boolean()
}).strict()

const verifySchema = z.object({
  token: z.string().trim().min(1)
}).strict()

type VerifyLimitState = {
  count: number
  resetAt: number
}

const verifyRateLimit = new Map<string, VerifyLimitState>()

function consumeVerifyAttempt(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const existing = verifyRateLimit.get(key)
  if (!existing || now > existing.resetAt) {
    verifyRateLimit.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true as const }
  }

  if (existing.count >= max) {
    return {
      allowed: false as const,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    }
  }

  existing.count += 1
  return { allowed: true as const }
}

function getRequestIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') || 'unknown'
}

async function resolveSuperAdminAuth() {
  const resolved = await resolveServerAuth({ namespace: 'super_admin', allowedRoles: ['super_admin'] })
  if (!resolved) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
  }

  return {
    ok: true as const,
    auth: resolved.auth
  }
}

function buildUserWhereClause(auth: { userDbId?: string | null, userId: string, traderId: string }) {
  if (auth.userDbId) {
    return { id: auth.userDbId }
  }
  return {
    traderId_userId: {
      traderId: auth.traderId,
      userId: auth.userId
    }
  }
}

async function buildTwoFactorPayloadForUser(user: { userId: string, twoFactorEnabled: boolean, twoFactorSecret: string | null }) {
  if (!user.twoFactorSecret) {
    return {
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
      hasSecret: false,
      qrCode: null,
      otpauthUrl: null,
      requiresVerification: false
    }
  }

  const qrPayload = await createTwoFactorQrFromSecret(user.userId, user.twoFactorSecret)
  return {
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    hasSecret: true,
    qrCode: qrPayload.qrCodeDataUrl,
    otpauthUrl: qrPayload.otpauthUrl,
    requiresVerification: !user.twoFactorEnabled
  }
}

export async function GET() {
  const authResult = await resolveSuperAdminAuth()
  if (!authResult.ok) return authResult.response

  const user = await prisma.user.findUnique({
    where: buildUserWhereClause(authResult.auth),
    select: {
      userId: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      deletedAt: true,
      locked: true
    }
  })

  if (!user || user.deletedAt || user.locked) {
    return NextResponse.json({ error: 'Account unavailable' }, { status: 403 })
  }

  const payload = await buildTwoFactorPayloadForUser(user)
  return NextResponse.json(payload)
}

export async function PATCH(request: NextRequest) {
  const authResult = await resolveSuperAdminAuth()
  if (!authResult.ok) return authResult.response

  const parsed = toggleSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: buildUserWhereClause(authResult.auth),
    select: {
      id: true,
      userId: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      deletedAt: true,
      locked: true
    }
  })

  if (!user || user.deletedAt || user.locked) {
    return NextResponse.json({ error: 'Account unavailable' }, { status: 403 })
  }

  if (!parsed.data.enabled) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null
      },
      select: {
        userId: true,
        twoFactorEnabled: true,
        twoFactorSecret: true
      }
    })

    const payload = await buildTwoFactorPayloadForUser(updated)
    return NextResponse.json({
      ...payload,
      message: '2FA turned off.'
    })
  }

  if (!user.twoFactorSecret) {
    const setup = await createTwoFactorSetupPayload(user.userId)
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: setup.secret,
        twoFactorEnabled: false
      },
      select: {
        userId: true,
        twoFactorEnabled: true,
        twoFactorSecret: true
      }
    })
    const payload = await buildTwoFactorPayloadForUser(updated)
    return NextResponse.json({
      ...payload,
      message: 'Scan QR and verify OTP to enable 2FA.'
    })
  }

  const payload = await buildTwoFactorPayloadForUser({
    userId: user.userId,
    twoFactorEnabled: user.twoFactorEnabled,
    twoFactorSecret: user.twoFactorSecret
  })

  return NextResponse.json({
    ...payload,
    message: user.twoFactorEnabled
      ? '2FA is already enabled.'
      : 'Enter OTP from Google Authenticator to enable 2FA.'
  })
}

export async function POST(request: NextRequest) {
  const authResult = await resolveSuperAdminAuth()
  if (!authResult.ok) return authResult.response

  const parsed = verifySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'OTP token is required' }, { status: 400 })
  }

  const token = parsed.data.token.trim()
  if (!isValidOtpTokenFormat(token)) {
    return NextResponse.json({ error: 'Invalid token format' }, { status: 400 })
  }

  const key = `${authResult.auth.userId}:${getRequestIp(request)}`
  const limit = consumeVerifyAttempt(key, 10, 5 * 60_000)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    )
  }

  const user = await prisma.user.findUnique({
    where: buildUserWhereClause(authResult.auth),
    select: {
      id: true,
      userId: true,
      twoFactorSecret: true,
      twoFactorEnabled: true,
      deletedAt: true,
      locked: true
    }
  })

  if (!user || user.deletedAt || user.locked) {
    return NextResponse.json({ error: 'Account unavailable' }, { status: 403 })
  }

  if (!user.twoFactorSecret) {
    return NextResponse.json({ error: '2FA setup not found. Turn 2FA on first.' }, { status: 400 })
  }

  const valid = verifyTwoFactorToken(user.twoFactorSecret, token)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid authenticator code' }, { status: 401 })
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true },
    select: {
      userId: true,
      twoFactorEnabled: true,
      twoFactorSecret: true
    }
  })

  const payload = await buildTwoFactorPayloadForUser(updated)
  return NextResponse.json({
    ...payload,
    success: true,
    message: '2FA enabled successfully.'
  })
}
