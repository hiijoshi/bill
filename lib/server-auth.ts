import 'server-only'

import { headers } from 'next/headers'

import {
  AUTH_CONTEXT_HEADER,
  decodeRequestAuthContext,
  normalizeAppRole,
  type AppRole,
  type RequestAuthContext
} from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import type { SessionNamespace } from '@/lib/session-cookies'

type ServerAuthNamespace = SessionNamespace | 'any'

export type ServerAuthenticatedUser = {
  id: string
  userId: string
  traderId: string
  name: string | null
  role: string | null
  companyId: string | null
  locked: boolean
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  trader: {
    id: string
    name: string | null
    locked: boolean
    deletedAt: Date | null
    maxCompanies: number | null
    maxUsers: number | null
  } | null
  company: {
    id: string
    name: string | null
    locked: boolean
    deletedAt: Date | null
  } | null
}

export type ResolvedServerAuth = {
  auth: RequestAuthContext
  user: ServerAuthenticatedUser
  source: 'header' | 'session'
}

type ResolveServerAuthOptions = {
  namespace?: ServerAuthNamespace
  allowedRoles?: AppRole[]
}

function matchesNamespace(role: AppRole, namespace: ServerAuthNamespace): boolean {
  if (namespace === 'any') return true
  if (namespace === 'super_admin') return role === 'super_admin'
  return role !== 'super_admin'
}

async function readHeaderAuthContext(namespace: ServerAuthNamespace): Promise<RequestAuthContext | null> {
  const headerStore = await headers()
  const decoded = decodeRequestAuthContext(headerStore.get(AUTH_CONTEXT_HEADER))
  if (!decoded) {
    return null
  }

  return matchesNamespace(decoded.role, namespace) ? decoded : null
}

async function loadActiveUser(candidate: RequestAuthContext): Promise<ServerAuthenticatedUser | null> {
  const user = await prisma.user.findFirst({
    where: candidate.userDbId
      ? {
          id: candidate.userDbId,
          deletedAt: null
        }
      : {
          userId: candidate.userId,
          traderId: candidate.traderId,
          deletedAt: null
        },
    select: {
      id: true,
      userId: true,
      traderId: true,
      name: true,
      role: true,
      companyId: true,
      locked: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      trader: {
        select: {
          id: true,
          name: true,
          locked: true,
          deletedAt: true,
          maxCompanies: true,
          maxUsers: true
        }
      },
      company: {
        select: {
          id: true,
          name: true,
          locked: true,
          deletedAt: true
        }
      }
    }
  })

  if (!user || user.locked || user.deletedAt || user.trader?.locked || user.trader?.deletedAt) {
    return null
  }

  return user
}

function toResolvedAuth(user: ServerAuthenticatedUser, fallbackRole?: string | null): RequestAuthContext {
  return {
    userId: user.userId,
    traderId: user.traderId,
    role: normalizeAppRole(user.role || fallbackRole),
    companyId: user.companyId || null,
    userDbId: user.id
  }
}

async function resolveFromSession(namespace: SessionNamespace): Promise<RequestAuthContext | null> {
  const session = await getSession(namespace)
  if (!session) {
    return null
  }

  return {
    userId: session.userId,
    traderId: session.traderId,
    role: normalizeAppRole(session.role),
    companyId: null,
    userDbId: null,
    sessionIssuedAt: null
  }
}

export async function resolveServerAuth(
  options: ResolveServerAuthOptions = {}
): Promise<ResolvedServerAuth | null> {
  const namespace = options.namespace || 'app'
  const candidates: Array<{ auth: RequestAuthContext; source: ResolvedServerAuth['source'] }> = []

  const headerAuth = await readHeaderAuthContext(namespace)
  if (headerAuth) {
    candidates.push({ auth: headerAuth, source: 'header' })
  }

  if (namespace === 'any') {
    const [superAdminSession, appSession] = await Promise.all([
      resolveFromSession('super_admin'),
      resolveFromSession('app')
    ])

    if (superAdminSession && matchesNamespace(superAdminSession.role, namespace)) {
      candidates.push({ auth: superAdminSession, source: 'session' })
    }
    if (appSession && matchesNamespace(appSession.role, namespace)) {
      candidates.push({ auth: appSession, source: 'session' })
    }
  } else {
    const sessionAuth = await resolveFromSession(namespace)
    if (sessionAuth && matchesNamespace(sessionAuth.role, namespace)) {
      candidates.push({ auth: sessionAuth, source: 'session' })
    }
  }

  for (const candidate of candidates) {
    const user = await loadActiveUser(candidate.auth)
    if (!user) {
      continue
    }

    const auth = toResolvedAuth(user, candidate.auth.role)
    if (!matchesNamespace(auth.role, namespace)) {
      continue
    }
    if (options.allowedRoles && !options.allowedRoles.includes(auth.role)) {
      continue
    }

    return {
      auth,
      user,
      source: candidate.source
    }
  }

  return null
}
