import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/config'
import { normalizeAppRole } from '@/lib/api-security'

export async function GET(request: NextRequest) {
  try {
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
        role: true,
        companyId: true
      }
    })

    if (!authUser) {
      return NextResponse.json({ error: 'Invalid session user' }, { status: 401 })
    }

    const role = normalizeAppRole(authUser.role || session.role)
    const isSuperAdmin = role === 'super_admin'
    const cookieCompanyId = request.cookies.get('companyId')?.value?.trim() || ''

    let company = cookieCompanyId
      ? await prisma.company.findFirst({
          where: isSuperAdmin
            ? { id: cookieCompanyId, deletedAt: null }
            : {
                id: cookieCompanyId,
                deletedAt: null,
                OR: [{ traderId: session.traderId }, { traderId: null }]
              },
          select: { id: true, name: true }
        })
      : null

    if ((role === 'company_admin' || role === 'company_user') && authUser.companyId) {
      if (!company || company.id !== authUser.companyId) {
        company = await prisma.company.findFirst({
          where: { id: authUser.companyId, deletedAt: null },
          select: { id: true, name: true }
        })
      }
    }

    if (!company) {
      company = await prisma.company.findFirst({
        where: isSuperAdmin
          ? { deletedAt: null }
          : {
              deletedAt: null,
              OR: [{ traderId: session.traderId }, { traderId: null }]
            },
        select: { id: true, name: true }
      })
    }

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
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const companyIdRaw = typeof body?.companyId === 'string' ? body.companyId.trim() : ''
    const force = body?.force === true

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
        role: true,
        companyId: true,
        locked: true,
        trader: {
          select: {
            locked: true,
            deletedAt: true
          }
        },
        company: {
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
      authUser.trader?.deletedAt ||
      authUser.company?.locked ||
      authUser.company?.deletedAt
    ) {
      return NextResponse.json({ error: 'Account is locked or inactive' }, { status: 403 })
    }

    const role = normalizeAppRole(authUser.role || session.role)
    const isSuperAdmin = role === 'super_admin'

    const company = await prisma.company.findFirst({
      where: isSuperAdmin
        ? { id: companyIdRaw, deletedAt: null }
        : {
            id: companyIdRaw,
            deletedAt: null,
            OR: [
              { traderId: session.traderId },
              { traderId: null }
            ]
          },
      select: {
        id: true,
        name: true
      }
    })

    if (!company) {
      return NextResponse.json({ error: 'Invalid company for this user' }, { status: 403 })
    }

    if ((role === 'company_admin' || role === 'company_user') && authUser.companyId && authUser.companyId !== company.id) {
      return NextResponse.json({ error: 'Company access denied' }, { status: 403 })
    }

    const currentLockedCompanyId = request.cookies.get('companyId')?.value
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

    response.cookies.set('companyId', company.id, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
      priority: 'high'
    })

    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
