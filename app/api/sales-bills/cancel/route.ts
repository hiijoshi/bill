import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'

const cancelSalesBillSchema = z.object({
  companyId: z.string().trim().min(1, 'Company ID is required'),
  billId: z.string().trim().min(1, 'Bill ID is required')
})

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, cancelSalesBillSchema)
    if (!parsed.ok) return parsed.response

    const { companyId, billId } = parsed.data
    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const salesBill = await prisma.salesBill.findFirst({
      where: {
        id: billId,
        companyId
      },
      select: {
        id: true,
        status: true
      }
    })

    if (!salesBill) {
      return NextResponse.json({ error: 'Sales bill not found' }, { status: 404 })
    }

    if (String(salesBill.status || '').toLowerCase() === 'cancelled') {
      return NextResponse.json({ success: true, message: 'Sales bill already cancelled' })
    }

    await prisma.$transaction(async (tx) => {
      const cancelledAt = new Date()

      await tx.stockLedger.deleteMany({
        where: {
          companyId,
          refTable: 'sales_bills',
          refId: billId
        }
      })

      await tx.payment.updateMany({
        where: {
          companyId,
          billType: 'sales',
          billId,
          deletedAt: null
        },
        data: {
          deletedAt: cancelledAt,
          status: 'pending'
        }
      })

      await tx.salesBill.update({
        where: { id: billId },
        data: {
          status: 'cancelled'
        }
      })
    })

    return NextResponse.json({ success: true, message: 'Sales bill cancelled successfully' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
