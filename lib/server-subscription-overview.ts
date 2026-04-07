import 'server-only'

import { prisma } from '@/lib/prisma'
import { ensureSubscriptionManagementSchemaReady } from '@/lib/subscription-schema'
import {
  getCurrentTraderSubscription,
  getTraderSubscriptionEntitlement,
  getTraderSubscriptionHistory,
  getTraderSubscriptionPayments
} from '@/lib/subscription-core'
import { getTraderDataLifecycleSummary, getTraderBackupHistory } from '@/lib/trader-retention'
import { getTraderCapacitySnapshot } from '@/lib/trader-limits'

export async function loadSubscriptionOverviewData(traderId: string) {
  const trader = await prisma.trader.findFirst({
    where: {
      id: traderId,
      deletedAt: null
    },
    select: {
      id: true,
      name: true,
      locked: true,
      deletedAt: true,
      maxCompanies: true,
      maxUsers: true
    }
  })

  if (!trader) {
    throw new Error('Trader not found')
  }

  const schemaReady = await ensureSubscriptionManagementSchemaReady(prisma)
  const capacity = await getTraderCapacitySnapshot(prisma, trader.id)

  const [entitlement, currentSubscription, dataLifecycle, history, payments, backups] = schemaReady
    ? await Promise.all([
        getTraderSubscriptionEntitlement(prisma, trader.id, new Date(), trader),
        getCurrentTraderSubscription(prisma, trader.id),
        getTraderDataLifecycleSummary(prisma, trader.id, new Date(), {
          traderDeletedAt: trader.deletedAt
        }),
        getTraderSubscriptionHistory(prisma, trader.id),
        getTraderSubscriptionPayments(prisma, trader.id),
        getTraderBackupHistory(prisma, trader.id)
      ])
    : await Promise.all([
        Promise.resolve(null),
        Promise.resolve(null),
        Promise.resolve(null),
        Promise.resolve([]),
        Promise.resolve([]),
        Promise.resolve([])
      ])

  return {
    current: {
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
    },
    history: {
      history,
      backups,
      payments
    },
    schemaReady
  }
}
