import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { normalizeAppRole, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { normalizePrismaApiError } from '@/lib/prisma-errors'

const idParamsSchema = z.object({ id: z.string().trim().min(1, 'User ID is required') })
const lockSchema = z.object({ locked: z.boolean() }).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const parsedBody = lockSchema.safeParse(await request.json().catch(() => null))
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
    }

    const userId = parsedParams.data.id
    const existing = await prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null
      }
    })

    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const isCurrentSessionUser =
      (authResult.auth.userDbId && existing.id === authResult.auth.userDbId) ||
      (existing.userId === authResult.auth.userId && existing.traderId === authResult.auth.traderId)

    if (parsedBody.data.locked && isCurrentSessionUser) {
      return NextResponse.json({ error: 'Cannot lock current session user' }, { status: 403 })
    }

    if (parsedBody.data.locked && normalizeAppRole(existing.role) === 'super_admin') {
      return NextResponse.json({ error: 'Cannot lock super admin users' }, { status: 403 })
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        locked: parsedBody.data.locked
      }
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: parsedBody.data.locked ? 'LOCK' : 'UNLOCK',
      resourceType: 'USER',
      resourceId: userId,
      scope: {
        traderId: updated.traderId,
        companyId: updated.companyId
      },
      before: {
        ...existing,
        password: undefined
      },
      after: {
        ...updated,
        password: undefined
      },
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        traderId: updated.traderId,
        companyId: updated.companyId,
        userId: updated.userId,
        name: updated.name,
        role: updated.role,
        locked: updated.locked,
        active: !updated.locked
      }
    })
  } catch (error) {
    const apiError = normalizePrismaApiError(error, 'Failed to update lock state')
    return NextResponse.json({ error: apiError.message }, { status: apiError.status })
  }
}
