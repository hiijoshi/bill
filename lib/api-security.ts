import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveRoutePermission } from '@/lib/permissions'

export type AppRole = 'super_admin' | 'trader_admin' | 'company_admin' | 'company_user'

export type RequestAuthContext = {
  userId: string
  traderId: string
  role: AppRole
  companyId: string | null
  userDbId: string | null
  requestId?: string
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

export function getRequestAuthContext(request: NextRequest): RequestAuthContext | null {
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
    companyId: request.headers.get('x-company-id') || null,
    userDbId: request.headers.get('x-user-db-id') || null,
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

export async function hasCompanyAccess(
  companyId: string,
  auth: RequestAuthContext
): Promise<boolean> {
  if (!companyId) return false

  const where: {
    id: string
    deletedAt: null
    traderId?: string
  } = {
    id: companyId,
    deletedAt: null
  }

  if (!isSuperAdmin(auth)) {
    if (auth.role === 'trader_admin') {
      where.traderId = auth.traderId
    } else {
      if (!auth.companyId || auth.companyId !== companyId) {
        return false
      }
      where.traderId = auth.traderId
    }
  }

  const company = await prisma.company.findFirst({
    where,
    select: { id: true }
  })

  return !!company
}

async function hasModulePermission(
  auth: RequestAuthContext,
  companyId: string,
  action: 'read' | 'write',
  module: string
): Promise<boolean> {
  if (isSuperAdmin(auth)) {
    return true
  }

  if (!auth.userDbId) {
    return false
  }

  const permission = await prisma.userPermission.findUnique({
    where: {
      userId_companyId_module: {
        userId: auth.userDbId,
        companyId,
        module
      }
    },
    select: {
      canRead: true,
      canWrite: true
    }
  })

  if (!permission) {
    return false
  }

  if (action === 'write') {
    return permission.canWrite
  }

  return permission.canRead || permission.canWrite
}

export async function filterCompanyIdsByRoutePermission(
  auth: RequestAuthContext,
  companyIds: string[],
  pathname: string,
  method: string
): Promise<string[]> {
  if (companyIds.length === 0 || isSuperAdmin(auth)) {
    return companyIds
  }

  const routePermission = resolveRoutePermission(pathname, method)
  if (!routePermission) {
    return companyIds
  }

  if (!auth.userDbId) {
    return []
  }

  const rows = await prisma.userPermission.findMany({
    where: {
      userId: auth.userDbId,
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

  const allowed = await hasCompanyAccess(companyId, authResult.auth)
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
  }

  return null
}

export async function getScopedCompanyIds(
  auth: RequestAuthContext,
  requestedCompanyId?: string | null
): Promise<string[]> {
  const companyId = requestedCompanyId?.trim()

  if (auth.role === 'super_admin') {
    const rows = await prisma.company.findMany({
      where: {
        deletedAt: null,
        ...(companyId ? { id: companyId } : {})
      },
      select: { id: true }
    })
    return rows.map((row) => row.id)
  }

  if (auth.role === 'trader_admin') {
    const rows = await prisma.company.findMany({
      where: {
        traderId: auth.traderId,
        deletedAt: null,
        ...(companyId ? { id: companyId } : {})
      },
      select: { id: true }
    })
    return rows.map((row) => row.id)
  }

  if (!auth.companyId) return []
  if (companyId && companyId !== auth.companyId) return []

  const company = await prisma.company.findFirst({
    where: {
      id: auth.companyId,
      traderId: auth.traderId,
      deletedAt: null
    },
    select: { id: true }
  })

  return company ? [company.id] : []
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
