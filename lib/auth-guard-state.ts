import { prisma } from '@/lib/prisma'
import type { RequestAuthContext } from '@/lib/api-security'

export type AuthGuardState = {
  missing: boolean
  userLocked: boolean
  userDeleted: boolean
  traderLocked: boolean
  traderDeleted: boolean
  userUpdatedAtMs: number | null
}

const AUTH_GUARD_CACHE_TTL_MS = 15_000
const authGuardCache = new Map<string, { state: AuthGuardState; expiresAt: number }>()
const REQUEST_GUARD_CACHE_TTL_MS = 15_000

type RequestGuardCacheEntry = {
  expiresAt: number
  values: Map<string, Promise<AuthGuardState> | AuthGuardState>
}

declare global {
  var __mbillAuthGuardRequestCache: Map<string, RequestGuardCacheEntry> | undefined
}

export function getAuthGuardCacheKey(auth: RequestAuthContext) {
  return `${auth.userDbId || ''}:${auth.traderId}:${auth.userId}`
}

function getRequestGuardCacheStore(): Map<string, RequestGuardCacheEntry> {
  if (!globalThis.__mbillAuthGuardRequestCache) {
    globalThis.__mbillAuthGuardRequestCache = new Map<string, RequestGuardCacheEntry>()
  }

  const now = Date.now()
  for (const [requestId, entry] of globalThis.__mbillAuthGuardRequestCache.entries()) {
    if (entry.expiresAt <= now) {
      globalThis.__mbillAuthGuardRequestCache.delete(requestId)
    }
  }

  return globalThis.__mbillAuthGuardRequestCache
}

function getRequestGuardValues(requestId?: string | null): Map<string, Promise<AuthGuardState> | AuthGuardState> | null {
  const normalizedRequestId = String(requestId || '').trim()
  if (!normalizedRequestId) {
    return null
  }

  const store = getRequestGuardCacheStore()
  const current = store.get(normalizedRequestId)
  if (current && current.expiresAt > Date.now()) {
    return current.values
  }

  const values = new Map<string, Promise<AuthGuardState> | AuthGuardState>()
  store.set(normalizedRequestId, {
    values,
    expiresAt: Date.now() + REQUEST_GUARD_CACHE_TTL_MS
  })
  return values
}

export function invalidateAuthGuardStateForUser(params: {
  id?: string | null
  traderId: string
  userId: string
}) {
  const normalizedUserId = params.userId.trim().toLowerCase()

  for (const key of authGuardCache.keys()) {
    if (params.id && key.startsWith(`${params.id}:`)) {
      authGuardCache.delete(key)
      continue
    }

    if (key.endsWith(`:${params.traderId}:${normalizedUserId}`)) {
      authGuardCache.delete(key)
    }
  }
}

export function hasSessionStateDrift(auth: RequestAuthContext, state: AuthGuardState): boolean {
  if (!auth.sessionIssuedAt || !state.userUpdatedAtMs) {
    return false
  }

  return state.userUpdatedAtMs > auth.sessionIssuedAt * 1000 + 1000
}

export async function loadAuthGuardState(auth: RequestAuthContext): Promise<AuthGuardState> {
  const cacheKey = getAuthGuardCacheKey(auth)
  const requestValues = getRequestGuardValues(auth.requestId)
  const requestCached = requestValues?.get(cacheKey)
  if (requestCached) {
    return await Promise.resolve(requestCached)
  }

  const cached = authGuardCache.get(cacheKey)
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    requestValues?.set(cacheKey, cached.state)
    return cached.state
  }

  const loadState = async (): Promise<AuthGuardState> => {
    const user = auth.userDbId
      ? await prisma.user.findFirst({
          where: { id: auth.userDbId },
          select: {
            locked: true,
            deletedAt: true,
            updatedAt: true,
            trader: {
              select: {
                locked: true,
                deletedAt: true
              }
            }
          }
        })
      : await prisma.user.findFirst({
          where: {
            traderId: auth.traderId,
            userId: auth.userId
          },
          select: {
            locked: true,
            deletedAt: true,
            updatedAt: true,
            trader: {
              select: {
                locked: true,
                deletedAt: true
              }
            }
          }
        })

    const state: AuthGuardState = user
      ? {
          missing: false,
          userLocked: user.locked,
          userDeleted: Boolean(user.deletedAt),
          traderLocked: Boolean(user.trader?.locked),
          traderDeleted: Boolean(user.trader?.deletedAt),
          userUpdatedAtMs: user.updatedAt.getTime()
        }
      : {
          missing: true,
          userLocked: false,
          userDeleted: false,
          traderLocked: false,
          traderDeleted: false,
          userUpdatedAtMs: null
        }

    authGuardCache.set(cacheKey, {
      state,
      expiresAt: Date.now() + AUTH_GUARD_CACHE_TTL_MS
    })

    return state
  }

  const pending = loadState()
  requestValues?.set(cacheKey, pending)

  try {
    const state = await pending
    requestValues?.set(cacheKey, state)
    return state
  } catch (error) {
    if (requestValues?.get(cacheKey) === pending) {
      requestValues.delete(cacheKey)
    }
    throw error
  }
}
