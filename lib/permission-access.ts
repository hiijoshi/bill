import type { PermissionAccessRow } from '@/lib/app-default-route'
import type { AppRole } from '@/lib/api-security'
import { PERMISSION_MODULES } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'

export type PermissionAccessPayload = {
  permissions: PermissionAccessRow[]
  grantedReadModules: number
  grantedWriteModules: number
}

function buildDefaultRows(): PermissionAccessRow[] {
  return PERMISSION_MODULES.map((module) => ({
    module,
    canRead: false,
    canWrite: false
  }))
}

function buildFullAccessRows(): PermissionAccessRow[] {
  return PERMISSION_MODULES.map((module) => ({
    module,
    canRead: true,
    canWrite: true
  }))
}

function summarize(rows: PermissionAccessRow[]): PermissionAccessPayload {
  return {
    permissions: rows,
    grantedReadModules: rows.filter((row) => row.canRead || row.canWrite).length,
    grantedWriteModules: rows.filter((row) => row.canWrite).length
  }
}

export async function loadPermissionAccessForCompany(params: {
  role: AppRole
  userDbId?: string | null
  companyId: string
}): Promise<PermissionAccessPayload> {
  const normalizedCompanyId = String(params.companyId || '').trim()
  if (!normalizedCompanyId) {
    return summarize([])
  }

  if (params.role === 'super_admin' || params.role === 'trader_admin' || params.role === 'company_admin') {
    return summarize(buildFullAccessRows())
  }

  if (!params.userDbId) {
    return summarize(buildDefaultRows())
  }

  const rows = await prisma.userPermission.findMany({
    where: {
      userId: params.userDbId,
      companyId: normalizedCompanyId
    },
    select: {
      module: true,
      canRead: true,
      canWrite: true
    }
  })

  const rowMap = new Map(rows.map((row) => [row.module, row]))
  const permissions = buildDefaultRows().map((row) => {
    const current = rowMap.get(String(row.module || ''))
    return {
      module: row.module,
      canRead: current?.canRead || false,
      canWrite: current?.canWrite || false
    }
  })

  return summarize(permissions)
}
