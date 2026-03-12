import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { UNIVERSAL_UNITS, toNumber } from '@/lib/unit-conversion'
import { ensureCompanyAccess, normalizeId, requireRoles } from '@/lib/api-security'

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

const DUMMY_UNITS = [
  { name: 'Kilogram', symbol: 'kg', kgEquivalent: 1, isUniversal: true, description: 'Universal base unit: 1 KG' },
  {
    name: 'Quintal',
    symbol: 'qt',
    kgEquivalent: 100,
    isUniversal: true,
    description: 'Universal base constant: 1 QT = 100 KG'
  },
  { name: 'Bag 90KG', symbol: 'bag90', kgEquivalent: 90, isUniversal: false, description: 'User unit: 90 KG per bag' }
] as const

function isUniversalSymbol(symbol: string): boolean {
  return symbol === UNIVERSAL_UNITS.KG || symbol === UNIVERSAL_UNITS.QUINTAL
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
    const companyId = normalizeId(new URL(request.url).searchParams.get('companyId'))
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400, headers: setCORSHeaders() })
    }

    const scopeGuard = await ensureCompanyAccess(request, companyId)
    if (scopeGuard) return scopeGuard

    await ensureUniversalUnits(companyId)

    const units = await prisma.unit.findMany({
      where: { companyId },
      orderBy: [{ isUniversal: 'desc' }, { name: 'asc' }]
    })

    return NextResponse.json(units, { headers: setCORSHeaders() })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: setCORSHeaders() })
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const companyId = normalizeId(new URL(request.url).searchParams.get('companyId'))
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400, headers: setCORSHeaders() })
    }

    const scopeGuard = await ensureCompanyAccess(request, companyId)
    if (scopeGuard) return scopeGuard

    const body = await request.json().catch(() => ({}))

    if ((body as { seed?: unknown }).seed === true) {
      const created = await prisma.$transaction(
        DUMMY_UNITS.map((row) =>
          prisma.unit.upsert({
            where: {
              companyId_symbol: {
                companyId,
                symbol: row.symbol
              }
            },
            update: {
              name: row.name,
              kgEquivalent: row.kgEquivalent,
              isUniversal: row.isUniversal,
              description: row.description
            },
            create: {
              companyId,
              name: row.name,
              symbol: row.symbol,
              kgEquivalent: row.kgEquivalent,
              isUniversal: row.isUniversal,
              description: row.description
            }
          })
        )
      )

      return NextResponse.json(
        { success: true, message: `${created.length} dummy units added successfully`, count: created.length },
        { headers: setCORSHeaders() }
      )
    }

    const name = String((body as { name?: unknown }).name || '').trim()
    const symbolNormalized = String((body as { symbol?: unknown }).symbol || '').trim().toLowerCase()
    const description =
      typeof (body as { description?: unknown }).description === 'string'
        ? (body as { description?: string }).description
        : null

    const isUniversal = isUniversalSymbol(symbolNormalized)
    const kgEquivalent = isUniversal
      ? symbolNormalized === UNIVERSAL_UNITS.KG
        ? 1
        : UNIVERSAL_UNITS.KG_PER_QUINTAL
      : toNumber((body as { kgEquivalent?: unknown }).kgEquivalent, 0)

    if (!name || !symbolNormalized) {
      return NextResponse.json({ error: 'Unit name and symbol are required' }, { status: 400, headers: setCORSHeaders() })
    }

    if (kgEquivalent <= 0) {
      return NextResponse.json({ error: 'KG equivalent must be greater than zero' }, { status: 400, headers: setCORSHeaders() })
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
      return NextResponse.json({ error: 'Unit with this symbol already exists' }, { status: 400, headers: setCORSHeaders() })
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

    return NextResponse.json(unit, { headers: setCORSHeaders() })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: setCORSHeaders() })
  }
}

export async function PUT(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const id = normalizeId(searchParams.get('id'))
    const companyId = normalizeId(searchParams.get('companyId'))

    if (!id) {
      return NextResponse.json({ error: 'Unit ID required' }, { status: 400, headers: setCORSHeaders() })
    }
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400, headers: setCORSHeaders() })
    }

    const scopeGuard = await ensureCompanyAccess(request, companyId)
    if (scopeGuard) return scopeGuard

    const body = await request.json().catch(() => ({}))
    const name = String((body as { name?: unknown }).name || '').trim()
    const symbolNormalized = String((body as { symbol?: unknown }).symbol || '').trim().toLowerCase()
    const description =
      typeof (body as { description?: unknown }).description === 'string'
        ? (body as { description?: string }).description
        : null

    const isUniversal = isUniversalSymbol(symbolNormalized)
    const kgEquivalent = isUniversal
      ? symbolNormalized === UNIVERSAL_UNITS.KG
        ? 1
        : UNIVERSAL_UNITS.KG_PER_QUINTAL
      : toNumber((body as { kgEquivalent?: unknown }).kgEquivalent, 0)

    if (!name || !symbolNormalized) {
      return NextResponse.json({ error: 'Unit name and symbol are required' }, { status: 400, headers: setCORSHeaders() })
    }
    if (kgEquivalent <= 0) {
      return NextResponse.json({ error: 'KG equivalent must be greater than zero' }, { status: 400, headers: setCORSHeaders() })
    }

    await ensureUniversalUnits(companyId)

    const currentUnit = await prisma.unit.findFirst({
      where: {
        id,
        companyId
      }
    })

    if (!currentUnit) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404, headers: setCORSHeaders() })
    }

    if (currentUnit.isUniversal) {
      return NextResponse.json({ error: 'Universal units cannot be edited' }, { status: 403, headers: setCORSHeaders() })
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
      return NextResponse.json({ error: 'Unit with this symbol already exists' }, { status: 400, headers: setCORSHeaders() })
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

    return NextResponse.json(unit, { headers: setCORSHeaders() })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: setCORSHeaders() })
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const id = normalizeId(searchParams.get('id'))
    const all = searchParams.get('all') === 'true'
    const companyId = normalizeId(searchParams.get('companyId'))

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400, headers: setCORSHeaders() })
    }

    const scopeGuard = await ensureCompanyAccess(request, companyId)
    if (scopeGuard) return scopeGuard

    if (all) {
      await ensureUniversalUnits(companyId)

      const deleted = await prisma.unit.deleteMany({
        where: {
          companyId,
          isUniversal: false
        }
      })

      return NextResponse.json(
        { success: true, message: `${deleted.count} units deleted successfully`, count: deleted.count },
        { headers: setCORSHeaders() }
      )
    }

    if (!id) {
      return NextResponse.json({ error: 'Unit ID required' }, { status: 400, headers: setCORSHeaders() })
    }

    const unit = await prisma.unit.findFirst({
      where: { id, companyId }
    })

    if (!unit) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404, headers: setCORSHeaders() })
    }

    if (unit.isUniversal) {
      return NextResponse.json({ error: 'Universal units cannot be deleted' }, { status: 403, headers: setCORSHeaders() })
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

    return NextResponse.json({ success: true, message: 'Unit deleted successfully' }, { headers: setCORSHeaders() })
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
