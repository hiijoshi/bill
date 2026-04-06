import { NextRequest, NextResponse } from 'next/server'
import { canAccessCompanyRoute, requireRoles } from '@/lib/api-security'
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

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const [hasPurchaseAccess, hasSalesAccess, hasPaymentsAccess, hasBanksAccess] = await Promise.all([
      canAccessCompanyRoute(request, companyId, '/api/purchase-bills', 'GET'),
      canAccessCompanyRoute(request, companyId, '/api/sales-bills', 'GET'),
      canAccessCompanyRoute(request, companyId, '/api/payments', 'GET'),
      canAccessCompanyRoute(request, companyId, '/api/banks', 'GET')
    ])

    if (!hasPurchaseAccess && !hasSalesAccess && !hasPaymentsAccess && !hasBanksAccess) {
      return NextResponse.json({ error: 'Company access denied' }, { status: 403 })
    }

    const payload = await loadReportDashboardData(companyId, reportType, {
      loadPurchase: hasPurchaseAccess,
      loadSales: hasSalesAccess,
      loadPayments: hasPaymentsAccess,
      loadBanks: hasBanksAccess
    })

    return NextResponse.json({
      purchaseBills: hasPurchaseAccess ? payload.purchaseBills : [],
      specialPurchaseBills: hasPurchaseAccess ? payload.specialPurchaseBills : [],
      salesBills: hasSalesAccess ? payload.salesBills : [],
      payments: hasPaymentsAccess ? payload.payments : [],
      banks: hasBanksAccess ? payload.banks : []
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
