import { cookies } from 'next/headers'
import { headers } from 'next/headers'
import { verifyToken } from './auth'
import { env } from './config'
import { randomBytes } from 'crypto'
import {
  getCompanyCookieNameCandidates,
  getSessionCookieNameCandidates,
  getSessionCookieNames,
  type SessionNamespace
} from './session-cookies'

async function resolveScopeSource(explicitScope?: string | null): Promise<string | null> {
  if (explicitScope !== undefined) {
    return explicitScope
  }

  const headerStore = await headers()
  return headerStore.get('x-forwarded-host') || headerStore.get('host') || null
}

export async function getSession(namespace: SessionNamespace = 'app', scopeSource?: string | null) {
  const cookieStore = await cookies()
  const resolvedScopeSource = await resolveScopeSource(scopeSource)
  const cookieNameCandidates = getSessionCookieNameCandidates(namespace, resolvedScopeSource)
  const token =
    cookieNameCandidates
      .map((cookieNames) => cookieStore.get(cookieNames.authToken)?.value)
      .find((value): value is string => Boolean(value)) || null
  
  if (!token) return null
  
  try {
    const payload = verifyToken(token)
    return payload
  } catch {
    return null
  }
}

export async function setSession(
  token: string,
  refreshToken?: string,
  res?: import('next/server').NextResponse,
  namespace: SessionNamespace = 'app',
  scopeSource?: string | null
) {
  // allow an explicit response object or fall back to the implicit cookie store
  const store = res ? res.cookies : await cookies()
  const resolvedScopeSource = await resolveScopeSource(scopeSource)
  const cookieNames = getSessionCookieNames(namespace, resolvedScopeSource)
  
  // Set access token
  store.set(cookieNames.authToken, token, {
    httpOnly: true, // Prevent XSS attacks
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    priority: 'high'
  })
  
  // Set refresh token if provided
  if (refreshToken) {
    store.set(cookieNames.refreshToken, refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      priority: 'high'
    })
  }

  // Double-submit CSRF token cookie for mutating cookie-auth API calls.
  store.set(cookieNames.csrfToken, randomBytes(24).toString('hex'), {
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    priority: 'high'
  })
}

export async function clearSession(
  res?: import('next/server').NextResponse,
  namespace: SessionNamespace = 'app',
  scopeSource?: string | null
) {
  const store = res ? res.cookies : await cookies()
  const resolvedScopeSource = await resolveScopeSource(scopeSource)
  const cookieNameCandidates = getSessionCookieNameCandidates(namespace, resolvedScopeSource)
  
  // Clear all authentication-related cookies
  for (const cookieNames of cookieNameCandidates) {
    store.delete(cookieNames.authToken)
    store.delete(cookieNames.refreshToken)
    store.delete(cookieNames.csrfToken)
  }

  if (namespace === 'app') {
    store.delete('userId')
    store.delete('traderId')
    for (const cookieName of getCompanyCookieNameCandidates(resolvedScopeSource)) {
      store.delete(cookieName)
    }
  }
}
