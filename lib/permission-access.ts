import type { PermissionAccessRow } from '@/lib/app-default-route'
import type { AppRole } from '@/lib/api-security'
import { PERMISSION_MODULES, type PermissionModule } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { getCompanySubscriptionAccess, isModuleEnabledForEntitlement } from '@/lib/subscription-core'
import { getTraderDataLifecycleSummary } from '@/lib/trader-retention'

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

function applySubscriptionOverlay(rows: PermissionAccessRow[], companyId: string, role: AppRole) {
  return async () => {
    const subscriptionAccess = await getCompanySubscriptionAccess(prisma, companyId)
    if (!subscriptionAccess || role === 'super_admin') {
      return rows
    }

    const dataLifecycle = await getTraderDataLifecycleSummary(prisma, subscriptionAccess.traderId, new Date(), {
      entitlement: subscriptionAccess.entitlement
    })

    return rows.map((row) => {
      const module = row.module as PermissionModule | undefined
      if (!module) return row

      const canRead =
        Boolean(row.canRead) &&
        isModuleEnabledForEntitlement(subscriptionAccess.entitlement, module, 'read') &&
        (dataLifecycle ? dataLifecycle.allowReadOperations : true)
      const canWrite =
        Boolean(row.canWrite) &&
        isModuleEnabledForEntitlement(subscriptionAccess.entitlement, module, 'write') &&
        (dataLifecycle ? dataLifecycle.allowWriteOperations : true)

      return {
        module,
        canRead,
        canWrite
      }
    })
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
    const permissions = await applySubscriptionOverlay(buildFullAccessRows(), normalizedCompanyId, params.role)()
    return summarize(permissions)
  }

  if (!params.userDbId) {
    const permissions = await applySubscriptionOverlay(buildDefaultRows(), normalizedCompanyId, params.role)()
    return summarize(permissions)
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

  const withSubscription = await applySubscriptionOverlay(permissions, normalizedCompanyId, params.role)()
  return summarize(withSubscription)
}
