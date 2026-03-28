import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireRoles, normalizeAppRole } from '@/lib/api-security'
import { invalidateAuthGuardStateForUser } from '@/lib/auth-guard-state'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { syncSupabaseForLegacyUserMutationWithTimeout } from '@/lib/supabase/legacy-user-sync'
import { getLinkedCompaniesForUser } from '@/lib/super-admin-user-companies'

const paramsSchema = z.object({
  id: z.string().trim().min(1, 'User ID is required')
})

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = paramsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const companyId = new URL(request.url).searchParams.get('companyId')?.trim() || ''
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const user = await prisma.user.findFirst({
      where: {
        id: parsedParams.data.id,
        deletedAt: null
      },
      select: {
        id: true,
        userId: true,
        traderId: true,
        companyId: true,
        role: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (normalizeAppRole(user.role) === 'super_admin') {
      return NextResponse.json({ error: 'Cannot remove company access from super admin users' }, { status: 403 })
    }

    const linkedCompanies = await getLinkedCompaniesForUser(prisma, {
      userId: user.id,
      traderId: user.traderId,
      primaryCompanyId: user.companyId
    })

    if (!linkedCompanies.some((company) => company.id === companyId)) {
      return NextResponse.json({ error: 'Company is not linked to this user' }, { status: 404 })
    }

    if (linkedCompanies.length <= 1) {
      return NextResponse.json(
        { error: 'User must keep at least one company. Delete the user if you want to remove all access.' },
        { status: 400 }
      )
    }

    const remainingCompanies = linkedCompanies.filter((company) => company.id !== companyId)
    const nextPrimaryCompanyId =
      user.companyId === companyId ? remainingCompanies[0]?.id || null : user.companyId || remainingCompanies[0]?.id || null

    const before = {
      primaryCompanyId: user.companyId,
      linkedCompanyIds: linkedCompanies.map((company) => company.id),
      removedCompanyId: companyId
    }

    await prisma.$transaction(async (tx) => {
      await tx.userPermission.deleteMany({
        where: {
          userId: user.id,
          companyId
        }
      })

      await tx.user.update({
        where: { id: user.id },
        data: {
          companyId: nextPrimaryCompanyId
        }
      })
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: 'UPDATE',
      resourceType: 'USER',
      resourceId: user.id,
      scope: {
        traderId: user.traderId,
        companyId: nextPrimaryCompanyId || undefined
      },
      before,
      after: {
        primaryCompanyId: nextPrimaryCompanyId,
        linkedCompanyIds: remainingCompanies.map((company) => company.id),
        removedCompanyId: companyId
      },
      requestMeta: getAuditRequestMeta(request),
      notes: 'Removed linked company from user'
    })

    let cloudSyncWarning: string | null = null
    if (isSupabaseConfigured()) {
      try {
        const syncResult = await syncSupabaseForLegacyUserMutationWithTimeout({
          legacyUserId: user.id,
          password: null
        })
        if (!syncResult.synced && syncResult.reason) {
          cloudSyncWarning = syncResult.reason
        }
      } catch (syncErr) {
        cloudSyncWarning = syncErr instanceof Error ? syncErr.message : 'Cloud sync failed'
      }
    }

    invalidateAuthGuardStateForUser({
      id: user.id,
      traderId: user.traderId,
      userId: user.userId
    })

    return NextResponse.json({
      success: true,
      userId: user.id,
      removedCompanyId: companyId,
      primaryCompanyId: nextPrimaryCompanyId,
      linkedCompanyIds: remainingCompanies.map((company) => company.id),
      ...(cloudSyncWarning ? { cloudSyncWarning } : {})
    })
  } catch (error) {
    console.error('DELETE /api/super-admin/users/[id]/companies failed', error)
    return NextResponse.json({ error: 'Failed to remove company access' }, { status: 500 })
  }
}
