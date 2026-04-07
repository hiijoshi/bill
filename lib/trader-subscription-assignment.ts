import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { SUBSCRIPTION_SCHEMA_WARNING_MESSAGE, ensureSubscriptionManagementSchemaReady } from '@/lib/subscription-schema'
import { normalizeSubscriptionBillingCycle } from '@/lib/subscription-config'
import {
  assertNoNonTerminalSubscriptionConflict,
  createManualSubscriptionPayment,
  SubscriptionMutationError
} from '@/lib/subscription-mutations'

type DbClient = typeof prisma | Prisma.TransactionClient

export const traderInitialSubscriptionSchema = z
  .object({
    mode: z.enum(['trial', 'paid']),
    planId: z.string().trim().min(1, 'Plan is required'),
    trialDays: z.number().int().min(1).max(365).optional().nullable(),
    amount: z.number().min(0).optional().nullable(),
    currency: z.string().trim().min(1).max(10).optional().nullable(),
    notes: z.string().trim().max(1_000).optional().nullable()
  })
  .strict()

export type TraderInitialSubscriptionInput = z.infer<typeof traderInitialSubscriptionSchema>

export type TraderInitialSubscriptionResult = {
  subscription: {
    id: string
    planId: string | null
    subscriptionType: 'trial' | 'paid'
    status: 'active'
    planNameSnapshot: string | null
    amount: number
    currency: string
    billingCycle: string
    startDate: Date
    endDate: Date
    trialDays: number | null
  }
  payment: {
    id: string
    amount: number
    currency: string
    status: string
    paymentMode: string
    paidAt: Date | null
  } | null
}

function addDays(baseDate: Date, days: number) {
  return new Date(baseDate.getTime() + days * 86_400_000)
}

export async function createTraderInitialSubscription(
  db: DbClient,
  input: {
    traderId: string
    actorId: string
    subscription: TraderInitialSubscriptionInput
    now?: Date
  }
): Promise<TraderInitialSubscriptionResult> {
  const now = input.now || new Date()
  const schemaReady = await ensureSubscriptionManagementSchemaReady(db)

  if (!schemaReady) {
    throw new SubscriptionMutationError(SUBSCRIPTION_SCHEMA_WARNING_MESSAGE, 503)
  }

  const plan = await db.subscriptionPlan.findUnique({
    where: {
      id: input.subscription.planId
    }
  })

  if (!plan) {
    throw new SubscriptionMutationError('Plan not found', 404)
  }

  if (!plan.isActive) {
    throw new SubscriptionMutationError('Selected plan is inactive', 400)
  }

  await assertNoNonTerminalSubscriptionConflict(db as Prisma.TransactionClient, input.traderId)

  if (input.subscription.mode === 'trial' && !plan.isTrialCapable) {
    throw new SubscriptionMutationError('Selected plan is not trial-capable', 400)
  }

  const startDate = now
  const endDate =
    input.subscription.mode === 'trial'
      ? addDays(startDate, input.subscription.trialDays ?? plan.defaultTrialDays ?? 7)
      : addDays(startDate, 365)

  const amount = input.subscription.mode === 'trial' ? 0 : input.subscription.amount ?? plan.amount
  const currency = String(input.subscription.currency || plan.currency || 'INR').trim().toUpperCase() || 'INR'

  const createdSubscription = await db.traderSubscription.create({
    data: {
      traderId: input.traderId,
      planId: plan.id,
      subscriptionType: input.subscription.mode,
      status: 'active',
      billingCycle: normalizeSubscriptionBillingCycle(plan.billingCycle),
      amount,
      currency,
      planNameSnapshot: plan.name,
      startDate,
      endDate,
      activatedAt: now,
      trialDays:
        input.subscription.mode === 'trial' ? input.subscription.trialDays ?? plan.defaultTrialDays ?? 7 : null,
      notes: input.subscription.notes || null,
      assignedByUserId: input.actorId,
      updatedByUserId: input.actorId
    }
  })

  const payment =
    input.subscription.mode === 'paid'
      ? await createManualSubscriptionPayment(db as Prisma.TransactionClient, {
          traderId: input.traderId,
          traderSubscriptionId: createdSubscription.id,
          planId: plan.id,
          amount,
          currency,
          status: 'confirmed',
          paymentMode: 'manual',
          paidAt: now,
          confirmedAt: now,
          confirmedByUserId: input.actorId,
          planNameSnapshot: plan.name,
          notes: input.subscription.notes || 'Assigned during trader creation'
        })
      : null

  return {
    subscription: {
      id: createdSubscription.id,
      planId: createdSubscription.planId,
      subscriptionType: input.subscription.mode,
      status: 'active',
      planNameSnapshot: createdSubscription.planNameSnapshot,
      amount: createdSubscription.amount,
      currency: createdSubscription.currency,
      billingCycle: createdSubscription.billingCycle || normalizeSubscriptionBillingCycle(plan.billingCycle),
      startDate: createdSubscription.startDate,
      endDate: createdSubscription.endDate,
      trialDays: createdSubscription.trialDays
    },
    payment: payment
      ? {
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          paymentMode: payment.paymentMode,
          paidAt: payment.paidAt
        }
      : null
  }
}
