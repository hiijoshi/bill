import { NextRequest, NextResponse } from 'next/server'

import { parseBooleanParam, requireRoles } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { getTraderSubscriptionEntitlement } from '@/lib/subscription-core'
import { getTraderDataLifecycleSummary } from '@/lib/trader-retention'
import { getTraderCapacitySnapshot } from '@/lib/trader-limits'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const query = String(searchParams.get('query') || '').trim().toLowerCase()
    const stateFilter = String(searchParams.get('state') || '').trim().toLowerCase()
    const expiringWithinDays = Number(searchParams.get('expiringWithinDays') || '')
    const includeLocked = parseBooleanParam(searchParams.get('includeLocked'))

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

    const rows = await Promise.all(
      traders.map(async (trader) => {
        const [capacity, entitlement] = await Promise.all([
          getTraderCapacitySnapshot(prisma, trader.id),
          getTraderSubscriptionEntitlement(prisma, trader.id, new Date(), trader)
        ])
        const dataLifecycle = await getTraderDataLifecycleSummary(prisma, trader.id, new Date(), {
          entitlement,
          traderDeletedAt: trader.deletedAt
        })

        return {
          id: trader.id,
          name: trader.name,
          locked: trader.locked,
          currentCompanies: capacity?.currentCompanies ?? 0,
          currentUsers: capacity?.currentUsers ?? 0,
          maxCompanies: capacity?.maxCompanies ?? null,
          maxUsers: capacity?.maxUsers ?? null,
          limitSource: capacity?.limitSource ?? 'none',
          subscriptionConfigured: entitlement?.isConfigured ?? false,
          subscriptionState: entitlement?.lifecycleState ?? 'none',
          subscriptionMessage: entitlement?.message ?? null,
          dataLifecycleState: dataLifecycle?.state ?? 'active',
          readOnlyMode: dataLifecycle?.readOnlyMode ?? false,
          lifecycleMessage: dataLifecycle?.message ?? null,
          latestBackupStatus: dataLifecycle?.latestBackup?.status ?? null,
          latestBackupCreatedAt: dataLifecycle?.latestBackup?.createdAt ?? null,
          latestReadyBackupAt: dataLifecycle?.latestReadyBackup?.exportedAt ?? null,
          scheduledDeletionAt: dataLifecycle?.scheduledDeletionAt ?? null,
          closureRequestedAt: dataLifecycle?.closureRequestedAt ?? null,
          daysLeft: entitlement?.daysLeft ?? null,
          currentPlanName: entitlement?.currentSubscription?.planName ?? null,
          subscriptionType: entitlement?.currentSubscription?.subscriptionType ?? null,
          status: entitlement?.currentSubscription?.status ?? null,
          startDate: entitlement?.currentSubscription?.startDate ?? null,
          endDate: entitlement?.currentSubscription?.endDate ?? null,
          amount: entitlement?.currentSubscription?.amount ?? null,
          currency: entitlement?.currentSubscription?.currency ?? null,
          billingCycle: entitlement?.currentSubscription?.billingCycle ?? null
        }
      })
    )

    const filtered = rows.filter((row) => {
      if (query.length > 0) {
        const haystack = `${row.name} ${row.currentPlanName || ''} ${row.subscriptionState}`.toLowerCase()
        if (!haystack.includes(query)) {
          return false
        }
      }

      if (stateFilter && row.subscriptionState !== stateFilter) {
        if (row.dataLifecycleState !== stateFilter) {
          return false
        }
      }

      if (Number.isFinite(expiringWithinDays) && expiringWithinDays >= 0) {
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

    return NextResponse.json(filtered)
  } catch (error) {
    console.error('trader-subscriptions GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch trader subscriptions' }, { status: 500 })
  }
}
