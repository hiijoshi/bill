import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { setSession } from '@/lib/session'
import { generateRefreshToken, generateToken, normalizeRole } from '@/lib/auth'
import { env } from '@/lib/config'

async function ensureDevSuperAdmin(userId: string, password: string): Promise<boolean> {
  if (env.NODE_ENV !== 'development') return false

  const defaultUser = process.env.SUPER_ADMIN_USER_ID || 'superadmin'
  const defaultPassword = process.env.SUPER_ADMIN_PASSWORD || 'super-admin-2026-secure'
  if (userId !== defaultUser || password !== defaultPassword) {
    return false
  }

  let systemTrader = await prisma.trader.findUnique({
    where: { id: 'system' }
  })
  if (!systemTrader) {
    systemTrader = await prisma.trader.create({
      data: { id: 'system', name: 'System Trader' }
    })
  } else if (systemTrader.locked || systemTrader.deletedAt) {
    systemTrader = await prisma.trader.update({
      where: { id: systemTrader.id },
      data: {
        locked: false,
        deletedAt: null
      }
    })
  }

  const hashed = await bcrypt.hash(defaultPassword, 12)
  await prisma.user.upsert({
    where: {
      traderId_userId: {
        traderId: systemTrader.id,
        userId: defaultUser
      }
    },
    update: {
      password: hashed,
      role: 'SUPER_ADMIN',
      name: 'System Administrator',
      locked: false,
      deletedAt: null
    },
    create: {
      traderId: systemTrader.id,
      userId: defaultUser,
      password: hashed,
      role: 'SUPER_ADMIN',
      name: 'System Administrator',
      locked: false
    }
  })

  return true
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!userId || !password) {
      return NextResponse.json({ error: 'User ID and password are required' }, { status: 400 })
    }

    let user = await prisma.user.findFirst({
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

    // Legacy fallback: locate super-admin by userId irrespective of traderId.
    if (!user) {
      user = await prisma.user.findFirst({
        where: { userId, deletedAt: null },
        include: {
          trader: true,
          company: true
        }
      })
    }

    if (!user) {
      const created = await ensureDevSuperAdmin(userId, password)
      if (created) {
        user = await prisma.user.findFirst({
          where: {
            userId,
            traderId: 'system',
            deletedAt: null
          },
          include: {
            trader: true,
            company: true
          }
        })
      }
    }

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
    })
    const refreshToken = generateRefreshToken({
      userId: user.userId,
      traderId: user.traderId,
      name: user.name || 'System Administrator',
      role: user.role || undefined
    })

    const response = NextResponse.json({
      success: true,
      user: {
        userId: user.userId,
        name: user.name,
        role: user.role,
        traderId: user.traderId
      }
    })
    await setSession(token, refreshToken, response)
    return response
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
