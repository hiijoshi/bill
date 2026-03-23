import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { env } from '@/lib/config'
import { AUTH_CONTEXT_HEADER, encodeRequestAuthContext, normalizeAppRole, type RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { getCompanyCookieNameCandidates, getSessionCookieNameCandidates } from '@/lib/session-cookies'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { getSupabaseClaimsFromRequest, hasSupabaseAppContext } from '@/lib/supabase/auth-bridge'

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const ENABLE_RATE_LIMIT = process.env.DISABLE_RATE_LIMIT !== 'true'

const alwaysPublicApiRoutes = new Set([
  '/api/auth',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/login',
  '/api/super-admin/auth',
  '/api/super-admin/refresh'
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
type AuthGuardState = {
  missing: boolean
  userLocked: boolean
  userDeleted: boolean
  traderLocked: boolean
  traderDeleted: boolean
}
const authGuardCache = new Map<string, { state: AuthGuardState; expiresAt: number }>()

const businessAppRoutePrefixes = [
  '/main', '/master', '/purchase', '/sales',
  '/stock', '/payment', '/reports', '/company'
]

function normalizePath(p: string) {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}

function isPublicApi(pathname: string): boolean {
  if (alwaysPublicApiRoutes.has(pathname)) return true
  if (env.NODE_ENV === 'development') {
    return pathname.startsWith('/api/debug') || pathname.startsWith('/api/test') || pathname === '/api/super-admin/test'
  }
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
  return (
    getCompanyCookieNameCandidates(scopeSource)
      .map((name) => request.cookies.get(name)?.value?.trim() || '')
      .find((value) => value.length > 0) || null
  )
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

function getAuthGuardCacheKey(auth: RequestAuthContext) {
  return `${auth.userDbId || ''}:${auth.traderId}:${auth.userId}`
}

async function loadAuthGuardState(auth: RequestAuthContext): Promise<AuthGuardState> {
  const cacheKey = getAuthGuardCacheKey(auth)
  const cached = authGuardCache.get(cacheKey)
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    return cached.state
  }

  const user = auth.userDbId
    ? await prisma.user.findFirst({
        where: { id: auth.userDbId },
        select: {
          locked: true,
          deletedAt: true,
          trader: {
            select: {
              locked: true,
              deletedAt: true
            }
          }
        }
      })
    : await prisma.user.findFirst({
        where: {
          traderId: auth.traderId,
          userId: auth.userId
        },
        select: {
          locked: true,
          deletedAt: true,
          trader: {
            select: {
              locked: true,
              deletedAt: true
            }
          }
        }
      })

  const state: AuthGuardState = user
    ? {
        missing: false,
        userLocked: user.locked,
        userDeleted: Boolean(user.deletedAt),
        traderLocked: Boolean(user.trader?.locked),
        traderDeleted: Boolean(user.trader?.deletedAt)
      }
    : {
        missing: true,
        userLocked: false,
        userDeleted: false,
        traderLocked: false,
        traderDeleted: false
      }

  authGuardCache.set(cacheKey, {
    state,
    expiresAt: now + 15_000
  })

  return state
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
    userDbId: supabaseContext.claims.user_db_id
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

  const payload = verifyToken(token)
  if (!payload) {
    return null
  }

  return {
    auth: {
      userId: payload.userId,
      traderId: payload.traderId,
      role: normalizeAppRole(String(payload.role || '')),
      companyId: getCookieCompanyId(request, scopeSource) || (payload as { companyId?: string }).companyId || null,
      userDbId: payload.dbId || null
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

    if (ENABLE_RATE_LIMIT && !isSuperAdminRequest) {
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
    if (authGuard.missing || authGuard.userLocked || authGuard.userDeleted || authGuard.traderLocked || authGuard.traderDeleted) {
      return NextResponse.json(
        { error: 'Account is locked or inactive. Please contact administrator.' },
        { status: 403 }
      )
    }

    // CSRF check for cookie-auth mutations
    if (!authHeader && mutatingMethods.has(request.method)) {
      const sessionCookieCandidates = getSessionCookieNameCandidates(
        isSuperAdminApiRoute ? 'super_admin' : 'app', scopeSource
      )
      const csrfCookie = sessionCookieCandidates
        .map(c => request.cookies.get(c.csrfToken)?.value).find(Boolean) || null
      const csrfHeader = request.headers.get('x-csrf-token')
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
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
    const urlCompanyId = request.nextUrl.searchParams.get('companyId')
    const lockedCompanyId = getCookieCompanyId(request, scopeSource)

    if (urlCompanyId && !isLockBypassApiRoute(pathname)) {
      if (lockedCompanyId && urlCompanyId !== lockedCompanyId && normalizedRole !== 'super_admin') {
        return NextResponse.json({ error: 'Company mismatch. Open company select to switch company.' }, { status: 403 })
      }
      // For company_user: verify against JWT claims (companyId in token payload)
      // Full DB check is done inside the route handler itself via ensureCompanyAccess()
      // This avoids a DB round-trip in middleware for every request
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

  // ── PAGE ROUTES ─────────────────────────────────────────────────────────────
  // Business app pages: just verify JWT is valid — no DB query
  if (isBusinessAppRoute(pathname)) {
    const authResolution = await resolveRequestAuthContext(request, 'app')
    if (!authResolution) return NextResponse.redirect(new URL('/login', request.url))
    const authGuard = await loadAuthGuardState(authResolution.auth)
    if (authGuard.missing || authGuard.userLocked || authGuard.userDeleted || authGuard.traderLocked || authGuard.traderDeleted) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    if (authResolution.auth.role === 'super_admin') {
      return NextResponse.redirect(new URL('/super-admin/crud', request.url))
    }
    let response = NextResponse.next()
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
    if (authGuard.missing || authGuard.userLocked || authGuard.userDeleted || authGuard.traderLocked || authGuard.traderDeleted) {
      return NextResponse.redirect(new URL('/super-admin/login', request.url))
    }
    let response = NextResponse.next()
    if (authResolution.applyCookies) {
      response = authResolution.applyCookies(response)
    }
    return response
  }

  // Company cookie mismatch redirect
  const urlCompanyId = request.nextUrl.searchParams.get('companyId')
  const lockedCompanyId = getCompanyCookieNameCandidates(scopeSource)
    .map(n => request.cookies.get(n)?.value).find(Boolean) || null
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
