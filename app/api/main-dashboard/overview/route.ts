import { NextRequest, NextResponse } from 'next/server'

import {
  getAccessibleCompanies,
  normalizeId,
  normalizeAppRole,
  requireRoles,
  type RequestAuthContext
} from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { getOrSetServerCache, makeServerCacheKey } from '@/lib/server-cache'
import { resolveSupabaseAppSession } from '@/lib/supabase/app-session'

type OverviewSection =
  | 'purchaseBills'
  | 'salesBills'
  | 'payments'
  | 'products'
  | 'parties'
  | 'units'
  | 'stockLedger'

type OverviewScopedCompanyIds = {
  purchaseCompanyIds: string[]
  salesCompanyIds: string[]
  paymentCompanyIds: string[]
  productCompanyIds: string[]
  partyCompanyIds: string[]
  unitCompanyIds: string[]
  stockCompanyIds: string[]
}

type OverviewSummary = {
  purchase: {
    total: number
    paid: number
    pending: number
    count: number
  }
  sales: {
    total: number
    received: number
    pending: number
    count: number
  }
  cashflow: {
    inAmount: number
    outAmount: number
    net: number
    count: number
  }
  masterRecords: {
    products: number
    parties: number
    units: number
  }
  inventory: {
    stockEntries: number
    lowStock: number
    lowStockItems: Array<{ name: string; balance: number }>
  }
  notifications: {
    pendingBills: number
  }
}

type CompanyPerformanceRow = {
  id: string
  name: string
  purchaseTotal: number
  salesTotal: number
  paymentIn: number
  paymentOut: number
  purchaseBills: number
  salesBills: number
  cashflow: number
}

type TrendRow = {
  day: string
  purchase: number
  sales: number
  payment: number
}

const OVERVIEW_SECTIONS: readonly OverviewSection[] = [
  'purchaseBills',
  'salesBills',
  'payments',
  'products',
  'parties',
  'units',
  'stockLedger'
]

const OVERVIEW_CACHE_TTL_MS = 15_000
const RECENT_BILLS_LIMIT = 8
const TREND_WINDOW_DAYS = 7

const emptyOverviewPayload = {
  purchaseBills: [],
  salesBills: [],
  payments: [],
  products: [],
  parties: [],
  units: [],
  stockLedger: [],
  summary: {
    purchase: { total: 0, paid: 0, pending: 0, count: 0 },
    sales: { total: 0, received: 0, pending: 0, count: 0 },
    cashflow: { inAmount: 0, outAmount: 0, net: 0, count: 0 },
    masterRecords: { products: 0, parties: 0, units: 0 },
    inventory: { stockEntries: 0, lowStock: 0, lowStockItems: [] },
    notifications: { pendingBills: 0 }
  } as OverviewSummary,
  companyPerformance: [] as CompanyPerformanceRow[],
  trendData: [] as TrendRow[]
}

function parseOverviewIncludes(searchParams: URLSearchParams): Set<OverviewSection> {
  const rawValues = searchParams
    .getAll('include')
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean)

  if (rawValues.length === 0) {
    return new Set(OVERVIEW_SECTIONS)
  }

  const allowed = new Set<OverviewSection>(OVERVIEW_SECTIONS)
  const nextIncludes = new Set<OverviewSection>()
  for (const value of rawValues) {
    if (allowed.has(value as OverviewSection)) {
      nextIncludes.add(value as OverviewSection)
    }
  }

  return nextIncludes.size > 0 ? nextIncludes : new Set(OVERVIEW_SECTIONS)
}

function toNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function startOfToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

function buildTrendRows(params: {
  purchaseRows: Array<{ billDate: Date; totalAmount: number }>
  salesRows: Array<{ billDate: Date; totalAmount: number }>
  paymentRows: Array<{ payDate: Date; amount: number }>
}) {
  const start = startOfToday()
  start.setDate(start.getDate() - (TREND_WINDOW_DAYS - 1))

  const days: string[] = []
  const purchaseByDay = new Map<string, number>()
  const salesByDay = new Map<string, number>()
  const paymentByDay = new Map<string, number>()

  for (let i = 0; i < TREND_WINDOW_DAYS; i += 1) {
    const current = new Date(start)
    current.setDate(start.getDate() + i)
    const key = current.toISOString().slice(0, 10)
    days.push(key)
    purchaseByDay.set(key, 0)
    salesByDay.set(key, 0)
    paymentByDay.set(key, 0)
  }

  for (const row of params.purchaseRows) {
    const key = row.billDate.toISOString().slice(0, 10)
    if (purchaseByDay.has(key)) {
      purchaseByDay.set(key, (purchaseByDay.get(key) || 0) + toNumber(row.totalAmount))
    }
  }

  for (const row of params.salesRows) {
    const key = row.billDate.toISOString().slice(0, 10)
    if (salesByDay.has(key)) {
      salesByDay.set(key, (salesByDay.get(key) || 0) + toNumber(row.totalAmount))
    }
  }

  for (const row of params.paymentRows) {
    const key = row.payDate.toISOString().slice(0, 10)
    if (paymentByDay.has(key)) {
      paymentByDay.set(key, (paymentByDay.get(key) || 0) + toNumber(row.amount))
    }
  }

  return days.map((day) => ({
    day,
    purchase: purchaseByDay.get(day) || 0,
    sales: salesByDay.get(day) || 0,
    payment: paymentByDay.get(day) || 0
  }))
}

async function getOverviewScopedCompanyIds(
  auth: RequestAuthContext,
  targetCompanyIds: string[]
): Promise<OverviewScopedCompanyIds> {
  const emptyScopes: OverviewScopedCompanyIds = {
    purchaseCompanyIds: [],
    salesCompanyIds: [],
    paymentCompanyIds: [],
    productCompanyIds: [],
    partyCompanyIds: [],
    unitCompanyIds: [],
    stockCompanyIds: []
  }

  if (targetCompanyIds.length === 0) return emptyScopes

  if (auth.role === 'super_admin') {
    return {
      purchaseCompanyIds: targetCompanyIds,
      salesCompanyIds: targetCompanyIds,
      paymentCompanyIds: targetCompanyIds,
      productCompanyIds: targetCompanyIds,
      partyCompanyIds: targetCompanyIds,
      unitCompanyIds: targetCompanyIds,
      stockCompanyIds: targetCompanyIds
    }
  }

  if (!auth.userDbId) {
    return emptyScopes
  }

  const rows = await prisma.userPermission.findMany({
    where: {
      userId: auth.userDbId,
      companyId: { in: targetCompanyIds },
      module: {
        in: [
          'PURCHASE_LIST',
          'SALES_LIST',
          'PAYMENTS',
          'MASTER_PRODUCTS',
          'MASTER_PARTIES',
          'MASTER_UNITS',
          'STOCK_DASHBOARD'
        ]
      },
      OR: [{ canRead: true }, { canWrite: true }]
    },
    select: {
      companyId: true,
      module: true
    }
  })

  const companyIdsByModule = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = companyIdsByModule.get(row.module) || new Set<string>()
    set.add(row.companyId)
    companyIdsByModule.set(row.module, set)
  }

  return {
    purchaseCompanyIds: Array.from(companyIdsByModule.get('PURCHASE_LIST') || []),
    salesCompanyIds: Array.from(companyIdsByModule.get('SALES_LIST') || []),
    paymentCompanyIds: Array.from(companyIdsByModule.get('PAYMENTS') || []),
    productCompanyIds: Array.from(companyIdsByModule.get('MASTER_PRODUCTS') || []),
    partyCompanyIds: Array.from(companyIdsByModule.get('MASTER_PARTIES') || []),
    unitCompanyIds: Array.from(companyIdsByModule.get('MASTER_UNITS') || []),
    stockCompanyIds: Array.from(companyIdsByModule.get('STOCK_DASHBOARD') || [])
  }
}

async function loadOverviewPayload(params: {
  includes: Set<OverviewSection>
  scopes: OverviewScopedCompanyIds
  companies: Array<{ id: string; name: string }>
}) {
  const {
    purchaseCompanyIds,
    salesCompanyIds,
    paymentCompanyIds,
    productCompanyIds,
    partyCompanyIds,
    unitCompanyIds,
    stockCompanyIds
  } = params.scopes

  const purchaseWhere = purchaseCompanyIds.length > 0 ? { companyId: { in: purchaseCompanyIds } } : null
  const salesWhere = salesCompanyIds.length > 0 ? { companyId: { in: salesCompanyIds } } : null
  const paymentWhere =
    paymentCompanyIds.length > 0 ? { companyId: { in: paymentCompanyIds }, deletedAt: null } : null

  const trendStart = startOfToday()
  trendStart.setDate(trendStart.getDate() - (TREND_WINDOW_DAYS - 1))

  const [
    purchaseSummary,
    salesSummary,
    paymentSummary,
    purchasePendingCount,
    salesPendingCount,
    recentPurchaseBills,
    recentSalesBills,
    productCount,
    partyCount,
    unitCount,
    stockEntriesCount,
    stockBalances,
    purchaseByCompany,
    salesByCompany,
    paymentsByCompany,
    purchaseTrendRows,
    salesTrendRows,
    paymentTrendRows
  ] = await Promise.all([
    purchaseWhere
      ? prisma.purchaseBill.aggregate({
          where: purchaseWhere,
          _count: { _all: true },
          _sum: {
            totalAmount: true,
            paidAmount: true,
            balanceAmount: true
          }
        })
      : Promise.resolve(null),
    salesWhere
      ? prisma.salesBill.aggregate({
          where: salesWhere,
          _count: { _all: true },
          _sum: {
            totalAmount: true,
            receivedAmount: true,
            balanceAmount: true
          }
        })
      : Promise.resolve(null),
    paymentWhere
      ? prisma.payment.aggregate({
          where: paymentWhere,
          _count: { _all: true },
          _sum: {
            amount: true
          }
        })
      : Promise.resolve(null),
    purchaseWhere
      ? prisma.purchaseBill.count({
          where: {
            ...purchaseWhere,
            balanceAmount: { gt: 0 }
          }
        })
      : Promise.resolve(0),
    salesWhere
      ? prisma.salesBill.count({
          where: {
            ...salesWhere,
            balanceAmount: { gt: 0 }
          }
        })
      : Promise.resolve(0),
    params.includes.has('purchaseBills') && purchaseWhere
      ? prisma.purchaseBill.findMany({
          where: purchaseWhere,
          select: {
            id: true,
            companyId: true,
            billNo: true,
            billDate: true,
            totalAmount: true,
            paidAmount: true,
            balanceAmount: true,
            status: true,
            farmer: {
              select: {
                name: true
              }
            }
          },
          orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
          take: RECENT_BILLS_LIMIT
        })
      : Promise.resolve([]),
    params.includes.has('salesBills') && salesWhere
      ? prisma.salesBill.findMany({
          where: salesWhere,
          select: {
            id: true,
            companyId: true,
            billNo: true,
            billDate: true,
            totalAmount: true,
            receivedAmount: true,
            balanceAmount: true,
            status: true,
            party: {
              select: {
                name: true
              }
            }
          },
          orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
          take: RECENT_BILLS_LIMIT
        })
      : Promise.resolve([]),
    productCompanyIds.length > 0 ? prisma.product.count({ where: { companyId: { in: productCompanyIds } } }) : Promise.resolve(0),
    partyCompanyIds.length > 0 ? prisma.party.count({ where: { companyId: { in: partyCompanyIds } } }) : Promise.resolve(0),
    unitCompanyIds.length > 0 ? prisma.unit.count({ where: { companyId: { in: unitCompanyIds } } }) : Promise.resolve(0),
    stockCompanyIds.length > 0 ? prisma.stockLedger.count({ where: { companyId: { in: stockCompanyIds } } }) : Promise.resolve(0),
    stockCompanyIds.length > 0
      ? prisma.stockLedger.groupBy({
          by: ['productId'],
          where: { companyId: { in: stockCompanyIds } },
          _sum: {
            qtyIn: true,
            qtyOut: true
          }
        })
      : Promise.resolve([]),
    purchaseWhere
      ? prisma.purchaseBill.groupBy({
          by: ['companyId'],
          where: purchaseWhere,
          _count: { _all: true },
          _sum: { totalAmount: true }
        })
      : Promise.resolve([]),
    salesWhere
      ? prisma.salesBill.groupBy({
          by: ['companyId'],
          where: salesWhere,
          _count: { _all: true },
          _sum: { totalAmount: true }
        })
      : Promise.resolve([]),
    paymentWhere
      ? prisma.payment.groupBy({
          by: ['companyId', 'billType'],
          where: paymentWhere,
          _sum: { amount: true }
        })
      : Promise.resolve([]),
    purchaseWhere
      ? prisma.purchaseBill.findMany({
          where: {
            ...purchaseWhere,
            billDate: { gte: trendStart }
          },
          select: {
            billDate: true,
            totalAmount: true
          }
        })
      : Promise.resolve([]),
    salesWhere
      ? prisma.salesBill.findMany({
          where: {
            ...salesWhere,
            billDate: { gte: trendStart }
          },
          select: {
            billDate: true,
            totalAmount: true
          }
        })
      : Promise.resolve([]),
    paymentWhere
      ? prisma.payment.findMany({
          where: {
            ...paymentWhere,
            payDate: { gte: trendStart }
          },
          select: {
            payDate: true,
            amount: true
          }
        })
      : Promise.resolve([])
  ])

  const lowStockRows = stockBalances.filter((row) => toNumber(row._sum.qtyIn) - toNumber(row._sum.qtyOut) <= 0)
  const lowStockProductIds = lowStockRows.map((row) => row.productId)
  const lowStockProducts =
    lowStockProductIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: lowStockProductIds } },
          select: {
            id: true,
            name: true
          }
        })
      : []

  const lowStockProductMap = new Map(lowStockProducts.map((row) => [row.id, row.name]))
  const lowStockItems = lowStockRows
    .map((row) => ({
      name: lowStockProductMap.get(row.productId) || 'Unknown Product',
      balance: toNumber(row._sum.qtyIn) - toNumber(row._sum.qtyOut)
    }))
    .sort((a, b) => a.balance - b.balance)
    .slice(0, 5)

  const companyPerformanceMap = new Map<string, CompanyPerformanceRow>()
  for (const company of params.companies) {
    companyPerformanceMap.set(company.id, {
      id: company.id,
      name: company.name,
      purchaseTotal: 0,
      salesTotal: 0,
      paymentIn: 0,
      paymentOut: 0,
      purchaseBills: 0,
      salesBills: 0,
      cashflow: 0
    })
  }

  for (const row of purchaseByCompany) {
    const current = companyPerformanceMap.get(row.companyId)
    if (!current) continue
    current.purchaseTotal = toNumber(row._sum.totalAmount)
    current.purchaseBills = toNumber(row._count._all)
  }

  for (const row of salesByCompany) {
    const current = companyPerformanceMap.get(row.companyId)
    if (!current) continue
    current.salesTotal = toNumber(row._sum.totalAmount)
    current.salesBills = toNumber(row._count._all)
  }

  for (const row of paymentsByCompany) {
    const current = companyPerformanceMap.get(row.companyId)
    if (!current) continue
    if (row.billType === 'sales') {
      current.paymentIn += toNumber(row._sum.amount)
    } else if (row.billType === 'purchase') {
      current.paymentOut += toNumber(row._sum.amount)
    }
  }

  const companyPerformance = Array.from(companyPerformanceMap.values())
    .map((row) => ({
      ...row,
      cashflow: Math.max(0, row.paymentIn - row.paymentOut)
    }))
    .sort((a, b) => b.salesTotal - a.salesTotal)

  const paymentTotal = toNumber(paymentSummary?._sum.amount)
  const paymentIn = paymentsByCompany
    .filter((row) => row.billType === 'sales')
    .reduce((sum, row) => sum + toNumber(row._sum.amount), 0)
  const paymentOut = paymentsByCompany
    .filter((row) => row.billType === 'purchase')
    .reduce((sum, row) => sum + toNumber(row._sum.amount), 0)

  return {
    purchaseBills: recentPurchaseBills,
    salesBills: recentSalesBills,
    payments: [],
    products: [],
    parties: [],
    units: [],
    stockLedger: [],
    summary: {
      purchase: {
        total: toNumber(purchaseSummary?._sum.totalAmount),
        paid: toNumber(purchaseSummary?._sum.paidAmount),
        pending: toNumber(purchaseSummary?._sum.balanceAmount),
        count: toNumber(purchaseSummary?._count._all)
      },
      sales: {
        total: toNumber(salesSummary?._sum.totalAmount),
        received: toNumber(salesSummary?._sum.receivedAmount),
        pending: toNumber(salesSummary?._sum.balanceAmount),
        count: toNumber(salesSummary?._count._all)
      },
      cashflow: {
        inAmount: paymentIn,
        outAmount: paymentOut,
        net: Math.max(0, paymentIn - paymentOut),
        count: paymentTotal > 0 ? toNumber(paymentSummary?._count._all) : 0
      },
      masterRecords: {
        products: productCount,
        parties: partyCount,
        units: unitCount
      },
      inventory: {
        stockEntries: stockEntriesCount,
        lowStock: lowStockRows.length,
        lowStockItems
      },
      notifications: {
        pendingBills: purchasePendingCount + salesPendingCount
      }
    },
    companyPerformance,
    trendData: buildTrendRows({
      purchaseRows: purchaseTrendRows,
      salesRows: salesTrendRows,
      paymentRows: paymentTrendRows
    })
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams
    const includes = parseOverviewIncludes(searchParams)
    const requestedCompanyIds = Array.from(
      new Set(
        searchParams
          .getAll('companyIds')
          .flatMap((value) => String(value || '').split(','))
          .map((value) => normalizeId(value))
          .filter(Boolean)
      )
    )

    const requestedCompanyId = normalizeId(searchParams.get('companyId'))
    const explicitRequestedIds =
      requestedCompanyIds.length > 0 ? requestedCompanyIds : requestedCompanyId ? [requestedCompanyId] : []

    const supabaseSession = await resolveSupabaseAppSession(request)
    if (supabaseSession) {
      const unlockedCompanies = supabaseSession.companies
        .filter((company) => !company.locked)
        .map((company) => ({
          id: company.id,
          name: company.name,
          traderId: company.traderId
        }))

      const targetCompanyIds =
        explicitRequestedIds.length > 0
          ? explicitRequestedIds.filter((companyId) => unlockedCompanies.some((company) => company.id === companyId))
          : unlockedCompanies.map((company) => company.id)

      if (targetCompanyIds.length === 0) {
        return supabaseSession.applyCookies(NextResponse.json(emptyOverviewPayload))
      }

      const auth: RequestAuthContext = {
        userId: supabaseSession.profile.user_code,
        traderId: supabaseSession.claims.trader_id,
        role: normalizeAppRole(supabaseSession.claims.app_role),
        companyId: supabaseSession.activeCompany?.id || supabaseSession.profile.default_company_id || null,
        userDbId: supabaseSession.claims.user_db_id
      }

      const scopes = await getOverviewScopedCompanyIds(auth, targetCompanyIds)
      const companies = unlockedCompanies
        .filter((company) => targetCompanyIds.includes(company.id))
        .map((company) => ({ id: company.id, name: company.name }))

      const cacheKey = makeServerCacheKey('overview', [Array.from(includes).sort(), scopes, companies])
      const payload = await getOrSetServerCache(cacheKey, OVERVIEW_CACHE_TTL_MS, () =>
        loadOverviewPayload({ includes, scopes, companies })
      )

      return supabaseSession.applyCookies(NextResponse.json(payload))
    }

    const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
    if (!authResult.ok) return authResult.response

    const accessibleCompanies = await getAccessibleCompanies(authResult.auth)
    const unlockedCompanies = accessibleCompanies
      .filter((company) => !company.locked)
      .map((company) => ({ id: company.id, name: company.name }))

    const targetCompanyIds =
      explicitRequestedIds.length > 0
        ? explicitRequestedIds.filter((companyId) => unlockedCompanies.some((company) => company.id === companyId))
        : unlockedCompanies.map((company) => company.id)

    if (targetCompanyIds.length === 0) {
      return NextResponse.json(emptyOverviewPayload)
    }

    const scopes = await getOverviewScopedCompanyIds(authResult.auth, targetCompanyIds)
    const companies = unlockedCompanies.filter((company) => targetCompanyIds.includes(company.id))
    const cacheKey = makeServerCacheKey('overview', [Array.from(includes).sort(), scopes, companies])

    const payload = await getOrSetServerCache(cacheKey, OVERVIEW_CACHE_TTL_MS, () =>
      loadOverviewPayload({ includes, scopes, companies })
    )

    return NextResponse.json(payload)
  } catch (error) {
    console.error('GET /api/main-dashboard/overview failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    return NextResponse.json({ error: 'Failed to load dashboard overview' }, { status: 500 })
  }
}
