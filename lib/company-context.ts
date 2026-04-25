import { deleteClientCache, getClientCache, getOrLoadClientCache, setClientCache } from './client-fetch-cache'
import { sanitizeCompanyId } from './company-id'
import { getCompanyCookieNameCandidates } from './session-cookies'
import {
  SHELL_ACTIVE_COMPANY_CACHE_AGE_MS,
  SHELL_ACTIVE_COMPANY_CACHE_KEY,
  SHELL_AUTH_CACHE_AGE_MS,
  SHELL_COMPANIES_CACHE_AGE_MS,
  SHELL_COMPANIES_CACHE_KEY
} from './client-shell-data'

export const APP_COMPANY_CHANGED_EVENT = 'app-company-changed'

const AUTH_ME_CACHE_KEY = 'shell:auth-me'
const AUTH_ME_CACHE_AGE_MS = SHELL_AUTH_CACHE_AGE_MS

type AuthMeCachePayload = {
  user?: {
    companyId?: string | null
  } | null
  company?: {
    id?: string | null
  } | null
}

type CompanyCachePayload = Array<{
  id?: string | null
  locked?: boolean | null
}>

function getCompanyIdFromCookie(): string {
  if (typeof document === 'undefined') return ''
  const cookieParts = document.cookie
    .split(';')
    .map((part) => part.trim())

  for (const cookieName of getCompanyCookieNameCandidates(window.location.host)) {
    const match = cookieParts.find((part) => part.startsWith(`${cookieName}=`))
    if (!match) continue
    const value = decodeURIComponent(match.split('=').slice(1).join('=')).trim()
    if (value) return value
  }

  return ''
}

const ALLOWED_INTERNAL_PATHS = new Set(['/api/auth/company', '/api/auth/me'])

function normalizeCompanyId(value: unknown): string {
  return sanitizeCompanyId(value)
}

function pickKnownCompanyId(
  companies: CompanyCachePayload,
  candidateIds: string[],
  options: { allowLocked?: boolean } = {}
): string {
  const normalizedCompanies = Array.isArray(companies)
    ? companies
        .map((company) => ({
          id: normalizeCompanyId(company?.id),
          locked: Boolean(company?.locked)
        }))
        .filter((company) => company.id.length > 0)
    : []

  if (normalizedCompanies.length === 0) {
    return ''
  }

  const normalizedCandidateIds = candidateIds
    .map((candidateId) => normalizeCompanyId(candidateId))
    .filter((candidateId) => candidateId.length > 0)

  if (normalizedCandidateIds.length === 0) {
    return chooseFallbackCompanyId(normalizedCompanies)
  }

  const unlockedCompanies = normalizedCompanies.filter((company) => !company.locked)

  for (const candidateId of normalizedCandidateIds) {
    if (unlockedCompanies.some((company) => company.id === candidateId)) {
      return candidateId
    }
  }

  if (options.allowLocked) {
    for (const candidateId of normalizedCandidateIds) {
      if (normalizedCompanies.some((company) => company.id === candidateId)) {
        return candidateId
      }
    }
  }

  return ''
}

function chooseFallbackCompanyId(companies: Array<{ id: string; locked: boolean }>): string {
  return companies.find((company) => !company.locked)?.id || companies[0]?.id || ''
}

function rememberResolvedCompanyId(companyId: string): string {
  const normalizedCompanyId = normalizeCompanyId(companyId)
  if (normalizedCompanyId) {
    setClientCache(SHELL_ACTIVE_COMPANY_CACHE_KEY, normalizedCompanyId, { persist: true })
  }
  return normalizedCompanyId
}

function clearStaleCompanyContext() {
  deleteClientCache(SHELL_ACTIVE_COMPANY_CACHE_KEY)
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number = 12000): Promise<Response> {
  // CWE-918: only allow known internal API paths — reject any external or unexpected URL
  if (!ALLOWED_INTERNAL_PATHS.has(url)) {
    throw new Error(`Blocked request to disallowed URL: ${url}`)
  }

  if (init.signal) return fetch(url, init)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort('RequestTimeout'), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

export function getCompanyIdFromSearch(search: string): string {
  const params = new URLSearchParams(search)
  const companyId = params.get('companyId')?.trim()
  if (companyId) return companyId

  const companyIdsRaw = params.get('companyIds') || ''
  const companyIds = companyIdsRaw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  return companyIds[0] || ''
}

export async function resolveCompanyId(search: string): Promise<string> {
  const fromSearch = getCompanyIdFromSearch(search)
  if (fromSearch) return fromSearch

  try {
    const cachedCompanies = getClientCache<CompanyCachePayload>(
      SHELL_COMPANIES_CACHE_KEY,
      SHELL_COMPANIES_CACHE_AGE_MS
    ) || []
    const cachedActiveCompanyId = normalizeCompanyId(
      getClientCache<string>(SHELL_ACTIVE_COMPANY_CACHE_KEY, SHELL_ACTIVE_COMPANY_CACHE_AGE_MS)
    )
    const cookieCompanyId = normalizeCompanyId(getCompanyIdFromCookie())

    const cachedAuthMe = getClientCache<AuthMeCachePayload>(AUTH_ME_CACHE_KEY, AUTH_ME_CACHE_AGE_MS)
    const cachedAuthCompanyId = normalizeCompanyId(cachedAuthMe?.company?.id || cachedAuthMe?.user?.companyId)

    if (cachedCompanies.length > 0) {
      const knownCompanyId = pickKnownCompanyId(
        cachedCompanies,
        [cookieCompanyId, cachedActiveCompanyId, cachedAuthCompanyId],
        { allowLocked: true }
      )
      if (knownCompanyId) {
        return rememberResolvedCompanyId(knownCompanyId)
      }
      clearStaleCompanyContext()
    } else if (cookieCompanyId) {
      return rememberResolvedCompanyId(cookieCompanyId)
    } else if (cachedAuthCompanyId) {
      return rememberResolvedCompanyId(cachedAuthCompanyId)
    }

    const defaultApiTimeoutMs = process.env.NODE_ENV === 'development' ? 20000 : 15000
    const timeoutMs = Math.max(
      8000,
      Math.min(60000, Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || defaultApiTimeoutMs))
    )
    return await getOrLoadClientCache<string>(
      SHELL_ACTIVE_COMPANY_CACHE_KEY,
      SHELL_ACTIVE_COMPANY_CACHE_AGE_MS,
      async () => {
        const activeCompanyResponse = await fetchWithTimeout('/api/auth/company', { cache: 'no-store' }, timeoutMs)
        if (activeCompanyResponse.ok) {
          const activeData = await activeCompanyResponse.json().catch(() => null)
          const activeCompanyId = normalizeCompanyId(activeData?.company?.id)
          if (activeCompanyId) {
            return activeCompanyId
          }
        }

        const data = await getOrLoadClientCache<AuthMeCachePayload | null>(
          AUTH_ME_CACHE_KEY,
          AUTH_ME_CACHE_AGE_MS,
          async () => {
            const response = await fetchWithTimeout('/api/auth/me', { cache: 'no-store' }, timeoutMs)
            if (!response.ok) {
              throw new Error('Failed to resolve company from auth session')
            }
            return (await response.json().catch(() => null)) as AuthMeCachePayload | null
          },
          {
            persist: true,
            shouldCache: (payload) => Boolean(payload && (payload.user || payload.company))
          }
        )

        const resolvedCompanyId = normalizeCompanyId(data?.company?.id || data?.user?.companyId)
        if (!resolvedCompanyId) {
          throw new Error('No active company found')
        }
        return resolvedCompanyId
      },
      {
        persist: true,
        shouldCache: (value) => Boolean(String(value || '').trim())
      }
    )
  } catch {
    return ''
  }
}

export function stripCompanyParamsFromUrl(): void {
  if (typeof window === 'undefined') return

  const current = new URL(window.location.href)
  if (!current.searchParams.has('companyId') && !current.searchParams.has('companyIds')) return

  current.searchParams.delete('companyId')
  current.searchParams.delete('companyIds')

  const next = `${current.pathname}${current.searchParams.toString() ? `?${current.searchParams.toString()}` : ''}${current.hash}`
  window.history.replaceState({}, '', next)
}

export function notifyAppCompanyChanged(companyId: string): void {
  if (typeof window === 'undefined') return
  const normalizedCompanyId = companyId.trim()
  if (normalizedCompanyId) {
    setClientCache(SHELL_ACTIVE_COMPANY_CACHE_KEY, normalizedCompanyId, { persist: true })
  }
  window.dispatchEvent(
    new CustomEvent(APP_COMPANY_CHANGED_EVENT, {
      detail: { companyId: normalizedCompanyId }
    })
  )
}
