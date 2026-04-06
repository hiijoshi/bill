import type { FinancialYear, Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'

import { normalizeId, type RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { isPrismaSchemaMismatchError } from '@/lib/prisma-schema-guard'
import { clearServerCacheByPrefix, getOrSetServerCache, makeServerCacheKey } from '@/lib/server-cache'
import { getFinancialYearCookieNameCandidates } from '@/lib/session-cookies'

export const FINANCIAL_YEAR_START_MONTH_INDEX = 3
export const FINANCIAL_YEAR_START_DAY = 1
const FINANCIAL_YEAR_CACHE_TTL_MS = 30_000

export const FINANCIAL_YEAR_STATUSES = ['open', 'closed', 'locked'] as const

export type FinancialYearStatus = (typeof FINANCIAL_YEAR_STATUSES)[number]

export type FinancialYearSummary = Pick<
  FinancialYear,
  'id' | 'traderId' | 'label' | 'startDate' | 'endDate' | 'isActive' | 'status' | 'createdAt' | 'updatedAt'
> & {
  activatedAt: Date | null
  closedAt: Date | null
  lockedAt: Date | null
}

export type FinancialYearSelectionSource = 'query' | 'cookie' | 'active' | 'none'

export type FinancialYearContext = {
  traderId: string
  financialYears: FinancialYearSummary[]
  activeFinancialYear: FinancialYearSummary | null
  selectedFinancialYear: FinancialYearSummary | null
  effectiveFinancialYear: FinancialYearSummary | null
  selectionSource: FinancialYearSelectionSource
  selectedFinancialYearId: string | null
}

export type FinancialYearDateFilter = FinancialYearContext & {
  dateFrom: Date | null
  dateTo: Date | null
  explicitDateRange: boolean
}

export class FinancialYearValidationError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'FinancialYearValidationError'
    this.statusCode = statusCode
  }
}

type DbClient = typeof prisma | Prisma.TransactionClient

type DateSpan = {
  startYear: number
  endYear: number
  label: string
  startDate: Date
  endDate: Date
}

type FinancialYearLoadResult = {
  financialYears: FinancialYearSummary[]
  schemaAvailable: boolean
}

function normalizeFinancialYearSummary(row: FinancialYear): FinancialYearSummary {
  return {
    id: row.id,
    traderId: row.traderId,
    label: row.label,
    startDate: row.startDate,
    endDate: row.endDate,
    isActive: row.isActive,
    status: normalizeFinancialYearStatus(row.status),
    activatedAt: row.activatedAt,
    closedAt: row.closedAt,
    lockedAt: row.lockedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function isFinancialYearSchemaMismatch(error: unknown): boolean {
  return isPrismaSchemaMismatchError(error, ['FinancialYear'])
}

export function normalizeFinancialYearStatus(value: unknown): FinancialYearStatus {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'closed' || normalized === 'locked') {
    return normalized
  }
  return 'open'
}

export function buildFinancialYearLabel(startYear: number): string {
  const endYear = (startYear + 1) % 100
  return `FY ${startYear}-${String(endYear).padStart(2, '0')}`
}

export function getFinancialYearWindowFromStartYear(startYear: number): DateSpan {
  const normalizedStartYear = Math.floor(Number(startYear || 0))
  const startDate = new Date(normalizedStartYear, FINANCIAL_YEAR_START_MONTH_INDEX, FINANCIAL_YEAR_START_DAY, 0, 0, 0, 0)
  const endDate = new Date(normalizedStartYear + 1, FINANCIAL_YEAR_START_MONTH_INDEX, 0, 23, 59, 59, 999)

  return {
    startYear: normalizedStartYear,
    endYear: normalizedStartYear + 1,
    label: buildFinancialYearLabel(normalizedStartYear),
    startDate,
    endDate
  }
}

export function getFinancialYearWindowForDate(date: Date): DateSpan {
  const parsed = new Date(date)
  const startYear =
    parsed.getMonth() >= FINANCIAL_YEAR_START_MONTH_INDEX ? parsed.getFullYear() : parsed.getFullYear() - 1
  return getFinancialYearWindowFromStartYear(startYear)
}

export function isDateWithinFinancialYear(date: Date, financialYear: Pick<FinancialYearSummary, 'startDate' | 'endDate'>): boolean {
  const parsed = new Date(date)
  return parsed.getTime() >= financialYear.startDate.getTime() && parsed.getTime() <= financialYear.endDate.getTime()
}

export function parseDateInputAtBoundary(value: string | null | undefined, endOfDay = false): Date | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  const [year, month, day] = raw.split('-').map((part) => Number(part))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  return new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  )
}

function getScopeSource(request: NextRequest): string {
  return request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host
}

function getSelectedFinancialYearIdFromRequest(request: NextRequest): {
  financialYearId: string | null
  source: Exclude<FinancialYearSelectionSource, 'active' | 'none'>
} | null {
  const queryFinancialYearId =
    normalizeId(request.nextUrl.searchParams.get('financialYearId')) ||
    normalizeId(request.nextUrl.searchParams.get('fy')) ||
    normalizeId(request.nextUrl.searchParams.get('financialYear'))

  if (queryFinancialYearId) {
    return { financialYearId: queryFinancialYearId, source: 'query' }
  }

  const cookieFinancialYearId =
    getFinancialYearCookieNameCandidates(getScopeSource(request))
      .map((cookieName) => normalizeId(request.cookies.get(cookieName)?.value))
      .find(Boolean) || ''

  if (cookieFinancialYearId) {
    return { financialYearId: cookieFinancialYearId, source: 'cookie' }
  }

  return null
}

async function resolveTraderId(args: {
  client?: DbClient
  auth?: RequestAuthContext | null
  traderId?: string | null
  companyId?: string | null
}): Promise<string> {
  const explicitTraderId = normalizeId(args.traderId)
  if (explicitTraderId) {
    return explicitTraderId
  }

  const authTraderId = normalizeId(args.auth?.traderId)
  if (authTraderId) {
    return authTraderId
  }

  const companyId = normalizeId(args.companyId)
  if (!companyId) {
    throw new FinancialYearValidationError('Trader scope could not be resolved for financial year context', 400)
  }

  const company = await (args.client || prisma).company.findFirst({
    where: { id: companyId },
    select: { traderId: true }
  })

  const traderId = normalizeId(company?.traderId)
  if (!traderId) {
    throw new FinancialYearValidationError('Company is not assigned to a trader', 400)
  }

  return traderId
}

async function findDateBoundaryRow<T extends Record<string, Date | null>>(input: {
  loader: () => Promise<T | null>
  key: keyof T
}): Promise<Date | null> {
  const row = await input.loader()
  const value = row?.[input.key]
  return value instanceof Date ? value : null
}

async function bootstrapFinancialYearsForTrader(client: DbClient, traderId: string): Promise<void> {
  const normalizedTraderId = normalizeId(traderId)
  if (!normalizedTraderId) return

  const existingCount = await client.financialYear.count({
    where: { traderId: normalizedTraderId }
  })
  if (existingCount > 0) {
    return
  }

  const trader = await client.trader.findFirst({
    where: { id: normalizedTraderId },
    select: { id: true, createdAt: true }
  })
  if (!trader) {
    return
  }

  const companyIds = (
    await client.company.findMany({
      where: { traderId: normalizedTraderId },
      select: { id: true }
    })
  ).map((row) => row.id)

  const today = new Date()
  const boundaryDates: Date[] = [trader.createdAt, today]

  if (companyIds.length > 0) {
    const [
      earliestCompany,
      earliestPartyOpening,
      latestPartyOpening,
      earliestPurchase,
      latestPurchase,
      earliestSpecialPurchase,
      latestSpecialPurchase,
      earliestSale,
      latestSale,
      earliestPayment,
      latestPayment,
      earliestStock,
      latestStock,
      earliestLedger,
      latestLedger
    ] = await Promise.all([
      findDateBoundaryRow({
        loader: () =>
          client.company.findFirst({
            where: { traderId: normalizedTraderId },
            select: { createdAt: true },
            orderBy: { createdAt: 'asc' }
          }),
        key: 'createdAt'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.party.findFirst({
            where: {
              companyId: { in: companyIds },
              openingBalanceDate: { not: null }
            },
            select: { openingBalanceDate: true },
            orderBy: { openingBalanceDate: 'asc' }
          }),
        key: 'openingBalanceDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.party.findFirst({
            where: {
              companyId: { in: companyIds },
              openingBalanceDate: { not: null }
            },
            select: { openingBalanceDate: true },
            orderBy: { openingBalanceDate: 'desc' }
          }),
        key: 'openingBalanceDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.purchaseBill.findFirst({
            where: { companyId: { in: companyIds } },
            select: { billDate: true },
            orderBy: { billDate: 'asc' }
          }),
        key: 'billDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.purchaseBill.findFirst({
            where: { companyId: { in: companyIds } },
            select: { billDate: true },
            orderBy: { billDate: 'desc' }
          }),
        key: 'billDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.specialPurchaseBill.findFirst({
            where: { companyId: { in: companyIds } },
            select: { billDate: true },
            orderBy: { billDate: 'asc' }
          }),
        key: 'billDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.specialPurchaseBill.findFirst({
            where: { companyId: { in: companyIds } },
            select: { billDate: true },
            orderBy: { billDate: 'desc' }
          }),
        key: 'billDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.salesBill.findFirst({
            where: { companyId: { in: companyIds } },
            select: { billDate: true },
            orderBy: { billDate: 'asc' }
          }),
        key: 'billDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.salesBill.findFirst({
            where: { companyId: { in: companyIds } },
            select: { billDate: true },
            orderBy: { billDate: 'desc' }
          }),
        key: 'billDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.payment.findFirst({
            where: { companyId: { in: companyIds }, deletedAt: null },
            select: { payDate: true },
            orderBy: { payDate: 'asc' }
          }),
        key: 'payDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.payment.findFirst({
            where: { companyId: { in: companyIds }, deletedAt: null },
            select: { payDate: true },
            orderBy: { payDate: 'desc' }
          }),
        key: 'payDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.stockLedger.findFirst({
            where: { companyId: { in: companyIds } },
            select: { entryDate: true },
            orderBy: { entryDate: 'asc' }
          }),
        key: 'entryDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.stockLedger.findFirst({
            where: { companyId: { in: companyIds } },
            select: { entryDate: true },
            orderBy: { entryDate: 'desc' }
          }),
        key: 'entryDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.ledgerEntry.findFirst({
            where: { companyId: { in: companyIds } },
            select: { entryDate: true },
            orderBy: { entryDate: 'asc' }
          }),
        key: 'entryDate'
      }),
      findDateBoundaryRow({
        loader: () =>
          client.ledgerEntry.findFirst({
            where: { companyId: { in: companyIds } },
            select: { entryDate: true },
            orderBy: { entryDate: 'desc' }
          }),
        key: 'entryDate'
      })
    ])

    for (const value of [
      earliestCompany,
      earliestPartyOpening,
      latestPartyOpening,
      earliestPurchase,
      latestPurchase,
      earliestSpecialPurchase,
      latestSpecialPurchase,
      earliestSale,
      latestSale,
      earliestPayment,
      latestPayment,
      earliestStock,
      latestStock,
      earliestLedger,
      latestLedger
    ]) {
      if (value) {
        boundaryDates.push(value)
      }
    }
  }

  const sortedDates = boundaryDates
    .filter((value) => value instanceof Date && Number.isFinite(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())

  const earliestDate = sortedDates[0] || today
  const latestDate = sortedDates[sortedDates.length - 1] || today
  const startSpan = getFinancialYearWindowForDate(earliestDate)
  const endSpan = getFinancialYearWindowForDate(latestDate.getTime() > today.getTime() ? latestDate : today)
  const activeSpan = getFinancialYearWindowForDate(today)

  const rows = []
  for (let startYear = startSpan.startYear; startYear <= endSpan.startYear; startYear += 1) {
    const span = getFinancialYearWindowFromStartYear(startYear)
    rows.push({
      traderId: normalizedTraderId,
      label: span.label,
      startDate: span.startDate,
      endDate: span.endDate,
      isActive: startYear === activeSpan.startYear,
      status: 'open' as const,
      activatedAt: startYear === activeSpan.startYear ? today : null,
      closedAt: null,
      lockedAt: null
    })
  }

  if (rows.length === 0) {
    const span = getFinancialYearWindowForDate(today)
    rows.push({
      traderId: normalizedTraderId,
      label: span.label,
      startDate: span.startDate,
      endDate: span.endDate,
      isActive: true,
      status: 'open' as const,
      activatedAt: today,
      closedAt: null,
      lockedAt: null
    })
  }

  await client.financialYear.createMany({
    data: rows
  })
}

async function loadFinancialYearsForTrader(client: DbClient, traderId: string): Promise<FinancialYearLoadResult> {
  const normalizedTraderId = normalizeId(traderId)
  if (!normalizedTraderId) {
    return {
      financialYears: [],
      schemaAvailable: true
    }
  }

  try {
    await bootstrapFinancialYearsForTrader(client, normalizedTraderId)

    const cacheKey = makeServerCacheKey('financial-years:list', [normalizedTraderId])
    const financialYears = await getOrSetServerCache(cacheKey, FINANCIAL_YEAR_CACHE_TTL_MS, async () => {
      const rows = await client.financialYear.findMany({
        where: { traderId: normalizedTraderId },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
      })

      return rows.map(normalizeFinancialYearSummary)
    })

    return {
      financialYears,
      schemaAvailable: true
    }
  } catch (error) {
    if (isFinancialYearSchemaMismatch(error)) {
      return {
        financialYears: [],
        schemaAvailable: false
      }
    }
    throw error
  }
}

export async function getFinancialYearContext(args: {
  client?: DbClient
  request?: NextRequest | null
  auth?: RequestAuthContext | null
  traderId?: string | null
  companyId?: string | null
}): Promise<FinancialYearContext> {
  const client = args.client || prisma
  const traderId = await resolveTraderId({
    client,
    auth: args.auth || null,
    traderId: args.traderId,
    companyId: args.companyId
  })
  const { financialYears } = await loadFinancialYearsForTrader(client, traderId)
  const activeFinancialYear = financialYears.find((row) => row.isActive) || financialYears[0] || null

  const selectionInput = args.request ? getSelectedFinancialYearIdFromRequest(args.request) : null
  const requestedFinancialYearId = normalizeId(selectionInput?.financialYearId)
  const selectedFinancialYear =
    (requestedFinancialYearId
      ? financialYears.find((row) => row.id === requestedFinancialYearId) || null
      : null) || null

  return {
    traderId,
    financialYears,
    activeFinancialYear,
    selectedFinancialYear,
    effectiveFinancialYear: selectedFinancialYear || activeFinancialYear,
    selectionSource: selectedFinancialYear ? selectionInput?.source || 'query' : activeFinancialYear ? 'active' : 'none',
    selectedFinancialYearId: selectedFinancialYear?.id || activeFinancialYear?.id || null
  }
}

export async function getFinancialYearDateFilter(args: {
  client?: DbClient
  request: NextRequest
  auth?: RequestAuthContext | null
  traderId?: string | null
  companyId?: string | null
  defaultToFinancialYear?: boolean
  dateFromParamName?: string
  dateToParamName?: string
}): Promise<FinancialYearDateFilter> {
  const dateFromParamName = args.dateFromParamName || 'dateFrom'
  const dateToParamName = args.dateToParamName || 'dateTo'
  const context = await getFinancialYearContext(args)
  const explicitDateFrom = parseDateInputAtBoundary(args.request.nextUrl.searchParams.get(dateFromParamName))
  const explicitDateTo = parseDateInputAtBoundary(args.request.nextUrl.searchParams.get(dateToParamName), true)
  const shouldDefaultToFinancialYear = args.defaultToFinancialYear !== false

  return {
    ...context,
    dateFrom:
      explicitDateFrom ||
      (shouldDefaultToFinancialYear ? context.effectiveFinancialYear?.startDate || null : null),
    dateTo:
      explicitDateTo ||
      (shouldDefaultToFinancialYear ? context.effectiveFinancialYear?.endDate || null : null),
    explicitDateRange: Boolean(explicitDateFrom || explicitDateTo)
  }
}

export async function findFinancialYearForDate(args: {
  client?: DbClient
  traderId?: string | null
  companyId?: string | null
  auth?: RequestAuthContext | null
  date: Date
}): Promise<FinancialYearSummary | null> {
  const traderId = await resolveTraderId(args)
  const { financialYears } = await loadFinancialYearsForTrader(args.client || prisma, traderId)
  return (
    financialYears.find((financialYear) => isDateWithinFinancialYear(args.date, financialYear)) || null
  )
}

export async function assertFinancialYearOpenForDate(args: {
  client?: DbClient
  traderId?: string | null
  companyId?: string | null
  auth?: RequestAuthContext | null
  date: Date
  actionLabel?: string
}): Promise<FinancialYearSummary> {
  const traderId = await resolveTraderId(args)
  const { financialYears, schemaAvailable } = await loadFinancialYearsForTrader(args.client || prisma, traderId)

  if (!schemaAvailable) {
    const span = getFinancialYearWindowForDate(args.date)
    return {
      id: '',
      traderId,
      label: span.label,
      startDate: span.startDate,
      endDate: span.endDate,
      isActive: true,
      status: 'open',
      activatedAt: null,
      closedAt: null,
      lockedAt: null,
      createdAt: span.startDate,
      updatedAt: span.startDate
    }
  }

  const financialYear =
    financialYears.find((row) => isDateWithinFinancialYear(args.date, row)) || null
  if (!financialYear) {
    const span = getFinancialYearWindowForDate(args.date)
    throw new FinancialYearValidationError(
      `${args.actionLabel || 'Transaction'} date falls outside configured financial years. Create ${span.label} first.`
    )
  }

  if (financialYear.status !== 'open') {
    throw new FinancialYearValidationError(
      `${args.actionLabel || 'Transaction'} is not allowed because ${financialYear.label} is ${financialYear.status}.`
    )
  }

  return financialYear
}

export function buildDateRangeWhere(
  field: string,
  dateFrom: Date | null,
  dateTo: Date | null
): Record<string, { gte?: Date; lte?: Date }> {
  if (!dateFrom && !dateTo) {
    return {}
  }

  return {
    [field]: {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {})
    }
  }
}

async function runWithFinancialYearWriteClient<T>(
  client: DbClient | undefined,
  handler: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  if (client && '$transaction' in client) {
    return client.$transaction(handler)
  }

  if (client) {
    return handler(client)
  }

  return prisma.$transaction(handler)
}

export async function setActiveFinancialYear(args: {
  client?: DbClient
  traderId: string
  financialYearId: string
}): Promise<FinancialYearSummary> {
  const traderId = normalizeId(args.traderId)
  const financialYearId = normalizeId(args.financialYearId)

  const updated = await runWithFinancialYearWriteClient(args.client, async (tx) => {
    const target = await tx.financialYear.findFirst({
      where: {
        id: financialYearId,
        traderId
      }
    })

    if (!target) {
      throw new FinancialYearValidationError('Financial year not found', 404)
    }

    if (normalizeFinancialYearStatus(target.status) !== 'open') {
      throw new FinancialYearValidationError('Only open financial years can be activated')
    }

    await tx.financialYear.updateMany({
      where: {
        traderId,
        isActive: true
      },
      data: {
        isActive: false
      }
    })

    return tx.financialYear.update({
      where: { id: target.id },
      data: {
        isActive: true,
        activatedAt: new Date()
      }
    })
  })

  clearFinancialYearCaches(traderId)
  return normalizeFinancialYearSummary(updated)
}

export async function updateFinancialYearStatus(args: {
  client?: DbClient
  traderId: string
  financialYearId: string
  status: FinancialYearStatus
}): Promise<FinancialYearSummary> {
  const client = args.client || prisma
  const traderId = normalizeId(args.traderId)
  const financialYearId = normalizeId(args.financialYearId)
  const nextStatus = normalizeFinancialYearStatus(args.status)

  const updated = await client.financialYear.updateMany({
    where: {
      id: financialYearId,
      traderId
    },
    data: {
      status: nextStatus,
      closedAt: nextStatus === 'closed' ? new Date() : null,
      lockedAt: nextStatus === 'locked' ? new Date() : null
    }
  })

  if (updated.count === 0) {
    throw new FinancialYearValidationError('Financial year not found', 404)
  }

  if (nextStatus !== 'open') {
    await client.financialYear.updateMany({
      where: {
        id: financialYearId,
        traderId,
        isActive: true
      },
      data: {
        isActive: false
      }
    })
  }

  const row = await client.financialYear.findFirst({
    where: {
      id: financialYearId,
      traderId
    }
  })

  if (!row) {
    throw new FinancialYearValidationError('Financial year not found', 404)
  }

  clearFinancialYearCaches(traderId)
  return normalizeFinancialYearSummary(row)
}

export function clearFinancialYearCaches(traderId?: string | null): void {
  clearServerCacheByPrefix('financial-years:list')
  void traderId
}
