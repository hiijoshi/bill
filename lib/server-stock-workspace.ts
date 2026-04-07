import { prisma } from '@/lib/prisma'
import { buildDateRangeWhere } from '@/lib/financial-years'

function toNumber(value: number | bigint | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

export async function loadStockWorkspaceData(
  companyId: string,
  recentLimit = 60,
  options: {
    dateFrom?: Date | null
    dateTo?: Date | null
  } = {}
) {
  const stockDateWhere = buildDateRangeWhere('entryDate', options.dateFrom || null, options.dateTo || null)

  const [products, stockMovementRows, adjustmentRows, totalTransactions, stockLedger] = await Promise.all([
    prisma.product.findMany({
      where: {
        companyId
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        unit: {
          select: {
            symbol: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    }),
    prisma.stockLedger.groupBy({
      by: ['productId'],
      where: {
        companyId,
        ...stockDateWhere
      },
      _sum: {
        qtyIn: true,
        qtyOut: true
      },
      _count: {
        _all: true
      },
      _max: {
        entryDate: true
      }
    }),
    prisma.stockLedger.groupBy({
      by: ['productId'],
      where: {
        companyId,
        type: 'adjustment',
        ...stockDateWhere
      },
      _count: {
        _all: true
      }
    }),
    prisma.stockLedger.count({
      where: {
        companyId,
        ...stockDateWhere
      }
    }),
    prisma.stockLedger.findMany({
      where: {
        companyId,
        ...stockDateWhere
      },
      select: {
        id: true,
        entryDate: true,
        type: true,
        qtyIn: true,
        qtyOut: true,
        refTable: true,
        refId: true,
        createdAt: true,
        product: {
          select: {
            id: true,
            name: true,
            unit: {
              select: {
                symbol: true
              }
            }
          }
        }
      },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      take: recentLimit
    })
  ])

  const movementByProductId = new Map(
    stockMovementRows.map((row) => [
      row.productId,
      {
        totalIn: toNumber(row._sum.qtyIn),
        totalOut: toNumber(row._sum.qtyOut),
        movementCount: toNumber(row._count._all),
        lastMovementDate: toDateOrNull(row._max.entryDate)
      }
    ])
  )
  const adjustmentCountByProductId = new Map(
    adjustmentRows.map((row) => [row.productId, toNumber(row._count._all)])
  )

  const stockSummary = products.map((product) => {
    const movement = movementByProductId.get(product.id)
    const totalIn = movement?.totalIn || 0
    const totalOut = movement?.totalOut || 0
    return {
      productId: product.id,
      productName: product.name,
      productUnit: product.unit?.symbol || '',
      totalIn,
      totalOut,
      closingStock: totalIn - totalOut,
      movementCount: movement?.movementCount || 0,
      adjustmentEntries: adjustmentCountByProductId.get(product.id) || 0,
      lastMovementDate: movement?.lastMovementDate || null
    }
  })

  return {
    products: products.map((product) => {
      const summary = stockSummary.find((row) => row.productId === product.id)
      return {
        id: product.id,
        name: product.name,
        unit: product.unit?.symbol || '',
        isActive: product.isActive,
        currentStock: summary?.closingStock || 0
      }
    }),
    stockSummary,
    totalTransactions,
    stockLedger: stockLedger.map((entry) => ({
      id: entry.id,
      entryDate: entry.entryDate,
      type: entry.type,
      qtyIn: Number(entry.qtyIn || 0),
      qtyOut: Number(entry.qtyOut || 0),
      refTable: entry.refTable,
      refId: entry.refId,
      createdAt: entry.createdAt,
      product: {
        id: entry.product.id,
        name: entry.product.name,
        unit: entry.product.unit?.symbol || ''
      }
    }))
  }
}
