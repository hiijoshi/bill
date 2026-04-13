'use client'

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
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin'
    })

    if (!response.ok) {
      throw await parseApiError(response)
    }

    return response.json() as Promise<T>
  },

  async postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return withCsrfRetry(async (csrfToken) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw await parseApiError(response)
      }

      return response.json() as Promise<T>
    })
  },

  async patchJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return withCsrfRetry(async (csrfToken) => {
      const response = await fetch(url, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        throw await parseApiError(response)
      }

      return response.json() as Promise<T>
    })
  },

  async postForm<T>(url: string, formData: FormData): Promise<T> {
    return withCsrfRetry(async (csrfToken) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'x-csrf-token': csrfToken
        },
        body: formData
      })

      if (!response.ok) {
        throw await parseApiError(response)
      }

      return response.json() as Promise<T>
    })
  },

  async postBinary<T>(url: string, body: Blob | ArrayBuffer | Uint8Array, headers: Record<string, string>): Promise<T> {
    return withCsrfRetry(async (csrfToken) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'x-csrf-token': csrfToken,
          ...headers
        },
        body: body as BodyInit
      })

      if (!response.ok) {
        throw await parseApiError(response)
      }

      return response.json() as Promise<T>
    })
  }
}
