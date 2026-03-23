import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateRequest, createCompanySchema, updateCompanySchema } from '@/lib/validation'
import {
  getAccessibleCompanies,
  normalizeId,
  parseBooleanParam,
  requireRoles
} from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { generateUniqueMandiAccountNumber } from '@/lib/mandi-account-number'
import { resolveSupabaseAppSession } from '@/lib/supabase/app-session'

function setCORSHeaders() {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigins[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabaseSession = await resolveSupabaseAppSession(request)
    if (supabaseSession) {
      const searchParams = new URL(request.url).searchParams
      const requestedTraderId = normalizeId(searchParams.get('traderId'))
      const scopedIds = supabaseSession.companies
        .filter((company) => !requestedTraderId || company.traderId === requestedTraderId)
        .map((company) => company.id)

      if (scopedIds.length === 0) {
        return supabaseSession.applyCookies(NextResponse.json([], { headers: setCORSHeaders() }))
      }

      const companies = await prisma.company.findMany({
        where: {
          deletedAt: null,
          id: { in: scopedIds }
        },
        include: {
          trader: {
            select: {
              id: true,
              name: true,
              locked: true,
              deletedAt: true
            }
          }
        },
        orderBy: { name: 'asc' }
      })

      if (companies.length > 0) {
        return supabaseSession.applyCookies(NextResponse.json(companies, { headers: setCORSHeaders() }))
      }

      return supabaseSession.applyCookies(
        NextResponse.json(
          supabaseSession.companies
            .filter((company) => !requestedTraderId || company.traderId === requestedTraderId)
            .map((company) => ({
              id: company.id,
              name: company.name,
              locked: company.locked,
              traderId: company.traderId,
              trader: null
            })),
          { headers: setCORSHeaders() }
        )
      )
    }

    const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
    if (!authResult.ok) return authResult.response

    const auth = authResult.auth
    const searchParams = new URL(request.url).searchParams
    const includeDeleted = auth.role === 'super_admin' && parseBooleanParam(searchParams.get('includeDeleted'))
    const requestedTraderId = normalizeId(searchParams.get('traderId'))

    const where: {
      deletedAt?: null
      traderId?: string
      id?: string
    } = {}

    if (!includeDeleted) {
      where.deletedAt = null
    }

    if (auth.role === 'super_admin') {
      if (requestedTraderId) {
        where.traderId = requestedTraderId
      }
    } else if (auth.role === 'trader_admin') {
      where.traderId = auth.traderId
    } else {
      const accessibleCompanies = await getAccessibleCompanies(auth)
      const ids = accessibleCompanies.map((company) => company.id)
      if (ids.length === 0) {
        return NextResponse.json([], { headers: setCORSHeaders() })
      }
      const companies = await prisma.company.findMany({
        where: {
          deletedAt: null,
          id: { in: ids }
        },
        include: {
          trader: {
            select: {
              id: true,
              name: true,
              locked: true,
              deletedAt: true
            }
          }
        },
        orderBy: { name: 'asc' }
      })

      return NextResponse.json(companies, { headers: setCORSHeaders() })
    }

    const companies = await prisma.company.findMany({
      where,
      include: {
        trader: {
          select: {
            id: true,
            name: true,
            locked: true,
            deletedAt: true
          }
        }
      },
      orderBy: { name: 'asc' }
    })

    return NextResponse.json(companies, { headers: setCORSHeaders() })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: setCORSHeaders() })
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const auth = authResult.auth
    const body = await request.json().catch(() => null)

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: setCORSHeaders() })
    }

    const validation = validateRequest(createCompanySchema, body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.errors
        },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    const { name, address, phone, mandiAccountNumber } = validation.data!

    const targetTraderId = normalizeId((validation.data as { traderId?: unknown }).traderId)

    if (!targetTraderId) {
      return NextResponse.json(
        { error: 'Trader ID is required to create company' },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    const trader = await prisma.trader.findFirst({
      where: {
        id: targetTraderId,
        deletedAt: null
      },
      select: { id: true }
    })

    if (!trader) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404, headers: setCORSHeaders() })
    }

    const mandiAccountNumberValue =
      typeof mandiAccountNumber === 'string' && mandiAccountNumber.trim()
        ? mandiAccountNumber.trim()
        : await generateUniqueMandiAccountNumber(prisma)

    const company = await prisma.company.create({
      data: {
        traderId: targetTraderId,
        name,
        address,
        phone,
        mandiAccountNumber: mandiAccountNumberValue
      }
    })

    await writeAuditLog({
      actor: {
        id: auth.userDbId || auth.userId,
        role: auth.role
      },
      action: 'CREATE',
      resourceType: 'COMPANY',
      resourceId: company.id,
      scope: {
        traderId: company.traderId,
        companyId: company.id
      },
      after: company,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json(company, { headers: setCORSHeaders() })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: setCORSHeaders() })
  }
}

export async function PUT(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const auth = authResult.auth
    const body = await request.json().catch(() => null)

    const validation = validateRequest(updateCompanySchema, body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.errors
        },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    const { name, address, phone, mandiAccountNumber } = validation.data!
    const id = normalizeId(new URL(request.url).searchParams.get('id'))

    if (!id) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400, headers: setCORSHeaders() })
    }

    const existing = await prisma.company.findFirst({
      where: { id, deletedAt: null }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404, headers: setCORSHeaders() })
    }

    const nextMandiAccountNumber =
      typeof mandiAccountNumber === 'string'
        ? mandiAccountNumber.trim() || await generateUniqueMandiAccountNumber(prisma)
        : undefined

    const company = await prisma.company.update({
      where: { id },
      data: {
        name,
        address,
        phone,
        ...(nextMandiAccountNumber !== undefined ? { mandiAccountNumber: nextMandiAccountNumber } : {})
      }
    })

    await writeAuditLog({
      actor: {
        id: auth.userDbId || auth.userId,
        role: auth.role
      },
      action: 'UPDATE',
      resourceType: 'COMPANY',
      resourceId: company.id,
      scope: {
        traderId: company.traderId,
        companyId: company.id
      },
      before: existing,
      after: company,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json(company, { headers: setCORSHeaders() })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: setCORSHeaders() })
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const auth = authResult.auth
    const id = normalizeId(new URL(request.url).searchParams.get('id'))

    if (!id) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400, headers: setCORSHeaders() })
    }

    const existing = await prisma.company.findFirst({
      where: { id, deletedAt: null }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404, headers: setCORSHeaders() })
    }

    const deletedAt = new Date()
    const company = await prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id },
        data: {
          deletedAt,
          locked: true
        }
      })

      await tx.user.updateMany({
        where: {
          companyId: id,
          deletedAt: null
        },
        data: {
          deletedAt,
          locked: true
        }
      })

      return updated
    })

    await writeAuditLog({
      actor: {
        id: auth.userDbId || auth.userId,
        role: auth.role
      },
      action: 'DELETE',
      resourceType: 'COMPANY',
      resourceId: company.id,
      scope: {
        traderId: company.traderId,
        companyId: company.id
      },
      before: existing,
      after: company,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({ success: true, message: 'Company deleted successfully' }, { headers: setCORSHeaders() })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: setCORSHeaders() })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: setCORSHeaders()
  })
}
