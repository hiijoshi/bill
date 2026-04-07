import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveRoutePermission } from '@/lib/permissions'
import { resolveSupabaseAppSession } from '@/lib/supabase/app-session'
import { getCompanySubscriptionAccess, getSubscriptionAccessMessage, isModuleEnabledForEntitlement } from '@/lib/subscription-core'
import { getTraderDataAccessMessage, getTraderDataLifecycleSummary } from '@/lib/trader-retention'

export type AppRole = 'super_admin' | 'trader_admin' | 'company_admin' | 'company_user'

export type RequestAuthContext = {
  userId: string
  traderId: string
  role: AppRole
  companyId: string | null
  userDbId: string | null
  sessionIssuedAt?: number | null
  requestId?: string
}

export const AUTH_CONTEXT_HEADER = 'x-auth-context'
const REQUEST_SCOPED_CACHE_TTL_MS = 15_000

type RequestScopedCacheEntry = {
  expiresAt: number
  values: Map<string, Promise<unknown> | unknown>
}

declare global {
  var __mbillApiSecurityRequestCache: Map<string, RequestScopedCacheEntry> | undefined
}

const ROLE_ALIASES: Record<string, AppRole> = {
  super_admin: 'super_admin',
  superadmin: 'super_admin',
  root: 'super_admin',
  trader_admin: 'trader_admin',
  trader: 'trader_admin',
  admin: 'company_admin',
  company_admin: 'company_admin',
  company_user: 'company_user',
  user: 'company_user'
}

export function normalizeAppRole(role?: string | null): AppRole {
  if (!role) return 'company_user'
  const normalized = role.toLowerCase().replace(/\s+/g, '_')
  return ROLE_ALIASES[normalized] || 'company_user'
}

function normalizeNullableHeaderValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function encodeRequestAuthContext(auth: RequestAuthContext): string {
  return Buffer.from(JSON.stringify(auth), 'utf8').toString('base64url')
}

export function decodeRequestAuthContext(value: string | null | undefined): RequestAuthContext | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<RequestAuthContext>
    if (typeof parsed.userId !== 'string' || typeof parsed.traderId !== 'string') {
      return null
    }

    return {
      userId: parsed.userId,
      traderId: parsed.traderId,
      role: normalizeAppRole(parsed.role),
      companyId: normalizeNullableHeaderValue(parsed.companyId),
      userDbId: normalizeNullableHeaderValue(parsed.userDbId),
      sessionIssuedAt: typeof parsed.sessionIssuedAt === 'number' ? parsed.sessionIssuedAt : null,
      requestId: normalizeNullableHeaderValue(parsed.requestId) || undefined
    }
  } catch {
    return null
  }
}

export function getRequestAuthContext(request: NextRequest): RequestAuthContext | null {
  const encodedContext = request.headers.get(AUTH_CONTEXT_HEADER)
  const decodedContext = decodeRequestAuthContext(encodedContext)
  if (decodedContext) {
    return decodedContext
  }

  const userId = request.headers.get('x-user-id')
  const traderId = request.headers.get('x-trader-id')

  if (!userId || !traderId) {
    return null
  }

  return {
    userId,
    traderId,
    role: normalizeAppRole(
      request.headers.get('x-user-role-normalized') || request.headers.get('x-user-role')
    ),
    companyId: normalizeNullableHeaderValue(request.headers.get('x-company-id')),
    userDbId: normalizeNullableHeaderValue(request.headers.get('x-user-db-id')),
    sessionIssuedAt: null,
    requestId: request.headers.get('x-request-id') || undefined
  }
}

export function getRequestIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export function isSuperAdmin(auth: RequestAuthContext): boolean {
  return auth.role === 'super_admin'
}

export function unauthorized(message = 'Unauthorized'): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden'): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function parseBooleanParam(value: string | null | undefined, defaultValue = false): boolean {
  if (value === null || value === undefined) return defaultValue
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

export function normalizeId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const digitsOnly = value.replace(/\D/g, '')
  return digitsOnly.length === 10 ? digitsOnly : null
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export function requireAuthContext(request: NextRequest):
  | { ok: true; auth: RequestAuthContext }
  | { ok: false; response: NextResponse } {
  const auth = getRequestAuthContext(request)
  if (!auth) {
    return { ok: false, response: unauthorized('Authentication required') }
  }
  return { ok: true, auth }
}

export function requireRoles(
  request: NextRequest,
  allowedRoles: AppRole[]
):
  | { ok: true; auth: RequestAuthContext }
  | { ok: false; response: NextResponse } {
  const authResult = requireAuthContext(request)
  if (!authResult.ok) return authResult

  if (!allowedRoles.includes(authResult.auth.role)) {
    return { ok: false, response: forbidden('Insufficient privileges') }
  }

  return authResult
}

function getRequestScopedCacheStore(): Map<string, RequestScopedCacheEntry> {
  if (!globalThis.__mbillApiSecurityRequestCache) {
    globalThis.__mbillApiSecurityRequestCache = new Map<string, RequestScopedCacheEntry>()
  }

  const now = Date.now()
  for (const [requestId, entry] of globalThis.__mbillApiSecurityRequestCache.entries()) {
    if (entry.expiresAt <= now) {
      globalThis.__mbillApiSecurityRequestCache.delete(requestId)
    }
  }

  return globalThis.__mbillApiSecurityRequestCache
}

function getRequestScopedValues(requestId?: string | null): Map<string, Promise<unknown> | unknown> | null {
  const normalizedRequestId = String(requestId || '').trim()
  if (!normalizedRequestId) {
    return null
  }

  const store = getRequestScopedCacheStore()
  const current = store.get(normalizedRequestId)
  if (current && current.expiresAt > Date.now()) {
    return current.values
  }

  const values = new Map<string, Promise<unknown> | unknown>()
  store.set(normalizedRequestId, {
    values,
    expiresAt: Date.now() + REQUEST_SCOPED_CACHE_TTL_MS
  })
  return values
}

async function withRequestScopedCache<T>(
  auth: RequestAuthContext,
  cacheKey: string,
  loader: () => Promise<T>
): Promise<T> {
  const values = getRequestScopedValues(auth.requestId)
  if (!values) {
    return loader()
  }

  const cached = values.get(cacheKey)
  if (cached !== undefined) {
    return await Promise.resolve(cached as T | Promise<T>)
  }

  const pending = loader()
  values.set(cacheKey, pending)

  try {
    const resolved = await pending
    values.set(cacheKey, resolved)
    return resolved
  } catch (error) {
    if (values.get(cacheKey) === pending) {
      values.delete(cacheKey)
    }
    throw error
  }
}

function normalizeCompanyIdsCacheKey(companyIds: string[]): string {
  return companyIds
    .map((companyId) => companyId.trim())
    .filter(Boolean)
    .sort()
    .join(',')
}

async function getPermissionScopedCompanyCandidateIds(auth: RequestAuthContext): Promise<string[]> {
  return withRequestScopedCache(auth, 'permission-company-candidates', async () => {
    const candidateIds = new Set<string>()
    if (auth.companyId) {
      candidateIds.add(auth.companyId)
    }

    if (auth.userDbId) {
      const permissionRows = await prisma.userPermission.findMany({
        where: {
          userId: auth.userDbId,
          OR: [{ canRead: true }, { canWrite: true }],
          company: {
            deletedAt: null,
            OR: [{ traderId: auth.traderId }, { traderId: null }]
          }
        },
        select: {
          companyId: true
        }
      })

      permissionRows.forEach((row) => {
        if (row.companyId) candidateIds.add(row.companyId)
      })
    }

    return Array.from(candidateIds)
  })
}

export async function hasCompanyAccess(
  companyId: string,
  auth: RequestAuthContext,
  request?: NextRequest
): Promise<boolean> {
  if (!companyId) return false

  if (request) {
    const supabaseAccess = await withRequestScopedCache(
      auth,
      `supabase-company-access:${companyId}`,
      async () => {
        const supabaseSession = await resolveSupabaseAppSession(request, companyId)
        if (!supabaseSession) {
          return null
        }

        return supabaseSession.companies.some((company) => company.id === companyId && !company.locked)
      }
    )

    if (typeof supabaseAccess === 'boolean') {
      return supabaseAccess
    }
  }

  const scopedCompanyIds = await getScopedCompanyIds(auth, companyId)
  return scopedCompanyIds.includes(companyId)
}

async function hasModulePermission(
  auth: RequestAuthContext,
  companyId: string,
  action: 'read' | 'write',
  module: string
): Promise<boolean> {
  if (isSuperAdmin(auth) || auth.role === 'trader_admin' || auth.role === 'company_admin') {
    return true
  }

  if (!auth.userDbId) {
    return false
  }

  const userDbId = auth.userDbId
  const permission = await withRequestScopedCache(
    auth,
    `module-permission:${companyId}:${action}:${module}`,
    () =>
      prisma.userPermission.findUnique({
        where: {
          userId_companyId_module: {
            userId: userDbId,
            companyId,
            module
          }
        },
        select: {
          canRead: true,
          canWrite: true
        }
      })
  )

  if (!permission) {
    return false
  }

  if (action === 'write') {
    return permission.canWrite
  }

  return permission.canRead || permission.canWrite
}

export async function canAccessCompanyRoute(
  request: NextRequest,
  companyId: string,
  pathname: string,
  method: string
): Promise<boolean> {
  const normalizedCompanyId = companyId.trim()
  if (!normalizedCompanyId) {
    return false
  }

  const authResult = requireAuthContext(request)
  if (!authResult.ok) {
    return false
  }

  const { auth } = authResult
  const allowedCompany = await hasCompanyAccess(normalizedCompanyId, auth, request)
  if (!allowedCompany) {
    return false
  }

  const routePermission = resolveRoutePermission(pathname, method)
  if (!routePermission) {
    return true
  }

  const hasPermission = await hasModulePermission(
    auth,
    normalizedCompanyId,
    routePermission.action,
    routePermission.module
  )

  if (!hasPermission) {
    return false
  }

  if (auth.role === 'super_admin') {
    return true
  }

  const subscriptionAccess = await withRequestScopedCache(auth, `subscription-access:${normalizedCompanyId}`, () =>
    getCompanySubscriptionAccess(prisma, normalizedCompanyId)
  )

  if (!subscriptionAccess) {
    return true
  }

  const allowedBySubscription = isModuleEnabledForEntitlement(
    subscriptionAccess.entitlement,
    routePermission.module,
    routePermission.action
  )

  if (!allowedBySubscription) {
    return false
  }

  const dataLifecycle = await withRequestScopedCache(
    auth,
    `subscription-data-lifecycle:${subscriptionAccess.traderId}:${normalizedCompanyId}`,
    () => getTraderDataLifecycleSummary(prisma, subscriptionAccess.traderId, new Date(), {
      entitlement: subscriptionAccess.entitlement
    })
  )

  if (!dataLifecycle) {
    return true
  }

  if (routePermission.action === 'read') {
    return dataLifecycle.allowReadOperations
  }

  return dataLifecycle.allowWriteOperations
}

export async function filterCompanyIdsByRoutePermission(
  auth: RequestAuthContext,
  companyIds: string[],
  pathname: string,
  method: string
): Promise<string[]> {
  if (
    companyIds.length === 0 ||
    isSuperAdmin(auth) ||
    auth.role === 'trader_admin' ||
    auth.role === 'company_admin'
  ) {
    return companyIds
  }

  const routePermission = resolveRoutePermission(pathname, method)
  if (!routePermission) {
    return companyIds
  }

  if (!auth.userDbId) {
    return []
  }

  const userDbId = auth.userDbId
  const rows = await withRequestScopedCache(
    auth,
    `route-company-permission:${pathname}:${method}:${routePermission.module}:${routePermission.action}:${normalizeCompanyIdsCacheKey(companyIds)}`,
    () =>
      prisma.userPermission.findMany({
        where: {
          userId: userDbId,
          companyId: { in: companyIds },
          module: routePermission.module,
          ...(routePermission.action === 'write'
            ? { canWrite: true }
            : { OR: [{ canRead: true }, { canWrite: true }] })
        },
        select: {
          companyId: true
        }
      })
  )

  const allowed = new Set(rows.map((row) => row.companyId))
  return companyIds.filter((companyId) => allowed.has(companyId))
}

export async function ensureCompanyAccess(
  request: NextRequest,
  companyId: string | null | undefined
): Promise<NextResponse | null> {
  if (!companyId || companyId.trim().length === 0) {
    return badRequest('Company ID is required')
  }

  const authResult = requireAuthContext(request)
  if (!authResult.ok) {
    return authResult.response
  }

  const allowed = await hasCompanyAccess(companyId, authResult.auth, request)
  if (!allowed) {
    return forbidden('Company access denied')
  }

  const routePermission = resolveRoutePermission(request.nextUrl.pathname, request.method)
  if (routePermission) {
    const hasPermission = await hasModulePermission(
      authResult.auth,
      companyId,
      routePermission.action,
      routePermission.module
    )

    if (!hasPermission) {
      return forbidden(
        `Missing privilege: ${routePermission.module} (${routePermission.action})`
      )
    }

    if (authResult.auth.role !== 'super_admin') {
      const subscriptionAccess = await getCompanySubscriptionAccess(prisma, companyId)

      if (subscriptionAccess) {
        const allowedBySubscription = isModuleEnabledForEntitlement(
          subscriptionAccess.entitlement,
          routePermission.module,
          routePermission.action
        )

        if (!allowedBySubscription) {
          return forbidden(getSubscriptionAccessMessage(subscriptionAccess.entitlement, routePermission.module))
        }

        const dataLifecycle = await getTraderDataLifecycleSummary(prisma, subscriptionAccess.traderId, new Date(), {
          entitlement: subscriptionAccess.entitlement
        })

        if (dataLifecycle) {
          if (routePermission.action === 'read' && !dataLifecycle.allowReadOperations) {
            return forbidden(getTraderDataAccessMessage(dataLifecycle))
          }

          if (routePermission.action === 'write' && !dataLifecycle.allowWriteOperations) {
            return forbidden(
              getTraderDataAccessMessage(
                dataLifecycle,
                getSubscriptionAccessMessage(subscriptionAccess.entitlement, routePermission.module)
              )
            )
          }
        }
      }
    }
  }

  return null
}

export async function getScopedCompanyIds(
  auth: RequestAuthContext,
  requestedCompanyId?: string | null
): Promise<string[]> {
  const companyId = requestedCompanyId?.trim()

  if (auth.role === 'super_admin') {
    const rows = await withRequestScopedCache(auth, `scoped-company-ids:super_admin:${companyId || '*'}`, () =>
      prisma.company.findMany({
        where: {
          deletedAt: null,
          locked: false,
          ...(companyId ? { id: companyId } : {})
        },
        select: { id: true }
      })
    )
    return rows.map((row) => row.id)
  }

  if (auth.role === 'trader_admin') {
    const rows = await withRequestScopedCache(auth, `scoped-company-ids:trader_admin:${companyId || '*'}`, () =>
      prisma.company.findMany({
        where: {
          deletedAt: null,
          locked: false,
          OR: [{ traderId: auth.traderId }, { traderId: null }],
          ...(companyId ? { id: companyId } : {})
        },
        select: { id: true }
      })
    )
    return rows.map((row) => row.id)
  }

  const ids = await getPermissionScopedCompanyCandidateIds(auth)
  if (ids.length === 0) return []

  const rows = await withRequestScopedCache(
    auth,
    `scoped-company-ids:user:${companyId || '*'}:${normalizeCompanyIdsCacheKey(ids)}`,
    () =>
      prisma.company.findMany({
        where: {
          id: {
            in: companyId ? ids.filter((id) => id === companyId) : ids
          },
          deletedAt: null,
          locked: false,
          OR: [{ traderId: auth.traderId }, { traderId: null }]
        },
        select: { id: true }
      })
  )

  return rows.map((row) => row.id)
}

export async function getAccessibleCompanies(
  auth: RequestAuthContext,
  requestedCompanyId?: string | null
): Promise<Array<{ id: string; name: string; locked: boolean; traderId: string | null }>> {
  const companyId = requestedCompanyId?.trim()

  if (auth.role === 'super_admin') {
    return withRequestScopedCache(auth, `accessible-companies:super_admin:${companyId || '*'}`, () =>
      prisma.company.findMany({
        where: {
          deletedAt: null,
          ...(companyId ? { id: companyId } : {})
        },
        select: {
          id: true,
          name: true,
          locked: true,
          traderId: true
        },
        orderBy: { name: 'asc' }
      })
    )
  }

  if (auth.role === 'trader_admin') {
    return withRequestScopedCache(auth, `accessible-companies:trader_admin:${companyId || '*'}`, () =>
      prisma.company.findMany({
        where: {
          deletedAt: null,
          OR: [{ traderId: auth.traderId }, { traderId: null }],
          ...(companyId ? { id: companyId } : {})
        },
        select: {
          id: true,
          name: true,
          locked: true,
          traderId: true
        },
        orderBy: { name: 'asc' }
      })
    )
  }

  const ids = await getPermissionScopedCompanyCandidateIds(auth)
  if (ids.length === 0) return []

  return withRequestScopedCache(
    auth,
    `accessible-companies:user:${companyId || '*'}:${normalizeCompanyIdsCacheKey(ids)}`,
    () =>
      prisma.company.findMany({
        where: {
          id: {
            in: companyId ? ids.filter((id) => id === companyId) : ids
          },
          deletedAt: null,
          OR: [{ traderId: auth.traderId }, { traderId: null }]
        },
        select: {
          id: true,
          name: true,
          locked: true,
          traderId: true
        },
        orderBy: { name: 'asc' }
      })
  )
}

export async function parseJsonWithSchema<T>(
  request: NextRequest,
  schema: z.ZodSchema<T>
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        },
        { status: 400 }
      )
    }
  }

  return { ok: true, data: parsed.data }
}
