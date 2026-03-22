'use client'

import "./globals.css";
import ErrorBoundary from "@/components/ErrorBoundary";
import { SessionProvider } from "@/components/SessionProvider";
import { useEffect } from "react";
import { isAbortError } from "@/lib/http";
import { getSessionCookieNameCandidates } from "@/lib/session-cookies";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Add global fetch interceptor for authentication with automatic token refresh
  useEffect(() => {
    const apiTimeoutMs = Math.max(
      5000,
      Math.min(60000, Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || 12000))
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

      const safeFetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
        useTimeout: boolean = false
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
          }, apiTimeoutMs)
        }

        try {
          return await originalFetch(input, finalInit)
        } catch (error) {
          if (isAbortError(error)) {
            return new Response(JSON.stringify(didTimeout ? { timedOut: true } : { aborted: true }), {
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
      let response = await safeFetch(url, requestInit, isInternalApi);

      // Preserve /api/super-admin/auth 401 to show in-page login errors.
      if (response.status === 401 && isSuperAdminApi && isSuperAdminAuthEndpoint) {
        return response;
      }
      
      // If 401, try to refresh token and retry once
      if (response.status === 401 && typeof url === 'string' && url.includes('/api/')) {
        const refreshed = await refreshToken(isSuperAdminApi);
        
        if (refreshed) {
          // Retry the original request with new token
          response = await safeFetch(url, requestInit, isInternalApi);
          if (response.status !== 401) {
            return response;
          }
        }

        if (isSuperAdminApi) {
          window.location.href = '/super-admin/login';
          return response;
        }

        // Token refresh failed, redirect to login
        window.location.href = '/login';
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

  return (
    <html lang="en">
      <body className="antialiased">
        <SessionProvider>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </SessionProvider>
      </body>
    </html>
  );
}
