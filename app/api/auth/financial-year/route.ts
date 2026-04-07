import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRoles } from '@/lib/api-security'
import { getFinancialYearContext } from '@/lib/financial-years'
import { getFinancialYearCookieName, getFinancialYearCookieNameCandidates } from '@/lib/session-cookies'
import { getAppCompanyCookieOptions } from '@/lib/supabase/app-session'

const switchFinancialYearSchema = z.object({
  financialYearId: z.string().trim().optional().nullable()
})

function getScopeSource(request: NextRequest): string {
  return request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const context = await getFinancialYearContext({
      request,
      auth: authResult.auth
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
        error: error instanceof Error ? error.message : 'Failed to load selected financial year'
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const parsed = switchFinancialYearSchema.safeParse(await request.json().catch(() => null))
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

    const context = await getFinancialYearContext({
      request,
      auth: authResult.auth
    })

    const requestedFinancialYearId = String(parsed.data.financialYearId || '').trim()
    const selectedFinancialYear = requestedFinancialYearId
      ? context.financialYears.find((row) => row.id === requestedFinancialYearId) || null
      : null

    if (requestedFinancialYearId && !selectedFinancialYear) {
      return NextResponse.json({ error: 'Financial year not found' }, { status: 404 })
    }

    const response = NextResponse.json({
      traderId: context.traderId,
      activeFinancialYear: context.activeFinancialYear,
      selectedFinancialYear,
      financialYears: context.financialYears
    })

    const scopeSource = getScopeSource(request)
    const cookieName = getFinancialYearCookieName(scopeSource)
    if (selectedFinancialYear) {
      response.cookies.set(cookieName, selectedFinancialYear.id, {
        ...getAppCompanyCookieOptions()
      })
    } else {
      response.cookies.set(cookieName, '', {
        ...getAppCompanyCookieOptions(),
        maxAge: 0
      })
      for (const candidate of getFinancialYearCookieNameCandidates(scopeSource)) {
        if (candidate === cookieName) continue
        response.cookies.set(candidate, '', {
          ...getAppCompanyCookieOptions(),
          maxAge: 0
        })
      }
    }

    return response
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to switch financial year'
      },
      { status: 500 }
    )
  }
}
