import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { assertFinancialYearOpenForDate, FinancialYearValidationError } from '@/lib/financial-years'

const cancelPurchaseBillSchema = z.object({
  companyId: z.string().trim().min(1, 'Company ID is required'),
  billId: z.string().trim().min(1, 'Bill ID is required')
})

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, cancelPurchaseBillSchema)
    if (!parsed.ok) return parsed.response

    const { companyId, billId } = parsed.data
    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const purchaseBill = await prisma.purchaseBill.findFirst({
      where: {
        id: billId,
        companyId
      },
      select: {
        id: true,
        status: true,
        billDate: true
      }
    })

    if (!purchaseBill) {
      return NextResponse.json({ error: 'Purchase bill not found' }, { status: 404 })
    }

    if (String(purchaseBill.status || '').toLowerCase() === 'cancelled') {
      return NextResponse.json({ success: true, message: 'Purchase bill already cancelled' })
    }

    await assertFinancialYearOpenForDate({
      companyId,
      date: purchaseBill.billDate,
      actionLabel: 'Purchase bill cancellation'
    })

    await prisma.$transaction(async (tx) => {
      const cancelledAt = new Date()

      await tx.stockLedger.deleteMany({
        where: {
          companyId,
          refTable: 'purchase_bills',
          refId: billId
        }
      })

      await tx.payment.updateMany({
        where: {
          companyId,
          billType: 'purchase',
          billId,
          deletedAt: null
        },
        data: {
          deletedAt: cancelledAt,
          status: 'pending'
        }
      })

      await tx.purchaseBill.update({
        where: { id: billId },
        data: {
          status: 'cancelled'
        }
      })
    })

    return NextResponse.json({ success: true, message: 'Purchase bill cancelled successfully' })
  } catch (error) {
    if (error instanceof FinancialYearValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
