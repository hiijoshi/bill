import { getCompanyCookieNameCandidates } from './session-cookies'

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

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number = 12000): Promise<Response> {
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
    const timeoutMs = Math.max(5000, Math.min(60000, Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || 12000)))
    const activeCompanyResponse = await fetchWithTimeout('/api/auth/company', { cache: 'no-store' }, timeoutMs)
    if (activeCompanyResponse.ok) {
      const activeData = await activeCompanyResponse.json().catch(() => null)
      const activeCompanyId = activeData?.company?.id
      if (typeof activeCompanyId === 'string' && activeCompanyId.trim()) {
        return activeCompanyId.trim()
      }
    }

    const response = await fetchWithTimeout('/api/auth/me', { cache: 'no-store' }, timeoutMs)
    if (!response.ok) return ''

    const data = await response.json()
    return (
      data?.user?.companyId ||
      data?.company?.id ||
      ''
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
