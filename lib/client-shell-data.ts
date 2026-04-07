import { getClientCache, getOrLoadClientCache, setClientCache } from './client-fetch-cache'
import { isAbortError } from './http'
import { loadClientPermissions, type ClientPermissionsPayload } from './client-permissions'

export type ShellAuthMePayload = {
  success?: boolean
  user?: {
    id?: string | null
    userId?: string | null
    traderId?: string | null
    name?: string | null
    role?: string | null
    companyId?: string | null
    assignedCompanyId?: string | null
  } | null
  trader?: {
    id?: string | null
    name?: string | null
  } | null
  company?: {
    id?: string | null
    name?: string | null
  } | null
}

export type ShellCompanySummary = {
  id: string
  name: string
  locked?: boolean
}

export type ShellBootstrapPayload = {
  auth: ShellAuthMePayload | null
  companies: ShellCompanySummary[]
  activeCompanyId: string
  permissions: ClientPermissionsPayload | null
}

export const SHELL_AUTH_CACHE_KEY = 'shell:auth-me'
export const SHELL_COMPANIES_CACHE_KEY = 'shell:companies'
export const SHELL_ACTIVE_COMPANY_CACHE_KEY = 'shell:active-company-id'
export const SHELL_AUTH_CACHE_AGE_MS = 5 * 60_000
export const SHELL_COMPANIES_CACHE_AGE_MS = 5 * 60_000
export const SHELL_ACTIVE_COMPANY_CACHE_AGE_MS = 5 * 60_000

function normalizeAuthPayload(payload: ShellAuthMePayload | null): ShellAuthMePayload | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  return {
    success: Boolean(payload.success),
    user: payload.user
      ? {
          id: String(payload.user.id || '').trim() || null,
          userId: String(payload.user.userId || '').trim() || null,
          traderId: String(payload.user.traderId || '').trim() || null,
          name: String(payload.user.name || '').trim() || null,
          role: String(payload.user.role || '').trim() || null,
          companyId: String(payload.user.companyId || '').trim() || null,
          assignedCompanyId: String(payload.user.assignedCompanyId || '').trim() || null
        }
      : null,
    trader: payload.trader
      ? {
          id: String(payload.trader.id || '').trim() || null,
          name: String(payload.trader.name || '').trim() || null
        }
      : null,
    company: payload.company
      ? {
          id: String(payload.company.id || '').trim() || null,
          name: String(payload.company.name || '').trim() || null
        }
      : null
  }
}

function normalizeCompaniesPayload(payload: unknown): ShellCompanySummary[] {
  if (!Array.isArray(payload)) {
    return []
  }

  return payload
    .map((row) => ({
      id: String((row as { id?: unknown })?.id || '').trim(),
      name:
        String((row as { name?: unknown; id?: unknown })?.name || (row as { id?: unknown })?.id || '').trim(),
      locked: Boolean((row as { locked?: unknown })?.locked)
    }))
    .filter((row) => row.id.length > 0)
}

function resolveActiveCompanyId(auth: ShellAuthMePayload | null, companies: ShellCompanySummary[]): string {
  const cachedActiveCompanyId = getClientCache<string>(
    SHELL_ACTIVE_COMPANY_CACHE_KEY,
    SHELL_ACTIVE_COMPANY_CACHE_AGE_MS
  )
  const candidateIds = [
    cachedActiveCompanyId,
    String(auth?.company?.id || '').trim(),
    String(auth?.user?.companyId || '').trim(),
    String(auth?.user?.assignedCompanyId || '').trim()
  ].filter((value): value is string => Boolean(value))

  for (const candidateId of candidateIds) {
    if (companies.some((company) => company.id === candidateId && !company.locked)) {
      return candidateId
    }
  }

  for (const candidateId of candidateIds) {
    if (companies.some((company) => company.id === candidateId)) {
      return candidateId
    }
  }

  return companies.find((company) => !company.locked)?.id || companies[0]?.id || ''
}

export async function loadShellAuthMe(options: {
  force?: boolean
  onUnauthorized?: () => void
} = {}): Promise<ShellAuthMePayload | null> {
  try {
    return await getOrLoadClientCache<ShellAuthMePayload | null>(
      SHELL_AUTH_CACHE_KEY,
      SHELL_AUTH_CACHE_AGE_MS,
      async () => {
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        if (response.status === 401) {
          options.onUnauthorized?.()
          return null
        }
        if (!response.ok) {
          throw new Error('Failed to load auth session')
        }

        const payload = normalizeAuthPayload(
          (await response.json().catch(() => null)) as ShellAuthMePayload | null
        )

        return payload
      },
      {
        persist: true,
        force: options.force,
        shouldCache: (data) => Boolean(data && (data.user || data.company))
      }
    )
  } catch (error) {
    if (isAbortError(error)) {
      return null
    }
    throw error
  }
}

export async function loadShellCompanies(options: {
  force?: boolean
  onUnauthorized?: () => void
} = {}): Promise<ShellCompanySummary[]> {
  try {
    return await getOrLoadClientCache<ShellCompanySummary[]>(
      SHELL_COMPANIES_CACHE_KEY,
      SHELL_COMPANIES_CACHE_AGE_MS,
      async () => {
        const response = await fetch('/api/companies', { cache: 'no-store' })
        if (response.status === 401) {
          options.onUnauthorized?.()
          return []
        }
        if (!response.ok) {
          throw new Error('Failed to load companies')
        }

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          return []
        }

        const payload = await response.json().catch(() => [])
        return normalizeCompaniesPayload(payload)
      },
      {
        persist: true,
        force: options.force,
        shouldCache: (data) => Array.isArray(data)
      }
    )
  } catch {
    return getClientCache<ShellCompanySummary[]>(
      SHELL_COMPANIES_CACHE_KEY,
      SHELL_COMPANIES_CACHE_AGE_MS
    ) || []
  }
}

export async function loadShellBootstrap(options: {
  force?: boolean
  onUnauthorized?: () => void
} = {}): Promise<ShellBootstrapPayload> {
  const [auth, companies] = await Promise.all([
    loadShellAuthMe(options),
    loadShellCompanies(options)
  ])

  const activeCompanyId = resolveActiveCompanyId(auth, companies)
  if (activeCompanyId) {
    setClientCache(SHELL_ACTIVE_COMPANY_CACHE_KEY, activeCompanyId, { persist: true })
  }

  const permissions = activeCompanyId
    ? await loadClientPermissions(activeCompanyId, { force: options.force }).catch(() => null)
    : null

  return {
    auth,
    companies,
    activeCompanyId,
    permissions
  }
}
