import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { setSession } from '@/lib/session'
import { generateRefreshToken, generateToken, normalizeRole } from '@/lib/auth'
import { env } from '@/lib/config'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { createSupabaseRouteClient } from '@/lib/supabase/route'
import { ensureSupabaseIdentityForLegacyUser, loadLegacyUserForSupabaseSync } from '@/lib/supabase/legacy-user-sync'

const SUPER_ADMIN_ACCESS_EXPIRES_IN: Parameters<typeof generateToken>[1] =
  (env.SUPER_ADMIN_ACCESS_EXPIRES_IN || '30m') as Parameters<typeof generateToken>[1]
const SUPER_ADMIN_REFRESH_EXPIRES_IN: Parameters<typeof generateRefreshToken>[1] =
  (env.SUPER_ADMIN_REFRESH_EXPIRES_IN || '8h') as Parameters<typeof generateRefreshToken>[1]

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
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const mfaToken = typeof body?.secondSecret === 'string' ? body.secondSecret : ''

    if (!userId || !password) {
      return NextResponse.json({ error: 'User ID and password are required' }, { status: 400 })
    }

    if (env.SUPER_ADMIN_SECOND_SECRET && mfaToken !== env.SUPER_ADMIN_SECOND_SECRET) {
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

    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = generateToken({
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || 'System Administrator',
      role: user.role || undefined,
      dbId: user.id
    }, SUPER_ADMIN_ACCESS_EXPIRES_IN)
    const refreshToken = generateRefreshToken({
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || 'System Administrator',
      role: user.role || undefined,
      dbId: user.id
    }, SUPER_ADMIN_REFRESH_EXPIRES_IN)

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

    await setSession(token, refreshToken, response, 'super_admin', requestHost)
    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
