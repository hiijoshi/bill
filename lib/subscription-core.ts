import type { PermissionAction, PermissionModule } from '@/lib/permissions'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  PERMISSION_MODULE_TO_SUBSCRIPTION_FEATURE,
  normalizeSubscriptionStatus,
  normalizeSubscriptionType,
  type SubscriptionStatus,
  type SubscriptionType
} from '@/lib/subscription-config'

type DbClient = typeof prisma | Prisma.TransactionClient

const DAY_IN_MS = 86_400_000
const NON_TERMINAL_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['pending', 'active', 'suspended']
const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['active']

const traderSubscriptionInclude = Prisma.validator<Prisma.TraderSubscriptionInclude>()({
  plan: {
    include: {
      features: {
        orderBy: [{ sortOrder: 'asc' }, { featureLabel: 'asc' }]
      }
    }
  },
  features: {
    orderBy: [{ sortOrder: 'asc' }, { featureLabel: 'asc' }]
  },
  payments: {
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }]
  }
})

type TraderSubscriptionRow = Prisma.TraderSubscriptionGetPayload<{
  include: typeof traderSubscriptionInclude
}>

type TraderBasicRow = {
  id: string
  name: string
  maxCompanies: number | null
  maxUsers: number | null
  locked: boolean
  deletedAt: Date | null
}

export type SubscriptionLifecycleState =
  | 'none'
  | 'pending'
  | 'trial'
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'suspended'

export type SubscriptionFeatureSummary = {
  featureKey: string
  featureLabel: string
  description: string | null
  enabled: boolean
  sortOrder: number
}

export type SubscriptionPaymentSummary = {
  id: string
  amount: number
  currency: string
  status: string
  paymentMode: string
  referenceNo: string | null
  paidAt: string | null
  confirmedAt: string | null
  notes: string | null
  createdAt: string
}

export type TraderSubscriptionSummary = {
  id: string
  traderId: string
  planId: string | null
  planName: string | null
  planDescription: string | null
  subscriptionType: SubscriptionType
  status: SubscriptionStatus
  lifecycleState: SubscriptionLifecycleState
  billingCycle: string | null
  amount: number
  currency: string
  startDate: string
  endDate: string
  activatedAt: string | null
  expiredAt: string | null
  cancelledAt: string | null
  suspendedAt: string | null
  trialDays: number | null
  maxCompanies: number | null
  maxUsers: number | null
  notes: string | null
  featureSource: 'subscription' | 'plan'
  features: SubscriptionFeatureSummary[]
  daysLeft: number
  isActiveWindow: boolean
  payments: SubscriptionPaymentSummary[]
  createdAt: string
  updatedAt: string
}

export type TraderSubscriptionEntitlement = {
  traderId: string
  traderName: string | null
  traderLocked: boolean
  lifecycleState: SubscriptionLifecycleState
  isConfigured: boolean
  requiresAttention: boolean
  message: string | null
  daysLeft: number | null
  currentSubscription: TraderSubscriptionSummary | null
  limits: {
    maxCompanies: number | null
    maxUsers: number | null
    source: 'subscription' | 'legacy' | 'hybrid' | 'none'
  }
  enabledFeatureKeys: string[]
  features: SubscriptionFeatureSummary[]
}

export type CompanySubscriptionAccess = {
  companyId: string
  traderId: string
  entitlement: TraderSubscriptionEntitlement
}

function normalizeDate(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.trunc(value)
  return rounded >= 0 ? rounded : null
}

function calculateDaysLeft(endDate: Date, now: Date) {
  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) return 0
  const diff = endDate.getTime() - now.getTime()
  if (diff <= 0) return 0
  return Math.ceil(diff / DAY_IN_MS)
}

function toLifecycleState(type: SubscriptionType, status: SubscriptionStatus): SubscriptionLifecycleState {
  if (status === 'active') {
    return type === 'trial' ? 'trial' : 'active'
  }
  if (status === 'pending') return 'pending'
  if (status === 'expired') return 'expired'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'suspended') return 'suspended'
  return 'none'
}

function getStateMessage(args: {
  lifecycleState: SubscriptionLifecycleState
  isConfigured: boolean
  planName: string | null
  endDate: Date | null
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

function buildFeatureRows(subscription: TraderSubscriptionRow): {
  source: 'subscription' | 'plan'
  rows: SubscriptionFeatureSummary[]
} {
  const rawRows =
    subscription.features.length > 0
      ? subscription.features.map((feature) => ({
          featureKey: feature.featureKey,
          featureLabel: feature.featureLabel,
          description: feature.description,
          enabled: feature.enabled,
          sortOrder: feature.sortOrder
        }))
      : (subscription.plan?.features || []).map((feature) => ({
          featureKey: feature.featureKey,
          featureLabel: feature.featureLabel,
          description: feature.description,
          enabled: feature.enabled,
          sortOrder: feature.sortOrder
        }))

  const featureMap = new Map<string, SubscriptionFeatureSummary>()
  for (const row of rawRows) {
    const featureKey = String(row.featureKey || '').trim().toLowerCase()
    if (!featureKey) continue

    featureMap.set(featureKey, {
      featureKey,
      featureLabel: String(row.featureLabel || featureKey).trim() || featureKey,
      description: row.description ? String(row.description).trim() : null,
      enabled: Boolean(row.enabled),
      sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : 0
    })
  }

  return {
    source: subscription.features.length > 0 ? 'subscription' : 'plan',
    rows: Array.from(featureMap.values()).sort(
      (left, right) => left.sortOrder - right.sortOrder || left.featureLabel.localeCompare(right.featureLabel)
    )
  }
}

function toPaymentSummary(subscription: TraderSubscriptionRow): SubscriptionPaymentSummary[] {
  return subscription.payments.map((payment) => ({
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    paymentMode: payment.paymentMode,
    referenceNo: payment.referenceNo || null,
    paidAt: normalizeDate(payment.paidAt),
    confirmedAt: normalizeDate(payment.confirmedAt),
    notes: payment.notes || null,
    createdAt: payment.createdAt.toISOString()
  }))
}

function toSubscriptionSummary(subscription: TraderSubscriptionRow, now: Date): TraderSubscriptionSummary {
  const subscriptionType = normalizeSubscriptionType(subscription.subscriptionType)
  const status = normalizeSubscriptionStatus(subscription.status)
  const lifecycleState = toLifecycleState(subscriptionType, status)
  const { source, rows } = buildFeatureRows(subscription)
  const daysLeft = calculateDaysLeft(subscription.endDate, now)
  const planMaxCompanies = normalizePositiveInteger(subscription.maxCompaniesOverride ?? subscription.plan?.maxCompanies ?? null)
  const planMaxUsers = normalizePositiveInteger(subscription.maxUsersOverride ?? subscription.plan?.maxUsers ?? null)

  return {
    id: subscription.id,
    traderId: subscription.traderId,
    planId: subscription.planId || null,
    planName: subscription.planNameSnapshot || subscription.plan?.name || null,
    planDescription: subscription.plan?.description || null,
    subscriptionType,
    status,
    lifecycleState,
    billingCycle: subscription.billingCycle || subscription.plan?.billingCycle || null,
    amount: subscription.amount,
    currency: subscription.currency,
    startDate: subscription.startDate.toISOString(),
    endDate: subscription.endDate.toISOString(),
    activatedAt: normalizeDate(subscription.activatedAt),
    expiredAt: normalizeDate(subscription.expiredAt),
    cancelledAt: normalizeDate(subscription.cancelledAt),
    suspendedAt: normalizeDate(subscription.suspendedAt),
    trialDays: normalizePositiveInteger(subscription.trialDays),
    maxCompanies: planMaxCompanies,
    maxUsers: planMaxUsers,
    notes: subscription.notes || null,
    featureSource: source,
    features: rows,
    daysLeft,
    isActiveWindow: ACTIVE_SUBSCRIPTION_STATUSES.includes(status) && subscription.endDate.getTime() > now.getTime(),
    payments: toPaymentSummary(subscription),
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString()
  }
}

async function synchronizeTraderSubscriptionLifecycle(db: DbClient, traderId: string, now = new Date()) {
  const rows = await db.traderSubscription.findMany({
    where: {
      traderId,
      status: {
        in: NON_TERMINAL_SUBSCRIPTION_STATUSES
      }
    },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      activatedAt: true
    }
  })

  const toActivate = rows
    .filter((row) => normalizeSubscriptionStatus(row.status) === 'pending' && row.startDate.getTime() <= now.getTime() && row.endDate.getTime() > now.getTime())
    .map((row) => row.id)

  const toExpire = rows
    .filter((row) => row.endDate.getTime() <= now.getTime())
    .map((row) => row.id)

  if (toActivate.length > 0) {
    await db.traderSubscription.updateMany({
      where: {
        id: {
          in: toActivate
        }
      },
      data: {
        status: 'active',
        activatedAt: now,
        expiredAt: null
      }
    })
  }

  if (toExpire.length > 0) {
    await db.traderSubscription.updateMany({
      where: {
        id: {
          in: toExpire
        }
      },
      data: {
        status: 'expired',
        expiredAt: now
      }
    })
  }
}

async function findRelevantTraderSubscription(db: DbClient, traderId: string, now = new Date()) {
  await synchronizeTraderSubscriptionLifecycle(db, traderId, now)

  const current = await db.traderSubscription.findFirst({
    where: {
      traderId,
      status: {
        in: NON_TERMINAL_SUBSCRIPTION_STATUSES
      }
    },
    include: traderSubscriptionInclude,
    orderBy: [{ startDate: 'desc' }, { updatedAt: 'desc' }]
  })

  if (current) {
    return current
  }

  return db.traderSubscription.findFirst({
    where: {
      traderId
    },
    include: traderSubscriptionInclude,
    orderBy: [{ endDate: 'desc' }, { updatedAt: 'desc' }]
  })
}

export async function getTraderSubscriptionHistory(db: DbClient, traderId: string, now = new Date()) {
  await synchronizeTraderSubscriptionLifecycle(db, traderId, now)

  const rows = await db.traderSubscription.findMany({
    where: {
      traderId
    },
    include: traderSubscriptionInclude,
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
  })

  return rows.map((row) => toSubscriptionSummary(row, now))
}

export async function getCurrentTraderSubscription(db: DbClient, traderId: string, now = new Date()) {
  const row = await findRelevantTraderSubscription(db, traderId, now)
  return row ? toSubscriptionSummary(row, now) : null
}

export async function getTraderSubscriptionEntitlement(
  db: DbClient,
  traderId: string,
  now = new Date(),
  traderRow?: TraderBasicRow | null
): Promise<TraderSubscriptionEntitlement | null> {
  const trader =
    traderRow ||
    (await db.trader.findFirst({
      where: {
        id: traderId
      },
      select: {
        id: true,
        name: true,
        maxCompanies: true,
        maxUsers: true,
        locked: true,
        deletedAt: true
      }
    }))

  if (!trader) {
    return null
  }

  const currentSubscription = await getCurrentTraderSubscription(db, traderId, now)
  const isConfigured = currentSubscription !== null
  const subscriptionMaxCompanies = currentSubscription?.maxCompanies ?? null
  const subscriptionMaxUsers = currentSubscription?.maxUsers ?? null
  const legacyMaxCompanies = normalizePositiveInteger(trader.maxCompanies)
  const legacyMaxUsers = normalizePositiveInteger(trader.maxUsers)
  const lifecycleState = currentSubscription?.lifecycleState || 'none'
  const message = getStateMessage({
    lifecycleState,
    isConfigured,
    planName: currentSubscription?.planName || null,
    startDate: currentSubscription ? new Date(currentSubscription.startDate) : null,
    endDate: currentSubscription ? new Date(currentSubscription.endDate) : null,
    daysLeft: currentSubscription?.daysLeft ?? null
  })

  return {
    traderId: trader.id,
    traderName: trader.name,
    traderLocked: trader.locked || Boolean(trader.deletedAt),
    lifecycleState,
    isConfigured,
    requiresAttention: lifecycleState !== 'active' && lifecycleState !== 'trial',
    message,
    daysLeft: currentSubscription?.daysLeft ?? null,
    currentSubscription,
    limits: {
      maxCompanies: mergeLimitValue(subscriptionMaxCompanies, legacyMaxCompanies),
      maxUsers: mergeLimitValue(subscriptionMaxUsers, legacyMaxUsers),
      source: resolveLimitSource({
        subscriptionMaxCompanies,
        subscriptionMaxUsers,
        legacyMaxCompanies,
        legacyMaxUsers
      })
    },
    enabledFeatureKeys: (currentSubscription?.features || []).filter((feature) => feature.enabled).map((feature) => feature.featureKey),
    features: currentSubscription?.features || []
  }
}

export function isModuleEnabledForEntitlement(
  entitlement: TraderSubscriptionEntitlement,
  module: PermissionModule,
  action: PermissionAction
) {
  if (module === 'DASHBOARD' && action === 'read') {
    return true
  }

  if (entitlement.traderLocked) {
    return false
  }

  const featureKey = PERMISSION_MODULE_TO_SUBSCRIPTION_FEATURE[module]
  if (!featureKey) {
    return action === 'read'
      ? entitlement.lifecycleState !== 'none' && entitlement.lifecycleState !== 'pending'
      : entitlement.lifecycleState === 'trial' || entitlement.lifecycleState === 'active'
  }

  const featureEnabled = entitlement.enabledFeatureKeys.includes(featureKey)
  if (!featureEnabled) {
    return false
  }

  if (action === 'write') {
    return entitlement.lifecycleState === 'trial' || entitlement.lifecycleState === 'active'
  }

  return entitlement.lifecycleState !== 'none' && entitlement.lifecycleState !== 'pending'
}

export function getSubscriptionAccessMessage(
  entitlement: TraderSubscriptionEntitlement,
  module: PermissionModule
) {
  if (entitlement.traderLocked) {
    return 'Trader account is locked. Please contact admin.'
  }

  if (entitlement.lifecycleState === 'trial' || entitlement.lifecycleState === 'active') {
    const featureKey = PERMISSION_MODULE_TO_SUBSCRIPTION_FEATURE[module]
    if (featureKey && !entitlement.enabledFeatureKeys.includes(featureKey)) {
      return 'Feature not available in current plan.'
    }
  }

  return entitlement.message || 'Subscription access denied.'
}

export async function getCompanySubscriptionAccess(
  db: DbClient,
  companyId: string,
  now = new Date()
): Promise<CompanySubscriptionAccess | null> {
  const company = await db.company.findFirst({
    where: {
      id: companyId,
      deletedAt: null
    },
    select: {
      id: true,
      traderId: true
    }
  })

  if (!company?.traderId) {
    return null
  }

  const entitlement = await getTraderSubscriptionEntitlement(db, company.traderId, now)
  if (!entitlement) {
    return null
  }

  return {
    companyId: company.id,
    traderId: company.traderId,
    entitlement
  }
}
