import { NextRequest, NextResponse } from 'next/server'
import { canAccessCompanyRoute, requireRoles, validateCompanyAccess } from '@/lib/api-security'
import { getFinancialYearDateFilter } from '@/lib/financial-years'
import { loadPaymentWorkspaceData } from '@/lib/server-payment-workspace'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const companyId = searchParams.get('companyId')?.trim() || ''
    const includePaymentModes = searchParams.get('includePaymentModes') === 'true'

    const companyValidation = await validateCompanyAccess(request, companyId)
    if (!companyValidation.ok) return companyValidation.response
    const scopedCompanyId = companyValidation.companyId

    const [purchaseAllowed, salesAllowed, paymentsAllowed] = await Promise.all([
      canAccessCompanyRoute(request, scopedCompanyId, '/api/purchase-bills', 'GET'),
      canAccessCompanyRoute(request, scopedCompanyId, '/api/sales-bills', 'GET'),
      canAccessCompanyRoute(request, scopedCompanyId, '/api/payments', 'GET')
    ])

    const hasAnyAccess = purchaseAllowed || salesAllowed || paymentsAllowed

    if (!hasAnyAccess) {
      const allowedByCompany = await canAccessCompanyRoute(request, scopedCompanyId, '/api/payment-modes', 'GET')
      if (!allowedByCompany) {
        return NextResponse.json({ error: 'User not linked to company' }, { status: 403 })
      }
    }

    const financialYearFilter = await getFinancialYearDateFilter({
      request,
      auth: authResult.auth,
      companyId: scopedCompanyId
    })

    const payload = await loadPaymentWorkspaceData(scopedCompanyId, {
      includePaymentModes,
      purchaseAllowed,
      salesAllowed,
      paymentsAllowed,
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
