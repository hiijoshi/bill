import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { env } from '@/lib/config'
import { prisma } from '@/lib/prisma'
import { normalizeAppRole } from '@/lib/api-security'
import { getCompanyCookieNameCandidates, getSessionCookieNameCandidates } from '@/lib/session-cookies'

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

type RateLimitEntry = {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()
const businessAppRoutePrefixes = [
  '/main',
  '/master',
  '/purchase',
  '/sales',
  '/stock',
  '/payment',
  '/reports',
  '/company'
]

function getRequestHost(request: NextRequest): string {
  return request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host || ''
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().split(':')[0]
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1'
}

function isLocalSuperAdminAccessAllowed(request: NextRequest): boolean {
  return env.NODE_ENV !== 'production' && isLoopbackHost(getRequestHost(request))
}

function consumeRateLimit(key: string, max: number, windowMs: number): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const current = rateLimitStore.get(key)

  if (!current || now > current.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }

  if (current.count >= max) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    }
  }

  current.count += 1
  rateLimitStore.set(key, current)
  return { allowed: true }
}

function tooManyRequestsResponse(message: string, retryAfter = 60) {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter)
      }
    }
  )
}

function getRequestIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

function isPublicApi(pathname: string): boolean {
  if (pathname === '/api/super-admin/auth') return true
  if (env.NODE_ENV === 'development' && pathname === '/api/super-admin/test') return true
  if (alwaysPublicApiRoutes.has(pathname)) return true
  if (env.NODE_ENV === 'development') {
    return pathname.startsWith('/api/debug') || pathname.startsWith('/api/test')
  }
  return false
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname
}

function isLockBypassApiRoute(pathname: string): boolean {
  if (lockBypassApiRoutes.has(pathname)) {
    return true
  }

  return lockBypassApiPatterns.some((pattern) => pattern.test(pathname))
}

function isBusinessAppRoute(pathname: string): boolean {
  return businessAppRoutePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

async function ensureCompanyScope(
  requestedCompanyId: string,
  auth: { role: string; traderId: string; companyId: string | null; userDbId: string | null }
): Promise<boolean> {
  if (auth.role === 'super_admin') {
    const company = await prisma.company.findFirst({
      where: {
        id: requestedCompanyId,
        deletedAt: null,
        locked: false
      },
      select: { id: true }
    })
    return !!company
  }

  if (auth.role === 'trader_admin') {
    const company = await prisma.company.findFirst({
      where: {
        id: requestedCompanyId,
        deletedAt: null,
        locked: false,
        OR: [{ traderId: auth.traderId }, { traderId: null }]
      },
      select: { id: true }
    })
    return !!company
  }

  const candidateIds = new Set<string>()
  if (auth.companyId) {
    candidateIds.add(auth.companyId)
  }

  if (auth.userDbId) {
    const permissionRows = await prisma.userPermission.findMany({
      where: {
        userId: auth.userDbId,
        companyId: requestedCompanyId,
        OR: [{ canRead: true }, { canWrite: true }],
        company: {
          deletedAt: null,
          locked: false,
          OR: [{ traderId: auth.traderId }, { traderId: null }]
        }
      },
      select: { companyId: true }
    })

    permissionRows.forEach((row) => {
      if (row.companyId) candidateIds.add(row.companyId)
    })
  }

  if (!candidateIds.has(requestedCompanyId)) {
    return false
  }

  const company = await prisma.company.findFirst({
    where: {
      id: requestedCompanyId,
      deletedAt: null,
      locked: false,
      OR: [{ traderId: auth.traderId }, { traderId: null }]
    },
    select: { id: true }
  })

  return !!company
}

export async function middleware(request: NextRequest) {
  const pathname = normalizePath(request.nextUrl.pathname)
  const isApiRoute = pathname.startsWith('/api/')
  const isSuperAdminApiRoute = pathname.startsWith('/api/super-admin/')
  const isSuperAdminPageRoute = !isApiRoute && pathname.startsWith('/super-admin')
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID()

  if ((isSuperAdminApiRoute || isSuperAdminPageRoute) && !isLocalSuperAdminAccessAllowed(request)) {
    if (isSuperAdminApiRoute) {
      return NextResponse.json({ error: 'Super admin is restricted to local development access' }, { status: 404 })
    }
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (!isApiRoute && (pathname === '/login' || pathname === '/super-admin/login')) {
    const sanitizedUrl = request.nextUrl.clone()
    if (sanitizedUrl.searchParams.has('password')) {
      sanitizedUrl.searchParams.delete('password')
      return NextResponse.redirect(sanitizedUrl)
    }
  }

  if (request.method === 'OPTIONS') {
    return NextResponse.next()
  }

  if (isApiRoute) {
    const ip = getRequestIp(request)
    const isPublic = isPublicApi(pathname)
    const authHeader = request.headers.get('Authorization')?.replace('Bearer ', '')
    const scopeSource = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
    const sessionCookieCandidates = getSessionCookieNameCandidates(
      isSuperAdminApiRoute ? 'super_admin' : 'app',
      scopeSource
    )
    const token =
      authHeader ||
      sessionCookieCandidates
        .map((cookieNames) => request.cookies.get(cookieNames.authToken)?.value)
        .find((value): value is string => Boolean(value))
    const payload = token ? verifyToken(token) : null
    const isSuperAdminRequest =
      !isPublic && !!payload && normalizeAppRole(String(payload.role || '')) === 'super_admin'

    if (ENABLE_RATE_LIMIT && !isSuperAdminRequest) {
      const globalLimit = consumeRateLimit(`global:${ip}`, 60, 60 * 1000)
      if (!globalLimit.allowed) {
        return tooManyRequestsResponse('Rate limit exceeded', globalLimit.retryAfter)
      }

      if (pathname.startsWith('/api/super-admin/')) {
        const adminLimit = consumeRateLimit(`admin:${ip}`, 30, 60 * 1000)
        if (!adminLimit.allowed) {
          return tooManyRequestsResponse('Admin rate limit exceeded', adminLimit.retryAfter)
        }
      }

      if (pathname.startsWith('/api/payments') && mutatingMethods.has(request.method)) {
        const paymentLimit = consumeRateLimit(`payments:${ip}`, 20, 60 * 1000)
        if (!paymentLimit.allowed) {
          return tooManyRequestsResponse('Payment mutation rate limit exceeded', paymentLimit.retryAfter)
        }
      }
    }

    if (isPublic) {
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-request-id', requestId)
      return NextResponse.next({
        request: {
          headers: requestHeaders
        }
      })
    }

    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required' },
        {
          status: 401,
          headers: {
            'Access-Control-Allow-Origin': env.ALLOWED_ORIGINS?.split(',')?.[0] || 'http://localhost:3000',
            Vary: 'Origin'
          }
        }
      )
    }

    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        {
          status: 401,
          headers: {
            'Access-Control-Allow-Origin': env.ALLOWED_ORIGINS?.split(',')?.[0] || 'http://localhost:3000',
            Vary: 'Origin'
          }
        }
      )
    }

    if (!authHeader && mutatingMethods.has(request.method)) {
      const csrfCookie =
        sessionCookieCandidates
          .map((cookieNames) => request.cookies.get(cookieNames.csrfToken)?.value)
          .find((value): value is string => Boolean(value)) || null
      const csrfHeader = request.headers.get('x-csrf-token')
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
      }
    }

    const user = await prisma.user.findFirst({
      where: {
        userId: payload.userId,
        traderId: payload.traderId,
        deletedAt: null
      },
      select: {
        id: true,
        userId: true,
        traderId: true,
        role: true,
        locked: true,
        deletedAt: true,
        companyId: true,
        trader: {
          select: {
            id: true,
            locked: true,
            deletedAt: true
          }
        },
        company: {
          select: {
            id: true,
            locked: true,
            deletedAt: true,
            traderId: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'Invalid session user' }, { status: 401 })
    }

    const rawRole = (user.role || payload.role || 'company_user').toString()
    const role = normalizeAppRole(rawRole)
    const legacyRole =
      role === 'trader_admin' ? 'admin' : role === 'company_user' ? 'user' : role

    if (pathname.startsWith('/api/super-admin/') && role !== 'super_admin') {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
    }

    if ((pathname === '/api/traders' || pathname === '/api/users') && role !== 'super_admin') {
      return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
    }

    const deletedReason = user.trader?.deletedAt
      ? 'Trader is deleted'
      : user.deletedAt
        ? 'User is deleted'
        : null

    if (deletedReason && !isLockBypassApiRoute(pathname)) {
      return NextResponse.json({ error: deletedReason }, { status: 403 })
    }

    const lockedReason = user.trader?.locked
      ? 'Trader is locked'
      : user.locked
        ? 'User is locked'
        : null

    if (lockedReason && !isLockBypassApiRoute(pathname)) {
      return NextResponse.json({ error: lockedReason }, { status: 403 })
    }

    const urlCompanyId = request.nextUrl.searchParams.get('companyId')
    const urlCompanyIds = request.nextUrl.searchParams.get('companyIds')
    const lockedCompanyId =
      getCompanyCookieNameCandidates(scopeSource)
        .map((cookieName) => request.cookies.get(cookieName)?.value)
        .find((value): value is string => Boolean(value)) || null

    if (urlCompanyId) {
      if (lockedCompanyId && urlCompanyId !== lockedCompanyId && role !== 'super_admin') {
        return NextResponse.json(
          { error: 'Company mismatch. Open company select to switch company.' },
          { status: 403 }
        )
      }

      const companyAllowed = await ensureCompanyScope(urlCompanyId, {
        role,
        traderId: user.traderId,
        companyId: user.companyId,
        userDbId: user.id
      })

      if (!companyAllowed) {
        return NextResponse.json({ error: 'Company not found or access denied' }, { status: 403 })
      }
    }

    if (urlCompanyIds) {
      const ids = urlCompanyIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
      for (const id of ids) {
        const companyAllowed = await ensureCompanyScope(id, {
          role,
          traderId: user.traderId,
          companyId: user.companyId,
          userDbId: user.id
        })
        if (!companyAllowed) {
          return NextResponse.json({ error: 'One or more company IDs are out of scope' }, { status: 403 })
        }
      }
    }

    const activeCompanyId = lockedCompanyId || user.companyId || ''
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id', user.userId)
    requestHeaders.set('x-user-db-id', user.id)
    requestHeaders.set('x-trader-id', user.traderId)
    requestHeaders.set('x-user-role', legacyRole)
    requestHeaders.set('x-user-role-raw', rawRole)
    requestHeaders.set('x-user-role-normalized', role)
    requestHeaders.set('x-company-id', activeCompanyId)
    requestHeaders.set('x-request-id', requestId)

    return NextResponse.next({
      request: {
        headers: requestHeaders
      }
    })
  }

  if (!isApiRoute && isBusinessAppRoute(pathname)) {
    const scopeSource = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
    const appCookieCandidates = getSessionCookieNameCandidates('app', scopeSource)
    const token =
      appCookieCandidates
        .map((cookieNames) => request.cookies.get(cookieNames.authToken)?.value)
        .find((value): value is string => Boolean(value)) || null
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const payload = verifyToken(token)
    if (!payload) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const user = await prisma.user.findFirst({
      where: {
        userId: payload.userId,
        traderId: payload.traderId,
        deletedAt: null
      },
      select: {
        role: true,
        locked: true,
        deletedAt: true,
        trader: {
          select: {
            locked: true,
            deletedAt: true
          }
        },
        company: {
          select: {
            locked: true,
            deletedAt: true
          }
        }
      }
    })

    if (
      !user ||
      user.locked ||
      user.deletedAt ||
      user.trader?.locked ||
      user.trader?.deletedAt
    ) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const role = normalizeAppRole(user.role || payload.role)
    if (role === 'super_admin') {
      return NextResponse.redirect(new URL('/super-admin/crud', request.url))
    }
  }

  if (isSuperAdminPageRoute && pathname !== '/super-admin/login') {
    const scopeSource = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
    const superAdminCookieCandidates = getSessionCookieNameCandidates('super_admin', scopeSource)
    const token =
      superAdminCookieCandidates
        .map((cookieNames) => request.cookies.get(cookieNames.authToken)?.value)
        .find((value): value is string => Boolean(value)) || null
    if (!token) {
      return NextResponse.redirect(new URL('/super-admin/login', request.url))
    }

    const payload = verifyToken(token)
    if (!payload) {
      return NextResponse.redirect(new URL('/super-admin/login', request.url))
    }

    const user = await prisma.user.findFirst({
      where: {
        userId: payload.userId,
        traderId: payload.traderId,
        deletedAt: null
      },
      select: {
        role: true,
        locked: true,
        deletedAt: true,
        trader: {
          select: {
            locked: true,
            deletedAt: true
          }
        },
        company: {
          select: {
            locked: true,
            deletedAt: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.redirect(new URL('/super-admin/login', request.url))
    }

    if (
      normalizeAppRole(user.role) !== 'super_admin' ||
      user.locked ||
      user.deletedAt ||
      user.trader?.locked ||
      user.trader?.deletedAt
    ) {
      return NextResponse.redirect(new URL('/super-admin/login', request.url))
    }
  }

  const urlCompanyId = request.nextUrl.searchParams.get('companyId')
  const scopeSource = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
  const lockedCompanyId =
    getCompanyCookieNameCandidates(scopeSource)
      .map((cookieName) => request.cookies.get(cookieName)?.value)
      .find((value): value is string => Boolean(value)) || null

  if (!isApiRoute && urlCompanyId && lockedCompanyId && urlCompanyId !== lockedCompanyId) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.searchParams.set('companyId', lockedCompanyId)
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.next()
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)']
}
