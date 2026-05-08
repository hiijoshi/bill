import type { NextRequest, NextResponse } from 'next/server'

export type SupabaseAppClaims = {
  sub?: string
  iat?: number
  exp?: number
  app_role?: string
  trader_id?: string
  user_db_id?: string
  user_code?: string
  full_name?: string
  default_company_id?: string
  company_ids?: string[]
  [key: string]: unknown
}

export async function getSupabaseClaimsFromRequest(
  request: NextRequest
): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  claims: SupabaseAppClaims
  applyCookies: <T>(response: NextResponse<T>) => NextResponse<T>
} | null> {
  void request
  return null
}

export function hasSupabaseAppContext(
  _claims: SupabaseAppClaims | null
): _claims is SupabaseAppClaims & {
  sub: string
  app_role: string
  trader_id: string
  user_db_id: string
} {
  return false
}
