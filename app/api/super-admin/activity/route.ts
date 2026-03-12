import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRoles } from '@/lib/api-security'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const auditRows = await prisma.auditLog.findMany({
      take: 20,
      orderBy: {
        createdAt: 'desc'
      }
    })

    if (auditRows.length > 0) {
      const mapped = auditRows.map((row) => ({
        id: row.id,
        type: row.resourceType.toLowerCase(),
        action: `${row.action} ${row.resourceType}`,
        details: row.resourceId,
        timestamp: row.createdAt
      }))
      return NextResponse.json(mapped)
    }

    const [recentUsers, recentCompanies, recentTraders] = await Promise.all([
      prisma.user.findMany({
        where: { deletedAt: null },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          name: true,
          role: true,
          createdAt: true
        }
      }),
      prisma.company.findMany({
        where: { deletedAt: null },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          createdAt: true
        }
      }),
      prisma.trader.findMany({
        where: { deletedAt: null },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          createdAt: true
        }
      })
    ])

    const activities = [
      ...recentUsers.map((user) => ({
        id: `user-${user.id}`,
        type: 'user' as const,
        action: 'New User Created',
        details: `${user.name || user.userId} (${user.role})`,
        timestamp: user.createdAt
      })),
      ...recentCompanies.map((company) => ({
        id: `company-${company.id}`,
        type: 'company' as const,
        action: 'New Company Registered',
        details: company.name,
        timestamp: company.createdAt
      })),
      ...recentTraders.map((trader) => ({
        id: `trader-${trader.id}`,
        type: 'trader' as const,
        action: 'New Trader Created',
        details: trader.name,
        timestamp: trader.createdAt
      }))
    ]

    const sortedActivities = activities
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10)

    return NextResponse.json(sortedActivities)
  } catch {
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 })
  }
}
