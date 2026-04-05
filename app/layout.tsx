'use client'

import "./globals.css";
import ErrorBoundary from "@/components/ErrorBoundary";
import { SessionProvider } from "@/components/SessionProvider";
import { useEffect, useState } from "react";
import { isAbortError } from "@/lib/http";
import { getSessionCookieNameCandidates } from "@/lib/session-cookies";
import { getClientCache } from "@/lib/client-fetch-cache";
import { broadcastAppDataChanged, invalidateAppDataCaches } from "@/lib/app-live-data";
import { notifyAppCompanyChanged } from "@/lib/company-context";
import { dispatchSuperAdminDataChanged } from "@/lib/super-admin-live-data";

function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    const syncStatus = () => {
      setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    }

    syncStatus()
    window.addEventListener('online', syncStatus)
    window.addEventListener('offline', syncStatus)

    return () => {
      window.removeEventListener('online', syncStatus)
      window.removeEventListener('offline', syncStatus)
    }
  }, [])

  if (isOnline) return null

  return (
    <div className="fixed inset-x-0 top-0 z-[100] border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900 shadow-sm">
      Offline mode detected. Cloud data cannot sync until your internet connection returns.
    </div>
  )
}

const ACTIVE_COMPANY_CACHE_KEY = 'shell:active-company-id'
const ACTIVE_COMPANY_CACHE_AGE_MS = 5 * 60_000
const LIVE_UPDATE_POLL_MS = 3_000
const businessAppPathPrefixes = ['/main', '/master', '/purchase', '/sales', '/stock', '/payment', '/reports', '/company']

function isBusinessAppPath(pathname: string): boolean {
  return businessAppPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Add global fetch interceptor for authentication with automatic token refresh
  useEffect(() => {
    const defaultApiTimeoutMs = process.env.NODE_ENV === 'development' ? 25000 : 20000
    const defaultSuperAdminApiTimeoutMs = process.env.NODE_ENV === 'development' ? 45000 : 30000
    const apiTimeoutMs = Math.max(
      8000,
      Math.min(60000, Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || defaultApiTimeoutMs))
    )
    const superAdminApiTimeoutMs = Math.max(
      apiTimeoutMs,
      Math.min(120000, Number(process.env.NEXT_PUBLIC_SUPER_ADMIN_API_TIMEOUT_MS || defaultSuperAdminApiTimeoutMs))
    )
    const originalFetch = window.fetch;
    const abortRejectionHandler = (event: PromiseRejectionEvent) => {
      if (isAbortError(event.reason)) {
        event.preventDefault()
      }
    }
    const abortErrorHandler = (event: ErrorEvent) => {
      if (isAbortError(event.error) || isAbortError(event.message)) {
        event.preventDefault()
      }
    }

    window.addEventListener('unhandledrejection', abortRejectionHandler)
    window.addEventListener('error', abortErrorHandler)

    const getCookieValue = (name: string): string | null => {
      const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
      return match ? decodeURIComponent(match[1]) : null
    }

    const isAuthScreen = () => {
      const pathname = window.location.pathname
      return pathname === '/login' || pathname === '/super-admin/login'
    }
    
    const refreshToken = async (useSuperAdminSession: boolean) => {
      try {
        const response = await fetch(useSuperAdminSession ? '/api/super-admin/refresh' : '/api/auth/refresh', {
          method: 'POST'
        });
        if (response.ok) {
          // notify listeners that session was refreshed so timers can reset
          window.dispatchEvent(new Event('sessionRefreshed'))
          return true; // Token refreshed successfully
        }
        return false;
      } catch {
        return false;
      }
    };

    const isTimeoutResponse = async (response: Response): Promise<boolean> => {
      if (response.status !== 504) return false
      try {
        const payload = await response.clone().json()
        return payload?.timedOut === true || typeof payload?.error === 'string'
      } catch {
        return true
      }
    }
    
    window.fetch = async (...args) => {
      const [url, options = {}] = args;
      const requestInit = { ...options } as RequestInit;
      const method = String(
        requestInit.method || (url instanceof Request ? url.method : 'GET')
      ).toUpperCase()
      const urlString =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url
      const isInternalApi =
        urlString.startsWith('/api/') ||
        urlString.startsWith(`${window.location.origin}/api/`)
      const isSuperAdminApi =
        urlString.startsWith('/api/super-admin') ||
        urlString.startsWith(`${window.location.origin}/api/super-admin`)
      const isSuperAdminAuthEndpoint =
        urlString === '/api/super-admin/auth' ||
        urlString === `${window.location.origin}/api/super-admin/auth`
      const isBankStatementImportApi =
        urlString === '/api/payments/bank-statement/import' ||
        urlString === `${window.location.origin}/api/payments/bank-statement/import`
      const isSubscriptionManagementApi =
        urlString.startsWith('/api/super-admin/trader-subscriptions') ||
        urlString.startsWith(`${window.location.origin}/api/super-admin/trader-subscriptions`) ||
        urlString.startsWith('/api/super-admin/subscription-plans') ||
        urlString.startsWith(`${window.location.origin}/api/super-admin/subscription-plans`)
      const timeoutMsForRequest = (() => {
        if (isSubscriptionManagementApi) {
          return Math.max(superAdminApiTimeoutMs, 60000)
        }
        if (isSuperAdminApi) return superAdminApiTimeoutMs
        if (isBankStatementImportApi) {
          return Math.max(apiTimeoutMs, 240000)
        }
        if (urlString.includes('/api/reports/')) {
          return Math.max(apiTimeoutMs, 45000)
        }
        return apiTimeoutMs
      })()
      const shouldRetryTimedGet = isInternalApi && ['GET', 'HEAD'].includes(method)
      
      // Skip for external URLs and auth bootstrap endpoints.
      if (typeof url === 'string' && url.startsWith('http')) {
        return originalFetch(...args);
      }
      if (
        typeof url === 'string' &&
        (
          url === '/api/auth' ||
          url === '/api/auth/refresh' ||
          url === '/api/auth/login' ||
          url === '/api/super-admin/auth' ||
          url === '/api/super-admin/refresh'
        )
      ) {
        return originalFetch(...args);
      }

      if (isInternalApi && typeof navigator !== 'undefined' && navigator.onLine === false) {
        return new Response(
          JSON.stringify({
            offline: true,
            error: 'You are offline. Please reconnect to continue syncing cloud data.'
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      }

      const safeFetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
        useTimeout: boolean = false,
        timeoutMs: number = apiTimeoutMs
      ): Promise<Response> => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null
        let didTimeout = false
        let controller: AbortController | null = null
        const finalInit = { ...(init || {}) }

        if (useTimeout && !finalInit.signal) {
          controller = new AbortController()
          finalInit.signal = controller.signal
          timeoutId = setTimeout(() => {
            didTimeout = true
            controller?.abort('RequestTimeout')
          }, timeoutMs)
        }

        try {
          return await originalFetch(input, finalInit)
        } catch (error) {
          if (isAbortError(error)) {
            const timeoutMessage = didTimeout && isBankStatementImportApi
              ? 'Bank statement scan took too long. Try once again, or upload CSV / Excel for the fastest result.'
              : 'Request timed out. Please retry once.'
            return new Response(JSON.stringify(
              didTimeout
                ? { timedOut: true, error: timeoutMessage }
                : { aborted: true, error: 'Request was interrupted. Please retry.' }
            ), {
              status: didTimeout ? 504 : 499,
              headers: {
                'Content-Type': 'application/json'
              }
            })
          }
          throw error
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId)
          }
        }
      }

      if (
        isInternalApi &&
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ) {
        const csrfToken =
          getSessionCookieNameCandidates(
            isSuperAdminApi ? 'super_admin' : 'app',
            window.location.host
          )
            .map((cookieNames) => getCookieValue(cookieNames.csrfToken))
            .find((value): value is string => Boolean(value)) || null
        if (csrfToken) {
          const headers = new Headers(requestInit.headers || {})
          headers.set('x-csrf-token', csrfToken)
          requestInit.headers = headers
        }
      }
      
      // Try API call first (cookies are sent automatically with HttpOnly)
      let response = await safeFetch(
        url,
        requestInit,
        isInternalApi,
        timeoutMsForRequest
      );

      if (shouldRetryTimedGet && await isTimeoutResponse(response)) {
        response = await safeFetch(
          url,
          requestInit,
          isInternalApi,
          Math.min(timeoutMsForRequest + 15000, isSuperAdminApi ? 120000 : 90000)
        )
      }

      // Preserve /api/super-admin/auth 401 to show in-page login errors.
      if (response.status === 401 && isSuperAdminApi && isSuperAdminAuthEndpoint) {
        return response;
      }
      
      // If 401, try to refresh token and retry once.
      // Never do this on login screens, otherwise the page can get stuck in a
      // refresh -> redirect -> login loop while already unauthenticated.
      if (response.status === 401 && typeof url === 'string' && url.includes('/api/')) {
        if (isAuthScreen()) {
          return response;
        }

        const refreshed = await refreshToken(isSuperAdminApi);
        
        if (refreshed) {
          // Retry the original request with new token
          response = await safeFetch(
            url,
            requestInit,
            isInternalApi,
            timeoutMsForRequest
          );
          if (response.status !== 401) {
            return response;
          }
        }

        if (isSuperAdminApi) {
          if (!isAuthScreen()) {
            window.location.href = '/super-admin/login';
          }
          return response;
        }

        // Token refresh failed, redirect to login
        if (!isAuthScreen()) {
          window.location.href = '/login';
        }
        return response;
      }

      return response;
    };
    
    return () => {
      window.fetch = originalFetch;
      window.removeEventListener('unhandledrejection', abortRejectionHandler)
      window.removeEventListener('error', abortErrorHandler)
    };
  }, []);

  useEffect(() => {
    let cancelled = false
    let lastSessionUpdatedAt = 0
    let sessionStampInitialized = false
    let lastSuperAdminUpdatedAt = 0
    let superAdminStampInitialized = false
    const lastCompanyUpdatedAt = new Map<string, number>()

    const refreshSession = async (namespace: 'app' | 'super_admin', companyId?: string) => {
      const response = await window.fetch(namespace === 'super_admin' ? '/api/super-admin/refresh' : '/api/auth/refresh', {
        method: 'POST',
        cache: 'no-store'
      }).catch(() => null)

      if (cancelled || !response) {
        return false
      }

      if (response.status === 401 || response.status === 403) {
        window.location.href = namespace === 'super_admin' ? '/super-admin/login' : '/login'
        return false
      }

      if (!response.ok) {
        return false
      }

      window.dispatchEvent(new Event('sessionRefreshed'))
      if (namespace === 'app' && companyId) {
        notifyAppCompanyChanged(companyId)
      }

      return true
    }

    const pollLiveUpdates = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return

      const pathname = window.location.pathname
      if (pathname === '/login' || pathname === '/super-admin/login') {
        return
      }

      if (pathname.startsWith('/super-admin')) {
        const response = await window.fetch('/api/super-admin/live-updates', { cache: 'no-store' }).catch(() => null)
        if (cancelled || !response) return

        if (response.status === 401 || response.status === 403) {
          window.location.href = '/super-admin/login'
          return
        }

        if (!response.ok) return

        const payload = await response.json().catch(() => ({} as { sessionUpdatedAt?: number; superAdminUpdatedAt?: number }))
        const sessionUpdatedAt = Number(payload.sessionUpdatedAt || 0)
        if (!sessionStampInitialized) {
          lastSessionUpdatedAt = sessionUpdatedAt
          sessionStampInitialized = true
        } else if (sessionUpdatedAt > lastSessionUpdatedAt) {
          lastSessionUpdatedAt = sessionUpdatedAt
          await refreshSession('super_admin')
        }

        const superAdminUpdatedAt = Number(payload.superAdminUpdatedAt || 0)
        if (!superAdminStampInitialized) {
          lastSuperAdminUpdatedAt = superAdminUpdatedAt
          superAdminStampInitialized = true
        } else if (superAdminUpdatedAt > lastSuperAdminUpdatedAt) {
          lastSuperAdminUpdatedAt = superAdminUpdatedAt
          dispatchSuperAdminDataChanged({ updatedAt: superAdminUpdatedAt })
        }

        return
      }

      if (!isBusinessAppPath(pathname)) {
        return
      }

      const activeCompanyId = getClientCache<string>(ACTIVE_COMPANY_CACHE_KEY, ACTIVE_COMPANY_CACHE_AGE_MS) || ''
      if (!activeCompanyId) {
        return
      }

      const response = await window.fetch(`/api/live-updates?companyIds=${encodeURIComponent(activeCompanyId)}`, {
        cache: 'no-store'
      }).catch(() => null)
      if (cancelled || !response) return

      if (response.status === 401 || response.status === 403) {
        window.location.href = '/login'
        return
      }

      if (!response.ok) return

      const payload = await response.json().catch(
        () =>
          ({} as {
            allowedCompanyIds?: string[]
            companyUpdates?: Record<string, number>
            sessionUpdatedAt?: number
          })
      )

      const allowedCompanyIds = Array.isArray(payload.allowedCompanyIds)
        ? payload.allowedCompanyIds.map((companyId: string) => String(companyId || '').trim()).filter(Boolean)
        : []
      const sessionUpdatedAt = Number(payload.sessionUpdatedAt || 0)
      if (!sessionStampInitialized) {
        lastSessionUpdatedAt = sessionUpdatedAt
        sessionStampInitialized = true
      } else if (sessionUpdatedAt > lastSessionUpdatedAt) {
        lastSessionUpdatedAt = sessionUpdatedAt
        await refreshSession('app', allowedCompanyIds.includes(activeCompanyId) ? activeCompanyId : undefined)
      }
      if (!allowedCompanyIds.includes(activeCompanyId)) {
        await refreshSession('app')
        return
      }

      const companyUpdatedAt = Number(payload.companyUpdates?.[activeCompanyId] || 0)
      const previousCompanyUpdatedAt = lastCompanyUpdatedAt.get(activeCompanyId)
      if (previousCompanyUpdatedAt === undefined) {
        lastCompanyUpdatedAt.set(activeCompanyId, companyUpdatedAt)
        return
      }

      if (companyUpdatedAt > previousCompanyUpdatedAt) {
        lastCompanyUpdatedAt.set(activeCompanyId, companyUpdatedAt)
        invalidateAppDataCaches(activeCompanyId, ['all'])
        broadcastAppDataChanged({
          companyId: activeCompanyId,
          scopes: ['all'],
          updatedAt: companyUpdatedAt
        })
        notifyAppCompanyChanged(activeCompanyId)
      }
    }

    void pollLiveUpdates()

    const intervalId = window.setInterval(() => {
      void pollLiveUpdates()
    }, LIVE_UPDATE_POLL_MS)

    const onFocus = () => {
      void pollLiveUpdates()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void pollLiveUpdates()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return (
    <html lang="en">
      <body className="motion-minimal-app antialiased">
        <NetworkStatusBanner />
        <SessionProvider>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </SessionProvider>
      </body>
    </html>
  );
}
