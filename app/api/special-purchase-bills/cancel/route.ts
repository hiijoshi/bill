import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'

const cancelSpecialPurchaseBillSchema = z.object({
  companyId: z.string().trim().min(1, 'Company ID is required'),
  billId: z.string().trim().min(1, 'Bill ID is required')
})

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, cancelSpecialPurchaseBillSchema)
    if (!parsed.ok) return parsed.response

    const { companyId, billId } = parsed.data
    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const specialPurchaseBill = await prisma.specialPurchaseBill.findFirst({
      where: {
        id: billId,
        companyId
      },
      select: {
        id: true,
        status: true
      }
    })

    if (!specialPurchaseBill) {
      return NextResponse.json({ error: 'Special purchase bill not found' }, { status: 404 })
    }

    if (String(specialPurchaseBill.status || '').toLowerCase() === 'cancelled') {
      return NextResponse.json({ success: true, message: 'Special purchase bill already cancelled' })
    }

    await prisma.$transaction(async (tx) => {
      const cancelledAt = new Date()

      await tx.stockLedger.deleteMany({
        where: {
          companyId,
          refTable: 'special_purchase_bills',
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

      await tx.specialPurchaseBill.update({
        where: { id: billId },
        data: {
          status: 'cancelled'
        }
      })
    })

    return NextResponse.json({ success: true, message: 'Special purchase bill cancelled successfully' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
