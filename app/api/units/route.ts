import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { UNIVERSAL_UNITS, toNumber } from '@/lib/unit-conversion'
import { ensureCompanyAccess, normalizeId, requireAuthContext, requireRoles } from '@/lib/api-security'

function setCORSHeaders() {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigins[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin'
  }
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v.length > 0 ? v : null
}

function readCompanyIdFromAuth(request: NextRequest): string | null {
  const req = request as NextRequest & {
    user?: {
      companyId?: string | null
      company_id?: string | null
      defaultCompanyId?: string | null
      default_company_id?: string | null
    }
    auth?: {
      companyId?: string | null
      company_id?: string | null
      defaultCompanyId?: string | null
      default_company_id?: string | null
    }
  }

  const candidates = [
    req.user?.companyId,
    req.user?.company_id,
    req.user?.defaultCompanyId,
    req.user?.default_company_id,
    req.auth?.companyId,
    req.auth?.company_id,
    req.auth?.defaultCompanyId,
    req.auth?.default_company_id,
    request.headers.get('x-auth-company-id'),
    request.headers.get('x-company-id')
  ]

  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (value && value !== 'null' && value !== 'undefined') {
      return value
    }
  }

  return null
}

function resolveCompanyId(
  request: NextRequest,
  companyIdFromQuery: string
): { ok: true; companyId: string } | { ok: false; response: NextResponse } {
  const normalizedQuery = companyIdFromQuery.trim()
  if (normalizedQuery) {
    return { ok: true, companyId: normalizedQuery }
  }

  const fromAuth = readCompanyIdFromAuth(request)
  if (fromAuth) {
    return { ok: true, companyId: fromAuth }
  }

  const authResult = requireAuthContext(request)
  if (!authResult.ok) {
    // Authentication missing -> 401 (not a server error).
    return { ok: false, response: authResult.response }
  }

  // Authenticated but no company scope -> 403 (not a server error).
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'No company assigned to this user' },
      { status: 403, headers: setCORSHeaders() }
    )
  }
}

function isUniversalSymbol(symbol: string): boolean {
  return symbol === UNIVERSAL_UNITS.KG || symbol === UNIVERSAL_UNITS.QUINTAL
}

async function ensureWriteAccess(request: NextRequest, companyId: string) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin'])
  if (!authResult.ok) {
    return authResult.response
  }

  const scopeGuard = await ensureCompanyAccess(request, companyId)
  if (scopeGuard) {
    return scopeGuard
  }

  return null
}

async function ensureReadAccess(request: NextRequest, companyId: string) {
  const scopeGuard = await ensureCompanyAccess(request, companyId)
  if (scopeGuard) {
    return scopeGuard
  }

  return null
}

async function ensureUniversalUnits(companyId: string) {
  await prisma.unit.upsert({
    where: {
      companyId_symbol: {
        companyId,
        symbol: UNIVERSAL_UNITS.KG
      }
    },
    update: {
      name: 'Kilogram',
      kgEquivalent: 1,
      isUniversal: true,
      description: 'Universal base unit: 1 KG'
    },
    create: {
      companyId,
      name: 'Kilogram',
      symbol: UNIVERSAL_UNITS.KG,
      kgEquivalent: 1,
      isUniversal: true,
      description: 'Universal base unit: 1 KG'
    }
  })

  await prisma.unit.upsert({
    where: {
      companyId_symbol: {
        companyId,
        symbol: UNIVERSAL_UNITS.QUINTAL
      }
    },
    update: {
      name: 'Quintal',
      kgEquivalent: UNIVERSAL_UNITS.KG_PER_QUINTAL,
      isUniversal: true,
      description: 'Universal base constant: 1 QT = 100 KG'
    },
    create: {
      companyId,
      name: 'Quintal',
      symbol: UNIVERSAL_UNITS.QUINTAL,
      kgEquivalent: UNIVERSAL_UNITS.KG_PER_QUINTAL,
      isUniversal: true,
      description: 'Universal base constant: 1 QT = 100 KG'
    }
  })
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams
    const companyIdFromQuery = normalizeId(searchParams.get('companyId'))
    const companyScope = resolveCompanyId(request, companyIdFromQuery)
    if (!companyScope.ok) return companyScope.response
    const companyId = companyScope.companyId

    const denied = await ensureReadAccess(request, companyId)
    if (denied) return denied

    await ensureUniversalUnits(companyId)

    const units = await prisma.unit.findMany({
      where: { companyId },
      orderBy: [{ isUniversal: 'desc' }, { name: 'asc' }]
    })

    return NextResponse.json(
      {
        units,
        companyId
      },
      { headers: setCORSHeaders() }
    )
  } catch (error) {
    console.error('GET /api/units failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500, headers: setCORSHeaders() }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams
    const companyIdFromQuery = normalizeId(searchParams.get('companyId'))
    const companyScope = resolveCompanyId(request, companyIdFromQuery)
    if (!companyScope.ok) return companyScope.response
    const companyId = companyScope.companyId

    const denied = await ensureWriteAccess(request, companyId)
    if (denied) return denied

    const body = await request.json().catch(() => ({}))

    const name = String((body as { name?: unknown }).name || '').trim()
    const symbolNormalized = String((body as { symbol?: unknown }).symbol || '')
      .trim()
      .toLowerCase()
    const description = clean((body as { description?: unknown }).description)

    const isUniversal = isUniversalSymbol(symbolNormalized)
    const kgEquivalent = isUniversal
      ? symbolNormalized === UNIVERSAL_UNITS.KG
        ? 1
        : UNIVERSAL_UNITS.KG_PER_QUINTAL
      : toNumber((body as { kgEquivalent?: unknown }).kgEquivalent, 0)

    if (!name || !symbolNormalized) {
      return NextResponse.json(
        { error: 'Unit name and symbol are required' },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    if (kgEquivalent <= 0) {
      return NextResponse.json(
        { error: 'KG equivalent must be greater than zero' },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    await ensureUniversalUnits(companyId)

    if (isUniversalSymbol(symbolNormalized)) {
      return NextResponse.json(
        { error: 'Universal units are system managed and cannot be created manually' },
        { status: 403, headers: setCORSHeaders() }
      )
    }

    const existingUnit = await prisma.unit.findFirst({
      where: {
        companyId,
        symbol: symbolNormalized
      }
    })

    if (existingUnit) {
      return NextResponse.json(
        { error: 'Unit with this symbol already exists' },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    const unit = await prisma.unit.create({
      data: {
        name,
        symbol: symbolNormalized,
        kgEquivalent,
        isUniversal,
        description,
        companyId
      }
    })

    return NextResponse.json(
      {
        success: true,
        companyId,
        unit
      },
      { headers: setCORSHeaders() }
    )
  } catch (error) {
    console.error('POST /api/units failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500, headers: setCORSHeaders() }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams
    const id = normalizeId(searchParams.get('id'))
    const companyIdFromQuery = normalizeId(searchParams.get('companyId'))
    const companyScope = resolveCompanyId(request, companyIdFromQuery)
    if (!companyScope.ok) return companyScope.response
    const companyId = companyScope.companyId

    if (!id) {
      return NextResponse.json(
        { error: 'Unit ID required' },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    const denied = await ensureWriteAccess(request, companyId)
    if (denied) return denied

    const body = await request.json().catch(() => ({}))
    const name = String((body as { name?: unknown }).name || '').trim()
    const symbolNormalized = String((body as { symbol?: unknown }).symbol || '')
      .trim()
      .toLowerCase()
    const description = clean((body as { description?: unknown }).description)

    const isUniversal = isUniversalSymbol(symbolNormalized)
    const kgEquivalent = isUniversal
      ? symbolNormalized === UNIVERSAL_UNITS.KG
        ? 1
        : UNIVERSAL_UNITS.KG_PER_QUINTAL
      : toNumber((body as { kgEquivalent?: unknown }).kgEquivalent, 0)

    if (!name || !symbolNormalized) {
      return NextResponse.json(
        { error: 'Unit name and symbol are required' },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    if (kgEquivalent <= 0) {
      return NextResponse.json(
        { error: 'KG equivalent must be greater than zero' },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    await ensureUniversalUnits(companyId)

    const currentUnit = await prisma.unit.findFirst({
      where: {
        id,
        companyId
      }
    })

    if (!currentUnit) {
      return NextResponse.json(
        { error: 'Unit not found' },
        { status: 404, headers: setCORSHeaders() }
      )
    }

    if (currentUnit.isUniversal) {
      return NextResponse.json(
        { error: 'Universal units cannot be edited' },
        { status: 403, headers: setCORSHeaders() }
      )
    }

    if (isUniversalSymbol(symbolNormalized)) {
      return NextResponse.json(
        { error: 'Reserved universal symbols (kg, qt) cannot be assigned to user units' },
        { status: 403, headers: setCORSHeaders() }
      )
    }

    const existingUnit = await prisma.unit.findFirst({
      where: {
        companyId,
        symbol: symbolNormalized,
        id: { not: id }
      }
    })

    if (existingUnit) {
      return NextResponse.json(
        { error: 'Unit with this symbol already exists' },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    const unit = await prisma.unit.update({
      where: { id },
      data: {
        name,
        symbol: symbolNormalized,
        kgEquivalent,
        isUniversal,
        description
      }
    })

    return NextResponse.json(
      {
        success: true,
        companyId,
        unit
      },
      { headers: setCORSHeaders() }
    )
  } catch (error) {
    console.error('PUT /api/units failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500, headers: setCORSHeaders() }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams
    const id = normalizeId(searchParams.get('id'))
    const all = searchParams.get('all') === 'true'
    const companyIdFromQuery = normalizeId(searchParams.get('companyId'))
    const companyScope = resolveCompanyId(request, companyIdFromQuery)
    if (!companyScope.ok) return companyScope.response
    const companyId = companyScope.companyId

    const denied = await ensureWriteAccess(request, companyId)
    if (denied) return denied

    if (all) {
      await ensureUniversalUnits(companyId)

      const deleted = await prisma.unit.deleteMany({
        where: {
          companyId,
          isUniversal: false
        }
      })

      return NextResponse.json(
        {
          success: true,
          companyId,
          message: `${deleted.count} units deleted successfully`,
          count: deleted.count
        },
        { headers: setCORSHeaders() }
      )
    }

    if (!id) {
      return NextResponse.json(
        { error: 'Unit ID required' },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    const unit = await prisma.unit.findFirst({
      where: { id, companyId }
    })

    if (!unit) {
      return NextResponse.json(
        { error: 'Unit not found' },
        { status: 404, headers: setCORSHeaders() }
      )
    }

    if (unit.isUniversal) {
      return NextResponse.json(
        { error: 'Universal units cannot be deleted' },
        { status: 403, headers: setCORSHeaders() }
      )
    }

    const productCount = await prisma.product.count({
      where: { unitId: id }
    })

    if (productCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete unit. It is being used by ${productCount} product(s).` },
        { status: 400, headers: setCORSHeaders() }
      )
    }

    await prisma.unit.delete({ where: { id } })

    return NextResponse.json(
      { success: true, companyId, message: 'Unit deleted successfully' },
      { headers: setCORSHeaders() }
    )
  } catch (error) {
    console.error('DELETE /api/units failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500, headers: setCORSHeaders() }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: setCORSHeaders()
  })
}