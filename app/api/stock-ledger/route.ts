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

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }
    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    // Auto-heal legacy records: older sales bills may exist without stock ledger rows.
    const [salesBills, existingSalesEntries] = await Promise.all([
      prisma.salesBill.findMany({
        where: { companyId },
        select: {
          id: true,
          billDate: true,
          salesItems: {
            select: {
              productId: true,
              weight: true
            }
          }
        }
      }),
      prisma.stockLedger.findMany({
        where: {
          companyId,
          refTable: 'sales_bills'
        },
        select: {
          refId: true,
          productId: true
        }
      })
    ])

    const existingEntrySet = new Set(existingSalesEntries.map((entry) => `${entry.refId}:${entry.productId}`))
    const missingLedgerEntries = salesBills
      .flatMap((bill) =>
        bill.salesItems
          .filter((item) => Number(item.weight || 0) > 0)
          .filter((item) => !existingEntrySet.has(`${bill.id}:${item.productId}`))
          .map((item) => ({
            companyId,
            entryDate: bill.billDate,
            productId: item.productId,
            type: 'sales',
            qtyIn: 0,
            qtyOut: Number(item.weight || 0),
            refTable: 'sales_bills',
            refId: bill.id
          }))
      )

    if (missingLedgerEntries.length > 0) {
      await prisma.$transaction(
        missingLedgerEntries.map((entry) =>
          prisma.stockLedger.create({
            data: entry
          })
        )
      )
    }

    const whereClause: { companyId: string; productId?: string } = { companyId }
    if (productId) {
      whereClause.productId = productId
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
