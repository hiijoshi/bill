import { NextRequest, NextResponse } from 'next/server'
import { ensureCompanyAccess, parseBooleanParam, requireAuthContext } from '@/lib/api-security'
import { loadPermissionAccessForCompany } from '@/lib/permission-access'

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

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (!auth.userDbId) {
      return NextResponse.json({ error: 'Invalid session user' }, { status: 401 })
    }

    const access = await loadPermissionAccessForCompany({
      role: auth.role,
      userDbId: auth.userDbId,
      companyId
    })

    return NextResponse.json({
      companyId,
      permissions: access.permissions,
      ...(includeMeta
        ? {
            grantedReadModules: access.grantedReadModules,
            grantedWriteModules: access.grantedWriteModules
          }
        : {})
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 })
  }
}
