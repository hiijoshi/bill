import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseRouteClient } from '@/lib/supabase/route'

export type SupabaseAppClaims = {
  sub?: string
  app_role?: string
  trader_id?: string
  user_db_id?: string
  user_code?: string
  full_name?: string
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

  const { data: userData, error } = await supabase.auth.getUser()

  if (error || !userData?.user) {
    return null
  }

  const userMetadata = userData.user.user_metadata ?? {}
  const appMetadata = userData.user.app_metadata ?? {}
  const metadataClaims: SupabaseAppClaims = {
    sub: userData.user.id,
    app_role:
      (typeof userMetadata.app_role === 'string' && userMetadata.app_role) ||
      (typeof appMetadata.app_role === 'string' && appMetadata.app_role) ||
      undefined,
    trader_id:
      (typeof userMetadata.trader_id === 'string' && userMetadata.trader_id) ||
      (typeof appMetadata.trader_id === 'string' && appMetadata.trader_id) ||
      undefined,
    user_db_id:
      (typeof userMetadata.user_db_id === 'string' && userMetadata.user_db_id) ||
      (typeof userMetadata.legacy_user_id === 'string' && userMetadata.legacy_user_id) ||
      (typeof appMetadata.user_db_id === 'string' && appMetadata.user_db_id) ||
      undefined,
    user_code:
      (typeof userMetadata.user_code === 'string' && userMetadata.user_code) ||
      (typeof appMetadata.user_code === 'string' && appMetadata.user_code) ||
      undefined,
    full_name:
      (typeof userMetadata.full_name === 'string' && userMetadata.full_name) ||
      (typeof appMetadata.full_name === 'string' && appMetadata.full_name) ||
      undefined,
    default_company_id:
      (typeof userMetadata.default_company_id === 'string' && userMetadata.default_company_id) ||
      (typeof appMetadata.default_company_id === 'string' && appMetadata.default_company_id) ||
      undefined,
    company_ids:
      Array.isArray(userMetadata.company_ids)
        ? (userMetadata.company_ids as string[])
        : Array.isArray(appMetadata.company_ids)
          ? (appMetadata.company_ids as string[])
          : undefined
  }

  const needsJwtFallback =
    !metadataClaims.app_role ||
    !metadataClaims.trader_id ||
    !metadataClaims.user_db_id ||
    !metadataClaims.default_company_id

  let jwtClaims: SupabaseAppClaims = {}
  if (needsJwtFallback) {
    const { data: sessionData } = await supabase.auth.getSession()
    const session = sessionData?.session

    if (session?.access_token) {
      try {
        const parts = session.access_token.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
          jwtClaims = payload as SupabaseAppClaims
        }
      } catch {
        // ignore parse errors and fall back to user/app metadata
      }
    }
  }

  const claims: SupabaseAppClaims = {
    sub: userData.user.id,
    ...jwtClaims,
    app_role: jwtClaims.app_role || metadataClaims.app_role,
    trader_id: jwtClaims.trader_id || metadataClaims.trader_id,
    user_db_id: jwtClaims.user_db_id || metadataClaims.user_db_id,
    user_code: jwtClaims.user_code || metadataClaims.user_code,
    full_name: jwtClaims.full_name || metadataClaims.full_name,
    default_company_id: jwtClaims.default_company_id || metadataClaims.default_company_id,
    company_ids:
      (Array.isArray(jwtClaims.company_ids) ? jwtClaims.company_ids : null) ||
      metadataClaims.company_ids
  }

  if (!claims.sub) {
    return null
  }

  return {
    supabase,
    claims,
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
