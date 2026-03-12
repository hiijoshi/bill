import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

export async function GET() {
  try {
    const session = await getSession()
    
    if (!session) {
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401 }
      )
    }

    // Get user details from database using session info
    const { prisma } = await import('@/lib/prisma')
    const user = await prisma.user.findFirst({
      where: {
        userId: session.userId,
        traderId: session.traderId,
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
        trader: {
          select: {
            id: true,
            name: true,
            locked: true,
            deletedAt: true
          }
        },
        company: {
          select: {
            id: true,
            name: true,
            locked: true,
            deletedAt: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid session user' },
        { status: 401 }
      )
    }

    if (user.locked || user.trader?.locked || user.trader?.deletedAt || user.company?.locked || user.company?.deletedAt) {
      return NextResponse.json({ error: 'Account is locked or inactive' }, { status: 403 })
    }

    // Get company for this user
    const company = user.companyId
      ? await prisma.company.findFirst({
          where: {
            id: user.companyId,
            traderId: user.traderId,
            deletedAt: null
          }
        })
      : await prisma.company.findFirst({
          where: {
            traderId: user.traderId,
            deletedAt: null
          }
        })

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        userId: user.userId,
        traderId: user.traderId,
        name: user.name,
        role: user.role,
        companyId: company?.id || null // Add companyId here
      },
      trader: user.trader,
      company: company ? {
        id: company.id,
        name: company.name
      } : null
    })

  } catch (error) {
    void error
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
