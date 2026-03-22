import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseRouteClient } from '@/lib/supabase/route'

export type SupabaseAppClaims = {
  sub?: string
  app_role?: string
  trader_id?: string
  user_db_id?: string
  default_company_id?: string
  company_ids?: string[]
  [key: string]: unknown
}

export async function getSupabaseClaimsFromRequest(request: NextRequest): Promise<{
  supabase: NonNullable<ReturnType<typeof createSupabaseRouteClient>>['supabase']
  claims: SupabaseAppClaims
  applyCookies: <T>(response: NextResponse<T>) => NextResponse<T>
} | null> {
  const routeClient = createSupabaseRouteClient(request)
  if (!routeClient) {
    return null
  }

  const { supabase, applyCookies } = routeClient
  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims) {
    return null
  }

  return {
    supabase,
    claims: data.claims as SupabaseAppClaims,
    applyCookies
  }
}

export function hasSupabaseAppContext(claims: SupabaseAppClaims | null): claims is SupabaseAppClaims & {
  sub: string
  app_role: string
  trader_id: string
  user_db_id: string
} {
  return Boolean(
    claims?.sub &&
      typeof claims.app_role === 'string' &&
      typeof claims.trader_id === 'string' &&
      typeof claims.user_db_id === 'string'
  )
}
