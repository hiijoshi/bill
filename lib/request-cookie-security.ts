import type { NextRequest } from 'next/server'

import { env } from '@/lib/config'

type RequestLike =
  | Pick<NextRequest, 'headers' | 'nextUrl'>
  | { headers: Headers; nextUrl?: { protocol?: string | null; host?: string | null } }

function normalizeProtocol(value: string | null | undefined): 'http' | 'https' | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:$/, '')

  if (!normalized) {
    return null
  }

  if (normalized.startsWith('http://')) {
    return 'http'
  }

  if (normalized.startsWith('https://')) {
    return 'https'
  }

  const firstToken = normalized.split(',')[0]?.trim() || ''
  if (firstToken === 'http' || firstToken === 'https') {
    return firstToken
  }

  return null
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().split(':')[0]
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1'
}

function readCookieSecureOverride(): boolean | null {
  const raw = String(process.env.COOKIE_SECURE || '').trim().toLowerCase()
  if (!raw) return null
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return null
}

export function shouldUseSecureCookies(request?: RequestLike | null): boolean {
  const override = readCookieSecureOverride()
  if (override !== null) {
    return override
  }

  if (!request) {
    return env.NODE_ENV === 'production'
  }

  const forwardedProto = normalizeProtocol(request.headers.get('x-forwarded-proto'))
  if (forwardedProto) {
    return forwardedProto === 'https'
  }

  const nextUrlProtocol = normalizeProtocol(request.nextUrl?.protocol)
  if (nextUrlProtocol) {
    return nextUrlProtocol === 'https'
  }

  const originProtocol = normalizeProtocol(request.headers.get('origin'))
  if (originProtocol) {
    return originProtocol === 'https'
  }

  const refererProtocol = normalizeProtocol(request.headers.get('referer'))
  if (refererProtocol) {
    return refererProtocol === 'https'
  }

  const host =
    String(request.headers.get('x-forwarded-host') || '').trim() ||
    String(request.headers.get('host') || '').trim()
  if (host && isLoopbackHost(host)) {
    return false
  }

  return env.NODE_ENV === 'production'
}
