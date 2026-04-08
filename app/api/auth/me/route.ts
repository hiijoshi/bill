import { NextRequest, NextResponse } from 'next/server'
import { normalizeAppRole } from '@/lib/api-security'
import { resolveServerAuth } from '@/lib/server-auth'
import { resolveServerAccessibleCompanies } from '@/lib/server-app-shell'
import { resolveSupabaseAppSession } from '@/lib/supabase/app-session'

export async function GET(request: NextRequest) {
  try {
    const supabaseSession = await resolveSupabaseAppSession(request)
    if (supabaseSession) {
      return supabaseSession.applyCookies(
        NextResponse.json({
          success: true,
          user: {
            id: supabaseSession.profile.legacy_user_id || supabaseSession.profile.id,
            userId: supabaseSession.profile.user_code,
            traderId: supabaseSession.profile.trader_id,
            name: supabaseSession.profile.full_name,
            role: supabaseSession.profile.app_role,
            companyId: supabaseSession.activeCompany?.id || null,
            assignedCompanyId: supabaseSession.profile.default_company_id || null
          },
          trader: {
            id: supabaseSession.profile.trader_id,
            name: null
          },
          company: supabaseSession.activeCompany
            ? {
                id: supabaseSession.activeCompany.id,
                name: supabaseSession.activeCompany.name
              }
            : null
        })
      )
    }

    const resolved = await resolveServerAuth({ namespace: 'app' })
    if (!resolved) {
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401 }
      )
    }

    const user = resolved.user
    const role = normalizeAppRole(user.role || resolved.auth.role)
    const { activeCompany: company } = await resolveServerAccessibleCompanies({
      auth: {
        ...resolved.auth,
        role
      },
      assignedCompanyId: user.companyId
    })

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        userId: user.userId,
        traderId: user.traderId,
        name: user.name,
        role: user.role,
        companyId: company?.id || null,
        assignedCompanyId: user.companyId || null
      },
      trader: user.trader,
      company: company
        ? {
            id: company.id,
            name: company.name
          }
        : null
    })

  } catch (error) {
    void error
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
