import { Prisma } from '@prisma/client'

import {
  normalizeSubscriptionFeatureInputs,
  normalizeSubscriptionPaymentMode,
  normalizeSubscriptionPaymentStatus
} from '@/lib/subscription-config'

type DbClient = Prisma.TransactionClient

export class SubscriptionMutationError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'SubscriptionMutationError'
    this.status = status
  }
}

export async function replaceSubscriptionPlanFeatures(
  tx: DbClient,
  planId: string,
  featureInput: Parameters<typeof normalizeSubscriptionFeatureInputs>[0]
) {
  const features = normalizeSubscriptionFeatureInputs(featureInput)

  await tx.subscriptionPlanFeature.deleteMany({
    where: {
      planId
    }
  })

  if (features.length === 0) {
    return
  }

  await tx.subscriptionPlanFeature.createMany({
    data: features.map((feature) => ({
      planId,
      featureKey: feature.featureKey,
      featureLabel: feature.featureLabel,
      description: feature.description,
      enabled: feature.enabled,
      sortOrder: feature.sortOrder
    }))
  })
}

export async function replaceTraderSubscriptionFeatures(
  tx: DbClient,
  subscriptionId: string,
  featureInput: Parameters<typeof normalizeSubscriptionFeatureInputs>[0]
) {
  const features = normalizeSubscriptionFeatureInputs(featureInput)

  await tx.traderSubscriptionFeature.deleteMany({
    where: {
      subscriptionId
    }
  })

  if (features.length === 0) {
    return
  }

  await tx.traderSubscriptionFeature.createMany({
    data: features.map((feature) => ({
      subscriptionId,
      featureKey: feature.featureKey,
      featureLabel: feature.featureLabel,
      description: feature.description,
      enabled: feature.enabled,
      sortOrder: feature.sortOrder
    }))
  })
}

export async function getNonTerminalTraderSubscriptions(
  tx: DbClient,
  traderId: string,
  excludeSubscriptionId?: string | null
) {
  return tx.traderSubscription.findMany({
    where: {
      traderId,
      status: {
        in: ['pending', 'active', 'suspended']
      },
      ...(excludeSubscriptionId
        ? {
            id: {
              not: excludeSubscriptionId
            }
          }
        : {})
    },
    select: {
      id: true,
      subscriptionType: true,
      status: true,
      startDate: true,
      endDate: true
    },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
  })
}

export async function assertNoNonTerminalSubscriptionConflict(
  tx: DbClient,
  traderId: string,
  excludeSubscriptionId?: string | null
) {
  const conflicts = await getNonTerminalTraderSubscriptions(tx, traderId, excludeSubscriptionId)
  if (conflicts.length > 0) {
    const current = conflicts[0]
    throw new SubscriptionMutationError(
      `Trader already has ${current.subscriptionType} subscription in ${current.status} state.`,
      409
    )
  }
}

export async function expireOtherTraderSubscriptions(
  tx: DbClient,
  traderId: string,
  now: Date,
  excludeSubscriptionId?: string | null
) {
  await tx.traderSubscription.updateMany({
    where: {
      traderId,
      status: {
        in: ['pending', 'active', 'suspended']
      },
      ...(excludeSubscriptionId
        ? {
            id: {
              not: excludeSubscriptionId
            }
          }
        : {})
    },
    data: {
      status: 'expired',
      expiredAt: now
    }
  })
}

export async function cancelTraderSubscription(
  tx: DbClient,
  subscriptionId: string,
  notes: string | null,
  updatedByUserId: string | null,
  now: Date
) {
  return tx.traderSubscription.update({
    where: {
      id: subscriptionId
    },
    data: {
      status: 'cancelled',
      cancelledAt: now,
      updatedByUserId: updatedByUserId || undefined,
      ...(notes !== null ? { notes } : {})
    }
  })
}

export async function suspendTraderSubscription(
  tx: DbClient,
  subscriptionId: string,
  notes: string | null,
  updatedByUserId: string | null,
  now: Date
) {
  return tx.traderSubscription.update({
    where: {
      id: subscriptionId
    },
    data: {
      status: 'suspended',
      suspendedAt: now,
      updatedByUserId: updatedByUserId || undefined,
      ...(notes !== null ? { notes } : {})
    }
  })
}

export async function activateTraderSubscription(
  tx: DbClient,
  subscriptionId: string,
  notes: string | null,
  updatedByUserId: string | null,
  now: Date
) {
  return tx.traderSubscription.update({
    where: {
      id: subscriptionId
    },
    data: {
      status: 'active',
      activatedAt: now,
      updatedByUserId: updatedByUserId || undefined,
      suspendedAt: null,
      cancelledAt: null,
      expiredAt: null,
      ...(notes !== null ? { notes } : {})
    }
  })
}

export async function createManualSubscriptionPayment(
  tx: DbClient,
  input: {
    traderId: string
    traderSubscriptionId?: string | null
    planId?: string | null
    amount: number
    currency?: string | null
    status?: string | null
    paymentMode?: string | null
    referenceNo?: string | null
    paidAt?: Date | null
    confirmedAt?: Date | null
    confirmedByUserId?: string | null
    planNameSnapshot?: string | null
    notes?: string | null
  }
) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return null
  }

  return tx.subscriptionPayment.create({
    data: {
      traderId: input.traderId,
      traderSubscriptionId: input.traderSubscriptionId || null,
      planId: input.planId || null,
      amount: input.amount,
      currency: String(input.currency || 'INR').trim() || 'INR',
      status: normalizeSubscriptionPaymentStatus(input.status),
      paymentMode: normalizeSubscriptionPaymentMode(input.paymentMode),
      referenceNo: input.referenceNo || null,
      paidAt: input.paidAt || null,
      confirmedAt: input.confirmedAt || input.paidAt || null,
      confirmedByUserId: input.confirmedByUserId || null,
      planNameSnapshot: input.planNameSnapshot || null,
      notes: input.notes || null
    }
  })
}
