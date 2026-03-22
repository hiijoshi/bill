import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { setSession } from '@/lib/session'
import { generateRefreshToken, generateToken, normalizeRole } from '@/lib/auth'
import { env } from '@/lib/config'

const SUPER_ADMIN_ACCESS_EXPIRES_IN: Parameters<typeof generateToken>[1] =
  (env.SUPER_ADMIN_ACCESS_EXPIRES_IN || '30m') as Parameters<typeof generateToken>[1]
const SUPER_ADMIN_REFRESH_EXPIRES_IN: Parameters<typeof generateRefreshToken>[1] =
  (env.SUPER_ADMIN_REFRESH_EXPIRES_IN || '8h') as Parameters<typeof generateRefreshToken>[1]

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const secondSecret = typeof body?.secondSecret === 'string' ? body.secondSecret : ''

    if (!userId || !password) {
      return NextResponse.json({ error: 'User ID and password are required' }, { status: 400 })
    }

    if (env.SUPER_ADMIN_SECOND_SECRET && secondSecret !== env.SUPER_ADMIN_SECOND_SECRET) {
      return NextResponse.json({ error: 'Invalid second secret' }, { status: 401 })
    }

    const user = await prisma.user.findFirst({
      where: {
        traderId: 'system',
        userId,
        deletedAt: null
      },
      include: {
        trader: true,
        company: true
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
      role: user.role || undefined
    }, SUPER_ADMIN_ACCESS_EXPIRES_IN)
    const refreshToken = generateRefreshToken({
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || 'System Administrator',
      role: user.role || undefined
    }, SUPER_ADMIN_REFRESH_EXPIRES_IN)

    const response = NextResponse.json({
      success: true,
      user: {
        userId: user.userId,
        name: user.name,
        role: user.role,
        traderId: user.traderId
      }
    })
    await setSession(token, refreshToken, response, 'super_admin')
    return response
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
