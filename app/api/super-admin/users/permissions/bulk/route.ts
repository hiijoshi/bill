import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireRoles } from '@/lib/api-security'
import { PERMISSION_MODULES, type PermissionModule } from '@/lib/permissions'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'

const permissionRowSchema = z
  .object({
    module: z.enum(PERMISSION_MODULES),
    canRead: z.boolean().optional(),
    canWrite: z.boolean().optional()
  })
  .strict()

const bulkUpdateSchema = z
  .object({
    scopeType: z.enum(['company', 'trader']),
    scopeId: z.string().trim().min(1),
    permissions: z.array(permissionRowSchema),
    excludeUserId: z.string().trim().optional(),
    onlyRoles: z.array(z.string().trim()).optional()
  })
  .strict()

function normalizePermissionRows(input: z.infer<typeof permissionRowSchema>[]) {
  const matrix = new Map<PermissionModule, { canRead: boolean; canWrite: boolean }>()
  for (const moduleName of PERMISSION_MODULES) {
    matrix.set(moduleName, { canRead: false, canWrite: false })
  }

  for (const row of input) {
    const canWrite = row.canWrite === true
    const canRead = row.canRead === true || canWrite
    matrix.set(row.module, { canRead, canWrite })
  }

  return PERMISSION_MODULES.map((moduleName) => {
    const record = matrix.get(moduleName) || { canRead: false, canWrite: false }
    return {
      module: moduleName,
      canRead: record.canRead,
      canWrite: record.canWrite
    }
  })
}

export async function PUT(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsed = bulkUpdateSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const normalizedRows = normalizePermissionRows(parsed.data.permissions)
    const scopeId = parsed.data.scopeId.trim()
    const onlyRoles = parsed.data.onlyRoles?.map((role) => role.trim().toLowerCase()).filter(Boolean) || []

    const userWhere =
      parsed.data.scopeType === 'company'
        ? {
            companyId: scopeId,
            deletedAt: null
          }
        : {
            traderId: scopeId,
            deletedAt: null
          }

    const targetUsers = await prisma.user.findMany({
      where: {
        ...userWhere,
        ...(parsed.data.excludeUserId ? { id: { not: parsed.data.excludeUserId.trim() } } : {}),
        ...(onlyRoles.length > 0 ? { role: { in: onlyRoles } } : {})
      },
      select: {
        id: true,
        userId: true,
        traderId: true,
        companyId: true,
        role: true
      }
    })

    const eligibleUsers = targetUsers.filter((user) => !!user.companyId)

    await prisma.$transaction(async (tx) => {
      for (const user of eligibleUsers) {
        const companyId = user.companyId as string
        await tx.userPermission.deleteMany({
          where: {
            userId: user.id,
            companyId
          }
        })

        for (const row of normalizedRows) {
          await tx.userPermission.create({
            data: {
              userId: user.id,
              companyId,
              module: row.module,
              canRead: row.canRead,
              canWrite: row.canWrite
            }
          })
        }
      }
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: 'UPDATE',
      resourceType: 'USER',
      resourceId: scopeId,
      scope:
        parsed.data.scopeType === 'company'
          ? { companyId: scopeId }
          : { traderId: scopeId },
      before: null,
      after: {
        scopeType: parsed.data.scopeType,
        updatedUsers: eligibleUsers.map((user) => ({
          id: user.id,
          userId: user.userId,
          companyId: user.companyId,
          role: user.role
        })),
        permissions: normalizedRows
      },
      requestMeta: getAuditRequestMeta(request),
      notes: 'Bulk privilege matrix apply'
    })

    return NextResponse.json({
      success: true,
      scopeType: parsed.data.scopeType,
      scopeId,
      updatedUsers: eligibleUsers.length,
      skippedUsersWithoutCompany: targetUsers.length - eligibleUsers.length
    })
  } catch {
    return NextResponse.json({ error: 'Failed to apply bulk permissions' }, { status: 500 })
  }
}
