import type { NextRequest } from 'next/server'

import { getSupabaseClaimsFromRequest, hasSupabaseAppContext, type SupabaseAppClaims } from '@/lib/supabase/auth-bridge'
import { getCompanyCookieName, getCompanyCookieNameCandidates } from '@/lib/session-cookies'
import { env } from '@/lib/config'

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
  claims: SupabaseAppClaims & {
    sub: string
    app_role: string
    trader_id: string
    user_db_id: string
  }
  profile: SupabaseProfileRow
  companies: SupabaseCompanyRow[]
  activeCompany: SupabaseCompanyRow | null
  companyCookieName: string
  cookieCompanyId: string | null
  applyCookies: <T>(response: import('next/server').NextResponse<T>) => import('next/server').NextResponse<T>
}

function normalizeCompanyId(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getScopeSource(request: NextRequest): string {
  return request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
}

function resolveCookieCompanyId(request: NextRequest): string | null {
  const scopeSource = getScopeSource(request)
  return (
    getCompanyCookieNameCandidates(scopeSource)
      .map((cookieName) => normalizeCompanyId(request.cookies.get(cookieName)?.value))
      .find((value): value is string => Boolean(value)) || null
  )
}

async function loadScopedCompanies(params: {
  request: NextRequest
  claims: ResolvedSupabaseAppSession['claims']
  profile: SupabaseProfileRow
  requestedCompanyId?: string | null
}) {
  const supabaseContext = await getSupabaseClaimsFromRequest(params.request)
  if (!supabaseContext || !hasSupabaseAppContext(supabaseContext.claims)) {
    return { companies: [] as SupabaseCompanyRow[], applyCookies: null as ResolvedSupabaseAppSession['applyCookies'] | null }
  }

  const requestedCompanyId = normalizeCompanyId(params.requestedCompanyId)
  const role = params.claims.app_role

  if (role === 'super_admin' || role === 'trader_admin') {
    let query = supabaseContext.supabase
      .from('Company')
      .select('id, name, locked, traderId')
      .is('deletedAt', null)
      .order('name', { ascending: true })

    if (requestedCompanyId) {
      query = query.eq('id', requestedCompanyId)
    }

    const { data, error } = await query
    if (error) {
      throw new Error(`Failed to load companies: ${error.message}`)
    }

    return {
      companies: (data ?? []) as SupabaseCompanyRow[],
      applyCookies: supabaseContext.applyCookies
    }
  }

  const { data: accessRows, error: accessError } = await supabaseContext.supabase
    .from('profile_company_access')
    .select('company_id')
    .eq('profile_id', params.profile.id)
    .eq('is_active', true)

  if (accessError) {
    throw new Error(`Failed to load company access: ${accessError.message}`)
  }

  const companyIds = Array.from(
    new Set(
      [
        params.profile.default_company_id,
        params.claims.default_company_id,
        ...(Array.isArray(params.claims.company_ids) ? params.claims.company_ids : []),
        ...((accessRows ?? []).map((row) => normalizeCompanyId(String(row.company_id))).filter(Boolean) as string[])
      ].filter((value): value is string => Boolean(value))
    )
  )

  if (companyIds.length === 0) {
    return {
      companies: [],
      applyCookies: supabaseContext.applyCookies
    }
  }

  const scopedIds = requestedCompanyId ? companyIds.filter((id) => id === requestedCompanyId) : companyIds
  if (scopedIds.length === 0) {
    return {
      companies: [],
      applyCookies: supabaseContext.applyCookies
    }
  }

  const query = supabaseContext.supabase
    .from('Company')
    .select('id, name, locked, traderId')
    .in('id', scopedIds)
    .is('deletedAt', null)
    .order('name', { ascending: true })

  const { data, error } = await query
  if (error) {
    throw new Error(`Failed to load scoped companies: ${error.message}`)
  }

  return {
    companies: (data ?? []) as SupabaseCompanyRow[],
    applyCookies: supabaseContext.applyCookies
  }
}

function chooseActiveCompany(params: {
  companies: SupabaseCompanyRow[]
  requestedCompanyId?: string | null
  cookieCompanyId?: string | null
  defaultCompanyId?: string | null
}) {
  const requestedCompanyId = normalizeCompanyId(params.requestedCompanyId)
  const cookieCompanyId = normalizeCompanyId(params.cookieCompanyId)
  const defaultCompanyId = normalizeCompanyId(params.defaultCompanyId)
  const unlockedCompanies = params.companies.filter((row) => !row.locked)

  return (
    (requestedCompanyId ? unlockedCompanies.find((row) => row.id === requestedCompanyId) : null) ||
    (cookieCompanyId ? unlockedCompanies.find((row) => row.id === cookieCompanyId) : null) ||
    (defaultCompanyId ? unlockedCompanies.find((row) => row.id === defaultCompanyId) : null) ||
    unlockedCompanies[0] ||
    params.companies[0] ||
    null
  )
}

export async function resolveSupabaseAppSession(
  request: NextRequest,
  requestedCompanyId?: string | null
): Promise<ResolvedSupabaseAppSession | null> {
  const supabaseContext = await getSupabaseClaimsFromRequest(request)
  if (!supabaseContext || !hasSupabaseAppContext(supabaseContext.claims)) {
    return null
  }

  const { data: profile, error } = await supabaseContext.supabase
    .from('profiles')
    .select('id, legacy_user_id, trader_id, user_code, full_name, app_role, login_email, default_company_id, is_active')
    .eq('id', supabaseContext.claims.sub)
    .maybeSingle()

  if (error || !profile || profile.is_active !== true) {
    return null
  }

  const scoped = await loadScopedCompanies({
    request,
    claims: supabaseContext.claims,
    profile: profile as SupabaseProfileRow,
    requestedCompanyId
  })

  const cookieCompanyId = resolveCookieCompanyId(request)
  const activeCompany = chooseActiveCompany({
    companies: scoped.companies,
    requestedCompanyId,
    cookieCompanyId,
    defaultCompanyId: profile.default_company_id || supabaseContext.claims.default_company_id
  })

  return {
    claims: supabaseContext.claims,
    profile: profile as SupabaseProfileRow,
    companies: scoped.companies,
    activeCompany,
    companyCookieName: getCompanyCookieName(getScopeSource(request)),
    cookieCompanyId,
    applyCookies: scoped.applyCookies || supabaseContext.applyCookies
  }
}

export function getAppCompanyCookieOptions() {
  return {
    httpOnly: true as const,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    priority: 'high' as const
  }
}
