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

export function getAuthGuardCacheKey(auth: RequestAuthContext) {
  return `${auth.userDbId || ''}:${auth.traderId}:${auth.userId}`
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
  const cached = authGuardCache.get(cacheKey)
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    return cached.state
  }

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
    expiresAt: now + AUTH_GUARD_CACHE_TTL_MS
  })

  return state
}
