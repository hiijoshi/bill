import type { NextRequest, NextResponse } from 'next/server'

import { shouldUseSecureCookies } from '@/lib/request-cookie-security'

export type SupabaseProfileRow = {
  id: string
  legacy_user_id: string | null
  trader_id: string
  user_code: string
  full_name: string | null
  app_role: string
  login_email: string
  default_company_id: string | null
  is_active: boolean
}

export type SupabaseCompanyRow = {
  id: string
  name: string
  locked: boolean
  traderId: string | null
}

export type ResolvedSupabaseAppSession = {
  claims: {
    sub: string
    app_role: string
    trader_id: string
    user_db_id: string
    [key: string]: unknown
  }
  profile: SupabaseProfileRow
  companies: SupabaseCompanyRow[]
  activeCompany: SupabaseCompanyRow | null
  companyCookieName: string
  cookieCompanyId: string | null
  applyCookies: <T>(response: NextResponse<T>) => NextResponse<T>
}

export async function resolveSupabaseAppSession(
  request: NextRequest,
  requestedCompanyId?: string | null
): Promise<ResolvedSupabaseAppSession | null> {
  void request
  void requestedCompanyId
  return null
}

export function getAppCompanyCookieOptions(request?: Pick<NextRequest, 'headers' | 'nextUrl'> | null) {
  return {
    httpOnly: true as const,
    secure: shouldUseSecureCookies(request),
    sameSite: 'strict' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 365
  }
}
