import 'server-only'

import { cookies, headers } from 'next/headers'

function buildCookieHeader() {
  return cookies()
    .then((store) => store.getAll().map((cookie) => `${cookie.name}=${cookie.value}`).join('; '))
}

async function getServerOrigin() {
  const headerStore = await headers()
  const host =
    headerStore.get('x-forwarded-host') ||
    headerStore.get('host') ||
    process.env.VERCEL_URL ||
    ''

  if (!host) {
    throw new Error('Unable to resolve request host for internal API bootstrap')
  }

  const protocol =
    headerStore.get('x-forwarded-proto') ||
    (host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')

  return { host, protocol }
}

export async function fetchInternalApiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const [{ host, protocol }, cookieHeader] = await Promise.all([getServerOrigin(), buildCookieHeader()])
  const requestHeaders = new Headers(init.headers)

  if (cookieHeader) {
    requestHeaders.set('cookie', cookieHeader)
  }
  requestHeaders.set('x-forwarded-host', host)
  requestHeaders.set('x-forwarded-proto', protocol)

  const response = await fetch(`${protocol}://${host}${path}`, {
    ...init,
    headers: requestHeaders,
    cache: 'no-store'
  })

  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string
    message?: string
  }

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : typeof payload?.message === 'string'
          ? payload.message
          : `Internal API request failed for ${path}`
    )
  }

  return payload
}
