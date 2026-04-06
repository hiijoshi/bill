import { NextRequest, NextResponse } from 'next/server'
import { canAccessCompanyRoute, requireRoles } from '@/lib/api-security'
import { loadPaymentWorkspaceData } from '@/lib/server-payment-workspace'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const companyId = searchParams.get('companyId')?.trim() || ''
    const includePaymentModes = searchParams.get('includePaymentModes') === 'true'

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const [purchaseAllowed, salesAllowed, paymentsAllowed] = await Promise.all([
      canAccessCompanyRoute(request, companyId, '/api/purchase-bills', 'GET'),
      canAccessCompanyRoute(request, companyId, '/api/sales-bills', 'GET'),
      canAccessCompanyRoute(request, companyId, '/api/payments', 'GET')
    ])

    const hasAnyAccess = purchaseAllowed || salesAllowed || paymentsAllowed

    if (!hasAnyAccess) {
      const allowedByCompany = await canAccessCompanyRoute(request, companyId, '/api/payment-modes', 'GET')
      if (!allowedByCompany) {
        return NextResponse.json({ error: 'Company access denied' }, { status: 403 })
      }
    }

    const payload = await loadPaymentWorkspaceData(companyId, {
      includePaymentModes,
      purchaseAllowed,
      salesAllowed,
      paymentsAllowed
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
