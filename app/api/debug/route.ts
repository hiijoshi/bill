import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRoles } from '@/lib/api-security'
import { env } from '@/lib/config'

export async function GET(request: NextRequest) {
  if (env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const traders = await prisma.trader.findMany({
      where: { deletedAt: null },
      include: {
        _count: {
          select: {
            companies: true,
            users: true
          }
        }
      }
    })

    const companies = await prisma.company.findMany({
      where: { deletedAt: null },
      include: {
        trader: {
          select: {
            id: true,
            name: true
          }
        },
        _count: {
          select: {
            parties: true,
            products: true,
            salesBills: true
          }
        }
      }
    })

    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        userId: true,
        traderId: true,
        companyId: true,
        name: true,
        role: true,
        locked: true,
        createdAt: true,
        trader: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    return NextResponse.json({
      traders: {
        count: traders.length,
        data: traders
      },
      companies: {
        count: companies.length,
        data: companies
      },
      users: {
        count: users.length,
        data: users
      }
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
