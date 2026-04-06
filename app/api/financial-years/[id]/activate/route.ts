import { NextRequest, NextResponse } from 'next/server'

import { normalizeId, requireRoles } from '@/lib/api-security'
import { setActiveFinancialYear } from '@/lib/financial-years'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const routeParams = await params
    const financialYearId = normalizeId(routeParams.id)
    if (!financialYearId) {
      return NextResponse.json({ error: 'Financial year ID is required' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const targetTraderId =
      authResult.auth.role === 'super_admin'
        ? normalizeId(body?.traderId) || authResult.auth.traderId
        : authResult.auth.traderId

    if (!targetTraderId) {
      return NextResponse.json({ error: 'Trader ID is required' }, { status: 400 })
    }

    const financialYear = await setActiveFinancialYear({
      traderId: targetTraderId,
      financialYearId
    })

    return NextResponse.json({
      success: true,
      financialYear
    })
  } catch (error) {
    const status = error instanceof Error && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode || 500)
      : 500
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to activate financial year'
      },
      { status }
    )
  }
}
