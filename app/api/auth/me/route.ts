import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { cookies, headers } from 'next/headers'
import { getAccessibleCompanies, normalizeAppRole } from '@/lib/api-security'
import { getCompanyCookieNameCandidates } from '@/lib/session-cookies'
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

    const session = await getSession()
    
    if (!session) {
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401 }
      )
    }

    // Get user details from database using session info
    const { prisma } = await import('@/lib/prisma')
    const user = await prisma.user.findFirst({
      where: {
        userId: session.userId,
        traderId: session.traderId,
        deletedAt: null
      },
      select: {
        id: true,
        userId: true,
        traderId: true,
        companyId: true,
        name: true,
        role: true,
        locked: true,
        trader: {
          select: {
            id: true,
            name: true,
            locked: true,
            deletedAt: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid session user' },
        { status: 401 }
      )
    }

    if (user.locked || user.trader?.locked || user.trader?.deletedAt) {
      return NextResponse.json({ error: 'Account is locked or inactive' }, { status: 403 })
    }

    const role = normalizeAppRole(user.role || session.role)
    const cookieStore = await cookies()
    const headerStore = await headers()
    const scopeSource = headerStore.get('x-forwarded-host') || headerStore.get('host')
    const companyCookieId =
      getCompanyCookieNameCandidates(scopeSource)
        .map((cookieName) => cookieStore.get(cookieName)?.value?.trim() || '')
        .find((value) => value.length > 0) || ''
    const accessibleCompanies = await getAccessibleCompanies({
      userId: user.userId,
      traderId: user.traderId,
      role,
      companyId: user.companyId,
      userDbId: user.id
    })
    const company =
      accessibleCompanies.find((entry) => entry.id === companyCookieId && !entry.locked) ||
      accessibleCompanies.find((entry) => entry.id === user.companyId && !entry.locked) ||
      accessibleCompanies.find((entry) => !entry.locked) ||
      null

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
      company: company ? {
        id: company.id,
        name: company.name
      } : null
    })

  } catch (error) {
    void error
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
