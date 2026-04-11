import { getSessionCookieNameCandidates, type SessionNamespace } from './session-cookies'

function getCookieMap(): Map<string, string> {
  if (typeof document === 'undefined') {
    return new Map()
  }

  return new Map(
    document.cookie
      .split('; ')
      .map((row) => {
        const separatorIndex = row.indexOf('=')
        if (separatorIndex <= 0) return null
        const name = row.slice(0, separatorIndex)
        const value = row.slice(separatorIndex + 1)
        return [name, decodeURIComponent(value)] as const
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))
  )
}

function resolveClientScopeSource(): string | null {
  if (typeof window === 'undefined') return null
  return window.location.host || null
}

function resolveCsrfToken(namespace: SessionNamespace): string {
  const cookieMap = getCookieMap()
  const scopeSource = resolveClientScopeSource()
  const candidateNames = getSessionCookieNameCandidates(namespace, scopeSource).map((candidate) => candidate.csrfToken)

  for (const cookieName of candidateNames) {
    const exactMatch = cookieMap.get(cookieName)
    if (exactMatch) {
      return exactMatch
    }
  }

  const prefix = namespace === 'super_admin' ? 'super-admin-csrf-token' : 'csrf-token'
  for (const [cookieName, value] of cookieMap.entries()) {
    if (cookieName === prefix || cookieName.startsWith(`${prefix}__`)) {
      return value
    }
  }

  return ''
}

/**
 * Reads the CSRF token from cookies for the current session namespace.
 * Super admin pages use 'super-admin-csrf-token', app pages use 'csrf-token'.
 */
export function getCsrfToken(namespace: 'super_admin' | 'app' = 'app'): string {
  return resolveCsrfToken(namespace)
}

/**
 * Returns headers with CSRF token included.
 * Use this for all PUT, POST, PATCH, DELETE requests.
 */
export function authHeaders(namespace: 'super_admin' | 'app' = 'app'): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-csrf-token': getCsrfToken(namespace)
  }
}

/**
 * Scoped cookie name may include host suffix like:
 * super-admin-csrf-token__example-com
 * This helper finds whichever variant exists.
 */
export function getCsrfTokenScoped(namespace: 'super_admin' | 'app' = 'app'): string {
  return resolveCsrfToken(namespace)
}

export function authHeadersScoped(namespace: 'super_admin' | 'app' = 'app'): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-csrf-token': getCsrfTokenScoped(namespace)
  }
}
