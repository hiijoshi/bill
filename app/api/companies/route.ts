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
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
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

    if ((body as { seed?: unknown }).seed === true) {
      const rawCount = Number((body as { count?: unknown }).count || 5)
      const count = Number.isFinite(rawCount) ? Math.min(Math.max(rawCount, 1), 20) : 5

      const targetTraderId = normalizeId((body as { traderId?: unknown }).traderId)

      if (!targetTraderId) {
        return NextResponse.json(
          { error: 'Trader ID is required for super admin seed requests' },
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

      const now = Date.now()
      const created = await prisma.$transaction(async (tx) => {
        const rows = []
        for (let idx = 0; idx < count; idx += 1) {
          const mandiAccountNumber = await generateUniqueMandiAccountNumber(tx)
          const row = await tx.company.create({
            data: {
              traderId: targetTraderId,
              name: `Demo Company ${now}-${idx + 1}`,
              address: `Demo Address ${idx + 1}`,
              phone: `90000${String(now + idx).slice(-5)}`,
              mandiAccountNumber
            }
          })
          rows.push(row)
        }
        return rows
      })

      await Promise.all(
        created.map((company) =>
          writeAuditLog({
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
        )
      )

      return NextResponse.json(
        {
          success: true,
          message: `${created.length} demo companies created successfully`,
          count: created.length,
          companies: created
        },
        { headers: setCORSHeaders() }
      )
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
