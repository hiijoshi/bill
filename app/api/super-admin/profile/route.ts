import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  type RequestAuthContext,
} from '@/lib/api-security'
import { invalidateAuthGuardStateForUser } from '@/lib/auth-guard-state'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { refreshUserSessionAfterMutation } from '@/lib/session-refresh'
import { loadSelfUser, toSelfProfile, updateSelfProfile } from '@/lib/self-profile'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { syncSupabaseForLegacyUserMutationWithTimeout } from '@/lib/supabase/legacy-user-sync'
import { resolveServerAuth } from '@/lib/server-auth'

const profileUpdateSchema = z
  .object({
    name: z.string().trim().max(100).optional().nullable(),
    currentPassword: z.string().min(1, 'Current password is required').optional(),
    newPassword: z.string().min(6, 'New password must be at least 6 characters').optional()
  })
  .strict()
  .refine((value) => value.name !== undefined || value.newPassword !== undefined, {
    message: 'No changes submitted'
  })
  .refine((value) => (value.newPassword ? Boolean(value.currentPassword) : true), {
    message: 'Current password is required to change password',
    path: ['currentPassword']
  })

async function resolveSuperAdminProfileAuthContext(request: NextRequest) {
  void request
  const resolved = await resolveServerAuth({ namespace: 'super_admin', allowedRoles: ['super_admin'] })
  if (!resolved) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
  }

  return { ok: true as const, auth: resolved.auth as RequestAuthContext }
}

export async function GET(request: NextRequest) {
  const authResult = await resolveSuperAdminProfileAuthContext(request)
  if (!authResult.ok) return authResult.response

  const user = await loadSelfUser(authResult.auth)
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  return NextResponse.json({
    user: toSelfProfile(user)
  })
}

export async function PATCH(request: NextRequest) {
  const authResult = await resolveSuperAdminProfileAuthContext(request)
  if (!authResult.ok) return authResult.response

  const parsed = profileUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Validation failed',
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      },
      { status: 400 }
    )
  }

  const updated = await updateSelfProfile({
    auth: authResult.auth,
    name: parsed.data.name,
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword
  })

  if (!updated.ok) {
    return NextResponse.json({ error: updated.error }, { status: updated.status })
  }

  await writeAuditLog({
    actor: {
      id: authResult.auth.userDbId || authResult.auth.userId,
      role: authResult.auth.role
    },
    action: 'UPDATE',
    resourceType: 'USER',
    resourceId: updated.after.id,
    scope: {
      traderId: updated.after.traderId,
      companyId: updated.after.companyId
    },
    before: updated.before,
    after: updated.after,
    requestMeta: getAuditRequestMeta(request),
    notes: parsed.data.newPassword ? 'Super Admin self-service password change' : 'Super Admin profile update'
  })

  invalidateAuthGuardStateForUser({
    id: updated.after.id,
    traderId: updated.after.traderId,
    userId: updated.after.userId
  })

  let cloudSyncWarning: string | null = null
  if (isSupabaseConfigured()) {
    const syncResult = await syncSupabaseForLegacyUserMutationWithTimeout({
      legacyUserId: updated.after.id,
      password: parsed.data.newPassword || null
    })
    if (!syncResult.synced && syncResult.reason) {
      cloudSyncWarning = syncResult.reason
    }
  }

  let response: NextResponse = NextResponse.json({
    success: true,
    user: updated.after,
    ...(cloudSyncWarning ? { cloudSyncWarning } : {})
  })
  const refreshedSession = await refreshUserSessionAfterMutation({
    request,
    response,
    namespace: 'super_admin',
    user: {
      id: updated.after.id,
      userId: updated.after.userId,
      traderId: updated.after.traderId,
      name: updated.after.name,
      role: updated.after.role
    },
    password: parsed.data.newPassword || null
  })
  response = refreshedSession.response

  return response
}
