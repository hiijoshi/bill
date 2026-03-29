import 'server-only'

import { cookies, headers } from 'next/headers'

import { getAccessibleCompanies, normalizeAppRole, type RequestAuthContext } from '@/lib/api-security'
import { resolveFirstAccessibleAppRoute, type PermissionAccessRow } from '@/lib/app-default-route'
import { PERMISSION_MODULES } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { getCompanyCookieNameCandidates } from '@/lib/session-cookies'

function normalizeCompanyId(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function getCookieCompanyId(): Promise<string | null> {
  const cookieStore = await cookies()
  const headerStore = await headers()
  const scopeSource = headerStore.get('x-forwarded-host') || headerStore.get('host') || null

  return (
    getCompanyCookieNameCandidates(scopeSource)
      .map((cookieName) => normalizeCompanyId(cookieStore.get(cookieName)?.value))
      .find((value): value is string => Boolean(value)) || null
  )
}

function buildSuperAdminPermissions(): PermissionAccessRow[] {
  return PERMISSION_MODULES.map((module) => ({
    module,
    canRead: true,
    canWrite: true
  }))
}

export async function resolveServerDefaultAppRoute(requestedCompanyId?: string | null): Promise<string | null> {
  const session = await getSession()
  if (!session) {
    return null
  }

  const user = await prisma.user.findFirst({
    where: {
      userId: session.userId,
      traderId: session.traderId,
      deletedAt: null
    },
    select: {
      id: true,
      companyId: true,
      role: true,
      locked: true,
      trader: {
        select: {
          locked: true,
          deletedAt: true
        }
      }
    }
  })

  if (!user || user.locked || user.trader?.locked || user.trader?.deletedAt) {
    return '/login'
  }

  const auth: RequestAuthContext = {
    userId: session.userId,
    traderId: session.traderId,
    role: normalizeAppRole(user.role || session.role),
    companyId: user.companyId,
    userDbId: user.id
  }

  const requestedId = normalizeCompanyId(requestedCompanyId)
  const cookieCompanyId = await getCookieCompanyId()
  const accessibleCompanies = await getAccessibleCompanies(auth)
  const unlockedCompanies = accessibleCompanies.filter((company) => !company.locked)
  if (unlockedCompanies.length === 0) {
    return '/company/select'
  }

  const currentCompany =
    (requestedId ? unlockedCompanies.find((company) => company.id === requestedId) : null) ||
    (cookieCompanyId ? unlockedCompanies.find((company) => company.id === cookieCompanyId) : null) ||
    (user.companyId ? unlockedCompanies.find((company) => company.id === user.companyId) : null) ||
    unlockedCompanies[0] ||
    null

  if (!currentCompany) {
    return '/company/select'
  }

  const permissions =
    auth.role === 'super_admin'
      ? buildSuperAdminPermissions()
      : await prisma.userPermission.findMany({
          where: {
            userId: user.id,
            companyId: currentCompany.id
          },
          select: {
            module: true,
            canRead: true,
            canWrite: true
          }
        })

  return resolveFirstAccessibleAppRoute(permissions, currentCompany.id)
}
