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
    const billCount = await prisma.purchaseBill.count()
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')

    if (companyId) {
      const companyBills = await prisma.purchaseBill.findMany({
        where: { companyId },
        include: {
          farmer: true
        },
        take: 5
      })

      return NextResponse.json({
        totalBills: billCount,
        companyBills,
        companyBillsCount: companyBills.length,
        companyId
      })
    }

    return NextResponse.json({
      totalBills: billCount,
      message: 'Provide companyId to inspect sample bills'
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
