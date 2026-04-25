'use client'

import { useEffect } from 'react'
import ErrorBoundary from '@/components/ErrorBoundary'
import NetworkStatusBanner from '@/components/NetworkStatusBanner'
import { SessionProvider } from '@/components/SessionProvider'
import PwaClientBoot from '@/components/pwa/PwaClientBoot'
import { isAbortError } from '@/lib/http'
import { getSessionCookieNameCandidates } from '@/lib/session-cookies'

export default function AppShell({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
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
    const originalFetch = window.fetch
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
        })
        if (response.ok) {
          window.dispatchEvent(new Event('sessionRefreshed'))
          return true
        }
        return false
      } catch {
        return false
      }
    }

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
      const [url, options = {}] = args
      const requestInit = { ...options } as RequestInit
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
      const isCsrfTokenEndpoint =
        urlString === '/api/security/csrf' ||
        urlString === `${window.location.origin}/api/security/csrf`
      const isSuperAdminAuthEndpoint =
        urlString === '/api/super-admin/auth' ||
        urlString === `${window.location.origin}/api/super-admin/auth`
      const isBankStatementImportApi =
        urlString.startsWith('/api/bank-statements/') ||
        urlString.startsWith(`${window.location.origin}/api/bank-statements/`)
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

      if (typeof url === 'string' && url.startsWith('http')) {
        return originalFetch(...args)
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
        return originalFetch(...args)
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

      let response = await safeFetch(
        url,
        requestInit,
        isInternalApi,
        timeoutMsForRequest
      )

      if (shouldRetryTimedGet && await isTimeoutResponse(response)) {
        response = await safeFetch(
          url,
          requestInit,
          isInternalApi,
          Math.min(timeoutMsForRequest + 15000, isSuperAdminApi ? 120000 : 90000)
        )
      }

      if (response.status === 401 && isSuperAdminApi && isSuperAdminAuthEndpoint) {
        return response
      }

      if (response.status === 401 && isCsrfTokenEndpoint) {
        return response
      }

      if (response.status === 401 && typeof url === 'string' && url.includes('/api/')) {
        if (isAuthScreen()) {
          return response
        }

        const refreshed = await refreshToken(isSuperAdminApi)

        if (refreshed) {
          response = await safeFetch(
            url,
            requestInit,
            isInternalApi,
            timeoutMsForRequest
          )
          if (response.status !== 401) {
            return response
          }
        }

        if (isSuperAdminApi) {
          if (!isAuthScreen()) {
            window.location.href = '/super-admin/login'
          }
          return response
        }

        if (!isAuthScreen()) {
          window.location.href = '/login'
        }
        return response
      }

      return response
    }

    return () => {
      window.fetch = originalFetch
      window.removeEventListener('unhandledrejection', abortRejectionHandler)
      window.removeEventListener('error', abortErrorHandler)
    }
  }, [])

  return (
    <>
      <PwaClientBoot />
      <NetworkStatusBanner />
      <SessionProvider>
        <ErrorBoundary>{children}</ErrorBoundary>
      </SessionProvider>
    </>
  )
}
