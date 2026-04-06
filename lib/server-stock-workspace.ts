import { prisma } from '@/lib/prisma'

type StockOverviewSummaryQueryRow = {
  productId: string
  productName: string
  productUnit: string | null
  productIsActive: boolean | number | bigint | string | null
  totalIn: number | string | null
  totalOut: number | string | null
  closingStock: number | string | null
  movementCount: number | bigint | null
  adjustmentEntries: number | bigint | null
  lastMovementDate: Date | string | null
}

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

export async function loadStockWorkspaceData(companyId: string, recentLimit = 60) {
  const [overviewRows, totalTransactions, stockLedger] = await Promise.all([
    prisma.$queryRaw<StockOverviewSummaryQueryRow[]>`
      SELECT
        p."id" AS "productId",
        p."name" AS "productName",
        u."symbol" AS "productUnit",
        p."isActive" AS "productIsActive",
        COALESCE(SUM(sl."qtyIn"), 0) AS "totalIn",
        COALESCE(SUM(sl."qtyOut"), 0) AS "totalOut",
        COALESCE(SUM(sl."qtyIn"), 0) - COALESCE(SUM(sl."qtyOut"), 0) AS "closingStock",
        COUNT(sl."id") AS "movementCount",
        COALESCE(SUM(CASE WHEN sl."type" = 'adjustment' THEN 1 ELSE 0 END), 0) AS "adjustmentEntries",
        MAX(sl."entryDate") AS "lastMovementDate"
      FROM "Product" p
      LEFT JOIN "Unit" u
        ON u."id" = p."unitId"
      LEFT JOIN "StockLedger" sl
        ON sl."productId" = p."id"
       AND sl."companyId" = p."companyId"
      WHERE p."companyId" = ${companyId}
      GROUP BY p."id", p."name", u."symbol", p."isActive"
      ORDER BY p."name" ASC
    `,
    prisma.stockLedger.count({
      where: {
        companyId
      }
    }),
    prisma.stockLedger.findMany({
      where: {
        companyId
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

  return {
    products: overviewRows.map((row) => ({
      id: row.productId,
      name: row.productName,
      unit: row.productUnit || '',
      isActive:
        row.productIsActive === false ||
        row.productIsActive === 0 ||
        row.productIsActive === '0' ||
        row.productIsActive === 'false'
          ? false
          : true,
      currentStock: toNumber(row.closingStock)
    })),
    stockSummary: overviewRows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      productUnit: row.productUnit || '',
      totalIn: toNumber(row.totalIn),
      totalOut: toNumber(row.totalOut),
      closingStock: toNumber(row.closingStock),
      movementCount: toNumber(row.movementCount),
      adjustmentEntries: toNumber(row.adjustmentEntries),
      lastMovementDate: toDateOrNull(row.lastMovementDate)
    })),
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
