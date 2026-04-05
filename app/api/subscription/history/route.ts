import { NextRequest, NextResponse } from 'next/server'

import { requireRoles } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { getTraderSubscriptionHistory } from '@/lib/subscription-core'
import { getTraderBackupHistory } from '@/lib/trader-retention'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const [history, payments, backups] = await Promise.all([
      getTraderSubscriptionHistory(prisma, authResult.auth.traderId),
      prisma.subscriptionPayment.findMany({
        where: {
          traderId: authResult.auth.traderId
        },
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }]
      }),
      getTraderBackupHistory(prisma, authResult.auth.traderId)
    ])

    return NextResponse.json({
      history,
      backups,
      payments: payments.map((payment) => ({
        id: payment.id,
        traderSubscriptionId: payment.traderSubscriptionId,
        planId: payment.planId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        paymentMode: payment.paymentMode,
        referenceNo: payment.referenceNo,
        paidAt: payment.paidAt?.toISOString() || null,
        confirmedAt: payment.confirmedAt?.toISOString() || null,
        confirmedByUserId: payment.confirmedByUserId,
        planNameSnapshot: payment.planNameSnapshot,
        notes: payment.notes,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString()
      }))
    })
  } catch (error) {
    console.error('subscription/history GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription history' }, { status: 500 })
  }
}
