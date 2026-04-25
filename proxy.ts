import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyTokenWithMetadata } from '@/lib/auth'
import { env } from '@/lib/config'
import { AUTH_CONTEXT_HEADER, encodeRequestAuthContext, normalizeAppRole, type RequestAuthContext } from '@/lib/api-security'
import { hasSessionStateDrift, loadAuthGuardState } from '@/lib/auth-guard-state'
import { sanitizeCompanyId } from '@/lib/company-id'
import { getCompanyCookieNameCandidates, getSessionCookieNameCandidates } from '@/lib/session-cookies'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { getSupabaseClaimsFromRequest, hasSupabaseAppContext } from '@/lib/supabase/auth-bridge'

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const ENABLE_RATE_LIMIT = process.env.DISABLE_RATE_LIMIT !== 'true'

const alwaysPublicApiRoutes = new Set([
  '/api/auth',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/login',
  '/api/super-admin/auth',
  '/api/super-admin/logout',
  '/api/super-admin/refresh'
])

const rateLimitBypassApiRoutes = new Set([
  '/api/auth/logout',
  '/api/super-admin/logout'
])

const lockBypassApiRoutes = new Set([
  '/api/auth/logout',
  '/api/super-admin/logout'
])
const lockBypassApiPatterns = [
  /^\/api\/super-admin\/traders\/[^/]+\/lock$/,
  /^\/api\/super-admin\/companies\/[^/]+\/lock$/,
  /^\/api\/super-admin\/users\/[^/]+\/lock$/
]

type RateLimitEntry = { count: number; resetAt: number }
const rateLimitStore = new Map<string, RateLimitEntry>()

const businessAppRoutePrefixes = [
  '/main', '/master', '/purchase', '/sales',
  '/stock', '/payment', '/reports', '/company'
]

const blockedSourcePathPatterns = [
  /(^|\/)page(?:\s+\d+)?\.tsx(?:\.backup)?$/i,
  /\.(?:tsx|ts|jsx|js)\.backup$/i,
  /\.backup$/i
]

function normalizePath(p: string) {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}

function isBlockedSourcePath(pathname: string): boolean {
  const decodedPath = (() => {
    try {
      return decodeURIComponent(pathname)
    } catch {
      return pathname
    }
  })()

  return blockedSourcePathPatterns.some((pattern) => pattern.test(decodedPath))
}

function isPublicApi(pathname: string): boolean {
  if (alwaysPublicApiRoutes.has(pathname)) return true
  return false
}

function isLockBypassApiRoute(pathname: string): boolean {
  return lockBypassApiRoutes.has(pathname) || lockBypassApiPatterns.some(p => p.test(pathname))
}

function isBusinessAppRoute(pathname: string): boolean {
  return businessAppRoutePrefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

function getScopeSource(request: NextRequest): string {
  return request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
}

function getCookieCompanyId(request: NextRequest, scopeSource: string): string | null {
  const candidate = (
    getCompanyCookieNameCandidates(scopeSource)
      .map((name) => request.cookies.get(name)?.value?.trim() || '')
      .find((value) => value.length > 0) || null
  )
  const normalized = sanitizeCompanyId(candidate)
  return normalized || null
}

function normalizeCompanyIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((entry) => sanitizeCompanyId(entry))
    .filter((entry): entry is string => Boolean(entry))
  return Array.from(new Set(normalized))
}

function getMatchingCsrfCookieValues(
  request: NextRequest,
  namespace: 'app' | 'super_admin',
  scopeSource: string
): string[] {
  const exactCandidates = getSessionCookieNameCandidates(namespace, scopeSource)
    .map((cookieNames) => request.cookies.get(cookieNames.csrfToken)?.value?.trim() || '')
    .filter((value) => value.length > 0)

  const prefix = namespace === 'super_admin' ? 'super-admin-csrf-token' : 'csrf-token'
  const prefixMatches = request.cookies
    .getAll()
    .filter((cookie) => cookie.name === prefix || cookie.name.startsWith(`${prefix}__`))
    .map((cookie) => cookie.value?.trim() || '')
    .filter((value) => value.length > 0)

  return Array.from(new Set([...exactCandidates, ...prefixMatches]))
}

function getRequestIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') || 'unknown'
}

function consumeRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const current = rateLimitStore.get(key)
  if (!current || now > current.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }
  if (current.count >= max) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) }
  }
  current.count += 1
  return { allowed: true }
}

function parseOrigin(value: string | null | undefined) {
  if (!value) return null
  try { return new URL(value) } catch { return null }
}

function resolveCorsOrigin(request: NextRequest): string {
  const requestOrigin = parseOrigin(request.headers.get('origin'))
  const allowedOrigins = (env.ALLOWED_ORIGINS?.split(',') || []).map(v => v.trim()).filter(Boolean)
  const fallback = allowedOrigins[0] || 'http://localhost:3000'
  if (!requestOrigin) return fallback
  const requestHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
  if (requestOrigin.host === requestHost) return requestOrigin.origin
  for (const allowed of allowedOrigins) {
    const a = parseOrigin(allowed)
    if (!a) continue
    if (requestOrigin.origin === a.origin || requestOrigin.hostname === a.hostname ||
        requestOrigin.hostname.endsWith(`.${a.hostname}`)) {
      return requestOrigin.origin
    }
  }
  return fallback
}

function isRemoteSuperAdminEnabled(): boolean {
  const flag = String(env.SUPER_ADMIN_REMOTE_ACCESS || '').trim().toLowerCase()
  return !['0', 'false', 'no', 'off'].includes(flag)
}

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().split(':')[0]
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
}

function isLocalSuperAdminAccessAllowed(request: NextRequest): boolean {
  if (isRemoteSuperAdminEnabled()) return true
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
  return env.NODE_ENV !== 'production' && isLoopbackHost(host)
}

type MiddlewareAuthResolution = {
  auth: RequestAuthContext
  applyCookies?: <T>(response: NextResponse<T>) => NextResponse<T>
}

async function resolveSupabaseAuthContext(request: NextRequest): Promise<MiddlewareAuthResolution | null> {
  if (!isSupabaseConfigured()) {
    return null
  }

  const supabaseContext = await getSupabaseClaimsFromRequest(request)
  if (!supabaseContext || !hasSupabaseAppContext(supabaseContext.claims)) {
    return null
  }

  const scopeSource = getScopeSource(request)
  const defaultCompanyId =
    typeof supabaseContext.claims.default_company_id === 'string' &&
    supabaseContext.claims.default_company_id.trim().length > 0
      ? supabaseContext.claims.default_company_id.trim()
      : null
  const auth: RequestAuthContext = {
    userId:
      (typeof supabaseContext.claims.user_code === 'string' && supabaseContext.claims.user_code.trim()) ||
      supabaseContext.claims.user_db_id,
    traderId: supabaseContext.claims.trader_id,
    role: normalizeAppRole(supabaseContext.claims.app_role),
    companyId: getCookieCompanyId(request, scopeSource) || defaultCompanyId,
    companyIds: normalizeCompanyIdList((supabaseContext.claims as { company_ids?: unknown }).company_ids),
    userDbId: supabaseContext.claims.user_db_id,
    sessionIssuedAt: typeof supabaseContext.claims.iat === 'number' ? supabaseContext.claims.iat : null
  }

  return {
    auth,
    applyCookies: supabaseContext.applyCookies
  }
}

function resolveLegacyAuthContext(
  request: NextRequest,
  namespace: 'app' | 'super_admin'
): MiddlewareAuthResolution | null {
  const scopeSource = getScopeSource(request)
  const authHeader = request.headers.get('Authorization')?.replace('Bearer ', '')
  const token =
    authHeader ||
    getSessionCookieNameCandidates(namespace, scopeSource)
      .map((cookieNames) => request.cookies.get(cookieNames.authToken)?.value)
      .find(Boolean)

  if (!token) {
    return null
  }

  const payload = verifyTokenWithMetadata(token)
  if (!payload) {
    return null
  }

  return {
    auth: {
      userId: payload.userId,
      traderId: payload.traderId,
      role: normalizeAppRole(String(payload.role || '')),
      companyId: getCookieCompanyId(request, scopeSource) || (payload as { companyId?: string }).companyId || null,
      companyIds: normalizeCompanyIdList((payload as { companyIds?: unknown }).companyIds),
      userDbId: payload.userDbId || null,
      sessionIssuedAt: payload.iat || null
    }
  }
}

async function resolveRequestAuthContext(
  request: NextRequest,
  namespace: 'app' | 'super_admin'
): Promise<MiddlewareAuthResolution | null> {
  const supabaseAuth = await resolveSupabaseAuthContext(request)
  if (supabaseAuth) {
    return supabaseAuth
  }

  return resolveLegacyAuthContext(request, namespace)
}

export async function proxy(request: NextRequest) {
  const pathname = normalizePath(request.nextUrl.pathname)
  const isApiRoute = pathname.startsWith('/api/')
  const isSuperAdminApiRoute = pathname.startsWith('/api/super-admin/')
  const isSuperAdminPageRoute = !isApiRoute && pathname.startsWith('/super-admin')
  const isSuperAdminLoginPage = pathname === '/super-admin/login'
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID()

  if (isBlockedSourcePath(pathname)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Super admin remote access guard
  if ((isSuperAdminApiRoute || isSuperAdminPageRoute) && !isLocalSuperAdminAccessAllowed(request)) {
    if (!isSuperAdminLoginPage && pathname !== '/api/super-admin/auth') {
      if (isSuperAdminApiRoute) {
        return NextResponse.json({ error: 'Super admin is restricted to local development access' }, { status: 404 })
      }
      const url = new URL('/super-admin/login', request.url)
      url.searchParams.set('restricted', 'remote-disabled')
      return NextResponse.redirect(url)
    }
  }

  // Strip password from login URLs
  if (!isApiRoute && (pathname === '/login' || pathname === '/super-admin/login')) {
    const u = request.nextUrl.clone()
    if (u.searchParams.has('password')) {
      u.searchParams.delete('password')
      return NextResponse.redirect(u)
    }
  }

  if (request.method === 'OPTIONS') return NextResponse.next()

  const scopeSource = getScopeSource(request)

  // ── API ROUTES ──────────────────────────────────────────────────────────────
  if (isApiRoute) {
    const isPublic = isPublicApi(pathname)
    const authHeader = request.headers.get('Authorization')?.replace('Bearer ', '')
    const authResolution = isPublic
      ? null
      : await resolveRequestAuthContext(request, isSuperAdminApiRoute ? 'super_admin' : 'app')
    const isSuperAdminRequest = authResolution?.auth.role === 'super_admin'
    const isRateLimitBypassed = rateLimitBypassApiRoutes.has(pathname)

    if (ENABLE_RATE_LIMIT && !isSuperAdminRequest && !isRateLimitBypassed) {
      const ip = getRequestIp(request)
      const globalLimit = consumeRateLimit(`g:${ip}`, 120, 60_000)
      if (!globalLimit.allowed) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, {
          status: 429, headers: { 'Retry-After': String(globalLimit.retryAfter) }
        })
      }
    }

    if (isPublic) {
      const h = new Headers(request.headers)
      h.set('x-request-id', requestId)
      return NextResponse.next({ request: { headers: h } })
    }

    if (!authResolution) {
      return NextResponse.json({ error: 'Authentication required' }, {
        status: 401, headers: { 'Access-Control-Allow-Origin': resolveCorsOrigin(request), Vary: 'Origin' }
      })
    }

    const authGuard = await loadAuthGuardState(authResolution.auth)
    const sessionDrift = hasSessionStateDrift(authResolution.auth, authGuard)
    if (authGuard.missing || authGuard.userLocked || authGuard.userDeleted || authGuard.traderLocked || authGuard.traderDeleted || sessionDrift) {
      return NextResponse.json(
        { error: sessionDrift ? 'Session expired due to account changes. Please sign in again.' : 'Account is locked or inactive. Please contact administrator.' },
        { status: sessionDrift ? 401 : 403 }
      )
    }

    // CSRF check for cookie-auth mutations
    if (!authHeader && mutatingMethods.has(request.method)) {
      const csrfHeader = request.headers.get('x-csrf-token')?.trim() || ''
      const csrfCookieValues = getMatchingCsrfCookieValues(
        request,
        isSuperAdminApiRoute ? 'super_admin' : 'app',
        scopeSource
      )

      if (!csrfHeader || csrfCookieValues.length === 0 || !csrfCookieValues.includes(csrfHeader)) {
        return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
      }
    }

    const normalizedRole = authResolution.auth.role

    if (isSuperAdminApiRoute && normalizedRole !== 'super_admin') {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
    }
    if ((pathname === '/api/traders' || pathname === '/api/users') && normalizedRole !== 'super_admin') {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
    }

    // Company scope check — JWT only for super_admin/trader_admin, skip for lock-bypass routes
    const urlCompanyId = sanitizeCompanyId(request.nextUrl.searchParams.get('companyId'))
    const lockedCompanyId = getCookieCompanyId(request, scopeSource)

    if (urlCompanyId && !isLockBypassApiRoute(pathname)) {
      if (lockedCompanyId && urlCompanyId !== lockedCompanyId && normalizedRole !== 'super_admin') {
        return NextResponse.json({ error: 'Company mismatch. Open company select to switch company.' }, { status: 403 })
      }
      if (normalizedRole !== 'super_admin' && normalizedRole !== 'trader_admin') {
        const claimCompanyIds = authResolution.auth.companyIds || []
        if (claimCompanyIds.length > 0 && !claimCompanyIds.includes(urlCompanyId)) {
          return NextResponse.json({ error: 'User not linked to company' }, { status: 403 })
        }
      }
    }

    const effectiveCompanyId =
      urlCompanyId ||
      lockedCompanyId ||
      sanitizeCompanyId(authResolution.auth.companyId) ||
      null

    const h = new Headers(request.headers)
    if (effectiveCompanyId) {
      h.set('x-company-id', effectiveCompanyId)
      h.set('x-auth-company-id', effectiveCompanyId)
    }
    if ((authResolution.auth.companyIds || []).length > 0) {
      h.set('x-company-ids', (authResolution.auth.companyIds || []).join(','))
    }
    h.set(
      AUTH_CONTEXT_HEADER,
      encodeRequestAuthContext({
        ...authResolution.auth,
        companyId: effectiveCompanyId,
        requestId
      })
    )
    h.set('x-request-id', requestId)

    let response = NextResponse.next({ request: { headers: h } })
    if (authResolution.applyCookies) {
      response = authResolution.applyCookies(response)
    }
    return response
  }

  // ── PAGE ROUTES ─────────────────────────────────────────────────────────────
  // Business app pages: just verify JWT is valid — no DB query
  if (isBusinessAppRoute(pathname)) {
    const authResolution = await resolveRequestAuthContext(request, 'app')
    if (!authResolution) return NextResponse.redirect(new URL('/login', request.url))
    const authGuard = await loadAuthGuardState(authResolution.auth)
    if (authGuard.missing || authGuard.userLocked || authGuard.userDeleted || authGuard.traderLocked || authGuard.traderDeleted || hasSessionStateDrift(authResolution.auth, authGuard)) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    if (authResolution.auth.role === 'super_admin') {
      return NextResponse.redirect(new URL('/super-admin/crud', request.url))
    }
    const effectiveCompanyId =
      getCookieCompanyId(request, scopeSource) ||
      sanitizeCompanyId(authResolution.auth.companyId) ||
      null
    const h = new Headers(request.headers)
    if (effectiveCompanyId) {
      h.set('x-company-id', effectiveCompanyId)
      h.set('x-auth-company-id', effectiveCompanyId)
    }
    if ((authResolution.auth.companyIds || []).length > 0) {
      h.set('x-company-ids', (authResolution.auth.companyIds || []).join(','))
    }
    h.set(
      AUTH_CONTEXT_HEADER,
      encodeRequestAuthContext({
        ...authResolution.auth,
        companyId: effectiveCompanyId,
        requestId
      })
    )
    h.set('x-request-id', requestId)

    let response = NextResponse.next({ request: { headers: h } })
    if (authResolution.applyCookies) {
      response = authResolution.applyCookies(response)
    }
    return response
  }

  // Super admin pages: just verify JWT is valid — no DB query
  if (isSuperAdminPageRoute && !isSuperAdminLoginPage) {
    const authResolution = await resolveRequestAuthContext(request, 'super_admin')
    if (!authResolution || authResolution.auth.role !== 'super_admin') {
      return NextResponse.redirect(new URL('/super-admin/login', request.url))
    }
    const authGuard = await loadAuthGuardState(authResolution.auth)
    if (authGuard.missing || authGuard.userLocked || authGuard.userDeleted || authGuard.traderLocked || authGuard.traderDeleted || hasSessionStateDrift(authResolution.auth, authGuard)) {
      return NextResponse.redirect(new URL('/super-admin/login', request.url))
    }
    const h = new Headers(request.headers)
    h.set(
      AUTH_CONTEXT_HEADER,
      encodeRequestAuthContext({
        ...authResolution.auth,
        requestId
      })
    )
    h.set('x-request-id', requestId)

    let response = NextResponse.next({ request: { headers: h } })
    if (authResolution.applyCookies) {
      response = authResolution.applyCookies(response)
    }
    return response
  }

  // Company cookie mismatch redirect
  const urlCompanyId = sanitizeCompanyId(request.nextUrl.searchParams.get('companyId'))
  const lockedCompanyId = getCompanyCookieNameCandidates(scopeSource)
    .map(n => sanitizeCompanyId(request.cookies.get(n)?.value || '')).find(Boolean) || null
  if (!isApiRoute && urlCompanyId && lockedCompanyId && urlCompanyId !== lockedCompanyId) {
    const u = request.nextUrl.clone()
    u.searchParams.set('companyId', lockedCompanyId)
    return NextResponse.redirect(u)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)']
}
