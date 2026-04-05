import { NextRequest, NextResponse } from 'next/server'

import { parseBooleanParam, requireRoles } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { normalizeSubscriptionStatus, normalizeSubscriptionType } from '@/lib/subscription-config'
import {
  buildSubscriptionSchemaHeaders,
  ensureSubscriptionManagementSchemaReady,
  isSubscriptionManagementSchemaMismatchError
} from '@/lib/subscription-schema'
import {
  normalizeTraderDataLifecycleState,
  resolveEffectiveTraderDataLifecycleState
} from '@/lib/trader-retention'

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
    return 'Closure request submitted. Super admin review is pending.'
  }

  return args.subscriptionMessage
}

function compareRelevantSubscriptions(
  left: TraderSubscriptionListRow,
  right: TraderSubscriptionListRow
) {
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

async function synchronizeTraderSubscriptions(traderIds: string[], now: Date) {
  if (traderIds.length === 0) return

  await Promise.all([
    prisma.traderSubscription.updateMany({
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
    prisma.traderSubscription.updateMany({
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

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const query = String(searchParams.get('query') || '').trim().toLowerCase()
    const stateFilter = String(searchParams.get('state') || '').trim().toLowerCase()
    const expiringWithinDaysParam = String(searchParams.get('expiringWithinDays') || '').trim()
    const expiringWithinDays = expiringWithinDaysParam.length > 0 ? Number(expiringWithinDaysParam) : null
    const includeLocked = parseBooleanParam(searchParams.get('includeLocked'))
    const schemaReady = await ensureSubscriptionManagementSchemaReady(prisma)

    const traders = await prisma.trader.findMany({
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
      return NextResponse.json([], {
        headers: buildSubscriptionSchemaHeaders(schemaReady)
      })
    }

    const traderIds = traders.map((trader) => trader.id)
    const now = new Date()

    if (schemaReady) {
      await synchronizeTraderSubscriptions(traderIds, now)
    }

    const [companyCounts, userCounts, subscriptions, lifecycles] = await Promise.all([
      prisma.company.groupBy({
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
      prisma.user.groupBy({
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
        ? prisma.traderSubscription.findMany({
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
        ? prisma.traderDataLifecycle.findMany({
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
        billingCycle: subscription?.billingCycle || subscription?.plan?.billingCycle || null
      }
    })

    const filtered = rows.filter((row) => {
      if (query.length > 0) {
        const haystack = `${row.name} ${row.currentPlanName || ''} ${row.subscriptionState}`.toLowerCase()
        if (!haystack.includes(query)) {
          return false
        }
      }

      if (stateFilter && row.subscriptionState !== stateFilter && row.dataLifecycleState !== stateFilter) {
        return false
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

    return NextResponse.json(filtered, {
      headers: buildSubscriptionSchemaHeaders(schemaReady)
    })
  } catch (error) {
    if (isSubscriptionManagementSchemaMismatchError(error)) {
      return NextResponse.json([], {
        headers: buildSubscriptionSchemaHeaders(false)
      })
    }

    console.error('trader-subscriptions GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch trader subscriptions' }, { status: 500 })
  }
}
