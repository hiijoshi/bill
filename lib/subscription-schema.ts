import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isPrismaSchemaMismatchError } from '@/lib/prisma-schema-guard'

type DbClient = typeof prisma | Prisma.TransactionClient

const SUBSCRIPTION_MANAGEMENT_SCHEMA_IDENTIFIERS = [
  'subscriptionplan',
  'subscriptionplanfeature',
  'tradersubscription',
  'tradersubscriptionfeature',
  'subscriptionpayment',
  'traderdatalifecycle',
  'traderdatabackup'
] as const

export const SUBSCRIPTION_SCHEMA_READY_HEADER = 'x-subscription-schema-ready'
export const SUBSCRIPTION_SCHEMA_WARNING_HEADER = 'x-subscription-schema-warning'
export const SUBSCRIPTION_SCHEMA_WARNING_MESSAGE =
  'Subscription management schema is not initialized yet. Run: npm run prisma:migrate:deploy && npx prisma generate'

const SUBSCRIPTION_SCHEMA_CACHE_TTL_MS = 30_000

let subscriptionManagementSchemaState:
  | {
      ready: boolean
      checkedAt: number
    }
  | null = null

export function isSubscriptionManagementSchemaMismatchError(error: unknown) {
  return isPrismaSchemaMismatchError(error, SUBSCRIPTION_MANAGEMENT_SCHEMA_IDENTIFIERS)
}

export async function ensureSubscriptionManagementSchemaReady(db: DbClient) {
  if (
    subscriptionManagementSchemaState &&
    Date.now() - subscriptionManagementSchemaState.checkedAt < SUBSCRIPTION_SCHEMA_CACHE_TTL_MS
  ) {
    return subscriptionManagementSchemaState.ready
  }

  try {
    await db.subscriptionPlan.findFirst({
      select: {
        id: true
      }
    })

    await db.traderDataLifecycle.findFirst({
      select: {
        id: true
      }
    })

    subscriptionManagementSchemaState = {
      ready: true,
      checkedAt: Date.now()
    }
    return true
  } catch (error) {
    if (isSubscriptionManagementSchemaMismatchError(error)) {
      subscriptionManagementSchemaState = {
        ready: false,
        checkedAt: Date.now()
      }
      return false
    }

    throw error
  }
}

export function buildSubscriptionSchemaHeaders(schemaReady: boolean, init?: HeadersInit) {
  const headers = new Headers(init)
  headers.set(SUBSCRIPTION_SCHEMA_READY_HEADER, schemaReady ? 'true' : 'false')

  if (schemaReady) {
    headers.delete(SUBSCRIPTION_SCHEMA_WARNING_HEADER)
  } else {
    headers.set(SUBSCRIPTION_SCHEMA_WARNING_HEADER, SUBSCRIPTION_SCHEMA_WARNING_MESSAGE)
  }

  return headers
}

export function readSubscriptionSchemaState(headers: Headers) {
  const schemaReady = headers.get(SUBSCRIPTION_SCHEMA_READY_HEADER) !== 'false'
  const schemaWarning = schemaReady
    ? null
    : headers.get(SUBSCRIPTION_SCHEMA_WARNING_HEADER) || SUBSCRIPTION_SCHEMA_WARNING_MESSAGE

  return {
    schemaReady,
    schemaWarning
  }
}
