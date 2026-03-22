import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { PERMISSION_MODULES, PERMISSION_MODULE_LABELS, type PermissionModule } from '@/lib/permissions'
import { requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'

const idParamsSchema = z.object({ id: z.string().trim().min(1, 'User ID is required') })

const permissionRowSchema = z
  .object({
    module: z.enum(PERMISSION_MODULES),
    canRead: z.boolean().optional(),
    canWrite: z.boolean().optional()
  })
  .strict()

const permissionUpdateSchema = z
  .object({
    companyId: z.string().trim().min(1).optional().nullable(),
    permissions: z.array(permissionRowSchema)
  })
  .strict()

function buildDefaultPermissionRows() {
  return PERMISSION_MODULES.map((module) => ({
    module,
    label: PERMISSION_MODULE_LABELS[module],
    canRead: false,
    canWrite: false
  }))
}

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

export async function GET(
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

    const user = await prisma.user.findFirst({
      where: {
        id: parsedParams.data.id,
        deletedAt: null
      },
      select: {
        id: true,
        userId: true,
        name: true,
        role: true,
        traderId: true,
        companyId: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (String(user.role || '').toLowerCase().replace(/\s+/g, '_') === 'super_admin') {
      return NextResponse.json(
        { error: 'Super Admin does not use company privilege matrix' },
        { status: 403 }
      )
    }

    const queryCompanyId = new URL(request.url).searchParams.get('companyId')?.trim()
    const companyId = queryCompanyId || user.companyId

    if (!companyId) {
      return NextResponse.json(
        { error: 'User is not assigned to a company. Assign company first.' },
        { status: 400 }
      )
    }

    const rows = await prisma.userPermission.findMany({
      where: {
        userId: user.id,
        companyId
      },
      select: {
        module: true,
        canRead: true,
        canWrite: true
      }
    })

    const map = new Map(rows.map((row) => [row.module, row]))
    const permissions = buildDefaultPermissionRows().map((row) => {
      const current = map.get(row.module)
      return {
        module: row.module,
        label: row.label,
        canRead: current?.canRead || false,
        canWrite: current?.canWrite || false
      }
    })

    return NextResponse.json({
      user,
      companyId,
      permissions
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch user permissions' }, { status: 500 })
  }
}

export async function PUT(
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

    const parsedBody = permissionUpdateSchema.safeParse(await request.json().catch(() => null))
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsedBody.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
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
        companyId: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const targetUser = await prisma.user.findFirst({
      where: {
        id: user.id,
        deletedAt: null
      },
      select: {
        role: true
      }
    })

    if (String(targetUser?.role || '').toLowerCase().replace(/\s+/g, '_') === 'super_admin') {
      return NextResponse.json(
        { error: 'Super Admin does not use company privilege matrix' },
        { status: 403 }
      )
    }

    const companyId = parsedBody.data.companyId?.trim() || user.companyId
    if (!companyId) {
      return NextResponse.json(
        { error: 'Company ID is required to assign privileges' },
        { status: 400 }
      )
    }

    const company = await prisma.company.findFirst({
      where: {
        id: companyId,
        deletedAt: null
      },
      select: {
        id: true,
        traderId: true
      }
    })

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    if (company.traderId && company.traderId !== user.traderId) {
      return NextResponse.json(
        { error: 'Company does not belong to user trader' },
        { status: 400 }
      )
    }

    const normalizedRows = normalizePermissionRows(parsedBody.data.permissions)
    const beforeRows = await prisma.userPermission.findMany({
      where: {
        userId: user.id,
        companyId
      },
      select: {
        module: true,
        canRead: true,
        canWrite: true
      }
    })

    const updatedRows = await prisma.$transaction(async (tx) => {
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

      return tx.userPermission.findMany({
        where: {
          userId: user.id,
          companyId
        },
        select: {
          module: true,
          canRead: true,
          canWrite: true
        },
        orderBy: {
          module: 'asc'
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
        companyId
      },
      before: { permissions: beforeRows },
      after: { permissions: updatedRows },
      requestMeta: getAuditRequestMeta(request),
      notes: 'User privilege matrix updated'
    })

    return NextResponse.json({
      success: true,
      userId: user.id,
      companyId,
      permissions: updatedRows
    })
  } catch {
    return NextResponse.json({ error: 'Failed to update user permissions' }, { status: 500 })
  }
}
