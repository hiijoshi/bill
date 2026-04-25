import { NextRequest, NextResponse } from 'next/server'
import { canAccessCompanyRoute, requireRoles, validateCompanyAccess } from '@/lib/api-security'
import { getFinancialYearDateFilter } from '@/lib/financial-years'
import { loadStockWorkspaceData } from '@/lib/server-stock-workspace'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const companyId = searchParams.get('companyId')?.trim() || ''

    const companyValidation = await validateCompanyAccess(request, companyId)
    if (!companyValidation.ok) return companyValidation.response
    const scopedCompanyId = companyValidation.companyId

    const allowed = await canAccessCompanyRoute(request, scopedCompanyId, '/api/stock-ledger', 'GET')
    if (!allowed) {
      return NextResponse.json({ error: 'User not linked to company' }, { status: 403 })
    }

    const financialYearFilter = await getFinancialYearDateFilter({
      request,
      auth: authResult.auth,
      companyId: scopedCompanyId
    })

    const payload = await loadStockWorkspaceData(scopedCompanyId, 60, {
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
