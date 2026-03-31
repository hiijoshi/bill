import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { buildPaginationMeta, parsePaginationParams } from '@/lib/pagination'

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

const MAX_OVERVIEW_RECENT_ENTRIES = 200
const DEFAULT_OVERVIEW_RECENT_ENTRIES = 80

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

function parsePositiveLimit(rawValue: string | null, fallback: number, max: number): number {
  if (!rawValue) return fallback
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function parseBooleanFlag(rawValue: string | null, fallback: boolean): boolean {
  if (rawValue === null) return fallback
  const normalized = rawValue.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function parseLedgerType(value: string | null): 'purchase' | 'sales' | 'adjustment' | null {
  if (value === 'purchase' || value === 'sales' || value === 'adjustment') {
    return value
  }
  return null
}

function toNumber(value: number | bigint | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
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

type StockLedgerEntryRow = {
  id: string
  entryDate: Date
  type: string
  qtyIn: number
  qtyOut: number
  refTable: string
  refId: string
  createdAt: Date
  note?: string | null
  product: {
    id: string
    name: string
    unit: {
      symbol: string
    } | null
  }
}

function normalizeLedgerEntry(entry: StockLedgerEntryRow) {
  return {
    id: entry.id,
    entryDate: entry.entryDate,
    type: entry.type,
    qtyIn: Number(entry.qtyIn || 0),
    qtyOut: Number(entry.qtyOut || 0),
    refTable: entry.refTable,
    refId: entry.refId,
    note: entry.note || null,
    createdAt: entry.createdAt,
    product: {
      id: entry.product.id,
      name: entry.product.name,
      unit: entry.product.unit?.symbol || ''
    }
  }
}

async function attachLedgerNotes(rows: StockLedgerEntryRow[]): Promise<StockLedgerEntryRow[]> {
  const adjustmentIds = rows
    .filter((row) => row.type === 'adjustment')
    .map((row) => row.id)

  if (adjustmentIds.length === 0) {
    return rows
  }

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      resourceType: 'STOCK',
      resourceId: { in: adjustmentIds }
    },
    select: {
      resourceId: true,
      notes: true,
      createdAt: true
    },
    orderBy: [{ createdAt: 'desc' }]
  })

  const noteByEntryId = new Map<string, string>()
  for (const log of auditLogs) {
    const note = String(log.notes || '').trim()
    if (!note || noteByEntryId.has(log.resourceId)) continue
    noteByEntryId.set(log.resourceId, note)
  }

  return rows.map((row) => ({
    ...row,
    note: noteByEntryId.get(row.id) || null
  }))
}

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
    const type = parseLedgerType(searchParams.get('type'))
    const mode = searchParams.get('mode')
    const recentLimit = parsePositiveLimit(
      searchParams.get('recentLimit'),
      DEFAULT_OVERVIEW_RECENT_ENTRIES,
      MAX_OVERVIEW_RECENT_ENTRIES
    )
    const includeMeta = parseBooleanFlag(searchParams.get('includeMeta'), true)
    const includeRecent = parseBooleanFlag(searchParams.get('includeRecent'), true)
    const pagination = parsePaginationParams(searchParams, {
      defaultPageSize: 50,
      maxPageSize: 200
    })

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
      type?: 'purchase' | 'sales' | 'adjustment'
    } = { companyId }
    if (productId) {
      whereClause.productId = productId
    }
    if (type) {
      whereClause.type = type
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

    if (mode === 'overview') {
      const [overviewRows, totalEntries, recentEntries] = await Promise.all([
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
        includeMeta
          ? prisma.stockLedger.count({
              where: { companyId }
            })
          : Promise.resolve(0),
        includeRecent
          ? prisma.stockLedger.findMany({
              where: whereClause,
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
          : Promise.resolve([])
      ])

      const summary = overviewRows.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        productUnit: row.productUnit || '',
        productIsActive: row.productIsActive,
        totalIn: toNumber(row.totalIn),
        totalOut: toNumber(row.totalOut),
        closingStock: toNumber(row.closingStock),
        movementCount: toNumber(row.movementCount),
        adjustmentEntries: toNumber(row.adjustmentEntries),
        lastMovementDate: toDateOrNull(row.lastMovementDate)
      }))

      const recentEntriesWithNotes = await attachLedgerNotes(recentEntries)

      return NextResponse.json({
        companyId,
        products: summary.map((row) => ({
          id: row.productId,
          name: row.productName,
          unit: row.productUnit,
          isActive: row.productIsActive === false || row.productIsActive === 0 || row.productIsActive === '0' || row.productIsActive === 'false' ? false : true,
          currentStock: row.closingStock
        })),
        summary,
        recentEntries: recentEntriesWithNotes.map(normalizeLedgerEntry),
        ...(includeMeta
          ? {
              meta: {
                companyId,
                totalEntries,
                returnedEntries: recentEntries.length,
                recentLimit
              }
            }
          : {})
      })
    }

    const [stockLedger, total] = await Promise.all([
      prisma.stockLedger.findMany({
        where: whereClause,
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
        ...(pagination.enabled ? { skip: pagination.skip, take: pagination.pageSize } : {})
      }),
      pagination.enabled ? prisma.stockLedger.count({ where: whereClause }) : Promise.resolve(0)
    ])

    const rows = (await attachLedgerNotes(stockLedger)).map(normalizeLedgerEntry)

    if (pagination.enabled) {
      return NextResponse.json({
        data: rows,
        companyId,
        meta: buildPaginationMeta(total, pagination)
      })
    }

    return NextResponse.json(rows)
  } catch (error) {
    void error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
