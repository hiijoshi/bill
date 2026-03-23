import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PERMISSION_MODULES, type PermissionModule } from '@/lib/permissions'
import { ensureCompanyAccess, parseBooleanParam, requireAuthContext } from '@/lib/api-security'

type PermissionRow = {
  module: PermissionModule
  canRead: boolean
  canWrite: boolean
}

// Builds default rows from the compile-time constant enum — no user input involved (not CWE-94)
function buildDefaultRows(): PermissionRow[] {
  return PERMISSION_MODULES.map((module) => ({
    module,
    canRead: false,
    canWrite: false
  }))
}

export async function GET(request: NextRequest) {
  const authResult = requireAuthContext(request)
  if (!authResult.ok) {
    return authResult.response
  }

  try {
    const auth = authResult.auth
    const searchParams = new URL(request.url).searchParams
    const queryCompanyId = searchParams.get('companyId')?.trim() || null
    const includeMeta = parseBooleanParam(searchParams.get('includeMeta'))

    const companyId = queryCompanyId || auth.companyId

    if (auth.role === 'super_admin') {
      const rows = PERMISSION_MODULES.map((module) => ({
        module,
        canRead: true,
        canWrite: true
      }))

      return NextResponse.json({
        companyId,
        permissions: rows,
        ...(includeMeta
          ? {
              grantedReadModules: rows.length,
              grantedWriteModules: rows.length
            }
          : {})
      })
    }

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (!auth.userDbId) {
      return NextResponse.json({ error: 'Invalid session user' }, { status: 401 })
    }

    const rows = await prisma.userPermission.findMany({
      where: {
        userId: auth.userDbId,
        companyId
      },
      select: {
        module: true,
        canRead: true,
        canWrite: true
      }
    })

    const map = new Map(rows.map((row) => [row.module, row]))
    const permissions = buildDefaultRows().map((row) => {
      const current = map.get(row.module)
      return {
        module: row.module,
        canRead: current?.canRead || false,
        canWrite: current?.canWrite || false
      }
    })

    const grantedReadModules = permissions.filter((row) => row.canRead || row.canWrite).length
    const grantedWriteModules = permissions.filter((row) => row.canWrite).length

    return NextResponse.json({
      companyId,
      permissions,
      ...(includeMeta
        ? {
            grantedReadModules,
            grantedWriteModules
          }
        : {})
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 })
  }
}
