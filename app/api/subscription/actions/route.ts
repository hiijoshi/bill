import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { markSuperAdminLiveUpdate } from '@/lib/live-update-state'
import { prisma } from '@/lib/prisma'
import { getCurrentTraderSubscription } from '@/lib/subscription-core'
import { clearTraderClosureRequest, createTraderDataBackup, requestTraderClosure, TraderRetentionError } from '@/lib/trader-backups'
import { getTraderBackupHistory, getTraderDataLifecycleSummary } from '@/lib/trader-retention'

const actionSchema = z
  .object({
    action: z.enum(['request_backup', 'request_closure', 'cancel_closure_request']),
    notes: z.string().trim().max(1_000).optional().nullable()
  })
  .strict()

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const body = await request.json().catch(() => null)
    const parsed = actionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const trader = await prisma.trader.findFirst({
      where: {
        id: authResult.auth.traderId,
        deletedAt: null
      },
      select: {
        id: true,
        deletedAt: true
      }
    })

    if (!trader) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    const actorId = authResult.auth.userDbId || authResult.auth.userId
    const now = new Date()

    if (parsed.data.action === 'request_backup') {
      const backup = await createTraderDataBackup({
        traderId: trader.id,
        actor: {
          userId: actorId,
          role: authResult.auth.role,
          requestSource: 'trader'
        },
        notes: parsed.data.notes || null
      })

      const [dataLifecycle, backups, currentSubscription] = await Promise.all([
        getTraderDataLifecycleSummary(prisma, trader.id, now, {
          traderDeletedAt: trader.deletedAt
        }),
        getTraderBackupHistory(prisma, trader.id),
        getCurrentTraderSubscription(prisma, trader.id)
      ])

      await writeAuditLog({
        actor: {
          id: actorId,
          role: authResult.auth.role
        },
        action: 'UPDATE',
        resourceType: 'TRADER_DATA_BACKUP',
        resourceId: backup.id,
        scope: {
          traderId: trader.id
        },
        after: {
          action: parsed.data.action,
          backupId: backup.id
        },
        requestMeta: getAuditRequestMeta(request)
      })
      markSuperAdminLiveUpdate()

      return NextResponse.json({
        success: true,
        action: parsed.data.action,
        currentSubscription,
        dataLifecycle,
        backups
      })
    }

    await prisma.$transaction(async (tx) => {
      if (parsed.data.action === 'cancel_closure_request') {
        await clearTraderClosureRequest(tx, {
          traderId: trader.id,
          notes: parsed.data.notes || null
        })
        return
      }

      await requestTraderClosure(tx, {
        traderId: trader.id,
        actorId,
        requestSource: 'trader',
        notes: parsed.data.notes || null,
        now
      })
    })

    const [dataLifecycle, backups, currentSubscription] = await Promise.all([
      getTraderDataLifecycleSummary(prisma, trader.id, now, {
        traderDeletedAt: trader.deletedAt
      }),
      getTraderBackupHistory(prisma, trader.id),
      getCurrentTraderSubscription(prisma, trader.id)
    ])

    await writeAuditLog({
      actor: {
        id: actorId,
        role: authResult.auth.role
      },
      action: 'UPDATE',
      resourceType: 'TRADER_DATA_LIFECYCLE',
      resourceId: trader.id,
      scope: {
        traderId: trader.id
      },
      after: {
        action: parsed.data.action,
        closureRequestedAt: dataLifecycle?.closureRequestedAt || null
      },
      requestMeta: getAuditRequestMeta(request)
    })
    markSuperAdminLiveUpdate()

    return NextResponse.json({
      success: true,
      action: parsed.data.action,
      currentSubscription,
      dataLifecycle,
      backups
    })
  } catch (error) {
    if (error instanceof TraderRetentionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('subscription/actions POST failed:', error)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
