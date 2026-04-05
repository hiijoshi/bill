import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTraderSubscriptionEntitlement } from '@/lib/subscription-core'
import { ensureSubscriptionManagementSchemaReady } from '@/lib/subscription-schema'
import { getTraderDataLifecycleSummary } from '@/lib/trader-retention'

type DbClient = typeof prisma | Prisma.TransactionClient

export type TraderCapacitySnapshot = {
  id: string
  name: string
  locked: boolean
  maxCompanies: number | null
  maxUsers: number | null
  currentCompanies: number
  currentUsers: number
  limitSource: 'subscription' | 'legacy' | 'hybrid' | 'none'
  subscriptionState: 'none' | 'pending' | 'trial' | 'active' | 'expired' | 'cancelled' | 'suspended'
  subscriptionMessage: string | null
  subscriptionConfigured: boolean
  canManageCompanies: boolean
  canManageUsers: boolean
}

export function normalizeTraderLimitInput(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return 0
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return undefined
  return parsed
}

export async function getTraderCapacitySnapshot(
  db: DbClient,
  traderId: string
): Promise<TraderCapacitySnapshot | null> {
  const trader = await db.trader.findFirst({
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

  if (!trader) return null

  const [currentCompanies, currentUsers] = await Promise.all([
    db.company.count({
      where: {
        traderId,
        deletedAt: null
      }
    }),
    db.user.count({
      where: {
        traderId,
        deletedAt: null,
        NOT: [{ role: 'SUPER_ADMIN' }, { role: 'super_admin' }]
      }
    })
  ])

  const schemaReady = await ensureSubscriptionManagementSchemaReady(db)
  if (!schemaReady) {
    return {
      ...trader,
      maxCompanies: trader.maxCompanies,
      maxUsers: trader.maxUsers,
      currentCompanies,
      currentUsers,
      limitSource: 'legacy',
      subscriptionState: 'none',
      subscriptionMessage: null,
      subscriptionConfigured: false,
      canManageCompanies: true,
      canManageUsers: true
    }
  }

  const entitlement = await getTraderSubscriptionEntitlement(db, traderId, new Date(), trader)
  const dataLifecycle = await getTraderDataLifecycleSummary(db, traderId, new Date(), {
    entitlement,
    traderDeletedAt: trader.deletedAt
  })
  const lifecycleAllowsWrites = dataLifecycle ? dataLifecycle.allowWriteOperations : true
  const lifecycleMessage = dataLifecycle?.message || null

  return {
    ...trader,
    maxCompanies: entitlement?.limits.maxCompanies ?? trader.maxCompanies,
    maxUsers: entitlement?.limits.maxUsers ?? trader.maxUsers,
    currentCompanies,
    currentUsers,
    limitSource: entitlement?.limits.source || 'legacy',
    subscriptionState: entitlement?.lifecycleState || 'none',
    subscriptionMessage: lifecycleMessage || entitlement?.message || null,
    subscriptionConfigured: entitlement?.isConfigured || false,
    canManageCompanies:
      lifecycleAllowsWrites &&
      (!entitlement ||
        !entitlement.isConfigured ||
        entitlement.lifecycleState === 'trial' ||
        entitlement.lifecycleState === 'active'),
    canManageUsers:
      lifecycleAllowsWrites &&
      (!entitlement ||
        !entitlement.isConfigured ||
        entitlement.lifecycleState === 'trial' ||
        entitlement.lifecycleState === 'active')
  }
}
