import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getAccessibleCompanies, normalizeAppRole } from '@/lib/api-security'
import { getCompanyCookieName, getCompanyCookieNameCandidates } from '@/lib/session-cookies'
import { getAppCompanyCookieOptions, resolveSupabaseAppSession } from '@/lib/supabase/app-session'

export async function GET(request: NextRequest) {
  try {
    const supabaseSession = await resolveSupabaseAppSession(request)
    if (supabaseSession) {
      return supabaseSession.applyCookies(
        NextResponse.json({
          success: true,
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const authUser = await prisma.user.findFirst({
      where: {
        userId: session.userId,
        traderId: session.traderId,
        deletedAt: null
      },
      select: {
        id: true,
        role: true,
        companyId: true
      }
    })

    if (!authUser) {
      return NextResponse.json({ error: 'Invalid session user' }, { status: 401 })
    }

    const role = normalizeAppRole(authUser.role || session.role)
    const accessibleCompanies = await getAccessibleCompanies({
      userId: session.userId,
      traderId: session.traderId,
      role,
      companyId: authUser.companyId,
      userDbId: authUser.id
    })
    const scopeSource = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
    const cookieCompanyId =
      getCompanyCookieNameCandidates(scopeSource)
        .map((cookieName) => request.cookies.get(cookieName)?.value?.trim() || '')
        .find((value) => value.length > 0) || ''

    const company =
      accessibleCompanies.find((entry) => entry.id === cookieCompanyId && !entry.locked) ||
      accessibleCompanies.find((entry) => entry.id === authUser.companyId && !entry.locked) ||
      accessibleCompanies.find((entry) => !entry.locked) ||
      null

    return NextResponse.json({
      success: true,
      company: company
        ? {
            id: company.id,
            name: company.name
          }
        : null
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const companyIdRaw = typeof body?.companyId === 'string' ? body.companyId.trim() : ''
    const force = body?.force === true

    const supabaseSession = await resolveSupabaseAppSession(request)
    if (supabaseSession) {
      if (!companyIdRaw) {
        return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
      }

      const company = supabaseSession.companies.find((entry) => entry.id === companyIdRaw) || null
      if (!company) {
        return supabaseSession.applyCookies(
          NextResponse.json({ error: 'Invalid company for this user' }, { status: 403 })
        )
      }

      if (company.locked) {
        return supabaseSession.applyCookies(
          NextResponse.json({ error: 'Company is locked' }, { status: 403 })
        )
      }

      if (supabaseSession.cookieCompanyId && supabaseSession.cookieCompanyId !== company.id && !force) {
        return supabaseSession.applyCookies(
          NextResponse.json(
            { error: 'Company is locked. Use company select page to switch.' },
            { status: 409 }
          )
        )
      }

      const response = supabaseSession.applyCookies(
        NextResponse.json({
          success: true,
          company: {
            id: company.id,
            name: company.name
          }
        })
      )

      response.cookies.set(
        supabaseSession.companyCookieName,
        company.id,
        getAppCompanyCookieOptions()
      )

      return response
    }

    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!companyIdRaw) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const authUser = await prisma.user.findFirst({
      where: {
        userId: session.userId,
        traderId: session.traderId,
        deletedAt: null
      },
      select: {
        id: true,
        role: true,
        companyId: true,
        locked: true,
        trader: {
          select: {
            locked: true,
            deletedAt: true
          }
        }
      }
    })

    if (!authUser) {
      return NextResponse.json({ error: 'Invalid session user' }, { status: 401 })
    }

    if (
      authUser.locked ||
      authUser.trader?.locked ||
      authUser.trader?.deletedAt
    ) {
      return NextResponse.json({ error: 'Account is locked or inactive' }, { status: 403 })
    }

    const role = normalizeAppRole(authUser.role || session.role)
    const company = (
      await getAccessibleCompanies(
        {
          userId: session.userId,
          traderId: session.traderId,
          role,
          companyId: authUser.companyId,
          userDbId: authUser.id
        },
        companyIdRaw
      )
    )[0]

    if (!company) {
      return NextResponse.json({ error: 'Invalid company for this user' }, { status: 403 })
    }

    if (company.locked) {
      return NextResponse.json({ error: 'Company is locked' }, { status: 403 })
    }

    const scopeSource = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
    const currentLockedCompanyId =
      getCompanyCookieNameCandidates(scopeSource)
        .map((cookieName) => request.cookies.get(cookieName)?.value)
        .find((value): value is string => Boolean(value)) || null
    if (currentLockedCompanyId && currentLockedCompanyId !== company.id && !force) {
      return NextResponse.json(
        { error: 'Company is locked. Use company select page to switch.' },
        { status: 409 }
      )
    }

    const response = NextResponse.json({
      success: true,
      company: {
        id: company.id,
        name: company.name
      }
    })

    response.cookies.set(getCompanyCookieName(scopeSource), company.id, {
      ...getAppCompanyCookieOptions()
    })

    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
