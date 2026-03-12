import { NextRequest, NextResponse } from 'next/server'
import { requireRoles } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const authResult = requireRoles(request, ['super_admin'])
    if (!authResult.ok) return authResult.response

    const user = await prisma.user.findFirst({
      where: {
        userId: authResult.auth.userId,
        traderId: authResult.auth.traderId,
        deletedAt: null
      },
      select: {
        userId: true,
        name: true,
        role: true,
        traderId: true,
        locked: true,
        trader: {
          select: {
            locked: true,
            deletedAt: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.locked || user.trader?.locked || user.trader?.deletedAt) {
      return NextResponse.json({ error: 'Account is locked or inactive' }, { status: 403 })
    }

    return NextResponse.json({
      userId: user.userId,
      name: user.name,
      role: user.role,
      traderId: user.traderId
    })

  } catch (error) {
    console.error('Super admin auth check error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
