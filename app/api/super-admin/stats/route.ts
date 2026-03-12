import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRoles } from '@/lib/api-security'

export async function GET(request: NextRequest) {
  try {
    const authResult = requireRoles(request, ['super_admin'])
    if (!authResult.ok) return authResult.response

    // Get system statistics (read-only)
    const [
      traderCount,
      companyCount,
      userCount,
      purchaseBillCount,
      salesBillCount
    ] = await Promise.all([
      prisma.trader.count({ where: { deletedAt: null } }),
      prisma.company.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.purchaseBill.count(),
      prisma.salesBill.count()
    ])

    const stats = {
      totalTraders: traderCount,
      totalCompanies: companyCount,
      totalUsers: userCount,
      totalPurchaseBills: purchaseBillCount,
      totalSalesBills: salesBillCount,
      totalAmount: 0, // Could be calculated if needed
      lastUpdated: new Date().toISOString()
    }

    return NextResponse.json(stats)

  } catch (error) {
    void error
    return NextResponse.json({ 
      error: 'Failed to load statistics'
    }, { status: 500 })
  }
}
