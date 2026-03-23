import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth'
import { setSession } from '@/lib/session'
import { checkBruteForce, recordFailedAttempt, recordSuccessfulAttempt } from '@/lib/brute-force-protection'
import { verifyCaptcha, shouldRequireCaptcha } from '@/lib/captcha'
import { auditLogger } from '@/lib/audit-logging'
import { env } from '@/lib/config'
import { loginSchema } from '@/lib/validation'
import { getRequestIp } from '@/lib/api-security'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { createSupabaseRouteClient } from '@/lib/supabase/route'
import { buildSupabaseLoginEmail, ensureSupabaseIdentityForLegacyUser, loadLegacyUserForSupabaseSync } from '@/lib/supabase/legacy-user-sync'
import { getAppCompanyCookieOptions } from '@/lib/supabase/app-session'
import { getCompanyCookieName } from '@/lib/session-cookies'

// Simple in-memory rate limiting store
const rateLimitStore = new Map<string, { count: number; resetTime: number }>()
const accountLockoutStore = new Map<string, { count: number; lockedUntil: number }>()
const ENFORCE_LOGIN_GUARDS = false
const isDev = env.NODE_ENV === 'development' || !ENFORCE_LOGIN_GUARDS
const SUPABASE_LOGIN_BRIDGE_TIMEOUT_MS = (() => {
  const configuredTimeout = Number(process.env.SUPABASE_LOGIN_BRIDGE_TIMEOUT_MS || 6000)
  if (!Number.isFinite(configuredTimeout)) {
    return 6000
  }
  return Math.max(3000, Math.min(15000, configuredTimeout))
})()

async function checkRateLimit(identifier: string, windowMs: number, maxRequests: number) {
  const now = Date.now()
  
  let entry = rateLimitStore.get(identifier)
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + windowMs }
    rateLimitStore.set(identifier, entry)
  }

  if (entry.count >= maxRequests) {
    const resetIn = Math.ceil((entry.resetTime - now) / 1000)
    return {
      blocked: true,
      resetIn
    }
  }

  entry.count++
  return { blocked: false }
}

async function withTimeoutResult<T>(
  task: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve(onTimeout())
    }, timeoutMs)
  })

  try {
    return await Promise.race([task, timeoutPromise])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

function parseOrigin(value: string | null | undefined) {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function resolveCorsOrigin(request: NextRequest) {
  const requestOrigin = parseOrigin(request.headers.get('origin'))
  const allowedOrigins = (env.ALLOWED_ORIGINS?.split(',') || [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  const fallbackOrigin = allowedOrigins[0] || 'http://localhost:3000'

  if (!requestOrigin) {
    return fallbackOrigin
  }

  const requestHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
  if (requestOrigin.host === requestHost) {
    return requestOrigin.origin
  }

  for (const allowedOriginValue of allowedOrigins) {
    const allowedOrigin = parseOrigin(allowedOriginValue)
    if (!allowedOrigin) continue

    if (
      requestOrigin.origin === allowedOrigin.origin ||
      requestOrigin.hostname === allowedOrigin.hostname ||
      requestOrigin.hostname.endsWith(`.${allowedOrigin.hostname}`)
    ) {
      return requestOrigin.origin
    }
  }

  return fallbackOrigin
}

export async function POST(request: NextRequest) {
  const ipAddress = getRequestIp(request)
  const userAgent = request.headers.get('user-agent') || 'unknown'

  // Enhanced brute force protection
  const bruteForceCheck = isDev
    ? { blocked: false, attemptCount: 0, reason: '', retryAfter: 0 }
    : checkBruteForce(request)
  if (bruteForceCheck.blocked) {
    await auditLogger.logSecurityEvent(
      'unknown',
      'unknown',
      'BRUTE_FORCE_DETECTED',
      ipAddress,
      userAgent,
      { attemptCount: bruteForceCheck.attemptCount }
    )
    
    return NextResponse.json(
      { 
        error: bruteForceCheck.reason,
        attemptCount: bruteForceCheck.attemptCount
      },
      { 
        status: 429,
        headers: {
          'Retry-After': bruteForceCheck.retryAfter?.toString() || '3600'
        }
      }
    )
  }

  // Rate limiting
  const identifier = ipAddress
  
  const rateLimitResult = isDev
    ? { blocked: false, resetIn: 0 }
    : await checkRateLimit(identifier, 15 * 60 * 1000, 8) // 8 requests per 15 minutes
  
  if (rateLimitResult.blocked) {
    await auditLogger.logSecurityEvent(
      'unknown',
      'unknown',
      'RATE_LIMIT_EXCEEDED',
      ipAddress,
      userAgent
    )
    
    return NextResponse.json(
      { 
        error: 'Too many requests',
        retryAfter: rateLimitResult.resetIn
      },
      { 
        status: 429,
        headers: {
          'Retry-After': rateLimitResult.resetIn?.toString() || '60'
        }
      }
    )
  }

  // Set CORS headers
  try {
    const corsOrigin = resolveCorsOrigin(request)
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin'
    }

    const body = await request.json()
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'User ID and password are required' },
        { status: 400, headers }
      )
    }
    const { traderId, userId, password } = parsed.data
    const captchaToken = typeof (body as { captchaToken?: unknown })?.captchaToken === 'string'
      ? (body as { captchaToken?: string }).captchaToken
      : undefined

    // Validation
    if (!userId.trim() || !password.trim()) {
      return NextResponse.json({ 
        error: 'User ID and password are required' 
      }, { 
        status: 400,
        headers 
      })
    }

    const accountKey = `${(traderId || '').toLowerCase()}:${userId.toLowerCase()}`
    const now = Date.now()
    const accountState = isDev ? null : accountLockoutStore.get(accountKey)
    if (accountState && accountState.lockedUntil > now) {
      const retryAfter = Math.ceil((accountState.lockedUntil - now) / 1000)
      return NextResponse.json(
        { error: 'Account temporarily locked due to repeated failed logins', retryAfter },
        { status: 429, headers: { ...headers, 'Retry-After': retryAfter.toString() } }
      )
    }

    // Check if CAPTCHA is required
    if (shouldRequireCaptcha(bruteForceCheck.attemptCount)) {
      if (!captchaToken) {
        await auditLogger.logSecurityEvent(
          userId,
          traderId || 'unknown',
          'CAPTCHA_REQUIRED',
          ipAddress,
          userAgent,
          { attemptCount: bruteForceCheck.attemptCount }
        )
        
        return NextResponse.json({
          error: 'CAPTCHA required for security verification',
          requiresCaptcha: true
        }, {
          status: 403,
          headers
        })
      }

      // Verify CAPTCHA
      const captchaResult = await verifyCaptcha(captchaToken, ipAddress)
      if (!captchaResult.success) {
        await auditLogger.logSecurityEvent(
          userId,
          traderId || 'unknown',
          'SUSPICIOUS_ACTIVITY',
          ipAddress,
          userAgent,
          { captchaError: captchaResult.error }
        )
        
        return NextResponse.json({
          error: 'CAPTCHA verification failed',
          requiresCaptcha: true
        }, {
          status: 403,
          headers
        })
      }
    }

    // Authenticate user using database
    const authResult = await authenticateUser({ userId, password, traderId })

    if (!authResult.success) {
      // Record failed attempt for brute force protection
      recordFailedAttempt(request)
      
      await auditLogger.logAuthentication(
        userId,
        traderId || 'unknown',
        'LOGIN_FAILURE',
        ipAddress,
        userAgent,
        authResult.error
      )
      
      if (!isDev) {
        const failed = accountLockoutStore.get(accountKey) || { count: 0, lockedUntil: 0 }
        failed.count += 1
        if (failed.count >= 8) {
          const minutes = Math.min(30, 2 ** Math.min(failed.count - 8, 4))
          failed.lockedUntil = Date.now() + minutes * 60 * 1000
        }
        accountLockoutStore.set(accountKey, failed)
      }

      const errorMessage = authResult.error || 'Invalid credentials'
      const status =
        errorMessage === 'Internal server error' ||
        errorMessage.startsWith('Database schema mismatch')
          ? 500
          : 401

      return NextResponse.json(
        {
          error: errorMessage
        },
        {
          status,
          headers
        }
      )
    }

    const normalizedRole = String(authResult.user?.role || '')
      .toLowerCase()
      .replace(/\s+/g, '_')
    if (normalizedRole === 'super_admin') {
      return NextResponse.json(
        { error: 'Use Super Admin login page' },
        { status: 403, headers }
      )
    }

    const scopeSource = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
    let preferredCompanyId = authResult.company?.id || null

    if (isSupabaseConfigured()) {
      const supabaseBridgeResult = await withTimeoutResult(
        (async () => {
          const routeClient = createSupabaseRouteClient(request)
          if (!routeClient) {
            throw new Error('Supabase client is not configured correctly')
          }

          let resolvedCompanyId = preferredCompanyId
          let loginEmail = buildSupabaseLoginEmail({
            legacyUserId: authResult.user!.id,
            traderId: authResult.user!.traderId,
            userId: authResult.user!.userId
          })

          let signInResult = await routeClient.supabase.auth.signInWithPassword({
            email: loginEmail,
            password
          })

          if (signInResult.error) {
            const legacyUser = await loadLegacyUserForSupabaseSync(authResult.user!.id)
            if (!legacyUser) {
              throw new Error('Account is locked or inactive')
            }

            const supabaseIdentity = await ensureSupabaseIdentityForLegacyUser({
              legacyUser,
              password
            })

            loginEmail = supabaseIdentity.loginEmail
            resolvedCompanyId = supabaseIdentity.defaultCompanyId || resolvedCompanyId

            signInResult = await routeClient.supabase.auth.signInWithPassword({
              email: loginEmail,
              password
            })

            if (signInResult.error) {
              throw new Error(`Supabase sign-in failed: ${signInResult.error.message}`)
            }
          }

          // Prepare success response so we can attach both Supabase and legacy compatibility cookies.
          const response = routeClient.applyCookies(
            NextResponse.json({
              success: true,
              user: authResult.user,
              trader: authResult.trader,
              company: authResult.company
            }, {
              headers
            })
          )

          await setSession(authResult.token!, authResult.refreshToken, response, 'app', scopeSource)

          if (resolvedCompanyId) {
            response.cookies.set(
              getCompanyCookieName(scopeSource),
              resolvedCompanyId,
              getAppCompanyCookieOptions()
            )
          }

          return {
            response,
            preferredCompanyId: resolvedCompanyId,
            warning: null as string | null
          }
        })().catch((supabaseError) => ({
          response: null as NextResponse | null,
          preferredCompanyId,
          warning: supabaseError instanceof Error ? supabaseError.message : 'Supabase login bridge failed'
        })),
        SUPABASE_LOGIN_BRIDGE_TIMEOUT_MS,
        () => ({
          response: null as NextResponse | null,
          preferredCompanyId,
          warning: 'Cloud login is taking too long. Please try again in a moment.'
        })
      )

      if (supabaseBridgeResult.response) {
        preferredCompanyId = supabaseBridgeResult.preferredCompanyId || preferredCompanyId

        // Record successful attempt (resets brute force counter) only after both sessions are ready.
        recordSuccessfulAttempt(request)

        await auditLogger.logAuthentication(
          authResult.user!.userId,
          authResult.user!.traderId,
          'LOGIN_SUCCESS',
          ipAddress,
          userAgent
        )

        if (!isDev) {
          accountLockoutStore.delete(accountKey)
        }

        return supabaseBridgeResult.response
      }

      await auditLogger.logAuthentication(
        authResult.user!.userId,
        authResult.user!.traderId,
        'LOGIN_FAILURE',
        ipAddress,
        userAgent,
        `Supabase bridge failed: ${supabaseBridgeResult.warning}`
      )

      return NextResponse.json(
        {
          error: supabaseBridgeResult.warning || 'Cloud login bridge failed'
        },
        {
          status: 503,
          headers
        }
      )
    }

    // Record successful attempt (resets brute force counter)
    recordSuccessfulAttempt(request)

    await auditLogger.logAuthentication(
      authResult.user!.userId,
      authResult.user!.traderId,
      'LOGIN_SUCCESS',
      ipAddress,
      userAgent
    )

    if (!isDev) {
      accountLockoutStore.delete(accountKey)
    }

    // Prepare success response so we can attach cookies to it
    const response = NextResponse.json({
      success: true,
      user: authResult.user,
      trader: authResult.trader,
      company: authResult.company
    }, {
      headers
    })

    // Set HttpOnly cookies with both tokens on the response
    await setSession(authResult.token!, authResult.refreshToken, response, 'app', scopeSource)

    if (preferredCompanyId) {
      response.cookies.set(
        getCompanyCookieName(scopeSource),
        preferredCompanyId,
        getAppCompanyCookieOptions()
      )
    }

    return response

  } catch (error) {
    console.error('POST /api/auth failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })

    await auditLogger.logAuthentication(
      'unknown',
      'unknown',
      'LOGIN_FAILURE',
      ipAddress,
      userAgent,
      error instanceof Error ? error.message : 'Unknown error'
    )
    
    return NextResponse.json({ 
      error: 'Internal server error'
    }, { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': resolveCorsOrigin(request),
        'Vary': 'Origin'
      }
    })
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': resolveCorsOrigin(request),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  })
}
