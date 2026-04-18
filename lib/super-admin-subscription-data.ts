import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  getCurrentTraderSubscription,
  getTraderSubscriptionEntitlement,
  getTraderSubscriptionHistory,
  getTraderSubscriptionPayments
} from '@/lib/subscription-core'
import {
  normalizeSubscriptionStatus,
  normalizeSubscriptionType
} from '@/lib/subscription-config'
import {
  ensureSubscriptionManagementSchemaReady,
  SUBSCRIPTION_SCHEMA_WARNING_MESSAGE
} from '@/lib/subscription-schema'
import { getTraderCapacitySnapshot } from '@/lib/trader-limits'
import {
  getTraderBackupHistory,
  getTraderDataLifecycleSummary,
  normalizeTraderDataLifecycleState,
  resolveEffectiveTraderDataLifecycleState
} from '@/lib/trader-retention'

type DbClient = typeof prisma | Prisma.TransactionClient

const DAY_IN_MS = 86_400_000

type TraderListRow = {
  id: string
  name: string
  maxCompanies: number | null
  maxUsers: number | null
  locked: boolean
  deletedAt: Date | null
}

type TraderSubscriptionListRow = {
  id: string
  traderId: string
  subscriptionType: string
  status: string
  billingCycle: string | null
  amount: number
  currency: string
  planNameSnapshot: string | null
  startDate: Date
  endDate: Date
  trialDays: number | null
  maxCompaniesOverride: number | null
  maxUsersOverride: number | null
  updatedAt: Date
  plan: {
    name: string
    billingCycle: string
    maxCompanies: number | null
    maxUsers: number | null
  } | null
}

type TraderLifecycleRow = {
  traderId: string
  state: string
  latestReadyBackupAt: Date | null
  closureRequestedAt: Date | null
  scheduledDeletionAt: Date | null
}

type SubscriptionPlanRecord = {
  id: string
  name: string
  description: string | null
  billingCycle: string
  amount: number
  currency: string
  maxCompanies: number | null
  maxUsers: number | null
  defaultTrialDays: number | null
  isActive: boolean
  isTrialCapable: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  features: Array<{
    id: string
    featureKey: string
    featureLabel: string
    description: string | null
    enabled: boolean
    sortOrder: number
  }>
  _count?: {
    subscriptions: number
  }
}

export type SuperAdminSubscriptionPlan = {
  id: string
  name: string
  description: string | null
  billingCycle: string
  amount: number
  currency: string
  maxCompanies: number | null
  maxUsers: number | null
  defaultTrialDays: number | null
  isActive: boolean
  isTrialCapable: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  features: Array<{
    id: string
    featureKey: string
    featureLabel: string
    description: string | null
    enabled: boolean
    sortOrder: number
  }>
  subscriptionCount: number
}

export type TraderSubscriptionListItem = {
  id: string
  name: string
  locked: boolean
  currentCompanies: number
  currentUsers: number
  maxCompanies: number | null
  maxUsers: number | null
  limitSource: 'subscription' | 'legacy' | 'hybrid' | 'none'
  subscriptionConfigured: boolean
  subscriptionState: string
  subscriptionMessage: string | null
  dataLifecycleState: string
  readOnlyMode: boolean
  lifecycleMessage: string | null
  daysLeft: number | null
  currentPlanName: string | null
  subscriptionType: string | null
  status: string | null
  startDate: string | null
  endDate: string | null
  amount: number | null
  currency: string | null
  billingCycle: string | null
  latestReadyBackupAt: string | null
  closureRequestedAt: string | null
  scheduledDeletionAt: string | null
}

export type SuperAdminClosureQueueStage = 'closure_requested' | 'backup_ready' | 'deletion_pending'

export type SuperAdminClosureQueueItem = {
  id: string
  name: string
  locked: boolean
  queueStage: SuperAdminClosureQueueStage
  currentPlanName: string | null
  subscriptionState: string
  dataLifecycleState: string
  lifecycleMessage: string | null
  daysLeft: number | null
  latestReadyBackupAt: string | null
  closureRequestedAt: string | null
  scheduledDeletionAt: string | null
}

export type TraderSubscriptionDetailPayload = {
  trader?: {
    id: string
    name: string
    locked: boolean
    maxCompanies: number | null
    maxUsers: number | null
    currentCompanies: number
    currentUsers: number
    limitSource: string
  }
  entitlement?: {
    lifecycleState?: string
    message?: string | null
    daysLeft?: number | null
  } | null
  dataLifecycle?: {
    state?: string | null
    readOnlyMode?: boolean
    message?: string | null
    allowBackupRequest?: boolean
    latestBackup?: {
      id: string
      status: string
      fileName: string | null
      createdAt: string
      exportedAt: string | null
    } | null
    latestReadyBackup?: {
      id: string
      status: string
      fileName: string | null
      createdAt: string
      exportedAt: string | null
    } | null
    closureRequestedAt?: string | null
    closureRequestSource?: string | null
    closureNotes?: string | null
    retentionDays?: number | null
    scheduledDeletionAt?: string | null
  } | null
  currentSubscription?: {
    id: string
    planName: string | null
    subscriptionType: string
    lifecycleState: string
    status: string
    billingCycle: string | null
    amount: number
    currency: string
    startDate: string
    endDate: string
    features: Array<{ featureKey: string; featureLabel: string; enabled: boolean }>
  } | null
  history?: Array<{
    id: string
    planName: string | null
    subscriptionType: string
    lifecycleState: string
    status: string
    startDate: string
    endDate: string
    amount: number
    currency: string
  }>
  payments?: Array<{
    id: string
    amount: number
    currency: string
    status: string
    paymentMode: string
    referenceNo: string | null
    paidAt: string | null
    planNameSnapshot: string | null
  }>
  backups?: Array<{
    id: string
    status: string
    format: string
    fileName: string | null
    exportedAt: string | null
    failedAt?: string | null
    downloadCount: number
    createdAt: string
    errorMessage?: string | null
  }>
}

export type SuperAdminSubscriptionPlansResult = {
  schemaReady: boolean
  schemaWarning: string | null
  plans: SuperAdminSubscriptionPlan[]
}

export type SuperAdminTraderSubscriptionRowsResult = {
  schemaReady: boolean
  schemaWarning: string | null
  rows: TraderSubscriptionListItem[]
}

export type SuperAdminTraderSubscriptionDetailResult = {
  schemaReady: boolean
  schemaWarning: string | null
  detail: TraderSubscriptionDetailPayload | null
}

export type SuperAdminClosureQueueResult = {
  schemaReady: boolean
  schemaWarning: string | null
  summary: {
    closureRequested: number
    backupReady: number
    deletionPending: number
  }
  rows: SuperAdminClosureQueueItem[]
}

export type SuperAdminSubscriptionBootstrap = {
  schemaReady: boolean
  schemaWarning: string | null
  plans: SuperAdminSubscriptionPlan[]
  traders: TraderSubscriptionListItem[]
  selectedTraderId: string
  detail: TraderSubscriptionDetailPayload | null
}

function normalizePositiveInteger(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const normalized = Math.trunc(value)
  return normalized >= 0 ? normalized : null
}

function calculateDaysLeft(endDate: Date | null | undefined, now: Date) {
  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
    return null
  }

  const diff = endDate.getTime() - now.getTime()
  if (diff <= 0) return 0
  return Math.ceil(diff / DAY_IN_MS)
}

function mergeLimitValue(subscriptionValue: number | null, legacyValue: number | null) {
  if (subscriptionValue === null && legacyValue === null) return null
  if (subscriptionValue === null) return legacyValue
  if (legacyValue === null) return subscriptionValue
  return Math.min(subscriptionValue, legacyValue)
}

function resolveLimitSource(args: {
  subscriptionMaxCompanies: number | null
  subscriptionMaxUsers: number | null
  legacyMaxCompanies: number | null
  legacyMaxUsers: number | null
}) {
  const hasSubscriptionLimits = args.subscriptionMaxCompanies !== null || args.subscriptionMaxUsers !== null
  const hasLegacyLimits = args.legacyMaxCompanies !== null || args.legacyMaxUsers !== null

  if (hasSubscriptionLimits && hasLegacyLimits) return 'hybrid' as const
  if (hasSubscriptionLimits) return 'subscription' as const
  if (hasLegacyLimits) return 'legacy' as const
  return 'none' as const
}

function toSubscriptionLifecycleState(subscriptionType: string, status: string) {
  const normalizedType = normalizeSubscriptionType(subscriptionType)
  const normalizedStatus = normalizeSubscriptionStatus(status)

  if (normalizedStatus === 'active') {
    return normalizedType === 'trial' ? 'trial' : 'active'
  }
  if (normalizedStatus === 'pending') return 'pending'
  if (normalizedStatus === 'expired') return 'expired'
  if (normalizedStatus === 'cancelled') return 'cancelled'
  if (normalizedStatus === 'suspended') return 'suspended'
  return 'none'
}

function getSubscriptionMessage(args: {
  lifecycleState: 'none' | 'pending' | 'trial' | 'active' | 'expired' | 'cancelled' | 'suspended'
  isConfigured: boolean
  planName: string | null
  startDate: Date | null
  daysLeft: number | null
}) {
  const planName = args.planName || 'subscription'

  if (!args.isConfigured || args.lifecycleState === 'none') {
    return 'Subscription not assigned yet. Please contact admin.'
  }

  if (args.lifecycleState === 'trial') {
    if ((args.daysLeft || 0) <= 0) {
      return 'Trial expired. Please renew or contact admin.'
    }
    return `${planName} trial expires in ${args.daysLeft} day${args.daysLeft === 1 ? '' : 's'}.`
  }

  if (args.lifecycleState === 'active') {
    if ((args.daysLeft || 0) <= 7) {
      return `${planName} expires in ${args.daysLeft} day${args.daysLeft === 1 ? '' : 's'}.`
    }
    return null
  }

  if (args.lifecycleState === 'pending') {
    return args.startDate
      ? `Subscription starts on ${args.startDate.toLocaleDateString('en-IN')}.`
      : 'Subscription is pending activation.'
  }

  if (args.lifecycleState === 'expired') {
    return 'Subscription expired. ERP is now in read-only mode. Please renew, download backup, or contact admin.'
  }

  if (args.lifecycleState === 'cancelled') {
    return 'Subscription cancelled. ERP is now in read-only mode. Please renew, download backup, or contact admin.'
  }

  if (args.lifecycleState === 'suspended') {
    return 'Subscription suspended. ERP is now in read-only mode. Please contact admin.'
  }

  return null
}

function isReadOnlyState(state: string) {
  return state === 'expired' || state === 'cancelled' || state === 'backup_ready' || state === 'deletion_pending'
}

function buildLifecycleMessage(args: {
  effectiveState: string
  subscriptionMessage: string | null
  latestReadyBackupAt: Date | null
  closureRequestedAt: Date | null
}) {
  if (args.effectiveState === 'deleted') {
    return 'Trader data was permanently removed after backup confirmation.'
  }

  if (args.effectiveState === 'deletion_pending') {
    return 'Account is marked for final deletion. Business data remains read-only until super admin confirms closure.'
  }

  if (args.effectiveState === 'backup_ready') {
    return args.latestReadyBackupAt
      ? 'Backup is ready for download. Business data remains read-only until renewal or final closure.'
      : 'Backup generation completed. Business data remains read-only until renewal or final closure.'
  }

  if (args.effectiveState === 'cancelled') {
    return 'Subscription cancelled. Business data is available in read-only mode. Renew, download backup, or request closure.'
  }

  if (args.effectiveState === 'expired') {
    return 'Subscription expired. Business data is available in read-only mode. Renew, download backup, or contact admin.'
  }

  if (args.closureRequestedAt) {
    return 'Closure request is active and waiting for review. It can still be cancelled before final processing.'
  }

  return args.subscriptionMessage
}

function hasClosureRequestMessage(message: string | null | undefined) {
  return String(message || '').toLowerCase().includes('closure request submitted')
}

function deriveClosureQueueStage(row: TraderSubscriptionListItem): SuperAdminClosureQueueStage | null {
  if (row.dataLifecycleState === 'deletion_pending') {
    return 'deletion_pending'
  }

  if (row.dataLifecycleState === 'backup_ready') {
    return 'backup_ready'
  }

  if (hasClosureRequestMessage(row.lifecycleMessage)) {
    return 'closure_requested'
  }

  return null
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0
  const parsed = new Date(value)
  const time = parsed.getTime()
  return Number.isFinite(time) ? time : 0
}

function compareClosureQueueItems(left: SuperAdminClosureQueueItem, right: SuperAdminClosureQueueItem) {
  const priority: Record<SuperAdminClosureQueueStage, number> = {
    deletion_pending: 0,
    backup_ready: 1,
    closure_requested: 2
  }

  if (priority[left.queueStage] !== priority[right.queueStage]) {
    return priority[left.queueStage] - priority[right.queueStage]
  }

  if (left.queueStage === 'deletion_pending' && right.queueStage === 'deletion_pending') {
    const leftTime = toTimestamp(left.scheduledDeletionAt) || Number.MAX_SAFE_INTEGER
    const rightTime = toTimestamp(right.scheduledDeletionAt) || Number.MAX_SAFE_INTEGER
    if (leftTime !== rightTime) {
      return leftTime - rightTime
    }
  } else if (left.queueStage === 'backup_ready' && right.queueStage === 'backup_ready') {
    const leftTime = toTimestamp(left.latestReadyBackupAt)
    const rightTime = toTimestamp(right.latestReadyBackupAt)
    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }
  } else {
    const leftTime = toTimestamp(left.closureRequestedAt)
    const rightTime = toTimestamp(right.closureRequestedAt)
    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }
  }

  return left.name.localeCompare(right.name)
}

function compareRelevantSubscriptions(left: TraderSubscriptionListRow, right: TraderSubscriptionListRow) {
  const leftStatus = normalizeSubscriptionStatus(left.status)
  const rightStatus = normalizeSubscriptionStatus(right.status)
  const leftNonTerminal = leftStatus === 'pending' || leftStatus === 'active' || leftStatus === 'suspended'
  const rightNonTerminal = rightStatus === 'pending' || rightStatus === 'active' || rightStatus === 'suspended'

  if (leftNonTerminal !== rightNonTerminal) {
    return leftNonTerminal ? -1 : 1
  }

  if (leftNonTerminal && rightNonTerminal) {
    if (left.startDate.getTime() !== right.startDate.getTime()) {
      return right.startDate.getTime() - left.startDate.getTime()
    }
  } else if (left.endDate.getTime() !== right.endDate.getTime()) {
    return right.endDate.getTime() - left.endDate.getTime()
  }

  return right.updatedAt.getTime() - left.updatedAt.getTime()
}

async function synchronizeTraderSubscriptions(db: DbClient, traderIds: string[], now: Date) {
  if (traderIds.length === 0) return

  await Promise.all([
    db.traderSubscription.updateMany({
      where: {
        traderId: { in: traderIds },
        status: 'pending',
        startDate: {
          lte: now
        },
        endDate: {
          gt: now
        }
      },
      data: {
        status: 'active',
        activatedAt: now,
        expiredAt: null
      }
    }),
    db.traderSubscription.updateMany({
      where: {
        traderId: { in: traderIds },
        status: {
          in: ['pending', 'active', 'suspended']
        },
        endDate: {
          lte: now
        }
      },
      data: {
        status: 'expired',
        expiredAt: now
      }
    })
  ])
}

export function normalizeSubscriptionPlanForResponse(plan: SubscriptionPlanRecord): SuperAdminSubscriptionPlan {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    billingCycle: plan.billingCycle,
    amount: plan.amount,
    currency: plan.currency,
    maxCompanies: plan.maxCompanies,
    maxUsers: plan.maxUsers,
    defaultTrialDays: plan.defaultTrialDays,
    isActive: plan.isActive,
    isTrialCapable: plan.isTrialCapable,
    sortOrder: plan.sortOrder,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    features: plan.features.map((feature) => ({
      id: feature.id,
      featureKey: feature.featureKey,
      featureLabel: feature.featureLabel,
      description: feature.description,
      enabled: feature.enabled,
      sortOrder: feature.sortOrder
    })),
    subscriptionCount: plan._count?.subscriptions ?? 0
  }
}

async function fetchSuperAdminSubscriptionPlans(
  db: DbClient,
  schemaReady: boolean,
  includeInactive: boolean
) {
  if (!schemaReady) {
    return []
  }

  const plans = await db.subscriptionPlan.findMany({
    where: includeInactive ? undefined : { isActive: true },
    include: {
      features: {
        orderBy: [{ sortOrder: 'asc' }, { featureLabel: 'asc' }]
      },
      _count: {
        select: {
          subscriptions: true
        }
      }
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
  })

  return plans.map((plan) => normalizeSubscriptionPlanForResponse(plan))
}

async function fetchSuperAdminTraderSubscriptionRows(
  db: DbClient,
  schemaReady: boolean,
  options: {
    query?: string
    state?: string
    expiringWithinDays?: number | null
    includeLocked?: boolean
    now?: Date
  }
) {
  const query = String(options.query || '').trim().toLowerCase()
  const stateFilter = String(options.state || '').trim().toLowerCase()
  const expiringWithinDays = options.expiringWithinDays ?? null
  const includeLocked = Boolean(options.includeLocked)
  const now = options.now || new Date()

  const traders = await db.trader.findMany({
    where: {
      deletedAt: null,
      ...(includeLocked ? {} : { locked: false })
    },
    select: {
      id: true,
      name: true,
      maxCompanies: true,
      maxUsers: true,
      locked: true,
      deletedAt: true
    },
    orderBy: [{ name: 'asc' }]
  })

  if (traders.length === 0) {
    return []
  }

  const traderIds = traders.map((trader) => trader.id)

  if (schemaReady) {
    await synchronizeTraderSubscriptions(db, traderIds, now)
  }

  const [companyCounts, userCounts, subscriptions, lifecycles] = await Promise.all([
    db.company.groupBy({
      by: ['traderId'],
      where: {
        traderId: {
          in: traderIds
        },
        deletedAt: null
      },
      _count: {
        _all: true
      }
    }),
    db.user.groupBy({
      by: ['traderId'],
      where: {
        traderId: {
          in: traderIds
        },
        deletedAt: null,
        NOT: [{ role: 'SUPER_ADMIN' }, { role: 'super_admin' }]
      },
      _count: {
        _all: true
      }
    }),
    schemaReady
      ? db.traderSubscription.findMany({
          where: {
            traderId: {
              in: traderIds
            }
          },
          select: {
            id: true,
            traderId: true,
            subscriptionType: true,
            status: true,
            billingCycle: true,
            amount: true,
            currency: true,
            planNameSnapshot: true,
            startDate: true,
            endDate: true,
            trialDays: true,
            maxCompaniesOverride: true,
            maxUsersOverride: true,
            updatedAt: true,
            plan: {
              select: {
                name: true,
                billingCycle: true,
                maxCompanies: true,
                maxUsers: true
              }
            }
          }
        })
      : Promise.resolve([] as TraderSubscriptionListRow[]),
    schemaReady
      ? db.traderDataLifecycle.findMany({
          where: {
            traderId: {
              in: traderIds
            }
          },
          select: {
            traderId: true,
            state: true,
            latestReadyBackupAt: true,
            closureRequestedAt: true,
            scheduledDeletionAt: true
          }
        })
      : Promise.resolve([] as TraderLifecycleRow[])
  ])

  const companyCountMap = new Map(
    companyCounts.map((row) => [String(row.traderId || ''), normalizePositiveInteger(row._count._all) ?? 0])
  )
  const userCountMap = new Map(
    userCounts.map((row) => [String(row.traderId || ''), normalizePositiveInteger(row._count._all) ?? 0])
  )

  const subscriptionMap = new Map<string, TraderSubscriptionListRow>()
  for (const subscription of subscriptions) {
    const existing = subscriptionMap.get(subscription.traderId)
    if (!existing || compareRelevantSubscriptions(subscription, existing) < 0) {
      subscriptionMap.set(subscription.traderId, subscription)
    }
  }

  const lifecycleMap = new Map(lifecycles.map((row) => [row.traderId, row]))

  const rows = traders.map((trader: TraderListRow) => {
    const subscription = subscriptionMap.get(trader.id) || null
    const lifecycle = lifecycleMap.get(trader.id) || null

    const currentCompanies = companyCountMap.get(trader.id) ?? 0
    const currentUsers = userCountMap.get(trader.id) ?? 0

    const subscriptionMaxCompanies = subscription
      ? normalizePositiveInteger(subscription.maxCompaniesOverride ?? subscription.plan?.maxCompanies ?? null)
      : null
    const subscriptionMaxUsers = subscription
      ? normalizePositiveInteger(subscription.maxUsersOverride ?? subscription.plan?.maxUsers ?? null)
      : null
    const legacyMaxCompanies = normalizePositiveInteger(trader.maxCompanies)
    const legacyMaxUsers = normalizePositiveInteger(trader.maxUsers)
    const subscriptionState = subscription
      ? toSubscriptionLifecycleState(subscription.subscriptionType, subscription.status)
      : 'none'
    const daysLeft = subscription ? calculateDaysLeft(subscription.endDate, now) : null
    const currentPlanName = subscription?.planNameSnapshot || subscription?.plan?.name || null
    const subscriptionMessage = getSubscriptionMessage({
      lifecycleState: subscriptionState,
      isConfigured: Boolean(subscription),
      planName: currentPlanName,
      startDate: subscription?.startDate || null,
      daysLeft
    })
    const dataLifecycleState = schemaReady
      ? resolveEffectiveTraderDataLifecycleState({
          configuredState: lifecycle ? normalizeTraderDataLifecycleState(lifecycle.state) : null,
          traderDeleted: Boolean(trader.deletedAt),
          subscriptionLifecycleState: subscriptionState
        })
      : 'active'

    return {
      id: trader.id,
      name: trader.name,
      locked: trader.locked,
      currentCompanies,
      currentUsers,
      maxCompanies: mergeLimitValue(subscriptionMaxCompanies, legacyMaxCompanies),
      maxUsers: mergeLimitValue(subscriptionMaxUsers, legacyMaxUsers),
      limitSource: resolveLimitSource({
        subscriptionMaxCompanies,
        subscriptionMaxUsers,
        legacyMaxCompanies,
        legacyMaxUsers
      }),
      subscriptionConfigured: Boolean(subscription),
      subscriptionState,
      subscriptionMessage,
      dataLifecycleState,
      readOnlyMode: isReadOnlyState(dataLifecycleState),
      lifecycleMessage: buildLifecycleMessage({
        effectiveState: dataLifecycleState,
        subscriptionMessage,
        latestReadyBackupAt: lifecycle?.latestReadyBackupAt || null,
        closureRequestedAt: lifecycle?.closureRequestedAt || null
      }),
      daysLeft,
      currentPlanName,
      subscriptionType: subscription ? normalizeSubscriptionType(subscription.subscriptionType) : null,
      status: subscription ? normalizeSubscriptionStatus(subscription.status) : null,
      startDate: subscription?.startDate?.toISOString() || null,
      endDate: subscription?.endDate?.toISOString() || null,
      amount: subscription?.amount ?? null,
      currency: subscription?.currency ?? null,
      billingCycle: subscription?.billingCycle || subscription?.plan?.billingCycle || null,
      latestReadyBackupAt: lifecycle?.latestReadyBackupAt?.toISOString() || null,
      closureRequestedAt: lifecycle?.closureRequestedAt?.toISOString() || null,
      scheduledDeletionAt: lifecycle?.scheduledDeletionAt?.toISOString() || null
    }
  })

  const filtered = rows.filter((row) => {
    if (query.length > 0) {
      const haystack = `${row.name} ${row.currentPlanName || ''} ${row.subscriptionState}`.toLowerCase()
      if (!haystack.includes(query)) {
        return false
      }
    }

    if (stateFilter) {
      if (stateFilter === 'closure_requested') {
        if (!String(row.lifecycleMessage || '').toLowerCase().includes('closure request submitted')) {
          return false
        }
      } else if (row.subscriptionState !== stateFilter && row.dataLifecycleState !== stateFilter) {
        return false
      }
    }

    if (schemaReady && expiringWithinDays !== null && Number.isFinite(expiringWithinDays) && expiringWithinDays >= 0) {
      if (row.daysLeft === null || row.daysLeft > expiringWithinDays) {
        return false
      }
    }

    return true
  })

  filtered.sort((left, right) => {
    const leftDays = left.daysLeft ?? Number.MAX_SAFE_INTEGER
    const rightDays = right.daysLeft ?? Number.MAX_SAFE_INTEGER
    if (leftDays !== rightDays) {
      return leftDays - rightDays
    }
    return left.name.localeCompare(right.name)
  })

  return filtered
}

async function fetchSuperAdminTraderSubscriptionDetail(
  db: DbClient,
  schemaReady: boolean,
  traderId: string,
  now: Date
) {
  const trader = await db.trader.findFirst({
    where: {
      id: traderId,
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
    return null
  }

  const capacity = await getTraderCapacitySnapshot(db, trader.id)
  const [entitlement, currentSubscription, history, payments, dataLifecycle, backups] = schemaReady
    ? await Promise.all([
        getTraderSubscriptionEntitlement(db, trader.id, now, trader),
        getCurrentTraderSubscription(db, trader.id, now),
        getTraderSubscriptionHistory(db, trader.id, now),
        getTraderSubscriptionPayments(db, trader.id),
        getTraderDataLifecycleSummary(db, trader.id, now, {
          traderDeletedAt: trader.deletedAt
        }),
        getTraderBackupHistory(db, trader.id)
      ])
    : await Promise.all([
        Promise.resolve(null),
        Promise.resolve(null),
        Promise.resolve([]),
        Promise.resolve([]),
        Promise.resolve(null),
        Promise.resolve([])
      ])

  return {
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
    payments
  } satisfies TraderSubscriptionDetailPayload
}

export async function getSuperAdminSubscriptionPlans(
  db: DbClient,
  options: {
    includeInactive?: boolean
  } = {}
): Promise<SuperAdminSubscriptionPlansResult> {
  const schemaReady = await ensureSubscriptionManagementSchemaReady(db)
  const plans = await fetchSuperAdminSubscriptionPlans(db, schemaReady, options.includeInactive ?? true)

  return {
    schemaReady,
    schemaWarning: schemaReady ? null : SUBSCRIPTION_SCHEMA_WARNING_MESSAGE,
    plans
  }
}

export async function getSuperAdminTraderSubscriptionRows(
  db: DbClient,
  options: {
    query?: string
    state?: string
    expiringWithinDays?: number | null
    includeLocked?: boolean
    now?: Date
  } = {}
): Promise<SuperAdminTraderSubscriptionRowsResult> {
  const schemaReady = await ensureSubscriptionManagementSchemaReady(db)
  const rows = await fetchSuperAdminTraderSubscriptionRows(db, schemaReady, options)

  return {
    schemaReady,
    schemaWarning: schemaReady ? null : SUBSCRIPTION_SCHEMA_WARNING_MESSAGE,
    rows
  }
}

export async function getSuperAdminTraderSubscriptionDetail(
  db: DbClient,
  traderId: string,
  now = new Date()
): Promise<SuperAdminTraderSubscriptionDetailResult> {
  const schemaReady = await ensureSubscriptionManagementSchemaReady(db)
  const detail = await fetchSuperAdminTraderSubscriptionDetail(db, schemaReady, traderId, now)

  return {
    schemaReady,
    schemaWarning: schemaReady ? null : SUBSCRIPTION_SCHEMA_WARNING_MESSAGE,
    detail
  }
}

export async function getSuperAdminClosureQueue(
  db: DbClient,
  options: {
    limit?: number
    now?: Date
  } = {}
): Promise<SuperAdminClosureQueueResult> {
  const schemaReady = await ensureSubscriptionManagementSchemaReady(db)
  const rows = await fetchSuperAdminTraderSubscriptionRows(db, schemaReady, {
    includeLocked: true,
    now: options.now
  })
  const queueRows: SuperAdminClosureQueueItem[] = []

  for (const row of rows) {
    const queueStage = deriveClosureQueueStage(row)
    if (!queueStage) continue

    queueRows.push({
      id: row.id,
      name: row.name,
      locked: row.locked,
      queueStage,
      currentPlanName: row.currentPlanName,
      subscriptionState: row.subscriptionState,
      dataLifecycleState: row.dataLifecycleState,
      lifecycleMessage: row.lifecycleMessage,
      daysLeft: row.daysLeft,
      latestReadyBackupAt: row.latestReadyBackupAt,
      closureRequestedAt: row.closureRequestedAt,
      scheduledDeletionAt: row.scheduledDeletionAt
    })
  }

  const sortedRows = queueRows.sort(compareClosureQueueItems)
  const limit =
    typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(1, Math.trunc(options.limit))
      : 6

  return {
    schemaReady,
    schemaWarning: schemaReady ? null : SUBSCRIPTION_SCHEMA_WARNING_MESSAGE,
    summary: {
      closureRequested: sortedRows.filter((row) => row.queueStage === 'closure_requested').length,
      backupReady: sortedRows.filter((row) => row.queueStage === 'backup_ready').length,
      deletionPending: sortedRows.filter((row) => row.queueStage === 'deletion_pending').length
    },
    rows: sortedRows.slice(0, limit)
  }
}

export async function getSuperAdminSubscriptionBootstrap(
  db: DbClient,
  options: {
    requestedTraderId?: string
    query?: string
    state?: string
    expiringWithinDays?: number | null
    includeLocked?: boolean
  } = {}
): Promise<SuperAdminSubscriptionBootstrap> {
  const schemaReady = await ensureSubscriptionManagementSchemaReady(db)
  const now = new Date()

  const [plans, traders] = await Promise.all([
    fetchSuperAdminSubscriptionPlans(db, schemaReady, true),
    fetchSuperAdminTraderSubscriptionRows(db, schemaReady, {
      query: options.query,
      state: options.state,
      expiringWithinDays: options.expiringWithinDays,
      includeLocked: options.includeLocked,
      now
    })
  ])

  const normalizedRequestedTraderId = String(options.requestedTraderId || '').trim()
  const selectedTraderId = traders.some((row) => row.id === normalizedRequestedTraderId)
    ? normalizedRequestedTraderId
    : (traders[0]?.id ?? '')

  const detail = selectedTraderId
    ? await fetchSuperAdminTraderSubscriptionDetail(db, schemaReady, selectedTraderId, now)
    : null

  return {
    schemaReady,
    schemaWarning: schemaReady ? null : SUBSCRIPTION_SCHEMA_WARNING_MESSAGE,
    plans,
    traders,
    selectedTraderId,
    detail
  }
}
