import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import {
  type RequestAuthContext,
  getRequestAuthContext,
  normalizeAppRole,
} from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { loadSelfUser, toSelfProfile, updateSelfProfile } from '@/lib/self-profile'

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
  const headerAuth = getRequestAuthContext(request)
  if (headerAuth?.role === 'super_admin') {
    return { ok: true as const, auth: headerAuth }
  }

  const session = await getSession('super_admin')
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
  }

  const user = await prisma.user.findFirst({
    where: {
      userId: session.userId,
      traderId: session.traderId,
      deletedAt: null
    },
    select: {
      id: true,
      userId: true,
      traderId: true,
      role: true,
      companyId: true
    }
  })

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
  }

  const auth: RequestAuthContext = {
    userId: user.userId,
    traderId: user.traderId,
    role: normalizeAppRole(user.role || session.role),
    companyId: user.companyId || null,
    userDbId: user.id
  }

  if (auth.role !== 'super_admin') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Insufficient privileges' }, { status: 403 })
    }
  }

  return { ok: true as const, auth }
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

  return NextResponse.json({
    success: true,
    user: updated.after
  })
}
