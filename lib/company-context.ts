import { getClientCache, setClientCache } from './client-fetch-cache'
import { getCompanyCookieNameCandidates } from './session-cookies'

export const APP_COMPANY_CHANGED_EVENT = 'app-company-changed'

const ACTIVE_COMPANY_CACHE_KEY = 'shell:active-company-id'
const AUTH_ME_CACHE_KEY = 'shell:auth-me'
const ACTIVE_COMPANY_CACHE_AGE_MS = 20_000
const AUTH_ME_CACHE_AGE_MS = 30_000

type AuthMeCachePayload = {
  user?: {
    companyId?: string | null
  } | null
  company?: {
    id?: string | null
  } | null
}

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

  if (companyIds[0]) return companyIds[0]

  return getCompanyIdFromCookie()
}

export async function resolveCompanyId(search: string): Promise<string> {
  const fromSearch = getCompanyIdFromSearch(search)
  if (fromSearch) return fromSearch

  try {
    const cachedActiveCompanyId = getClientCache<string>(ACTIVE_COMPANY_CACHE_KEY, ACTIVE_COMPANY_CACHE_AGE_MS)
    if (cachedActiveCompanyId) {
      return cachedActiveCompanyId
    }

    const cachedAuthMe = getClientCache<AuthMeCachePayload>(AUTH_ME_CACHE_KEY, AUTH_ME_CACHE_AGE_MS)
    const cachedAuthCompanyId = String(cachedAuthMe?.company?.id || cachedAuthMe?.user?.companyId || '').trim()
    if (cachedAuthCompanyId) {
      setClientCache(ACTIVE_COMPANY_CACHE_KEY, cachedAuthCompanyId)
      return cachedAuthCompanyId
    }

    const timeoutMs = Math.max(5000, Math.min(60000, Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || 12000)))
    const activeCompanyResponse = await fetchWithTimeout('/api/auth/company', { cache: 'no-store' }, timeoutMs)
    if (activeCompanyResponse.ok) {
      const activeData = await activeCompanyResponse.json().catch(() => null)
      const activeCompanyId = activeData?.company?.id
      if (typeof activeCompanyId === 'string' && activeCompanyId.trim()) {
        const normalizedActiveCompanyId = activeCompanyId.trim()
        setClientCache(ACTIVE_COMPANY_CACHE_KEY, normalizedActiveCompanyId)
        return normalizedActiveCompanyId
      }
    }

    const response = await fetchWithTimeout('/api/auth/me', { cache: 'no-store' }, timeoutMs)
    if (!response.ok) return ''

    const data = await response.json()
    setClientCache(AUTH_ME_CACHE_KEY, data)
    const resolvedCompanyId = (
      data?.user?.companyId ||
      data?.company?.id ||
      ''
    )
    if (typeof resolvedCompanyId === 'string' && resolvedCompanyId.trim()) {
      setClientCache(ACTIVE_COMPANY_CACHE_KEY, resolvedCompanyId.trim())
    }
    return resolvedCompanyId
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
  window.dispatchEvent(
    new CustomEvent(APP_COMPANY_CHANGED_EVENT, {
      detail: { companyId }
    })
  )
}
