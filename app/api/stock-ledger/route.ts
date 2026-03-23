import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'

const stockLedgerCreateSchema = z.object({
  companyId: z.string().min(1),
  productId: z.string().min(1),
  entryDate: z.string().min(1),
  type: z.enum(['purchase', 'sales', 'adjustment']),
  qtyIn: z.coerce.number().min(0).optional(),
  qtyOut: z.coerce.number().min(0).optional(),
  refTable: z.string().min(1),
  refId: z.string().min(1)
}).refine((data) => (data.qtyIn || 0) > 0 || (data.qtyOut || 0) > 0, {
  message: 'Either qtyIn or qtyOut must be greater than 0',
  path: ['qtyIn']
})

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, stockLedgerCreateSchema)
    if (!parsed.ok) return parsed.response
    const { companyId, productId, entryDate, type, qtyIn, qtyOut, refTable, refId } = parsed.data
    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const [product, summary] = await Promise.all([
      prisma.product.findFirst({
        where: {
          id: productId,
          companyId
        },
        select: {
          id: true,
          name: true,
          unit: {
            select: {
              symbol: true
            }
          }
        }
      }),
      prisma.stockLedger.aggregate({
        where: {
          companyId,
          productId
        },
        _sum: {
          qtyIn: true,
          qtyOut: true
        }
      })
    ])

    if (!product) {
      return NextResponse.json({ error: 'Selected product not found' }, { status: 404 })
    }

    const nextQtyOut = Number(qtyOut) || 0
    const currentStock = Number(summary._sum.qtyIn || 0) - Number(summary._sum.qtyOut || 0)
    if (nextQtyOut > 0 && type === 'adjustment' && nextQtyOut > currentStock) {
      return NextResponse.json(
        {
          error: `Adjustment quantity cannot exceed current stock (${currentStock.toFixed(2)} ${product.unit.symbol})`
        },
        { status: 400 }
      )
    }

    // Create stock ledger entry
    const stockLedger = await prisma.stockLedger.create({
      data: {
        companyId,
        entryDate: new Date(entryDate),
        productId,
        type,
        qtyIn: Number(qtyIn) || 0,
        qtyOut: Number(qtyOut) || 0,
        refTable,
        refId
      }
    })

    return NextResponse.json({ success: true, stockLedger })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const productId = searchParams.get('productId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }
    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const whereClause: {
      companyId: string
      productId?: string
      entryDate?: {
        gte?: Date
        lte?: Date
      }
    } = { companyId }
    if (productId) {
      whereClause.productId = productId
    }
    if (dateFrom || dateTo) {
      const entryDate: { gte?: Date; lte?: Date } = {}
      if (dateFrom) {
        const parsedFrom = new Date(`${dateFrom}T00:00:00`)
        if (Number.isFinite(parsedFrom.getTime())) {
          entryDate.gte = parsedFrom
        }
      }
      if (dateTo) {
        const parsedTo = new Date(`${dateTo}T23:59:59.999`)
        if (Number.isFinite(parsedTo.getTime())) {
          entryDate.lte = parsedTo
        }
      }
      if (entryDate.gte || entryDate.lte) {
        whereClause.entryDate = entryDate
      }
    }

    const stockLedger = await prisma.stockLedger.findMany({
      where: whereClause,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            unit: true
          }
        }
      },
      orderBy: { entryDate: 'desc' }
    })

    return NextResponse.json(stockLedger)
  } catch (error) {
    void error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
