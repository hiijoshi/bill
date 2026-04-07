import { NextRequest, NextResponse } from 'next/server'
import { canAccessCompanyRoute, requireRoles } from '@/lib/api-security'
import { getFinancialYearDateFilter } from '@/lib/financial-years'
import { loadStockWorkspaceData } from '@/lib/server-stock-workspace'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const companyId = searchParams.get('companyId')?.trim() || ''

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const allowed = await canAccessCompanyRoute(request, companyId, '/api/stock-ledger', 'GET')
    if (!allowed) {
      return NextResponse.json({ error: 'Company access denied' }, { status: 403 })
    }

    const financialYearFilter = await getFinancialYearDateFilter({
      request,
      auth: authResult.auth,
      companyId
    })

    const payload = await loadStockWorkspaceData(companyId, 60, {
      dateFrom: financialYearFilter.dateFrom,
      dateTo: financialYearFilter.dateTo
    })
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
