import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRoles } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { getCurrentTraderSubscription, getTraderSubscriptionEntitlement, getTraderSubscriptionHistory } from '@/lib/subscription-core'
import { getTraderBackupHistory, getTraderDataLifecycleSummary } from '@/lib/trader-retention'
import { getTraderCapacitySnapshot } from '@/lib/trader-limits'

const paramsSchema = z.object({
  traderId: z.string().trim().min(1)
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ traderId: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = paramsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid trader ID' }, { status: 400 })
    }

    const trader = await prisma.trader.findFirst({
      where: {
        id: parsedParams.data.traderId,
        deletedAt: null
      },
      select: {
        id: true,
        name: true,
        maxCompanies: true,
        maxUsers: true,
        locked: true,
        deletedAt: true
      }
    })

    if (!trader) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    const [capacity, entitlement, currentSubscription, history, payments, dataLifecycle, backups] = await Promise.all([
      getTraderCapacitySnapshot(prisma, trader.id),
      getTraderSubscriptionEntitlement(prisma, trader.id, new Date(), trader),
      getCurrentTraderSubscription(prisma, trader.id),
      getTraderSubscriptionHistory(prisma, trader.id),
      prisma.subscriptionPayment.findMany({
        where: {
          traderId: trader.id
        },
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }]
      }),
      getTraderDataLifecycleSummary(prisma, trader.id, new Date(), {
        traderDeletedAt: trader.deletedAt
      }),
      getTraderBackupHistory(prisma, trader.id)
    ])

    return NextResponse.json({
      trader: {
        id: trader.id,
        name: trader.name,
        locked: trader.locked,
        maxCompanies: capacity?.maxCompanies ?? trader.maxCompanies,
        maxUsers: capacity?.maxUsers ?? trader.maxUsers,
        currentCompanies: capacity?.currentCompanies ?? 0,
        currentUsers: capacity?.currentUsers ?? 0,
        limitSource: capacity?.limitSource ?? 'none'
      },
      entitlement,
      dataLifecycle,
      currentSubscription,
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
    console.error('trader-subscription detail GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch trader subscription detail' }, { status: 500 })
  }
}
