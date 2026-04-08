import 'server-only'

import { normalizeAppRole, type RequestAuthContext } from '@/lib/api-security'
import { resolveFirstAccessibleAppRoute } from '@/lib/app-default-route'
import { loadPermissionAccessForCompany } from '@/lib/permission-access'
import { resolveServerAuth } from '@/lib/server-auth'
import { resolveServerAccessibleCompanies } from '@/lib/server-app-shell'

export async function resolveServerDefaultAppRoute(requestedCompanyId?: string | null): Promise<string | null> {
  const resolved = await resolveServerAuth({ namespace: 'app' })
  if (!resolved) {
    return null
  }
  const user = resolved.user

  const auth: RequestAuthContext = {
    userId: user.userId,
    traderId: user.traderId,
    role: normalizeAppRole(user.role || resolved.auth.role),
    companyId: user.companyId,
    userDbId: user.id
  }

  const { activeCompany } = await resolveServerAccessibleCompanies({
    auth,
    requestedCompanyId,
    assignedCompanyId: user.companyId
  })

  if (!activeCompany || activeCompany.locked) {
    return '/main/profile'
  }

  const permissions = (await loadPermissionAccessForCompany({
    role: auth.role,
    userDbId: user.id,
    companyId: activeCompany.id
  })).permissions

  return resolveFirstAccessibleAppRoute(permissions, activeCompany.id)
}
