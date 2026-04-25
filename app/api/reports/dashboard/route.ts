import { NextRequest, NextResponse } from 'next/server'
import { canAccessCompanyRoute, requireRoles, validateCompanyAccess } from '@/lib/api-security'
import { getFinancialYearDateFilter } from '@/lib/financial-years'
import { loadReportDashboardData, type ReportDashboardType } from '@/lib/server-report-dashboard'

function normalizeReportType(value: string | null): ReportDashboardType {
  if (value === 'purchase' || value === 'sales') return value
  return 'main'
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const companyId = searchParams.get('companyId')?.trim() || ''
    const reportType = normalizeReportType(searchParams.get('reportType'))

    const companyValidation = await validateCompanyAccess(request, companyId)
    if (!companyValidation.ok) return companyValidation.response
    const scopedCompanyId = companyValidation.companyId

    const [hasPurchaseAccess, hasSalesAccess, hasPaymentsAccess, hasBanksAccess] = await Promise.all([
      canAccessCompanyRoute(request, scopedCompanyId, '/api/purchase-bills', 'GET'),
      canAccessCompanyRoute(request, scopedCompanyId, '/api/sales-bills', 'GET'),
      canAccessCompanyRoute(request, scopedCompanyId, '/api/payments', 'GET'),
      canAccessCompanyRoute(request, scopedCompanyId, '/api/banks', 'GET')
    ])

    if (!hasPurchaseAccess && !hasSalesAccess && !hasPaymentsAccess && !hasBanksAccess) {
      return NextResponse.json({ error: 'User not linked to company' }, { status: 403 })
    }

    const financialYearFilter = await getFinancialYearDateFilter({
      request,
      auth: authResult.auth,
      companyId: scopedCompanyId
    })

    const payload = await loadReportDashboardData(scopedCompanyId, reportType, {
      loadPurchase: hasPurchaseAccess,
      loadSales: hasSalesAccess,
      loadPayments: hasPaymentsAccess,
      loadBanks: hasBanksAccess,
      dateFrom: financialYearFilter.dateFrom,
      dateTo: financialYearFilter.dateTo
    })

    return NextResponse.json({
      purchaseBills: hasPurchaseAccess ? payload.purchaseBills : [],
      specialPurchaseBills: hasPurchaseAccess ? payload.specialPurchaseBills : [],
      salesBills: hasSalesAccess ? payload.salesBills : [],
      payments: hasPaymentsAccess ? payload.payments : [],
      banks: hasBanksAccess ? payload.banks : [],
      activeFinancialYear: financialYearFilter.effectiveFinancialYear
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    )
  }
}
