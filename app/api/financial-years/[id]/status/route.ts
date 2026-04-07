import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { normalizeId, requireRoles } from '@/lib/api-security'
import { updateFinancialYearStatus } from '@/lib/financial-years'

const statusSchema = z.object({
  traderId: z.string().trim().optional().nullable(),
  status: z.enum(['open', 'closed', 'locked'])
})

export async function PATCH(
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

    const parsed = statusSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        },
        { status: 400 }
      )
    }

    const targetTraderId =
      authResult.auth.role === 'super_admin'
        ? normalizeId(parsed.data.traderId) || authResult.auth.traderId
        : authResult.auth.traderId

    if (!targetTraderId) {
      return NextResponse.json({ error: 'Trader ID is required' }, { status: 400 })
    }

    const financialYear = await updateFinancialYearStatus({
      traderId: targetTraderId,
      financialYearId,
      status: parsed.data.status
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
        error: error instanceof Error ? error.message : 'Failed to update financial year'
      },
      { status }
    )
  }
}
