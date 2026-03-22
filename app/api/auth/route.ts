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
import { ensureSupabaseIdentityForLegacyUser, loadLegacyUserForSupabaseSync } from '@/lib/supabase/legacy-user-sync'
import { getAppCompanyCookieOptions } from '@/lib/supabase/app-session'
import { getCompanyCookieName } from '@/lib/session-cookies'

// Simple in-memory rate limiting store
const rateLimitStore = new Map<string, { count: number; resetTime: number }>()
const accountLockoutStore = new Map<string, { count: number; lockedUntil: number }>()
const ENFORCE_LOGIN_GUARDS = false
const isDev = env.NODE_ENV === 'development' || !ENFORCE_LOGIN_GUARDS

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
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
  
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigins[0],
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
      const legacyUser = await loadLegacyUserForSupabaseSync(authResult.user!.id)
      if (!legacyUser) {
        return NextResponse.json(
          { error: 'Account is locked or inactive' },
          { status: 403, headers }
        )
      }

      const routeClient = createSupabaseRouteClient(request)
      if (!routeClient) {
        return NextResponse.json(
          { error: 'Supabase client is not configured correctly' },
          { status: 500, headers }
        )
      }

      const supabaseIdentity = await ensureSupabaseIdentityForLegacyUser({
        legacyUser,
        password
      })

      preferredCompanyId = supabaseIdentity.defaultCompanyId || preferredCompanyId

      const signInResult = await routeClient.supabase.auth.signInWithPassword({
        email: supabaseIdentity.loginEmail,
        password
      })

      if (signInResult.error) {
        await auditLogger.logAuthentication(
          authResult.user!.userId,
          authResult.user!.traderId,
          'LOGIN_FAILURE',
          ipAddress,
          userAgent,
          `Supabase sign-in failed: ${signInResult.error.message}`
        )

        return NextResponse.json(
          { error: 'Failed to start Supabase session' },
          { status: 500, headers }
        )
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

      if (preferredCompanyId) {
        response.cookies.set(
          getCompanyCookieName(scopeSource),
          preferredCompanyId,
          getAppCompanyCookieOptions()
        )
      }

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

      return response
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
        'Access-Control-Allow-Origin': allowedOrigins[0],
        'Vary': 'Origin'
      }
    })
  }
}

export async function OPTIONS() {
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigins[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  })
}
