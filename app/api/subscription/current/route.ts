import { NextRequest, NextResponse } from 'next/server'

import { requireRoles } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { getCurrentTraderSubscription, getTraderSubscriptionEntitlement } from '@/lib/subscription-core'
import { getTraderDataLifecycleSummary } from '@/lib/trader-retention'
import { getTraderCapacitySnapshot } from '@/lib/trader-limits'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const trader = await prisma.trader.findFirst({
      where: {
        id: authResult.auth.traderId,
        deletedAt: null
      },
      select: {
        id: true,
        name: true,
        locked: true,
        maxCompanies: true,
        maxUsers: true
      }
    })

    if (!trader) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    const [entitlement, currentSubscription, capacity, dataLifecycle] = await Promise.all([
      getTraderSubscriptionEntitlement(prisma, trader.id, new Date(), {
        ...trader,
        deletedAt: null
      }),
      getCurrentTraderSubscription(prisma, trader.id),
      getTraderCapacitySnapshot(prisma, trader.id),
      getTraderDataLifecycleSummary(prisma, trader.id, new Date(), {
        traderDeletedAt: null
      })
    ])

    return NextResponse.json({
      trader: {
        id: trader.id,
        name: trader.name,
        locked: trader.locked
      },
      entitlement,
      dataLifecycle,
      currentSubscription,
      capacity: capacity
        ? {
            maxCompanies: capacity.maxCompanies,
            maxUsers: capacity.maxUsers,
            currentCompanies: capacity.currentCompanies,
            currentUsers: capacity.currentUsers,
            limitSource: capacity.limitSource
          }
        : null
    })
  } catch (error) {
    console.error('subscription/current GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch current subscription' }, { status: 500 })
  }
}
