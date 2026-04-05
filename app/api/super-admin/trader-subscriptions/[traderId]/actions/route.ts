import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { invalidateAuthGuardStateForUser } from '@/lib/auth-guard-state'
import {
  markCompanyLiveUpdates,
  markSuperAdminLiveUpdate,
  markUserSessionLiveUpdates
} from '@/lib/live-update-state'
import { prisma } from '@/lib/prisma'
import { getCurrentTraderSubscription, getTraderSubscriptionHistory } from '@/lib/subscription-core'
import {
  normalizeSubscriptionBillingCycle,
  normalizeSubscriptionFeatureInputs
} from '@/lib/subscription-config'
import {
  activateTraderSubscription,
  assertNoNonTerminalSubscriptionConflict,
  cancelTraderSubscription,
  createManualSubscriptionPayment,
  expireOtherTraderSubscriptions,
  replaceTraderSubscriptionFeatures,
  SubscriptionMutationError,
  suspendTraderSubscription
} from '@/lib/subscription-mutations'
import {
  confirmTraderFinalDeletion,
  createTraderDataBackup,
  markTraderDeletionPending,
  requestTraderClosure,
  restoreTraderActiveAccess,
  setTraderLifecycleReadOnlyState,
  TraderRetentionError,
  updateTraderRetentionPolicy
} from '@/lib/trader-backups'
import { getTraderBackupHistory, getTraderDataLifecycleSummary } from '@/lib/trader-retention'

const paramsSchema = z.object({
  traderId: z.string().trim().min(1)
})

const featureSchema = z
  .object({
    featureKey: z.string().trim().min(1).max(80),
    featureLabel: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(400).optional().nullable(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional().nullable()
  })
  .strict()

const actionSchema = z
  .object({
    action: z.enum([
      'assign_trial',
      'assign_paid',
      'renew_paid',
      'convert_to_paid',
      'extend',
      'cancel',
      'suspend',
      'activate',
      'request_backup',
      'mark_read_only',
      'restore_access',
      'request_closure',
      'update_retention',
      'mark_deletion_pending',
      'confirm_final_deletion'
    ]),
    subscriptionId: z.string().trim().min(1).optional().nullable(),
    planId: z.string().trim().min(1).optional().nullable(),
    backupId: z.string().trim().min(1).optional().nullable(),
    startDate: z.string().trim().min(1).optional().nullable(),
    endDate: z.string().trim().min(1).optional().nullable(),
    trialDays: z.number().int().min(1).max(365).optional().nullable(),
    extendDays: z.number().int().min(1).max(3650).optional().nullable(),
    retentionDays: z.number().int().min(0).max(3650).optional().nullable(),
    notes: z.string().trim().max(1_000).optional().nullable(),
    amount: z.number().min(0).optional().nullable(),
    currency: z.string().trim().max(10).optional().nullable(),
    billingCycle: z.string().trim().min(1).optional().nullable(),
    readOnlyState: z.enum(['expired', 'cancelled']).optional().nullable(),
    confirmDeletion: z.boolean().optional(),
    maxCompaniesOverride: z.number().int().min(0).optional().nullable(),
    maxUsersOverride: z.number().int().min(0).optional().nullable(),
    features: z.array(featureSchema).optional(),
    replaceExisting: z.boolean().optional(),
    paymentStatus: z.string().trim().max(40).optional().nullable(),
    paymentMode: z.string().trim().max(40).optional().nullable(),
    referenceNo: z.string().trim().max(120).optional().nullable(),
    paidAt: z.string().trim().min(1).optional().nullable()
  })
  .strict()

type ActionResult = {
  action: string
  subscriptionId?: string | null
  backupId?: string | null
  resourceType?: 'TRADER_SUBSCRIPTION' | 'TRADER_DATA_LIFECYCLE' | 'TRADER_DATA_BACKUP' | 'TRADER'
  resourceId?: string | null
  affectedUsers?: Array<{ id: string; traderId: string; userId: string }>
  affectedCompanyIds?: string[]
}

function parseOptionalDate(value: string | null | undefined, fieldLabel: string) {
  if (!value) {
    return { ok: true as const, value: null }
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false as const, error: `${fieldLabel} is invalid` }
  }

  return { ok: true as const, value: parsed }
}

function addDays(baseDate: Date, days: number) {
  return new Date(baseDate.getTime() + days * 86_400_000)
}

function resolveWindow(args: {
  startDateInput?: string | null
  endDateInput?: string | null
  durationDays?: number | null
  fallbackDurationDays?: number | null
  now: Date
}) {
  const parsedStart = parseOptionalDate(args.startDateInput, 'Start date')
  if (!parsedStart.ok) return parsedStart

  const parsedEnd = parseOptionalDate(args.endDateInput, 'End date')
  if (!parsedEnd.ok) return parsedEnd

  const startDate = parsedStart.value || args.now
  const durationDays = args.durationDays ?? args.fallbackDurationDays ?? 365
  const endDate = parsedEnd.value || addDays(startDate, durationDays)

  if (endDate.getTime() <= startDate.getTime()) {
    return {
      ok: false as const,
      error: 'End date must be after start date'
    }
  }

  return {
    ok: true as const,
    startDate,
    endDate
  }
}

async function findTargetSubscription(traderId: string, subscriptionId?: string | null) {
  if (subscriptionId) {
    return prisma.traderSubscription.findFirst({
      where: {
        id: subscriptionId,
        traderId
      }
    })
  }

  return prisma.traderSubscription.findFirst({
    where: {
      traderId
    },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
  })
}

async function loadTraderActionSnapshot(traderId: string) {
  const [currentSubscription, history, dataLifecycle, backups] = await Promise.all([
    getCurrentTraderSubscription(prisma, traderId),
    getTraderSubscriptionHistory(prisma, traderId),
    getTraderDataLifecycleSummary(prisma, traderId),
    getTraderBackupHistory(prisma, traderId)
  ])

  return {
    currentSubscription,
    history,
    dataLifecycle,
    backups
  }
}

export async function POST(
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
        id: parsedParams.data.traderId,
        deletedAt: null
      },
      select: {
        id: true,
        name: true,
        locked: true
      }
    })

    if (!trader) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    const input = parsed.data
    const now = new Date()
    const actorId = authResult.auth.userDbId || authResult.auth.userId
    let result: ActionResult

    if (input.action === 'request_backup') {
      const backup = await createTraderDataBackup({
        traderId: trader.id,
        actor: {
          userId: actorId,
          role: authResult.auth.role,
          requestSource: 'super_admin'
        },
        notes: input.notes || null
      })

      result = {
        action: input.action,
        backupId: backup.id,
        resourceType: 'TRADER_DATA_BACKUP',
        resourceId: backup.id
      }
    } else if (input.action === 'request_closure') {
      await prisma.$transaction(async (tx) => {
        await requestTraderClosure(tx, {
          traderId: trader.id,
          actorId,
          requestSource: 'super_admin',
          notes: input.notes || null,
          now
        })
      })

      result = {
        action: input.action,
        resourceType: 'TRADER_DATA_LIFECYCLE',
        resourceId: trader.id
      }
    } else if (input.action === 'mark_read_only') {
      await prisma.$transaction(async (tx) => {
        await setTraderLifecycleReadOnlyState(tx, {
          traderId: trader.id,
          actorId,
          state: input.readOnlyState || 'cancelled',
          notes: input.notes || null,
          retentionDays: input.retentionDays ?? null,
          now
        })
      })

      result = {
        action: input.action,
        resourceType: 'TRADER_DATA_LIFECYCLE',
        resourceId: trader.id
      }
    } else if (input.action === 'restore_access') {
      await prisma.$transaction(async (tx) => {
        await restoreTraderActiveAccess(tx, {
          traderId: trader.id,
          notes: input.notes || null
        })
      })

      result = {
        action: input.action,
        resourceType: 'TRADER_DATA_LIFECYCLE',
        resourceId: trader.id
      }
    } else if (input.action === 'update_retention') {
      if (input.retentionDays === null || input.retentionDays === undefined) {
        throw new TraderRetentionError('Retention days are required', 400)
      }

      await prisma.$transaction(async (tx) => {
        await updateTraderRetentionPolicy(tx, {
          traderId: trader.id,
          retentionDays: input.retentionDays ?? null,
          notes: input.notes || null,
          now
        })
      })

      result = {
        action: input.action,
        resourceType: 'TRADER_DATA_LIFECYCLE',
        resourceId: trader.id
      }
    } else if (input.action === 'mark_deletion_pending') {
      if (!input.backupId) {
        throw new TraderRetentionError('Backup ID is required to mark deletion pending', 400)
      }

      await markTraderDeletionPending({
        traderId: trader.id,
        actorId,
        backupId: input.backupId,
        retentionDays: input.retentionDays ?? null,
        notes: input.notes || null
      })

      result = {
        action: input.action,
        backupId: input.backupId,
        resourceType: 'TRADER_DATA_LIFECYCLE',
        resourceId: trader.id
      }
    } else if (input.action === 'confirm_final_deletion') {
      if (!input.confirmDeletion) {
        throw new TraderRetentionError('Final deletion confirmation is required', 400)
      }

      if (!input.backupId) {
        throw new TraderRetentionError('Backup ID is required for final deletion', 400)
      }

      const deletionResult = await confirmTraderFinalDeletion({
        traderId: trader.id,
        backupId: input.backupId,
        actorId,
        notes: input.notes || null
      })

      result = {
        action: input.action,
        backupId: input.backupId,
        resourceType: 'TRADER',
        resourceId: trader.id,
        affectedUsers: deletionResult.affectedUsers,
        affectedCompanyIds: deletionResult.affectedCompanyIds
      }
    } else {
      result = await prisma.$transaction(async (tx) => {
        const targetSubscription = input.subscriptionId
          ? await tx.traderSubscription.findFirst({
              where: {
                id: input.subscriptionId,
                traderId: trader.id
              }
            })
          : await tx.traderSubscription.findFirst({
              where: {
                traderId: trader.id
              },
              orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
            })

        const plan = input.planId
          ? await tx.subscriptionPlan.findUnique({
              where: {
                id: input.planId
              }
            })
          : null

        if (input.planId && !plan) {
          throw new SubscriptionMutationError('Plan not found', 404)
        }

        if (input.action === 'assign_trial') {
          if (plan && !plan.isTrialCapable) {
            throw new SubscriptionMutationError('Selected plan is not trial-capable', 400)
          }

          const window = resolveWindow({
            startDateInput: input.startDate,
            endDateInput: input.endDate,
            durationDays: input.trialDays,
            fallbackDurationDays: plan?.defaultTrialDays ?? 7,
            now
          })
          if (!window.ok) {
            throw new SubscriptionMutationError(window.error, 400)
          }

          if (input.replaceExisting) {
            await expireOtherTraderSubscriptions(tx, trader.id, now)
          } else {
            await assertNoNonTerminalSubscriptionConflict(tx, trader.id)
          }

          const status = window.startDate.getTime() > now.getTime() ? 'pending' : 'active'
          const created = await tx.traderSubscription.create({
            data: {
              traderId: trader.id,
              planId: plan?.id || null,
              subscriptionType: 'trial',
              status,
              billingCycle: plan?.billingCycle || normalizeSubscriptionBillingCycle(input.billingCycle),
              amount: input.amount ?? 0,
              currency: String(input.currency || plan?.currency || 'INR').trim().toUpperCase() || 'INR',
              planNameSnapshot: plan?.name || null,
              startDate: window.startDate,
              endDate: window.endDate,
              activatedAt: status === 'active' ? now : null,
              trialDays: input.trialDays ?? plan?.defaultTrialDays ?? 7,
              maxCompaniesOverride: input.maxCompaniesOverride ?? null,
              maxUsersOverride: input.maxUsersOverride ?? null,
              notes: input.notes || null,
              assignedByUserId: actorId,
              updatedByUserId: actorId
            }
          })

          if (input.features && input.features.length > 0) {
            await replaceTraderSubscriptionFeatures(tx, created.id, normalizeSubscriptionFeatureInputs(input.features))
          }

          await restoreTraderActiveAccess(tx, {
            traderId: trader.id,
            notes: input.notes || null
          })

          return {
            action: input.action,
            subscriptionId: created.id,
            resourceType: 'TRADER_SUBSCRIPTION',
            resourceId: created.id
          }
        }

        if (input.action === 'assign_paid' || input.action === 'renew_paid' || input.action === 'convert_to_paid') {
          if (!plan) {
            throw new SubscriptionMutationError('Plan is required for paid subscription', 400)
          }

          if (input.action === 'convert_to_paid') {
            if (!targetSubscription || targetSubscription.subscriptionType !== 'trial') {
              throw new SubscriptionMutationError('Active or selected trial subscription not found', 404)
            }

            await tx.traderSubscription.update({
              where: {
                id: targetSubscription.id
              },
              data: {
                status: 'expired',
                expiredAt: now,
                updatedByUserId: actorId
              }
            })
          } else if (input.replaceExisting || input.action === 'renew_paid') {
            await expireOtherTraderSubscriptions(tx, trader.id, now)
          } else {
            await assertNoNonTerminalSubscriptionConflict(tx, trader.id)
          }

          const window = resolveWindow({
            startDateInput: input.startDate,
            endDateInput: input.endDate,
            durationDays: null,
            fallbackDurationDays: 365,
            now
          })
          if (!window.ok) {
            throw new SubscriptionMutationError(window.error, 400)
          }

          const parsedPaidAt = parseOptionalDate(input.paidAt, 'Payment date')
          if (!parsedPaidAt.ok) {
            throw new SubscriptionMutationError(parsedPaidAt.error, 400)
          }

          const status = window.startDate.getTime() > now.getTime() ? 'pending' : 'active'
          const amount = input.amount ?? plan.amount
          const created = await tx.traderSubscription.create({
            data: {
              traderId: trader.id,
              planId: plan.id,
              subscriptionType: 'paid',
              status,
              billingCycle: plan.billingCycle || normalizeSubscriptionBillingCycle(input.billingCycle),
              amount,
              currency: String(input.currency || plan.currency || 'INR').trim().toUpperCase() || 'INR',
              planNameSnapshot: plan.name,
              startDate: window.startDate,
              endDate: window.endDate,
              activatedAt: status === 'active' ? now : null,
              maxCompaniesOverride: input.maxCompaniesOverride ?? null,
              maxUsersOverride: input.maxUsersOverride ?? null,
              notes: input.notes || null,
              assignedByUserId: actorId,
              updatedByUserId: actorId
            }
          })

          if (input.features && input.features.length > 0) {
            await replaceTraderSubscriptionFeatures(tx, created.id, normalizeSubscriptionFeatureInputs(input.features))
          }

          await createManualSubscriptionPayment(tx, {
            traderId: trader.id,
            traderSubscriptionId: created.id,
            planId: plan.id,
            amount,
            currency: input.currency || plan.currency,
            status: input.paymentStatus || 'confirmed',
            paymentMode: input.paymentMode || 'manual',
            referenceNo: input.referenceNo || null,
            paidAt: parsedPaidAt.value || now,
            confirmedAt: now,
            confirmedByUserId: actorId,
            planNameSnapshot: plan.name,
            notes: input.notes || null
          })

          await restoreTraderActiveAccess(tx, {
            traderId: trader.id,
            notes: input.notes || null
          })

          return {
            action: input.action,
            subscriptionId: created.id,
            resourceType: 'TRADER_SUBSCRIPTION',
            resourceId: created.id
          }
        }

        if (!targetSubscription) {
          throw new SubscriptionMutationError('Subscription not found', 404)
        }

        if (input.action === 'extend') {
          if (targetSubscription.status === 'cancelled') {
            throw new SubscriptionMutationError('Cancelled subscription cannot be extended', 400)
          }

          const parsedEndDate = parseOptionalDate(input.endDate, 'End date')
          if (!parsedEndDate.ok) {
            throw new SubscriptionMutationError(parsedEndDate.error, 400)
          }

          const extendDays = input.extendDays ?? 0
          const newEndDate = parsedEndDate.value || addDays(targetSubscription.endDate, extendDays)

          if (newEndDate.getTime() <= targetSubscription.startDate.getTime()) {
            throw new SubscriptionMutationError('Extended end date must be after start date', 400)
          }

          const shouldActivate = newEndDate.getTime() > now.getTime()
          await tx.traderSubscription.update({
            where: {
              id: targetSubscription.id
            },
            data: {
              endDate: newEndDate,
              status: shouldActivate
                ? targetSubscription.startDate.getTime() > now.getTime()
                  ? 'pending'
                  : 'active'
                : 'expired',
              activatedAt: shouldActivate ? now : targetSubscription.activatedAt,
              expiredAt: shouldActivate ? null : now,
              updatedByUserId: actorId,
              ...(input.notes !== undefined ? { notes: input.notes || null } : {})
            }
          })

          if (shouldActivate) {
            await restoreTraderActiveAccess(tx, {
              traderId: trader.id,
              notes: input.notes || null
            })
          } else {
            await setTraderLifecycleReadOnlyState(tx, {
              traderId: trader.id,
              actorId,
              state: 'expired',
              notes: input.notes || null,
              now
            })
          }

          return {
            action: input.action,
            subscriptionId: targetSubscription.id,
            resourceType: 'TRADER_SUBSCRIPTION',
            resourceId: targetSubscription.id
          }
        }

        if (input.action === 'cancel') {
          await cancelTraderSubscription(tx, targetSubscription.id, input.notes || null, actorId, now)
          await setTraderLifecycleReadOnlyState(tx, {
            traderId: trader.id,
            actorId,
            state: 'cancelled',
            notes: input.notes || null,
            now
          })

          return {
            action: input.action,
            subscriptionId: targetSubscription.id,
            resourceType: 'TRADER_SUBSCRIPTION',
            resourceId: targetSubscription.id
          }
        }

        if (input.action === 'suspend') {
          await suspendTraderSubscription(tx, targetSubscription.id, input.notes || null, actorId, now)
          await setTraderLifecycleReadOnlyState(tx, {
            traderId: trader.id,
            actorId,
            state: 'expired',
            notes: input.notes || null,
            now
          })

          return {
            action: input.action,
            subscriptionId: targetSubscription.id,
            resourceType: 'TRADER_SUBSCRIPTION',
            resourceId: targetSubscription.id
          }
        }

        if (input.action === 'activate') {
          if (targetSubscription.endDate.getTime() <= now.getTime()) {
            throw new SubscriptionMutationError('Cannot activate an already expired subscription without extending it', 400)
          }

          await activateTraderSubscription(tx, targetSubscription.id, input.notes || null, actorId, now)

          if (targetSubscription.startDate.getTime() > now.getTime()) {
            await tx.traderSubscription.update({
              where: { id: targetSubscription.id },
              data: {
                startDate: now
              }
            })
          }

          await restoreTraderActiveAccess(tx, {
            traderId: trader.id,
            notes: input.notes || null
          })

          return {
            action: input.action,
            subscriptionId: targetSubscription.id,
            resourceType: 'TRADER_SUBSCRIPTION',
            resourceId: targetSubscription.id
          }
        }

        throw new SubscriptionMutationError('Unsupported action', 400)
      })
    }

    const snapshot = await loadTraderActionSnapshot(trader.id)

    await writeAuditLog({
      actor: {
        id: actorId,
        role: authResult.auth.role
      },
      action: result.action === 'confirm_final_deletion' ? 'DELETE' : 'UPDATE',
      resourceType: result.resourceType || 'TRADER_SUBSCRIPTION',
      resourceId: result.resourceId || trader.id,
      scope: {
        traderId: trader.id
      },
      after: {
        action: result.action,
        currentSubscription: snapshot.currentSubscription,
        dataLifecycle: snapshot.dataLifecycle,
        backupId: result.backupId || null
      },
      requestMeta: getAuditRequestMeta(request)
    })

    markSuperAdminLiveUpdate()
    if (result.affectedCompanyIds && result.affectedCompanyIds.length > 0) {
      markCompanyLiveUpdates(result.affectedCompanyIds)
    }
    if (result.affectedUsers && result.affectedUsers.length > 0) {
      markUserSessionLiveUpdates(result.affectedUsers)
      result.affectedUsers.forEach((user) => {
        invalidateAuthGuardStateForUser(user)
      })
    }

    return NextResponse.json({
      success: true,
      action: result.action,
      currentSubscription: snapshot.currentSubscription,
      history: snapshot.history,
      dataLifecycle: snapshot.dataLifecycle,
      backups: snapshot.backups
    })
  } catch (error) {
    if (error instanceof SubscriptionMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    if (error instanceof TraderRetentionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('trader-subscription action failed:', error)
    return NextResponse.json({ error: 'Failed to update trader subscription' }, { status: 500 })
  }
}
