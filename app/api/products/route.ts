import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseJsonWithSchema, requireRoles } from '@/lib/api-security'
import { buildPaginationMeta, parsePaginationParams } from '@/lib/pagination'

function normalizeCompanyId(raw: string | null): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value === 'null' || value === 'undefined') return null
  return value
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v.length > 0 ? v : null
}

async function ensureReadAccess(request: NextRequest, companyId: string) {
  const denied = await ensureCompanyAccess(request, companyId)
  if (denied) return denied
  return null
}

async function ensureWriteAccess(request: NextRequest, companyId: string) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin'])
  if (!authResult.ok) {
    return authResult.response
  }

  const denied = await ensureCompanyAccess(request, companyId)
  if (denied) return denied

  return null
}

const postSchema = z.object({
  name: z.string().trim().min(1).optional(),
  unit: z.string().trim().min(1).optional(),
  hsnCode: z.string().optional().nullable(),
  gstRate: z.union([z.number(), z.string()]).optional().nullable(),
  sellingPrice: z.union([z.number(), z.string()]).optional().nullable(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

const putSchema = z.object({
  name: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  hsnCode: z.string().optional().nullable(),
  gstRate: z.union([z.number(), z.string()]).optional().nullable(),
  sellingPrice: z.union([z.number(), z.string()]).optional().nullable(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams
    const companyId = normalizeCompanyId(searchParams.get('companyId'))
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureReadAccess(request, companyId)
    if (denied) return denied

    const pagination = parsePaginationParams(searchParams, { defaultPageSize: 50, maxPageSize: 200 })
    const where = {
      companyId,
      ...(pagination.search
        ? {
            OR: [
              { name: { contains: pagination.search } },
              { hsnCode: { contains: pagination.search } },
              { description: { contains: pagination.search } }
            ]
          }
        : {})
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          unit: true
        },
        orderBy: { name: 'asc' },
        ...(pagination.enabled ? { skip: pagination.skip, take: pagination.pageSize } : {})
      }),
      pagination.enabled ? prisma.product.count({ where }) : Promise.resolve(0)
    ])

    const productIds = products.map((product) => product.id)
    const stockSummary =
      productIds.length > 0
        ? await prisma.stockLedger.groupBy({
            by: ['productId'],
            where: {
              companyId,
              productId: { in: productIds }
            },
            _sum: {
              qtyIn: true,
              qtyOut: true
            }
          })
        : []

    const stockSummaryMap = new Map(
      stockSummary.map((row) => [
        row.productId,
        {
          qtyIn: Number(row._sum.qtyIn || 0),
          qtyOut: Number(row._sum.qtyOut || 0)
        }
      ])
    )

    const rows = products.map((product) => {
      const totals = stockSummaryMap.get(product.id) || { qtyIn: 0, qtyOut: 0 }
      return {
        id: product.id,
        name: product.name,
        unit: product.unit.symbol,
        hsnCode: product.hsnCode,
        gstRate: product.gstRate,
        sellingPrice: product.sellingPrice,
        description: product.description,
        isActive: product.isActive,
        currentStock: totals.qtyIn - totals.qtyOut,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
      }
    })

    if (pagination.enabled) {
      return NextResponse.json({
        data: rows,
        meta: buildPaginationMeta(total, pagination)
      })
    }

    return NextResponse.json(rows)
  } catch (error) {
    console.error('GET /api/products failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, postSchema)
    if (!parsed.ok) return parsed.response

    const companyId = normalizeCompanyId(new URL(request.url).searchParams.get('companyId'))
    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureWriteAccess(request, companyId)
    if (denied) return denied

    const name = clean(parsed.data.name)
    const unit = clean(parsed.data.unit)
    if (!name || !unit) {
      return NextResponse.json({ error: 'Product name and unit are required' }, { status: 400 })
    }

    const unitRecord = await prisma.unit.findFirst({
      where: { companyId, symbol: unit.toLowerCase() }
    })
    if (!unitRecord) {
      return NextResponse.json({ error: 'Invalid unit' }, { status: 400 })
    }

    const product = await prisma.product.create({
      data: {
        companyId,
        name,
        unitId: unitRecord.id,
        hsnCode: clean(parsed.data.hsnCode),
        gstRate: parsed.data.gstRate !== undefined && parsed.data.gstRate !== null ? Number(parsed.data.gstRate) : null,
        sellingPrice: parsed.data.sellingPrice !== undefined && parsed.data.sellingPrice !== null ? Number(parsed.data.sellingPrice) : null,
        description: clean(parsed.data.description),
        isActive: parsed.data.isActive !== false
      },
      include: { unit: true }
    })

    return NextResponse.json({
      success: true,
      message: 'Product data stored successfully',
      product: {
        id: product.id,
        name: product.name,
        unit: product.unit.symbol,
        hsnCode: product.hsnCode,
        gstRate: product.gstRate,
        sellingPrice: product.sellingPrice,
        description: product.description,
        isActive: product.isActive,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
      }
    })
  } catch (error) {
    console.error('POST /api/products failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, putSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const companyId = normalizeCompanyId(searchParams.get('companyId'))
    if (!id || !companyId) {
      return NextResponse.json({ error: 'Product ID and Company ID required' }, { status: 400 })
    }

    const denied = await ensureWriteAccess(request, companyId)
    if (denied) return denied

    const existingProduct = await prisma.product.findFirst({
      where: { id, companyId },
      select: { id: true }
    })
    if (!existingProduct) {
      return NextResponse.json({ error: 'Product not found for this company' }, { status: 404 })
    }

    const unitRecord = await prisma.unit.findFirst({
      where: { companyId, symbol: parsed.data.unit.toLowerCase() }
    })
    if (!unitRecord) {
      return NextResponse.json({ error: 'Invalid unit' }, { status: 400 })
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: parsed.data.name,
        unitId: unitRecord.id,
        hsnCode: clean(parsed.data.hsnCode),
        gstRate: parsed.data.gstRate !== undefined && parsed.data.gstRate !== null ? Number(parsed.data.gstRate) : null,
        sellingPrice: parsed.data.sellingPrice !== undefined && parsed.data.sellingPrice !== null ? Number(parsed.data.sellingPrice) : null,
        description: clean(parsed.data.description),
        isActive: parsed.data.isActive !== false
      },
      include: { unit: true }
    })

    return NextResponse.json({
      success: true,
      message: 'Product updated successfully',
      product: {
        id: product.id,
        name: product.name,
        unit: product.unit.symbol,
        hsnCode: product.hsnCode,
        gstRate: product.gstRate,
        sellingPrice: product.sellingPrice,
        description: product.description,
        isActive: product.isActive,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
      }
    })
  } catch (error) {
    console.error('PUT /api/products failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = normalizeCompanyId(searchParams.get('companyId'))
    const id = searchParams.get('id')
    const all = searchParams.get('all') === 'true'

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureWriteAccess(request, companyId)
    if (denied) return denied

    if (all) {
      const result = await prisma.product.deleteMany({ where: { companyId } })
      return NextResponse.json({
        success: true,
        message: `${result.count} products deleted successfully`,
        count: result.count
      })
    }

    if (!id) {
      return NextResponse.json({ error: 'Product ID required' }, { status: 400 })
    }

    const existingProduct = await prisma.product.findFirst({
      where: { id, companyId },
      select: { id: true }
    })
    if (!existingProduct) {
      return NextResponse.json({ error: 'Product not found for this company' }, { status: 404 })
    }

    await prisma.product.delete({ where: { id } })
    return NextResponse.json({ success: true, message: 'Product deleted successfully' })
  } catch (error) {
    console.error('DELETE /api/products failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}