export type SessionNamespace = 'app' | 'super_admin'

export type SessionCookieNames = {
  authToken: string
  refreshToken: string
  csrfToken: string
}

// These are cookie key names (not secrets). Values are set by the server at login.
const APP_SESSION_COOKIE_KEYS: SessionCookieNames = {
  authToken: 'auth-token',
  refreshToken: 'refresh-token',
  csrfToken: 'csrf-token'
}

const SUPER_ADMIN_SESSION_COOKIE_KEYS: SessionCookieNames = {
  authToken: 'super-admin-auth-token',
  refreshToken: 'super-admin-refresh-token',
  csrfToken: 'super-admin-csrf-token'
}

function getBaseSessionCookieNames(namespace: SessionNamespace = 'app'): SessionCookieNames {
  return namespace === 'super_admin' ? SUPER_ADMIN_SESSION_COOKIE_KEYS : APP_SESSION_COOKIE_KEYS
}

function normalizeCookieScope(scopeSource?: string | null): string {
  if (!scopeSource) return ''
  const normalized = scopeSource
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized
}

function withScope(cookieName: string, scopeSource?: string | null): string {
  const scope = normalizeCookieScope(scopeSource)
  return scope ? `${cookieName}__${scope}` : cookieName
}

export function getSessionCookieNames(
  namespace: SessionNamespace = 'app',
  scopeSource?: string | null
): SessionCookieNames {
  const base = getBaseSessionCookieNames(namespace)
  return {
    authToken: withScope(base.authToken, scopeSource),
    refreshToken: withScope(base.refreshToken, scopeSource),
    csrfToken: withScope(base.csrfToken, scopeSource)
  }
}

export function getSessionCookieNameCandidates(
  namespace: SessionNamespace = 'app',
  scopeSource?: string | null
): SessionCookieNames[] {
  const scoped = getSessionCookieNames(namespace, scopeSource)
  const legacy = getBaseSessionCookieNames(namespace)
  return scoped.authToken === legacy.authToken ? [legacy] : [scoped, legacy]
}

export function getCompanyCookieName(scopeSource?: string | null): string {
  return withScope('companyId', scopeSource)
}

export function getCompanyCookieNameCandidates(scopeSource?: string | null): string[] {
  const scoped = getCompanyCookieName(scopeSource)
  return scoped === 'companyId' ? ['companyId'] : [scoped, 'companyId']
}
