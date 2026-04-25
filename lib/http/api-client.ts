'use client'

import { sanitizeCompanyId } from '@/lib/company-id'
import { getCompanyCookieNameCandidates } from '@/lib/session-cookies'

type ApiErrorShape = {
  ok?: false
  error?:
    | string
    | {
        code?: string
        message?: string
        retryable?: boolean
      }
}

function getCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function shouldAttachCompany(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false
  if (pathname.startsWith('/api/auth')) return false
  if (pathname.startsWith('/api/super-admin')) return false
  if (pathname === '/api/security/csrf') return false
  if (pathname.startsWith('/api/subscription/')) return false
  return true
}

function resolveActiveCompanyId(target: URL): string {
  const fromRequest = sanitizeCompanyId(target.searchParams.get('companyId') || '')
  if (fromRequest) return fromRequest

  if (typeof window !== 'undefined') {
    const fromLocation = sanitizeCompanyId(new URL(window.location.href).searchParams.get('companyId') || '')
    if (fromLocation) return fromLocation

    for (const cookieName of getCompanyCookieNameCandidates(window.location.host)) {
      const fromCookie = sanitizeCompanyId(getCookieValue(cookieName) || '')
      if (fromCookie) return fromCookie
    }
  }

  return ''
}

function resolveScopedRequest(url: string, method: string) {
  const target = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  const companyId = shouldAttachCompany(target.pathname) ? resolveActiveCompanyId(target) : ''

  if (companyId && method === 'GET' && !target.searchParams.has('companyId')) {
    target.searchParams.set('companyId', companyId)
  }

  const relativeUrl = `${target.pathname}${target.search}`
  return { url: relativeUrl, companyId }
}

function withCompanyHeaders(headers: HeadersInit | undefined, companyId: string): Headers {
  const nextHeaders = new Headers(headers || {})
  if (companyId) {
    nextHeaders.set('x-company-id', companyId)
    nextHeaders.set('x-auth-company-id', companyId)
  }
  return nextHeaders
}

async function loadCsrfToken() {
  const response = await fetch('/api/security/csrf', {
    cache: 'no-store',
    credentials: 'same-origin'
  })

  if (!response.ok) {
    throw new Error('Unable to initialize secure request session.')
  }

  const payload = await response.json().catch(() => null) as
    | { ok?: boolean; data?: { csrfToken?: string } }
    | null

  const csrfToken = String(payload?.data?.csrfToken || '').trim()
  if (!csrfToken) {
    throw new Error('Unable to obtain request security token.')
  }

  return csrfToken
}

async function parseApiError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => null) as ApiErrorShape | null
  const message = typeof payload?.error === 'string'
    ? payload.error
    : String(payload?.error?.message || `Request failed with status ${response.status}`)
  return new Error(message)
}

async function withCsrfRetry<T>(executor: (csrfToken: string) => Promise<T>): Promise<T> {
  let csrfToken = await loadCsrfToken()

  try {
    return await executor(csrfToken)
  } catch (error) {
    if (!(error instanceof Error) || !/csrf|security token/i.test(error.message)) {
      throw error
    }

    csrfToken = await loadCsrfToken()
    return executor(csrfToken)
  }
}

export const apiClient = {
  async getJson<T>(url: string): Promise<T> {
    const scoped = resolveScopedRequest(url, 'GET')
    const response = await fetch(scoped.url, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: withCompanyHeaders(undefined, scoped.companyId)
    })

    if (!response.ok) {
      throw await parseApiError(response)
    }

    return response.json() as Promise<T>
  },

  async postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return withCsrfRetry(async (csrfToken) => {
      const scoped = resolveScopedRequest(url, 'POST')
      const scopedBody: Record<string, unknown> = { ...body }
      if (scoped.companyId && !('companyId' in scopedBody)) {
        scopedBody.companyId = scoped.companyId
      }

      const response = await fetch(scoped.url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: withCompanyHeaders(
          {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          scoped.companyId
        ),
        body: JSON.stringify(scopedBody)
      })

      if (!response.ok) {
        throw await parseApiError(response)
      }

      return response.json() as Promise<T>
    })
  },

  async patchJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return withCsrfRetry(async (csrfToken) => {
      const scoped = resolveScopedRequest(url, 'PATCH')
      const scopedBody: Record<string, unknown> = { ...body }
      if (scoped.companyId && !('companyId' in scopedBody)) {
        scopedBody.companyId = scoped.companyId
      }

      const response = await fetch(scoped.url, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: withCompanyHeaders(
          {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          scoped.companyId
        ),
        body: JSON.stringify(scopedBody)
      })

      if (!response.ok) {
        throw await parseApiError(response)
      }

      return response.json() as Promise<T>
    })
  },

  async postForm<T>(url: string, formData: FormData): Promise<T> {
    return withCsrfRetry(async (csrfToken) => {
      const scoped = resolveScopedRequest(url, 'POST')
      const scopedFormData = new FormData()
      formData.forEach((value, key) => scopedFormData.append(key, value))
      if (scoped.companyId && !scopedFormData.has('companyId')) {
        scopedFormData.append('companyId', scoped.companyId)
      }

      const response = await fetch(scoped.url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: withCompanyHeaders(
          {
            'x-csrf-token': csrfToken
          },
          scoped.companyId
        ),
        body: scopedFormData
      })

      if (!response.ok) {
        throw await parseApiError(response)
      }

      return response.json() as Promise<T>
    })
  },

  async postBinary<T>(url: string, body: Blob | ArrayBuffer | Uint8Array, headers: Record<string, string>): Promise<T> {
    return withCsrfRetry(async (csrfToken) => {
      const scoped = resolveScopedRequest(url, 'POST')
      const response = await fetch(scoped.url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: withCompanyHeaders(
          {
            'x-csrf-token': csrfToken,
            ...headers
          },
          scoped.companyId
        ),
        body: body as BodyInit
      })

      if (!response.ok) {
        throw await parseApiError(response)
      }

      return response.json() as Promise<T>
    })
  }
}
