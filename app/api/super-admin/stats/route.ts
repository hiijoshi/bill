import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { requireRoles } from '@/lib/api-security'

const nonSuperAdminUserWhere: Prisma.UserWhereInput = {
  deletedAt: null,
  OR: [
    { role: null },
    {
      role: {
        notIn: ['SUPER_ADMIN', 'super_admin']
      }
    }
  ]
}

const safeCount = (result: PromiseSettledResult<number>): number => {
  if (result.status === 'fulfilled') {
    return Number(result.value || 0)
  }
  return 0
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  const results = await Promise.allSettled([
    prisma.trader.count({ where: { deletedAt: null } }),
    prisma.trader.count({ where: { deletedAt: null, locked: true } }),
    prisma.company.count({ where: { deletedAt: null } }),
    prisma.company.count({ where: { deletedAt: null, locked: true } }),
    prisma.user.count({ where: nonSuperAdminUserWhere }),
    prisma.user.count({
      where: {
        ...nonSuperAdminUserWhere,
        locked: true
      }
    }),
    prisma.purchaseBill.count(),
    prisma.salesBill.count()
  ])

  const stats = {
    totalTraders: safeCount(results[0]),
    lockedTraders: safeCount(results[1]),
    totalCompanies: safeCount(results[2]),
    lockedCompanies: safeCount(results[3]),
    totalUsers: safeCount(results[4]),
    lockedUsers: safeCount(results[5]),
    totalPurchaseBills: safeCount(results[6]),
    totalSalesBills: safeCount(results[7]),
    partial: results.some((result) => result.status === 'rejected'),
    lastUpdated: new Date().toISOString()
  }

  return NextResponse.json(stats)
}
