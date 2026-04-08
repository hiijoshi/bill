import type { NextRequest, NextResponse } from 'next/server'
import { generateRefreshToken, generateToken, normalizeRole } from '@/lib/auth'
import { env } from '@/lib/config'
import { shouldUseSecureCookies } from '@/lib/request-cookie-security'
import { setSession } from '@/lib/session'
import type { SessionNamespace } from '@/lib/session-cookies'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { createSupabaseRouteClient } from '@/lib/supabase/route'
import { ensureSupabaseIdentityForLegacyUser, loadLegacyUserForSupabaseSync } from '@/lib/supabase/legacy-user-sync'

const SUPER_ADMIN_ACCESS_EXPIRES_IN: Parameters<typeof generateToken>[1] =
  (env.SUPER_ADMIN_ACCESS_EXPIRES_IN || '30m') as Parameters<typeof generateToken>[1]
const SUPER_ADMIN_REFRESH_EXPIRES_IN: Parameters<typeof generateRefreshToken>[1] =
  (env.SUPER_ADMIN_REFRESH_EXPIRES_IN || '8h') as Parameters<typeof generateRefreshToken>[1]

export async function refreshUserSessionAfterMutation(params: {
  request: NextRequest
  response: NextResponse
  namespace: SessionNamespace
  user: {
    id: string
    userId: string
    traderId: string
    name?: string | null
    role?: string | null
  }
  password?: string | null
}) {
  let response = params.response
  let warning: string | null = null

  if (isSupabaseConfigured()) {
    const routeClient = createSupabaseRouteClient(params.request)
    if (routeClient) {
      const refreshed = await routeClient.supabase.auth.refreshSession()

      if (refreshed.error && params.password && params.password.trim().length > 0) {
        const legacyUser = await loadLegacyUserForSupabaseSync(params.user.id)
        if (legacyUser) {
          const identity = await ensureSupabaseIdentityForLegacyUser({
            legacyUser,
            password: params.password
          })
          const signInResult = await routeClient.supabase.auth.signInWithPassword({
            email: identity.loginEmail,
            password: params.password
          })
          if (signInResult.error) {
            warning = `Failed to refresh cloud session: ${signInResult.error.message}`
          }
        } else {
          warning = 'Failed to refresh cloud session: legacy user is locked or inactive'
        }
      } else if (refreshed.error) {
        warning = `Failed to refresh cloud session: ${refreshed.error.message}`
      }

      response = routeClient.applyCookies(response)
    }
  }

  const scopeSource =
    params.request.headers.get('x-forwarded-host') ||
    params.request.headers.get('host') ||
    params.request.nextUrl.host

  const tokenPayload = {
    userId: params.user.userId,
    traderId: params.user.traderId,
    name: params.user.name || undefined,
    role: normalizeRole(params.user.role) || undefined,
    userDbId: params.user.id
  }
  const accessToken =
    params.namespace === 'super_admin'
      ? generateToken(tokenPayload, SUPER_ADMIN_ACCESS_EXPIRES_IN)
      : generateToken(tokenPayload)
  const refreshToken =
    params.namespace === 'super_admin'
      ? generateRefreshToken(tokenPayload, SUPER_ADMIN_REFRESH_EXPIRES_IN)
      : generateRefreshToken(tokenPayload)

  await setSession(
    accessToken,
    refreshToken,
    response,
    params.namespace,
    scopeSource,
    shouldUseSecureCookies(params.request)
  )

  return {
    response,
    warning
  }
}
