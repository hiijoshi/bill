import 'server-only'

import { prisma } from '@/lib/prisma'
import type { RequestAuthContext } from '@/lib/api-security'
import {
  formatFinancialYearDateInput,
  getEffectiveClientFinancialYear,
  type ClientFinancialYearPayload
} from '@/lib/client-financial-years'
import { fetchInternalApiJson } from '@/lib/server-internal-api'
import { loadPaymentWorkspaceData } from '@/lib/server-payment-workspace'
import { loadReportDashboardData, type ReportDashboardType } from '@/lib/server-report-dashboard'
import { loadStockWorkspaceData } from '@/lib/server-stock-workspace'
import { getOrSetServerCache, makeServerCacheKey } from '@/lib/server-cache'
import { getUserSessionLiveUpdate } from '@/lib/live-update-state'
import {
  isIncomingCashflowPaymentType,
  isOutgoingCashflowPaymentType
} from '@/lib/payment-entry-types'
import { buildGroupedSalesBillWhere, buildOperationalSalesBillWhere } from '@/lib/sales-split'

export type ServerDateRange = {
  dateFrom: Date | null
  dateTo: Date | null
  dateFromInput: string
  dateToInput: string
}

type OverviewScopedCompanyIds = {
  dashboardCompanyIds: string[]
  purchaseCompanyIds: string[]
  salesCompanyIds: string[]
  paymentCompanyIds: string[]
  productCompanyIds: string[]
  partyCompanyIds: string[]
  unitCompanyIds: string[]
  stockCompanyIds: string[]
}

type FinancialYearSummaryLike = {
  id: string
  label: string
}

const OVERVIEW_CACHE_TTL_MS = 15_000
const RECENT_BILLS_LIMIT = 8
const TREND_WINDOW_DAYS = 7
const LIST_SSR_LIMIT = 50

const emptyDashboardOverviewPayload = {
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
    inventory: { stockEntries: 0, lowStock: 0, lowStockItems: [] as Array<{ name: string; balance: number }> },
    notifications: { pendingBills: 0 }
  },
  companyPerformance: [] as Array<{
    id: string
    name: string
    purchaseTotal: number
    salesTotal: number
    paymentIn: number
    paymentOut: number
    purchaseBills: number
    salesBills: number
    cashflow: number
  }>,
  trendData: [] as Array<{
    day: string
    purchase: number
    sales: number
    payment: number
  }>
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

  for (let index = 0; index < TREND_WINDOW_DAYS; index += 1) {
    const current = new Date(start)
    current.setDate(start.getDate() + index)
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
    dashboardCompanyIds: [],
    purchaseCompanyIds: [],
    salesCompanyIds: [],
    paymentCompanyIds: [],
    productCompanyIds: [],
    partyCompanyIds: [],
    unitCompanyIds: [],
    stockCompanyIds: []
  }

  if (targetCompanyIds.length === 0) {
    return emptyScopes
  }

  if (auth.role === 'super_admin' || auth.role === 'trader_admin' || auth.role === 'company_admin') {
    return {
      dashboardCompanyIds: targetCompanyIds,
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

  const scopeCacheKey = makeServerCacheKey('overview-scopes', [
    auth.userDbId,
    auth.role,
    auth.traderId,
    auth.companyId || '',
    auth.sessionIssuedAt || 0,
    getUserSessionLiveUpdate(auth),
    targetCompanyIds.slice().sort()
  ])

  return getOrSetServerCache(scopeCacheKey, OVERVIEW_CACHE_TTL_MS, async () => {
    const rows = await prisma.userPermission.findMany({
      where: {
        userId: auth.userDbId!,
        companyId: { in: targetCompanyIds },
        module: {
          in: [
            'DASHBOARD',
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
      const values = companyIdsByModule.get(row.module) || new Set<string>()
      values.add(row.companyId)
      companyIdsByModule.set(row.module, values)
    }

    const dashboardCompanyIds = Array.from(companyIdsByModule.get('DASHBOARD') || [])
    const dashboardCompanyIdSet = new Set(dashboardCompanyIds)

    return {
      dashboardCompanyIds,
      purchaseCompanyIds: Array.from(companyIdsByModule.get('PURCHASE_LIST') || []).filter((companyId) =>
        dashboardCompanyIdSet.has(companyId)
      ),
      salesCompanyIds: Array.from(companyIdsByModule.get('SALES_LIST') || []).filter((companyId) =>
        dashboardCompanyIdSet.has(companyId)
      ),
      paymentCompanyIds: Array.from(companyIdsByModule.get('PAYMENTS') || []).filter((companyId) =>
        dashboardCompanyIdSet.has(companyId)
      ),
      productCompanyIds: Array.from(companyIdsByModule.get('MASTER_PRODUCTS') || []).filter((companyId) =>
        dashboardCompanyIdSet.has(companyId)
      ),
      partyCompanyIds: Array.from(companyIdsByModule.get('MASTER_PARTIES') || []).filter((companyId) =>
        dashboardCompanyIdSet.has(companyId)
      ),
      unitCompanyIds: Array.from(companyIdsByModule.get('MASTER_UNITS') || []).filter((companyId) =>
        dashboardCompanyIdSet.has(companyId)
      ),
      stockCompanyIds: Array.from(companyIdsByModule.get('STOCK_DASHBOARD') || []).filter((companyId) =>
        dashboardCompanyIdSet.has(companyId)
      )
    }
  })
}

async function loadDirectDashboardOverviewPayload(params: {
  scopes: OverviewScopedCompanyIds
  companies: Array<{ id: string; name: string }>
  dateFrom: Date | null
  dateTo: Date | null
  financialYear: FinancialYearSummaryLike | null
  mode?: 'critical' | 'full'
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

  const purchaseWhere =
    purchaseCompanyIds.length > 0
      ? {
          companyId: { in: purchaseCompanyIds },
          status: { not: 'cancelled' as const },
          ...(params.dateFrom || params.dateTo
            ? {
                billDate: {
                  ...(params.dateFrom ? { gte: params.dateFrom } : {}),
                  ...(params.dateTo ? { lte: params.dateTo } : {})
                }
              }
            : {})
        }
      : null
  const salesWhere =
    salesCompanyIds.length > 0
      ? buildOperationalSalesBillWhere({
          companyId: { in: salesCompanyIds },
          status: { not: 'cancelled' as const },
          ...(params.dateFrom || params.dateTo
            ? {
                billDate: {
                  ...(params.dateFrom ? { gte: params.dateFrom } : {}),
                  ...(params.dateTo ? { lte: params.dateTo } : {})
                }
              }
            : {})
        })
      : null
  const paymentWhere =
    paymentCompanyIds.length > 0
      ? {
          companyId: { in: paymentCompanyIds },
          deletedAt: null,
          ...(params.dateFrom || params.dateTo
            ? {
                payDate: {
                  ...(params.dateFrom ? { gte: params.dateFrom } : {}),
                  ...(params.dateTo ? { lte: params.dateTo } : {})
                }
              }
            : {})
        }
      : null

  const trendEnd = (() => {
    const today = startOfToday()
    if (params.dateTo && params.dateTo.getTime() < today.getTime()) {
      return new Date(params.dateTo)
    }
    return today
  })()
  const trendStart = new Date(trendEnd)
  trendStart.setDate(trendEnd.getDate() - (TREND_WINDOW_DAYS - 1))
  if (params.dateFrom && trendStart.getTime() < params.dateFrom.getTime()) {
    trendStart.setTime(params.dateFrom.getTime())
  }
  const includeAnalytics = params.mode !== 'critical'
  const needsCompanyBreakdown = params.companies.length > 1

  const [
    purchaseSummary,
    salesSummary,
    paymentSummary,
    paymentTotalsByType,
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
    paymentWhere
      ? prisma.payment.groupBy({
          by: ['billType'],
          where: paymentWhere,
          _sum: {
            amount: true
          }
        })
      : Promise.resolve([]),
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
    purchaseWhere
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
    salesWhere
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
    includeAnalytics && stockCompanyIds.length > 0
      ? prisma.stockLedger.count({
          where: {
            companyId: { in: stockCompanyIds },
            ...(params.dateFrom || params.dateTo
              ? {
                  entryDate: {
                    ...(params.dateFrom ? { gte: params.dateFrom } : {}),
                    ...(params.dateTo ? { lte: params.dateTo } : {})
                  }
                }
              : {})
          }
        })
      : Promise.resolve(0),
    stockCompanyIds.length > 0
      ? prisma.stockLedger.groupBy({
          by: ['productId'],
          where: {
            companyId: { in: stockCompanyIds },
            ...(params.dateFrom || params.dateTo
              ? {
                  entryDate: {
                    ...(params.dateFrom ? { gte: params.dateFrom } : {}),
                    ...(params.dateTo ? { lte: params.dateTo } : {})
                  }
                }
              : {})
          },
          _sum: {
            qtyIn: true,
            qtyOut: true
          }
        })
      : Promise.resolve([]),
    includeAnalytics && needsCompanyBreakdown && purchaseWhere
      ? prisma.purchaseBill.groupBy({
          by: ['companyId'],
          where: purchaseWhere,
          _count: { _all: true },
          _sum: { totalAmount: true }
        })
      : Promise.resolve([]),
    includeAnalytics && needsCompanyBreakdown && salesWhere
      ? prisma.salesBill.groupBy({
          by: ['companyId'],
          where: salesWhere,
          _count: { _all: true },
          _sum: { totalAmount: true }
        })
      : Promise.resolve([]),
    includeAnalytics && needsCompanyBreakdown && paymentWhere
      ? prisma.payment.groupBy({
          by: ['companyId', 'billType'],
          where: paymentWhere,
          _sum: { amount: true }
        })
      : Promise.resolve([]),
    includeAnalytics && purchaseWhere
      ? prisma.purchaseBill.findMany({
          where: {
            ...purchaseWhere,
            billDate: {
              gte: trendStart,
              ...(params.dateTo ? { lte: params.dateTo } : {})
            }
          },
          select: {
            billDate: true,
            totalAmount: true
          }
        })
      : Promise.resolve([]),
    includeAnalytics && salesWhere
      ? prisma.salesBill.findMany({
          where: {
            ...salesWhere,
            billDate: {
              gte: trendStart,
              ...(params.dateTo ? { lte: params.dateTo } : {})
            }
          },
          select: {
            billDate: true,
            totalAmount: true
          }
        })
      : Promise.resolve([]),
    includeAnalytics && paymentWhere
      ? prisma.payment.findMany({
          where: {
            ...paymentWhere,
            payDate: {
              gte: trendStart,
              ...(params.dateTo ? { lte: params.dateTo } : {})
            }
          },
          select: {
            payDate: true,
            amount: true
          }
        })
      : Promise.resolve([])
  ])

  const lowStockRows = includeAnalytics
    ? stockBalances.filter((row) => toNumber(row._sum.qtyIn) - toNumber(row._sum.qtyOut) <= 0)
    : []
  const lowStockPreviewRows = [...lowStockRows]
    .sort((left, right) => (toNumber(left._sum.qtyIn) - toNumber(left._sum.qtyOut)) - (toNumber(right._sum.qtyIn) - toNumber(right._sum.qtyOut)))
    .slice(0, 5)
  const lowStockProductIds = lowStockPreviewRows.map((row) => row.productId)
  const lowStockProducts =
    includeAnalytics && lowStockProductIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: lowStockProductIds } },
          select: {
            id: true,
            name: true
          }
        })
      : []

  const lowStockProductMap = new Map(lowStockProducts.map((row) => [row.id, row.name]))
  const lowStockItems = lowStockPreviewRows
    .map((row) => ({
      name: lowStockProductMap.get(row.productId) || 'Unknown Product',
      balance: toNumber(row._sum.qtyIn) - toNumber(row._sum.qtyOut)
    }))
    .sort((left, right) => left.balance - right.balance)

  const paymentTotal = toNumber(paymentSummary?._sum.amount)
  const paymentIn = paymentTotalsByType
    .filter((row) => isIncomingCashflowPaymentType(row.billType))
    .reduce((sum, row) => sum + toNumber(row._sum.amount), 0)
  const paymentOut = paymentTotalsByType
    .filter((row) => isOutgoingCashflowPaymentType(row.billType))
    .reduce((sum, row) => sum + toNumber(row._sum.amount), 0)
  const purchaseByCompanyMap = new Map(purchaseByCompany.map((row) => [row.companyId, row]))
  const salesByCompanyMap = new Map(salesByCompany.map((row) => [row.companyId, row]))
  const paymentsByCompanyMap = paymentsByCompany.reduce((map, row) => {
    const current = map.get(row.companyId) || []
    current.push(row)
    map.set(row.companyId, current)
    return map
  }, new Map<string, typeof paymentsByCompany>())
  const companyPerformance = includeAnalytics && needsCompanyBreakdown
    ? Array.from(
        params.companies
          .reduce((map, company) => {
            map.set(company.id, {
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
            return map
          }, new Map<string, {
            id: string
            name: string
            purchaseTotal: number
            salesTotal: number
            paymentIn: number
            paymentOut: number
            purchaseBills: number
            salesBills: number
            cashflow: number
          }>())
          .values()
      )
        .map((row) => {
          const purchaseRow = purchaseByCompanyMap.get(row.id)
          const salesRow = salesByCompanyMap.get(row.id)
          const paymentRows = paymentsByCompanyMap.get(row.id) || []
          const paymentInAmount = paymentRows
            .filter((item) => isIncomingCashflowPaymentType(item.billType))
            .reduce((sum, item) => sum + toNumber(item._sum.amount), 0)
          const paymentOutAmount = paymentRows
            .filter((item) => isOutgoingCashflowPaymentType(item.billType))
            .reduce((sum, item) => sum + toNumber(item._sum.amount), 0)

          return {
            ...row,
            purchaseTotal: toNumber(purchaseRow?._sum.totalAmount),
            salesTotal: toNumber(salesRow?._sum.totalAmount),
            paymentIn: paymentInAmount,
            paymentOut: paymentOutAmount,
            purchaseBills: toNumber(purchaseRow?._count._all),
            salesBills: toNumber(salesRow?._count._all),
            cashflow: Math.max(0, paymentInAmount - paymentOutAmount)
          }
        })
        .sort((left, right) => right.salesTotal - left.salesTotal)
    : includeAnalytics && params.companies[0]
      ? [
          {
            id: params.companies[0].id,
            name: params.companies[0].name,
            purchaseTotal: toNumber(purchaseSummary?._sum.totalAmount),
            salesTotal: toNumber(salesSummary?._sum.totalAmount),
            paymentIn,
            paymentOut,
            purchaseBills: toNumber(purchaseSummary?._count._all),
            salesBills: toNumber(salesSummary?._count._all),
            cashflow: Math.max(0, paymentIn - paymentOut)
          }
        ]
      : []

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
    trendData: includeAnalytics
      ? buildTrendRows({
          purchaseRows: purchaseTrendRows,
          salesRows: salesTrendRows,
          paymentRows: paymentTrendRows
        })
      : [],
    activeFinancialYear: params.financialYear
  }
}

export function getServerFinancialYearRange(payload?: ClientFinancialYearPayload | null): ServerDateRange {
  const financialYear = getEffectiveClientFinancialYear(payload || null)
  if (!financialYear) {
    return {
      dateFrom: null,
      dateTo: null,
      dateFromInput: '',
      dateToInput: ''
    }
  }

  const dateFrom = new Date(financialYear.startDate)
  const dateTo = new Date(financialYear.endDate)
  return {
    dateFrom: Number.isFinite(dateFrom.getTime()) ? dateFrom : null,
    dateTo: Number.isFinite(dateTo.getTime()) ? dateTo : null,
    dateFromInput: formatFinancialYearDateInput(financialYear.startDate),
    dateToInput: formatFinancialYearDateInput(financialYear.endDate)
  }
}

export async function loadServerDashboardOverview(args: {
  auth: RequestAuthContext
  companies: Array<{ id: string; name: string; locked?: boolean }>
  targetCompanyIds: string[]
  financialYearPayload?: ClientFinancialYearPayload | null
}) {
  const unlockedCompanies = args.companies
    .filter((company) => !company.locked)
    .map((company) => ({ id: company.id, name: company.name }))

  const targetCompanyIds =
    args.targetCompanyIds.length > 0
      ? args.targetCompanyIds.filter((companyId) => unlockedCompanies.some((company) => company.id === companyId))
      : unlockedCompanies.map((company) => company.id)

  if (targetCompanyIds.length === 0) {
    return emptyDashboardOverviewPayload
  }

  const scopes = await getOverviewScopedCompanyIds(args.auth, targetCompanyIds)
  if (scopes.dashboardCompanyIds.length === 0) {
    return emptyDashboardOverviewPayload
  }

  const companies = unlockedCompanies.filter((company) => scopes.dashboardCompanyIds.includes(company.id))
  const range = getServerFinancialYearRange(args.financialYearPayload)
  const effectiveFinancialYear = getEffectiveClientFinancialYear(args.financialYearPayload || null)
  const cacheKey = makeServerCacheKey('overview', [
    ['purchaseBills', 'salesBills'],
    scopes,
    companies,
    effectiveFinancialYear?.id || '',
    range.dateFrom?.toISOString() || '',
    range.dateTo?.toISOString() || ''
  ])

  return getOrSetServerCache(cacheKey, OVERVIEW_CACHE_TTL_MS, () =>
    loadDirectDashboardOverviewPayload({
      scopes,
      companies,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      financialYear: effectiveFinancialYear
        ? {
            id: effectiveFinancialYear.id,
            label: effectiveFinancialYear.label
          }
        : null,
      mode: 'critical'
    })
  )
}

export async function loadServerPurchaseListData(
  companyId: string,
  financialYearPayload?: ClientFinancialYearPayload | null,
  limit = LIST_SSR_LIMIT
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  const [purchaseBills, specialPurchaseBills] = await Promise.all([
    prisma.purchaseBill.findMany({
      where: {
        companyId,
        ...(range.dateFrom || range.dateTo
          ? {
              billDate: {
                ...(range.dateFrom ? { gte: range.dateFrom } : {}),
                ...(range.dateTo ? { lte: range.dateTo } : {})
              }
            }
          : {})
      },
      select: {
        id: true,
        billNo: true,
        billDate: true,
        totalAmount: true,
        paidAmount: true,
        balanceAmount: true,
        status: true,
        farmerNameSnapshot: true,
        farmerAddressSnapshot: true,
        krashakAnubandhSnapshot: true,
        farmer: {
          select: {
            id: true,
            name: true
          }
        },
        purchaseItems: {
          select: {
            bags: true,
            qty: true,
            rate: true,
            hammali: true,
            amount: true,
            markaNo: true
          }
        }
      },
      orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
      take: limit
    }),
    prisma.specialPurchaseBill.findMany({
      where: {
        companyId,
        ...(range.dateFrom || range.dateTo
          ? {
              billDate: {
                ...(range.dateFrom ? { gte: range.dateFrom } : {}),
                ...(range.dateTo ? { lte: range.dateTo } : {})
              }
            }
          : {})
      },
      select: {
        id: true,
        supplierInvoiceNo: true,
        billDate: true,
        totalAmount: true,
        paidAmount: true,
        balanceAmount: true,
        status: true,
        supplier: {
          select: {
            id: true,
            name: true,
            address: true,
            gstNumber: true
          }
        },
        specialPurchaseItems: {
          select: {
            noOfBags: true,
            weight: true,
            rate: true,
            netAmount: true,
            otherAmount: true,
            grossAmount: true
          }
        }
      },
      orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
      take: limit
    })
  ])

  return {
    purchaseBills,
    specialPurchaseBills
  }
}

export async function loadServerSalesListData(
  companyId: string,
  financialYearPayload?: ClientFinancialYearPayload | null,
  limit = LIST_SSR_LIMIT
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  return prisma.salesBill.findMany({
    where: buildGroupedSalesBillWhere({
      companyId,
      ...(range.dateFrom || range.dateTo
        ? {
            billDate: {
              ...(range.dateFrom ? { gte: range.dateFrom } : {}),
              ...(range.dateTo ? { lte: range.dateTo } : {})
              }
            }
          : {})
    }),
    select: {
      id: true,
      billNo: true,
      billDate: true,
      totalAmount: true,
      receivedAmount: true,
      balanceAmount: true,
      status: true,
      invoiceKind: true,
      workflowStatus: true,
      splitMethod: true,
      splitPartLabel: true,
      splitSuffix: true,
      parentSalesBill: {
        select: {
          id: true,
          billNo: true
        }
      },
      childSalesBills: {
        select: {
          id: true,
          billNo: true,
          totalAmount: true,
          receivedAmount: true,
          balanceAmount: true,
          workflowStatus: true,
          invoiceKind: true,
          splitPartLabel: true,
          splitSuffix: true
        }
      },
      party: {
        select: {
          name: true,
          address: true,
          phone1: true
        }
      },
      salesItems: {
        select: {
          weight: true,
          bags: true,
          rate: true,
          amount: true,
          product: {
            select: {
              name: true
            }
          }
        }
      },
      transportBills: {
        select: {
          transportName: true,
          lorryNo: true,
          freightAmount: true,
          otherAmount: true,
          insuranceAmount: true
        }
      }
    },
    orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
    take: limit
  })
}

export async function loadServerPaymentWorkspace(
  companyId: string,
  financialYearPayload?: ClientFinancialYearPayload | null,
  options: {
    includePaymentModes?: boolean
  } = {}
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  return loadPaymentWorkspaceData(companyId, {
    includePaymentModes: options.includePaymentModes,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo
  })
}

export async function loadServerStockWorkspace(
  companyId: string,
  financialYearPayload?: ClientFinancialYearPayload | null,
  recentLimit = 60
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  return loadStockWorkspaceData(companyId, recentLimit, {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo
  })
}

export async function loadServerReportDashboardWorkspace(
  companyId: string,
  reportType: ReportDashboardType,
  financialYearPayload?: ClientFinancialYearPayload | null
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  return loadReportDashboardData(companyId, reportType, {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo
  })
}

export async function loadServerStockReportRows(
  companyId: string,
  financialYearPayload?: ClientFinancialYearPayload | null
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  const params = new URLSearchParams({
    companyId
  })
  if (range.dateFromInput) params.set('dateFrom', range.dateFromInput)
  if (range.dateToInput) params.set('dateTo', range.dateToInput)

  const payload = await fetchInternalApiJson<Array<Record<string, unknown>> | { data?: Array<Record<string, unknown>> }>(
    `/api/stock-ledger?${params.toString()}`
  )

  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : []

  const company = await prisma.company.findFirst({
    where: { id: companyId },
    select: {
      name: true
    }
  })
  const companyName = company?.name || companyId

  return rows
    .map((entry) => {
      const entryDate = typeof entry?.entryDate === 'string' ? new Date(entry.entryDate) : null
      if (!entryDate || !Number.isFinite(entryDate.getTime())) {
        return null
      }

      const qtyIn = Number(entry?.qtyIn || 0)
      const qtyOut = Number(entry?.qtyOut || 0)
      return {
        id: String(entry?.id || ''),
        companyId,
        companyName,
        entryDate: String(entry?.entryDate || ''),
        productName: String((entry?.product as { name?: unknown } | undefined)?.name || '').trim() || 'Unknown Product',
        unit: String((entry?.product as { unit?: unknown } | undefined)?.unit || '').trim() || '-',
        type: String(entry?.type || '').trim() || 'unknown',
        qtyIn: Number.isFinite(qtyIn) ? qtyIn : 0,
        qtyOut: Number.isFinite(qtyOut) ? qtyOut : 0,
        netMovement: (Number.isFinite(qtyIn) ? qtyIn : 0) - (Number.isFinite(qtyOut) ? qtyOut : 0),
        refTable: String(entry?.refTable || '').trim() || '-',
        refId: String(entry?.refId || '').trim() || '-',
        _sortTs: entryDate.getTime()
      }
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => right._sortTs - left._sortTs)
}

export async function loadServerOperationsReport(
  companyId: string,
  view: string,
  financialYearPayload?: ClientFinancialYearPayload | null,
  options: {
    companyIds?: string[]
    partyId?: string
  } = {}
) {
  const range = getServerFinancialYearRange(financialYearPayload)
  const params = new URLSearchParams({ view })
  const normalizedCompanyIds = Array.from(new Set((options.companyIds || []).map((value) => value.trim()).filter(Boolean)))
  if (normalizedCompanyIds.length > 1) {
    params.set('companyIds', normalizedCompanyIds.join(','))
  } else {
    params.set('companyId', normalizedCompanyIds[0] || companyId)
  }
  if (options.partyId) {
    params.set('partyId', options.partyId)
  }
  if (range.dateFromInput) params.set('dateFrom', range.dateFromInput)
  if (range.dateToInput) params.set('dateTo', range.dateToInput)
  return fetchInternalApiJson(`/api/reports/operations?${params.toString()}`)
}
