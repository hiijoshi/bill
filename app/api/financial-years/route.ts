import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { normalizeId, requireRoles } from '@/lib/api-security'
import {
  buildFinancialYearLabel,
  clearFinancialYearCaches,
  getFinancialYearContext,
  getFinancialYearWindowFromStartYear
} from '@/lib/financial-years'
import { prisma } from '@/lib/prisma'

const createFinancialYearSchema = z.object({
  traderId: z.string().trim().optional().nullable(),
  startYear: z.coerce.number().int().min(2000).max(2100),
  activate: z.boolean().optional().default(false),
  status: z.enum(['open', 'closed', 'locked']).optional().default('open')
})

function normalizeTraderIdInput(request: NextRequest, authTraderId: string, role: string): string {
  const queryTraderId = normalizeId(request.nextUrl.searchParams.get('traderId'))
  if (role === 'super_admin' && queryTraderId) {
    return queryTraderId
  }
  return authTraderId
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const companyId = normalizeId(request.nextUrl.searchParams.get('companyId'))
    const traderId = normalizeTraderIdInput(
      request,
      authResult.auth.traderId,
      authResult.auth.role
    )

    const context = await getFinancialYearContext({
      request,
      auth: authResult.auth,
      traderId,
      companyId
    })

    return NextResponse.json({
      traderId: context.traderId,
      activeFinancialYear: context.activeFinancialYear,
      selectedFinancialYear: context.selectedFinancialYear,
      financialYears: context.financialYears
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to load financial years'
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsed = createFinancialYearSchema.safeParse(await request.json().catch(() => null))
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

    const span = getFinancialYearWindowFromStartYear(parsed.data.startYear)
    const label = buildFinancialYearLabel(parsed.data.startYear)

    if (parsed.data.activate && parsed.data.status !== 'open') {
      return NextResponse.json(
        { error: 'Only open financial years can be activated' },
        { status: 400 }
      )
    }

    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.financialYear.findFirst({
        where: {
          traderId: targetTraderId,
          OR: [
            { label },
            {
              startDate: span.startDate,
              endDate: span.endDate
            }
          ]
        }
      })

      if (existing) {
        throw new Error('Financial year already exists for this trader')
      }

      if (parsed.data.activate) {
        await tx.financialYear.updateMany({
          where: {
            traderId: targetTraderId,
            isActive: true
          },
          data: {
            isActive: false
          }
        })
      }

      return tx.financialYear.create({
        data: {
          traderId: targetTraderId,
          label,
          startDate: span.startDate,
          endDate: span.endDate,
          isActive: parsed.data.activate,
          status: parsed.data.status,
          activatedAt: parsed.data.activate ? new Date() : null,
          closedAt: parsed.data.status === 'closed' ? new Date() : null,
          lockedAt: parsed.data.status === 'locked' ? new Date() : null
        }
      })
    })

    clearFinancialYearCaches(targetTraderId)

    return NextResponse.json(
      {
        success: true,
        financialYear: created
      },
      { status: 201 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create financial year'
    const lowered = message.toLowerCase()
    const status =
      lowered.includes('already exists') || lowered.includes('overlap')
        ? 409
        : lowered.includes('financial year')
          ? 400
          : 500

    return NextResponse.json({ error: message }, { status })
  }
}
