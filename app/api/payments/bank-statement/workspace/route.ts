import { NextRequest, NextResponse } from 'next/server'

import { ensureCompanyAccess, requireRoles } from '@/lib/api-security'
import { loadBankStatementWorkspace } from '@/lib/server-bank-statement-workspace'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const companyId = new URL(request.url).searchParams.get('companyId')?.trim() || ''
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const payload = await loadBankStatementWorkspace(companyId)
    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    )
  }
}
