import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import {
  filterCompanyIdsByRoutePermission,
  getAccessibleCompanies,
  normalizeId,
  requireRoles
} from '@/lib/api-security'
import { getCompanySubscriptionAccess, getSubscriptionAccessMessage, isModuleEnabledForEntitlement } from '@/lib/subscription-core'
import { createBankEntryProvider, SUPPORTED_BANK_SYNC_PROVIDERS } from '@/lib/bank-integration'
import { normalizeNonNegative, roundCurrency } from '@/lib/billing-calculations'
import {
  getSignedPartyOpeningBalance,
  isPartyOpeningBalanceReference,
  normalizePartyOpeningBalanceType
} from '@/lib/party-opening-balance'
import { JOURNAL_VOUCHER_BILL_TYPE } from '@/lib/journal-vouchers'
import { getOrSetServerCache, makeServerCacheKey } from '@/lib/server-cache'
import {
  getPaymentTypeLabel,
  isIncomingCashflowPaymentType,
  isOutgoingCashflowPaymentType,
  parseCashBankPaymentReference,
  isSalesReceiptType,
  isSelfTransferPaymentType
} from '@/lib/payment-entry-types'
import { buildOperationalSalesBillWhere } from '@/lib/sales-split'
import { isCashPaymentMode } from '@/lib/payment-mode-utils'
import { getFinancialYearDateFilter } from '@/lib/financial-years'

type CompanyOption = {
  id: string
  name: string
  address?: string | null
  phone?: string | null
}

type DailySummaryAccumulator = {
  date: string
  totalSales: number
  totalPurchase: number
  totalStockAdjustmentQty: number
  totalPurchasePayment: number
  totalSalesReceipt: number
  transactionCount: number
  companyIds: Set<string>
}

type PartyLedgerEntryType = 'opening' | 'sale' | 'receipt'

type OutstandingAccumulator = {
  partyId: string
  companyId: string
  companyName: string
  partyName: string
  phone1: string
  address: string
  saleAmount: number
  receivedAmount: number
  balanceAmount: number
  invoiceCount: number
  oldestBillDate: string
  lastBillDate: string
}

type JournalVoucherLedgerRow = {
  id: string
  companyId: string
  entryDate: Date
  billId: string
  direction: string
  amount: number
  accountHeadNameSnapshot: string | null
  accountGroupSnapshot: string | null
  counterpartyNameSnapshot: string | null
  note: string | null
}

type PaymentLedgerRow = {
  id: string
  companyId: string
  billType: string
  billId: string
  payDate: Date
  amount: number
  mode: string | null
  cashAmount?: number | null
  onlinePayAmount?: number | null
  ifscCode?: string | null
  beneficiaryBankAccount?: string | null
  bankNameSnapshot?: string | null
  bankBranchSnapshot?: string | null
  txnRef?: string | null
  note?: string | null
  party?: {
    name?: string | null
  } | null
  farmer?: {
    name?: string | null
  } | null
}

type OperationsReportView =
  | 'overview'
  | 'outstanding'
  | 'ledger'
  | 'daily'
  | 'daily-transaction'
  | 'daily-consolidated'
  | 'bank-ledger'
  | 'cash-ledger'

function normalizeReportView(value: string | null): OperationsReportView {
  if (
    value === 'overview' ||
    value === 'outstanding' ||
    value === 'ledger' ||
    value === 'daily' ||
    value === 'daily-transaction' ||
    value === 'daily-consolidated' ||
    value === 'bank-ledger' ||
    value === 'cash-ledger'
  ) {
    return value
  }
  return 'overview'
}

const OPERATIONS_REPORT_CACHE_TTL_MS = 20_000

async function loadBankSyncProviderStatuses(companyId: string) {
  const normalizedCompanyId = String(companyId || '').trim()
  if (!normalizedCompanyId) {
    return []
  }

  return getOrSetServerCache(
    makeServerCacheKey('operations-report:bank-sync-providers', [normalizedCompanyId]),
    OPERATIONS_REPORT_CACHE_TTL_MS,
    () =>
      Promise.all(
        SUPPORTED_BANK_SYNC_PROVIDERS.map((provider) =>
          createBankEntryProvider(provider).getStatus({ companyId: normalizedCompanyId })
        )
      )
  )
}

function parseDateAtBoundary(value: string | null, endOfDay = false): Date | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map((part) => Number(part))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
}

function dateKey(value: Date | string | null | undefined): string {
  if (!value) return ''
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) return ''
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function getDaysOverdue(value: string, asOf: Date): number {
  if (!value) return 0
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 0
  const diffMs = startOfLocalDay(asOf).getTime() - startOfLocalDay(parsed).getTime()
  if (diffMs <= 0) return 0
  return Math.floor(diffMs / 86_400_000)
}

function getOutstandingAgeBucket(daysOverdue: number): string {
  if (daysOverdue <= 0) return 'Current'
  if (daysOverdue <= 7) return '1-7 Days'
  if (daysOverdue <= 15) return '8-15 Days'
  if (daysOverdue <= 30) return '16-30 Days'
  if (daysOverdue <= 60) return '31-60 Days'
  if (daysOverdue <= 90) return '61-90 Days'
  return '90+ Days'
}

function getOrCreateDailyRow(map: Map<string, DailySummaryAccumulator>, key: string): DailySummaryAccumulator {
  const existing = map.get(key)
  if (existing) return existing

  const nextRow: DailySummaryAccumulator = {
    date: key,
    totalSales: 0,
    totalPurchase: 0,
    totalStockAdjustmentQty: 0,
    totalPurchasePayment: 0,
    totalSalesReceipt: 0,
    transactionCount: 0,
    companyIds: new Set<string>()
  }

  map.set(key, nextRow)
  return nextRow
}

function addDailyMetric(
  map: Map<string, DailySummaryAccumulator>,
  key: string,
  companyId: string,
  updater: (row: DailySummaryAccumulator) => void
) {
  const row = getOrCreateDailyRow(map, key)
  row.companyIds.add(companyId)
  row.transactionCount += 1
  updater(row)
}

function formatProductNames(names: string[]): string {
  const uniqueNames = Array.from(new Set(names.map((name) => String(name || '').trim()).filter(Boolean)))
  if (uniqueNames.length === 0) return '-'
  return uniqueNames.join(', ')
}

function normalizeOutstandingStatus(balanceAmount: number, receivedAmount: number): 'paid' | 'partial' | 'unpaid' {
  if (balanceAmount <= 0) return 'paid'
  if (receivedAmount > 0) return 'partial'
  return 'unpaid'
}

function normalizeTransferAccountLabel(value: string | null | undefined): string {
  return String(value || '').trim()
}

type MasterBankFilterRecord = {
  id: string
  companyId: string
  name: string
  branch: string
  ifscCode: string
  accountNumber: string
  label: string
}

function normalizeBankLookupValue(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeBankAccountLookupValue(value: string | null | undefined): string {
  return String(value || '')
    .replace(/\s+/g, '')
    .trim()
}

function getMasterBankLabel(bank: { name?: string | null; branch?: string | null }): string {
  const name = String(bank.name || '').trim()
  const branch = String(bank.branch || '').trim()
  if (!name) return ''
  return branch ? `${name} (${branch})` : name
}

type MasterBankLookupRecord = {
  byIfsc: Map<string, string[]>
  byAccountNumber: Map<string, string[]>
  byNameBranch: Map<string, string[]>
  byLabelOrName: Map<string, string[]>
}

function addUniqueLookupValue(map: Map<string, string[]>, key: string, value: string) {
  if (!key) return
  const existing = map.get(key)
  if (existing) {
    if (!existing.includes(value)) existing.push(value)
  } else {
    map.set(key, [value])
  }
}

function buildMasterBankLookup(masterBanks: MasterBankFilterRecord[]): MasterBankLookupRecord {
  const lookup: MasterBankLookupRecord = {
    byIfsc: new Map<string, string[]>(),
    byAccountNumber: new Map<string, string[]>(),
    byNameBranch: new Map<string, string[]>(),
    byLabelOrName: new Map<string, string[]>()
  }

  for (const bank of masterBanks) {
    const normalizedLabel = normalizeBankLookupValue(bank.label)
    const normalizedName = normalizeBankLookupValue(bank.name)
    const normalizedBranch = normalizeBankLookupValue(bank.branch)
    const normalizedIfsc = normalizeBankLookupValue(bank.ifscCode)
    const normalizedAccountNumber = normalizeBankAccountLookupValue(bank.accountNumber)

    if (normalizedIfsc) {
      addUniqueLookupValue(lookup.byIfsc, normalizedIfsc, bank.label)
    }

    if (normalizedAccountNumber) {
      addUniqueLookupValue(lookup.byAccountNumber, normalizedAccountNumber, bank.label)
    }

    if (normalizedName && normalizedBranch) {
      addUniqueLookupValue(lookup.byNameBranch, `${normalizedName}|${normalizedBranch}`, bank.label)
    }

    if (normalizedLabel) {
      addUniqueLookupValue(lookup.byLabelOrName, normalizedLabel, bank.label)
    }

    if (normalizedName) {
      addUniqueLookupValue(lookup.byLabelOrName, normalizedName, bank.label)
    }
  }

  return lookup
}

function matchMasterBankLabels(args: {
  masterBankLookup?: MasterBankLookupRecord
  masterBanks?: MasterBankFilterRecord[]
  nameSnapshot?: string | null
  branchSnapshot?: string | null
  ifscCode?: string | null
  accountNumber?: string | null
}): string[] {
  const lookup = args.masterBankLookup ?? buildMasterBankLookup(args.masterBanks ?? [])
  const normalizedName = normalizeBankLookupValue(args.nameSnapshot)
  const normalizedBranch = normalizeBankLookupValue(args.branchSnapshot)
  const normalizedIfsc = normalizeBankLookupValue(args.ifscCode)
  const normalizedAccountNumber = normalizeBankAccountLookupValue(args.accountNumber)

  if (normalizedIfsc) {
    return lookup.byIfsc.get(normalizedIfsc) ?? []
  }

  if (normalizedAccountNumber) {
    return lookup.byAccountNumber.get(normalizedAccountNumber) ?? []
  }

  if (normalizedName && normalizedBranch) {
    return lookup.byNameBranch.get(`${normalizedName}|${normalizedBranch}`) ?? []
  }

  if (normalizedName) {
    return lookup.byLabelOrName.get(normalizedName) ?? []
  }

  return []
}

function isCashDescriptor(value: string | null | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'cash' || normalized.startsWith('cash ') || normalized.includes(' cash')
}

function resolveSelfTransferSide(
  payment: {
    bankNameSnapshot?: string | null
    bankBranchSnapshot?: string | null
  },
  target: 'bank' | 'cash'
): {
  direction: 'IN' | 'OUT' | 'TRANSFER' | null
  amountIn: number
  amountOut: number
  accountName: string
  description: string
} {
  const fromLabel = normalizeTransferAccountLabel(payment.bankNameSnapshot)
  const toLabel = normalizeTransferAccountLabel(payment.bankBranchSnapshot)
  const fromCash = isCashDescriptor(fromLabel)
  const toCash = isCashDescriptor(toLabel)

  if (target === 'cash') {
    if (fromCash && !toCash) {
      return {
        direction: 'OUT',
        amountIn: 0,
        amountOut: 1,
        accountName: toLabel || 'Bank',
        description: [fromLabel || 'Cash', toLabel || 'Bank'].filter(Boolean).join(' -> ')
      }
    }
    if (!fromCash && toCash) {
      return {
        direction: 'IN',
        amountIn: 1,
        amountOut: 0,
        accountName: fromLabel || 'Bank',
        description: [fromLabel || 'Bank', toLabel || 'Cash'].filter(Boolean).join(' -> ')
      }
    }
    if (fromCash && toCash) {
      return {
        direction: 'TRANSFER',
        amountIn: 1,
        amountOut: 1,
        accountName: 'Cash',
        description: [fromLabel || 'Cash', toLabel || 'Cash'].filter(Boolean).join(' -> ')
      }
    }
    return {
      direction: null,
      amountIn: 0,
      amountOut: 0,
      accountName: '',
      description: [fromLabel, toLabel].filter(Boolean).join(' -> ')
    }
  }

  if (fromCash && !toCash) {
    return {
      direction: 'IN',
      amountIn: 1,
      amountOut: 0,
      accountName: toLabel || 'Bank',
      description: [fromLabel || 'Cash', toLabel || 'Bank'].filter(Boolean).join(' -> ')
    }
  }
  if (!fromCash && toCash) {
    return {
      direction: 'OUT',
      amountIn: 0,
      amountOut: 1,
      accountName: fromLabel || 'Bank',
      description: [fromLabel || 'Bank', toLabel || 'Cash'].filter(Boolean).join(' -> ')
    }
  }
  if (!fromCash && !toCash && (fromLabel || toLabel)) {
    return {
      direction: 'TRANSFER',
      amountIn: 1,
      amountOut: 1,
      accountName: [fromLabel, toLabel].filter(Boolean).join(' -> ') || 'Bank Transfer',
      description: [fromLabel, toLabel].filter(Boolean).join(' -> ')
    }
  }
  return {
    direction: null,
    amountIn: 0,
    amountOut: 0,
    accountName: '',
    description: [fromLabel, toLabel].filter(Boolean).join(' -> ')
  }
}

function isBankLikePayment(payment: {
  mode?: string | null
  bankNameSnapshot?: string | null
  ifscCode?: string | null
  beneficiaryBankAccount?: string | null
  txnRef?: string | null
}): boolean {
  const mode = String(payment.mode || '').trim().toLowerCase()
  if (mode === 'cash' || mode === 'c') {
    return Boolean(payment.bankNameSnapshot || payment.ifscCode || payment.beneficiaryBankAccount || payment.txnRef)
  }

  return Boolean(
    mode || payment.bankNameSnapshot || payment.ifscCode || payment.beneficiaryBankAccount || payment.txnRef
  )
}

function isCashLikePayment(payment: {
  billType?: string | null
  mode?: string | null
  bankNameSnapshot?: string | null
  bankBranchSnapshot?: string | null
}): boolean {
  if (isSelfTransferPaymentType(payment.billType)) {
    return Boolean(resolveSelfTransferSide(payment, 'cash').direction)
  }
  return isCashPaymentMode(payment.mode)
}

function formatPaymentMode(mode: string | null | undefined): string {
  const normalized = String(mode || '').trim()
  if (!normalized) return '-'
  return normalized
}

function normalizeLedgerDirection(value: string | null | undefined): 'debit' | 'credit' {
  return String(value || '').trim().toLowerCase() === 'credit' ? 'credit' : 'debit'
}

function isBankJournalVoucherEntry(entry: { accountGroupSnapshot?: string | null }): boolean {
  return String(entry.accountGroupSnapshot || '').trim().toUpperCase() === 'BANK'
}

function isCashJournalVoucherEntry(entry: { accountGroupSnapshot?: string | null }): boolean {
  return String(entry.accountGroupSnapshot || '').trim().toUpperCase() === 'CASH'
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin', 'trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const { searchParams } = new URL(request.url)
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
    const requestedPartyId = normalizeId(searchParams.get('partyId'))
    const requestedView = normalizeReportView(searchParams.get('view'))
    const explicitDateFrom = parseDateAtBoundary(searchParams.get('dateFrom'))
    const explicitDateTo = parseDateAtBoundary(searchParams.get('dateTo'), true)

    if ((searchParams.get('dateFrom') && !explicitDateFrom) || (searchParams.get('dateTo') && !explicitDateTo)) {
      return NextResponse.json({ error: 'Invalid date range provided' }, { status: 400 })
    }

    if (explicitDateFrom && explicitDateTo && explicitDateFrom > explicitDateTo) {
      return NextResponse.json({ error: 'Date from cannot be after date to' }, { status: 400 })
    }

    const accessibleCompanies = await getAccessibleCompanies(authResult.auth)
    const permittedCompanyIds = await filterCompanyIdsByRoutePermission(
      authResult.auth,
      accessibleCompanies.map((company) => company.id),
      request.nextUrl.pathname,
      request.method
    )

    const permittedCompanies: CompanyOption[] = accessibleCompanies
      .filter((company) => permittedCompanyIds.includes(company.id))
      .map((company) => ({
        id: company.id,
        name: company.name,
        address: null,
        phone: null
      }))

    if (permittedCompanies.length === 0) {
      return NextResponse.json({ error: 'No report access found for this user' }, { status: 403 })
    }

    const explicitRequestedCompanyIds =
      requestedCompanyIds.length > 0 ? requestedCompanyIds : requestedCompanyId ? [requestedCompanyId] : []

    const targetCompanyIds =
      explicitRequestedCompanyIds.length > 0
        ? explicitRequestedCompanyIds.filter((companyId) => permittedCompanyIds.includes(companyId))
        : [permittedCompanies[0].id]

    if (targetCompanyIds.length === 0) {
      return NextResponse.json({ error: 'Requested company is outside your report access scope' }, { status: 403 })
    }

    const financialYearFilter = await getFinancialYearDateFilter({
      request,
      auth: authResult.auth,
      companyId: targetCompanyIds[0]
    })
    const dateFrom = financialYearFilter.dateFrom
    const dateTo = financialYearFilter.dateTo

    const aggregateEligibleCompanyIds =
      targetCompanyIds.length <= 1
        ? []
        : authResult.auth.role === 'super_admin' || authResult.auth.role === 'trader_admin'
          ? permittedCompanyIds
          : authResult.auth.userDbId
            ? (
                await prisma.userPermission.findMany({
                  where: {
                    userId: authResult.auth.userDbId,
                    companyId: { in: permittedCompanyIds },
                    module: 'REPORTS',
                    canWrite: true
                  },
                  select: {
                    companyId: true
                  }
                })
              ).map((row) => row.companyId)
            : []

    const selectedCompanyDetail =
      targetCompanyIds.length === 1
        ? await prisma.company.findFirst({
            where: {
              id: targetCompanyIds[0],
              deletedAt: null
            },
            select: {
              address: true,
              phone: true
            }
          })
        : null

    if (authResult.auth.role !== 'super_admin') {
      const subscriptionAccess = await getCompanySubscriptionAccess(prisma, targetCompanyIds[0])
      if (
        subscriptionAccess &&
        !isModuleEnabledForEntitlement(subscriptionAccess.entitlement, 'REPORTS', 'read')
      ) {
        return NextResponse.json(
          { error: getSubscriptionAccessMessage(subscriptionAccess.entitlement, 'REPORTS') },
          { status: 403 }
        )
      }
    }

    if (
      targetCompanyIds.length > 1 &&
      !targetCompanyIds.every((companyId) => aggregateEligibleCompanyIds.includes(companyId))
    ) {
      return NextResponse.json(
        { error: 'Multi-company reports require All Companies report access for every selected company' },
        { status: 403 }
      )
    }

    const cacheKey = makeServerCacheKey('operations-report', [
      requestedView,
      targetCompanyIds,
      requestedView === 'ledger' ? requestedPartyId || '' : '',
      financialYearFilter.selectedFinancialYearId,
      dateFrom?.toISOString() || '',
      dateTo?.toISOString() || '',
      permittedCompanies.map((company) => company.id),
      aggregateEligibleCompanyIds
    ])

    const payload = await getOrSetServerCache(cacheKey, OPERATIONS_REPORT_CACHE_TTL_MS, async () => {
      const companyNameMap = new Map(permittedCompanies.map((company) => [company.id, company.name]))
      const selectedCompanyName =
        targetCompanyIds.length === 1
          ? companyNameMap.get(targetCompanyIds[0]) || ''
          : `${targetCompanyIds.length} companies`

      const salesWhere = buildOperationalSalesBillWhere({
        companyId: { in: targetCompanyIds },
        status: { not: 'cancelled' as const },
        ...(dateFrom || dateTo
          ? {
              billDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {})
              }
            }
          : {})
      })

      const purchaseWhere = {
      companyId: { in: targetCompanyIds },
      status: { not: 'cancelled' as const },
      ...(dateFrom || dateTo
        ? {
            billDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {})
    }

      const paymentWhere = {
      companyId: { in: targetCompanyIds },
      deletedAt: null,
      ...(dateFrom || dateTo
        ? {
            payDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {})
    }

      const stockAdjustmentWhere = {
      companyId: { in: targetCompanyIds },
      type: 'adjustment',
      ...(dateFrom || dateTo
        ? {
            entryDate: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {})
            }
          }
        : {})
    }

      const salesOutstandingWhere = buildOperationalSalesBillWhere({
        companyId: { in: targetCompanyIds },
        status: { not: 'cancelled' as const },
        ...(dateTo
          ? {
              billDate: {
                lte: dateTo
              }
            }
          : {})
      })

      const purchaseOutstandingWhere = {
      companyId: { in: targetCompanyIds },
      status: { not: 'cancelled' as const },
      ...(dateTo
        ? {
            billDate: {
              lte: dateTo
            }
          }
        : {})
    }

      const paymentOutstandingWhere = {
      companyId: { in: targetCompanyIds },
      deletedAt: null,
      ...(dateTo
        ? {
            payDate: {
              lte: dateTo
            }
          }
        : {})
    }

      const needsOverviewView = requestedView === 'overview'
      const needsLedgerView = requestedView === 'ledger'
      const needsOutstandingView = requestedView === 'outstanding'
      const needsDailyView =
        requestedView === 'daily' || requestedView === 'daily-transaction' || requestedView === 'daily-consolidated' || needsOverviewView
      const needsBankLedgerView = requestedView === 'bank-ledger'
      const needsCashLedgerView = requestedView === 'cash-ledger'
      const needsDetailedPayments = needsDailyView || needsBankLedgerView || needsCashLedgerView
      const needsPartyBalances = needsOutstandingView || needsLedgerView
      const needsSummary = needsOutstandingView || needsOverviewView

      const [
      salesTotalAggregate,
      purchaseTotalAggregate,
      specialPurchaseTotalAggregate,
      paymentTotalsByType,
      stockAdjustmentAggregate,
      salesBills,
      purchaseBills,
      specialPurchaseBills,
      payments,
      journalVoucherEntries,
      stockAdjustments,
      masterBanks,
      bankSyncProviders,
      salesBillsAsOf,
      purchaseBillsAsOf,
      specialPurchaseBillsAsOf,
      paymentsAsOf
      ] = await Promise.all([
      needsSummary
        ? prisma.salesBill.aggregate({
            where: salesWhere,
            _sum: {
              totalAmount: true
            }
          })
        : Promise.resolve({ _sum: { totalAmount: 0 } }),
      needsSummary
        ? prisma.purchaseBill.aggregate({
            where: purchaseWhere,
            _sum: {
              totalAmount: true
            }
          })
        : Promise.resolve({ _sum: { totalAmount: 0 } }),
      needsSummary
        ? prisma.specialPurchaseBill.aggregate({
            where: purchaseWhere,
            _sum: {
              totalAmount: true
            }
          })
        : Promise.resolve({ _sum: { totalAmount: 0 } }),
      needsSummary
        ? prisma.payment.groupBy({
            by: ['billType'],
            where: paymentWhere,
            _sum: {
              amount: true
            }
          })
        : Promise.resolve([]),
      needsSummary
        ? prisma.stockLedger.aggregate({
            where: stockAdjustmentWhere,
            _sum: {
              qtyIn: true,
              qtyOut: true
            }
          })
        : Promise.resolve({ _sum: { qtyIn: 0, qtyOut: 0 } }),
      needsDailyView
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
          partyId: true,
          party: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          },
          salesItems: {
            select: {
              weight: true,
              product: {
                select: {
                  name: true
                }
              }
            }
          }
        },
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
      })
        : Promise.resolve([]),
      needsDailyView
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
          farmerId: true,
          farmerNameSnapshot: true,
          farmerAddressSnapshot: true,
          farmerContactSnapshot: true,
          farmer: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          },
          purchaseItems: {
            select: {
              qty: true,
              productNameSnapshot: true,
              product: {
                select: {
                  name: true
                }
              }
            }
          }
        },
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
      })
        : Promise.resolve([]),
      needsDailyView
        ? prisma.specialPurchaseBill.findMany({
        where: purchaseWhere,
        select: {
          id: true,
          companyId: true,
          supplierInvoiceNo: true,
          billDate: true,
          totalAmount: true,
          paidAmount: true,
          balanceAmount: true,
          supplier: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          },
          specialPurchaseItems: {
            select: {
              weight: true,
              product: {
                select: {
                  name: true
                }
              }
            }
          }
        },
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
      })
        : Promise.resolve([]),
      needsDetailedPayments
        ? prisma.payment.findMany({
        where: paymentWhere,
        select: {
          id: true,
          companyId: true,
          billType: true,
          billId: true,
          payDate: true,
          amount: true,
          mode: true,
          cashAmount: true,
          onlinePayAmount: true,
          ifscCode: true,
          beneficiaryBankAccount: true,
          bankNameSnapshot: true,
          bankBranchSnapshot: true,
          txnRef: true,
          note: true,
          partyId: true,
          farmerId: true,
          party: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          },
          farmer: {
            select: {
              id: true,
              name: true,
              address: true,
              phone1: true
            }
          }
        },
        orderBy: [{ payDate: 'desc' }, { createdAt: 'desc' }]
      })
        : Promise.resolve([]),
      needsBankLedgerView || needsCashLedgerView
        ? prisma.ledgerEntry.findMany({
            where: {
              companyId: { in: targetCompanyIds },
              billType: JOURNAL_VOUCHER_BILL_TYPE,
              ...(dateFrom || dateTo
                ? {
                    entryDate: {
                      ...(dateFrom ? { gte: dateFrom } : {}),
                      ...(dateTo ? { lte: dateTo } : {})
                    }
                  }
                : {})
            },
            select: {
              id: true,
              companyId: true,
              entryDate: true,
              billId: true,
              direction: true,
              amount: true,
              accountHeadNameSnapshot: true,
              accountGroupSnapshot: true,
              counterpartyNameSnapshot: true,
              note: true
            },
            orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }]
          })
        : Promise.resolve([] as JournalVoucherLedgerRow[]),
      needsDailyView
        ? prisma.stockLedger.findMany({
        where: stockAdjustmentWhere,
        select: {
          id: true,
          companyId: true,
          entryDate: true,
          qtyIn: true,
          qtyOut: true,
          refTable: true,
          refId: true,
          product: {
            select: {
              name: true
            }
          }
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }]
      })
        : Promise.resolve([]),
      needsBankLedgerView
        ? prisma.bank.findMany({
            where: {
              companyId: { in: targetCompanyIds },
              isActive: true
            },
            select: {
              id: true,
              companyId: true,
              name: true,
              branch: true,
              ifscCode: true,
              accountNumber: true
            },
            orderBy: [{ name: 'asc' }, { branch: 'asc' }]
          })
        : Promise.resolve([]),
      needsBankLedgerView
        ? loadBankSyncProviderStatuses(targetCompanyIds[0] || '')
        : Promise.resolve([]),
      needsPartyBalances
        ? prisma.salesBill.findMany({
            where: salesOutstandingWhere,
            select: {
              id: true,
              companyId: true,
              billDate: true,
              totalAmount: true,
              partyId: true,
              party: {
                select: {
                  id: true,
                  name: true,
                  address: true,
                  phone1: true
                }
              }
            },
            orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }]
          })
        : Promise.resolve([]),
      needsSummary
        ? prisma.purchaseBill.findMany({
            where: purchaseOutstandingWhere,
            select: {
              id: true,
              companyId: true,
              totalAmount: true
            }
          })
        : Promise.resolve([]),
      needsSummary
        ? prisma.specialPurchaseBill.findMany({
            where: purchaseOutstandingWhere,
            select: {
              id: true,
              companyId: true,
              totalAmount: true
            }
          })
        : Promise.resolve([]),
      needsPartyBalances
        ? prisma.payment.groupBy({
            by: ['billType', 'billId', 'partyId'],
            where: paymentOutstandingWhere,
            _sum: {
              amount: true
            }
          })
        : Promise.resolve([])
    ])

      const partyBalanceIds = needsPartyBalances
        ? Array.from(
            new Set(
              [
                ...salesBillsAsOf.map((bill) => String(bill.partyId || '').trim()),
                ...paymentsAsOf
                  .filter(
                    (payment) =>
                      payment.billType === 'sales' &&
                      isPartyOpeningBalanceReference(payment.billId) &&
                      Boolean(String(payment.partyId || '').trim())
                  )
                  .map((payment) => String(payment.partyId || '').trim())
              ].filter(Boolean)
            )
          )
        : []

      const parties =
        needsPartyBalances && (partyBalanceIds.length > 0 || targetCompanyIds.length > 0)
          ? await prisma.party.findMany({
              where: {
                companyId: { in: targetCompanyIds },
                OR: [
                  { openingBalance: { gt: 0 } },
                  ...(partyBalanceIds.length > 0 ? [{ id: { in: partyBalanceIds } }] : [])
                ]
              },
              select: {
                id: true,
                companyId: true,
                name: true,
                address: true,
                phone1: true,
                openingBalance: true,
                openingBalanceType: true,
                openingBalanceDate: true
              },
              orderBy: [{ name: 'asc' }]
            })
          : []

      const purchasePaymentBillIds = Array.from(
        new Set(
          payments
            .filter((payment) => payment.billType === 'purchase' && payment.billId)
            .map((payment) => payment.billId)
        )
      )
      const salesPaymentBillIds = Array.from(
        new Set(
          payments
            .filter((payment) => payment.billType === 'sales' && payment.billId)
            .map((payment) => payment.billId)
        )
      )
      const cashBankReferences = payments
        .map((payment) => parseCashBankPaymentReference(payment.billId))
        .filter((reference): reference is NonNullable<ReturnType<typeof parseCashBankPaymentReference>> => Boolean(reference))
      const accountingHeadReferenceIds = Array.from(
        new Set(
          cashBankReferences
            .filter((reference) => reference.referenceType === 'accounting-head')
            .map((reference) => reference.referenceId)
        )
      )
      const partyReferenceIds = Array.from(
        new Set(
          cashBankReferences
            .filter((reference) => reference.referenceType === 'party')
            .map((reference) => reference.referenceId)
        )
      )
      const supplierReferenceIds = Array.from(
        new Set(
          cashBankReferences
            .filter((reference) => reference.referenceType === 'supplier')
            .map((reference) => reference.referenceId)
        )
      )

      const [paymentPurchaseBills, paymentSpecialPurchaseBills, paymentSalesBills, referencedAccountingHeads, referencedParties, referencedSuppliers] = await Promise.all([
      purchasePaymentBillIds.length > 0
        ? prisma.purchaseBill.findMany({
            where: { id: { in: purchasePaymentBillIds }, companyId: { in: targetCompanyIds } },
            select: { id: true, billNo: true }
          })
        : Promise.resolve([]),
      purchasePaymentBillIds.length > 0
        ? prisma.specialPurchaseBill.findMany({
            where: { id: { in: purchasePaymentBillIds }, companyId: { in: targetCompanyIds } },
            select: { id: true, supplierInvoiceNo: true }
          })
        : Promise.resolve([]),
      salesPaymentBillIds.length > 0
        ? prisma.salesBill.findMany({
            where: { id: { in: salesPaymentBillIds }, companyId: { in: targetCompanyIds } },
            select: { id: true, billNo: true }
          })
        : Promise.resolve([]),
      accountingHeadReferenceIds.length > 0
        ? prisma.accountingHead.findMany({
            where: {
              companyId: { in: targetCompanyIds },
              id: { in: accountingHeadReferenceIds }
            },
            select: {
              id: true,
              name: true
            }
          })
        : Promise.resolve([]),
      partyReferenceIds.length > 0
        ? prisma.party.findMany({
            where: {
              companyId: { in: targetCompanyIds },
              id: { in: partyReferenceIds }
            },
            select: {
              id: true,
              name: true
            }
          })
        : Promise.resolve([]),
      supplierReferenceIds.length > 0
        ? prisma.supplier.findMany({
            where: {
              companyId: { in: targetCompanyIds },
              id: { in: supplierReferenceIds }
            },
            select: {
              id: true,
              name: true
            }
          })
        : Promise.resolve([])
    ])

      const purchaseBillNoMap = new Map(paymentPurchaseBills.map((bill) => [bill.id, bill.billNo]))
      const specialPurchaseBillNoMap = new Map(paymentSpecialPurchaseBills.map((bill) => [bill.id, bill.supplierInvoiceNo]))
      const salesBillNoMap = new Map(paymentSalesBills.map((bill) => [bill.id, bill.billNo]))
      const masterBankRecords: MasterBankFilterRecord[] = masterBanks.map((bank) => ({
        id: bank.id,
        companyId: bank.companyId,
        name: String(bank.name || '').trim(),
        branch: String(bank.branch || '').trim(),
        ifscCode: String(bank.ifscCode || '').trim().toUpperCase(),
        accountNumber: String(bank.accountNumber || '').trim(),
        label: getMasterBankLabel(bank)
      }))
      const masterBankLookup = buildMasterBankLookup(masterBankRecords)
      const masterBankFilterOptions = Array.from(
        new Set(masterBankRecords.map((bank) => bank.label).filter(Boolean))
      ).sort((left, right) => left.localeCompare(right))
      const cashBankReferenceLabelMap = new Map<string, string>([
        ...referencedAccountingHeads.map((head) => [`accounting-head:${head.id}`, head.name || ''] as const),
        ...referencedParties.map((party) => [`party:${party.id}`, party.name || ''] as const),
        ...referencedSuppliers.map((supplier) => [`supplier:${supplier.id}`, supplier.name || ''] as const)
      ])

      const mapPaymentToBankLedgerRows = (payment: PaymentLedgerRow) => {
        if (!isBankLikePayment(payment)) {
          return []
        }

        const isIncomingReceipt = isIncomingCashflowPaymentType(payment.billType)
        const isOutgoingPayment = isOutgoingCashflowPaymentType(payment.billType)
        const isSelfTransfer = isSelfTransferPaymentType(payment.billType)
        const amount = roundCurrency(normalizeNonNegative(payment.amount))
        const billNo = isIncomingReceipt
          ? String(salesBillNoMap.get(payment.billId) || '')
          : payment.billType === 'purchase'
            ? String(purchaseBillNoMap.get(payment.billId) || specialPurchaseBillNoMap.get(payment.billId) || '')
            : ''
        const referenceNo = billNo || String(payment.txnRef || '')
        const transferDescription = [payment.bankNameSnapshot, payment.bankBranchSnapshot]
          .map((value) => String(value || '').trim())
          .filter(Boolean)
          .join(' -> ')

        if (isSelfTransfer) {
          const fromLabel = normalizeTransferAccountLabel(payment.bankNameSnapshot)
          const toLabel = normalizeTransferAccountLabel(payment.bankBranchSnapshot)
          const fromCash = isCashDescriptor(fromLabel)
          const toCash = isCashDescriptor(toLabel)

          if (!fromCash && !toCash && (fromLabel || toLabel)) {
            const sourceMatches = matchMasterBankLabels({
              masterBankLookup,
              nameSnapshot: fromLabel
            })
            const destinationMatches = matchMasterBankLabels({
              masterBankLookup,
              nameSnapshot: toLabel
            })

            return [
              {
                id: `${payment.id}:source`,
                date: dateKey(payment.payDate),
                companyId: payment.companyId,
                companyName: companyNameMap.get(payment.companyId) || payment.companyId,
                direction: 'TRANSFER' as const,
                billType: getPaymentTypeLabel(payment.billType),
                billNo,
                refNo: referenceNo,
                partyName: `Transfer to ${toLabel || 'Bank'}`,
                bankName: sourceMatches[0] || fromLabel || 'Bank',
                bankFilterValues: sourceMatches.length > 0 ? sourceMatches : [sourceMatches[0] || fromLabel || 'Bank'],
                mode: formatPaymentMode(payment.mode),
                amountIn: 0,
                amountOut: amount,
                txnRef: String(payment.txnRef || ''),
                ifscCode: '',
                accountNo: '',
                note: String(payment.note || transferDescription || '').trim()
              },
              {
                id: `${payment.id}:destination`,
                date: dateKey(payment.payDate),
                companyId: payment.companyId,
                companyName: companyNameMap.get(payment.companyId) || payment.companyId,
                direction: 'TRANSFER' as const,
                billType: getPaymentTypeLabel(payment.billType),
                billNo,
                refNo: referenceNo,
                partyName: `Transfer from ${fromLabel || 'Bank'}`,
                bankName: destinationMatches[0] || toLabel || 'Bank',
                bankFilterValues: destinationMatches.length > 0 ? destinationMatches : [destinationMatches[0] || toLabel || 'Bank'],
                mode: formatPaymentMode(payment.mode),
                amountIn: amount,
                amountOut: 0,
                txnRef: String(payment.txnRef || ''),
                ifscCode: '',
                accountNo: '',
                note: String(payment.note || transferDescription || '').trim()
              }
            ]
          }
        }

        const selfTransferSide = isSelfTransfer ? resolveSelfTransferSide(payment, 'bank') : null
        const matchedMasterBankLabels = isSelfTransfer
          ? Array.from(
              new Set(
                [payment.bankNameSnapshot, payment.bankBranchSnapshot]
                  .map((value) =>
                    matchMasterBankLabels({
                      masterBankLookup,
                      nameSnapshot: value
                    })
                  )
                  .flat()
                  .filter((value) => value && !isCashDescriptor(value))
              )
            )
          : matchMasterBankLabels({
              masterBankLookup,
              nameSnapshot: payment.bankNameSnapshot,
              branchSnapshot: payment.bankBranchSnapshot,
              ifscCode: payment.ifscCode,
              accountNumber: payment.beneficiaryBankAccount
            })
        const amountIn = isSelfTransfer
          ? roundCurrency(amount * Number(selfTransferSide?.amountIn || 0))
          : roundCurrency(isIncomingReceipt ? amount : 0)
        const amountOut = isSelfTransfer
          ? roundCurrency(amount * Number(selfTransferSide?.amountOut || 0))
          : roundCurrency(isOutgoingPayment ? amount : 0)
        const bankLabel = isSelfTransfer
          ? matchedMasterBankLabels.join(' -> ') || selfTransferSide?.accountName || 'Bank Transfer'
          : matchedMasterBankLabels[0] || String(payment.bankNameSnapshot || '').trim() || 'Bank / Online'

        return [
          {
            id: payment.id,
            date: dateKey(payment.payDate),
            companyId: payment.companyId,
            companyName: companyNameMap.get(payment.companyId) || payment.companyId,
            direction: selfTransferSide?.direction || (isIncomingReceipt ? 'IN' : isOutgoingPayment ? 'OUT' : '-'),
            billType: getPaymentTypeLabel(payment.billType),
            billNo,
            refNo: referenceNo,
            partyName: isSelfTransfer
              ? selfTransferSide?.description || transferDescription
              : String(payment.party?.name || payment.farmer?.name || getCashBankTargetLabel(payment.billId) || payment.bankNameSnapshot || ''),
            bankName: bankLabel,
            bankFilterValues: matchedMasterBankLabels,
            mode: formatPaymentMode(payment.mode),
            amountIn,
            amountOut,
            txnRef: String(payment.txnRef || ''),
            ifscCode: String(payment.ifscCode || ''),
            accountNo: String(payment.beneficiaryBankAccount || ''),
            note: String(payment.note || payment.bankBranchSnapshot || '')
          }
        ]
      }

      const mapPaymentToCashLedgerRows = (payment: PaymentLedgerRow) => {
        if (!isCashLikePayment(payment)) {
          return []
        }

        const isIncomingReceipt = isIncomingCashflowPaymentType(payment.billType)
        const isOutgoingPayment = isOutgoingCashflowPaymentType(payment.billType)
        const isSelfTransfer = isSelfTransferPaymentType(payment.billType)
        const amount = roundCurrency(normalizeNonNegative(payment.amount))
        const selfTransferSide = isSelfTransfer ? resolveSelfTransferSide(payment, 'cash') : null
        const billNo = isIncomingReceipt
          ? String(salesBillNoMap.get(payment.billId) || '')
          : payment.billType === 'purchase'
            ? String(purchaseBillNoMap.get(payment.billId) || specialPurchaseBillNoMap.get(payment.billId) || '')
            : ''
        const amountIn = isSelfTransfer
          ? roundCurrency(amount * Number(selfTransferSide?.amountIn || 0))
          : roundCurrency(isIncomingReceipt ? amount : 0)
        const amountOut = isSelfTransfer
          ? roundCurrency(amount * Number(selfTransferSide?.amountOut || 0))
          : roundCurrency(isOutgoingPayment ? amount : 0)

        return [
          {
            id: payment.id,
            date: dateKey(payment.payDate),
            companyId: payment.companyId,
            companyName: companyNameMap.get(payment.companyId) || payment.companyId,
            direction: selfTransferSide?.direction || (isIncomingReceipt ? 'IN' : isOutgoingPayment ? 'OUT' : '-'),
            billType: getPaymentTypeLabel(payment.billType),
            billNo,
            refNo: billNo || String(payment.txnRef || ''),
            partyName: isSelfTransfer
              ? selfTransferSide?.description || [payment.bankNameSnapshot, payment.bankBranchSnapshot].map((value) => String(value || '').trim()).filter(Boolean).join(' -> ')
              : String(payment.party?.name || payment.farmer?.name || getCashBankTargetLabel(payment.billId) || payment.bankNameSnapshot || 'Cash'),
            bankName: isSelfTransfer
              ? selfTransferSide?.accountName || 'Cash'
              : String(payment.bankNameSnapshot || '').trim() || 'Cash',
            mode: formatPaymentMode(payment.mode),
            amountIn,
            amountOut,
            txnRef: String(payment.txnRef || ''),
            ifscCode: '',
            accountNo: '',
            note: String(payment.note || '').trim() || (isSelfTransfer ? selfTransferSide?.description || 'Cash transfer' : formatPaymentMode(payment.mode))
          }
        ]
      }

      const mapJournalVoucherToBankLedgerRows = (entry: JournalVoucherLedgerRow) => {
        if (!isBankJournalVoucherEntry(entry)) {
          return []
        }

        const bankLabel = String(entry.accountHeadNameSnapshot || '').trim() || 'Bank'
        const matchedMasterBankLabels = matchMasterBankLabels({
          masterBankLookup,
          nameSnapshot: bankLabel
        })
        const direction = normalizeLedgerDirection(entry.direction) === 'debit' ? 'IN' : 'OUT'

        return [
          {
            id: entry.id,
            date: dateKey(entry.entryDate),
            companyId: entry.companyId,
            companyName: companyNameMap.get(entry.companyId) || entry.companyId,
            direction,
            billType: 'Journal Voucher',
            billNo: String(entry.billId || '').trim(),
            refNo: String(entry.billId || '').trim(),
            partyName: String(entry.counterpartyNameSnapshot || '').trim() || 'Journal Voucher',
            bankName: matchedMasterBankLabels[0] || bankLabel,
            bankFilterValues: matchedMasterBankLabels.length > 0 ? matchedMasterBankLabels : [matchedMasterBankLabels[0] || bankLabel],
            mode: 'Journal Voucher',
            amountIn: direction === 'IN' ? roundCurrency(normalizeNonNegative(entry.amount)) : 0,
            amountOut: direction === 'OUT' ? roundCurrency(normalizeNonNegative(entry.amount)) : 0,
            txnRef: String(entry.counterpartyNameSnapshot || '').trim(),
            ifscCode: '',
            accountNo: '',
            note: String(entry.note || '').trim()
          }
        ]
      }

      const mapJournalVoucherToCashLedgerRows = (entry: JournalVoucherLedgerRow) => {
        if (!isCashJournalVoucherEntry(entry)) {
          return []
        }

        const direction = normalizeLedgerDirection(entry.direction) === 'debit' ? 'IN' : 'OUT'

        return [
          {
            id: entry.id,
            date: dateKey(entry.entryDate),
            companyId: entry.companyId,
            companyName: companyNameMap.get(entry.companyId) || entry.companyId,
            direction,
            billType: 'Journal Voucher',
            billNo: String(entry.billId || '').trim(),
            refNo: String(entry.billId || '').trim(),
            partyName: String(entry.counterpartyNameSnapshot || '').trim() || 'Journal Voucher',
            bankName: '',
            mode: 'Journal Voucher',
            amountIn: direction === 'IN' ? roundCurrency(normalizeNonNegative(entry.amount)) : 0,
            amountOut: direction === 'OUT' ? roundCurrency(normalizeNonNegative(entry.amount)) : 0,
            txnRef: String(entry.counterpartyNameSnapshot || '').trim(),
            ifscCode: '',
            accountNo: '',
            note: String(entry.note || '').trim()
          }
        ]
      }

      const salesReceiptByBillId = new Map<string, number>()
      const purchasePaidByBillId = new Map<string, number>()
      const getCashBankTargetLabel = (billId: string): string => {
        const reference = parseCashBankPaymentReference(billId)
        if (!reference) return ''
        return cashBankReferenceLabelMap.get(`${reference.referenceType}:${reference.referenceId}`) || ''
      }

      const [openingLedgerPayments, openingJournalVoucherEntries] =
        dateFrom && (needsBankLedgerView || needsCashLedgerView)
          ? await Promise.all([
              prisma.payment.findMany({
                where: {
                  companyId: { in: targetCompanyIds },
                  deletedAt: null,
                  payDate: { lt: dateFrom }
                },
                select: {
                  id: true,
                  companyId: true,
                  billType: true,
                  billId: true,
                  payDate: true,
                  amount: true,
                  mode: true,
                  cashAmount: true,
                  onlinePayAmount: true,
                  ifscCode: true,
                  beneficiaryBankAccount: true,
                  bankNameSnapshot: true,
                  bankBranchSnapshot: true,
                  txnRef: true,
                  note: true,
                  party: {
                    select: {
                      name: true
                    }
                  },
                  farmer: {
                    select: {
                      name: true
                    }
                  }
                }
              }),
              prisma.ledgerEntry.findMany({
                where: {
                  companyId: { in: targetCompanyIds },
                  billType: JOURNAL_VOUCHER_BILL_TYPE,
                  entryDate: { lt: dateFrom }
                },
                select: {
                  id: true,
                  companyId: true,
                  entryDate: true,
                  billId: true,
                  direction: true,
                  amount: true,
                  accountHeadNameSnapshot: true,
                  accountGroupSnapshot: true,
                  counterpartyNameSnapshot: true,
                  note: true
                }
              })
            ])
          : [[], []]

      const bankOpeningBalanceByFilter = new Map<string, number>()
      let bankLedgerOpeningBalance = 0
      for (const row of [
        ...openingLedgerPayments.flatMap((payment) => mapPaymentToBankLedgerRows(payment)),
        ...openingJournalVoucherEntries.flatMap((entry) => mapJournalVoucherToBankLedgerRows(entry))
      ]) {
        const netAmount = roundCurrency(Number(row.amountIn || 0) - Number(row.amountOut || 0))
        bankLedgerOpeningBalance = roundCurrency(bankLedgerOpeningBalance + netAmount)
        const labels =
          Array.isArray(row.bankFilterValues) && row.bankFilterValues.length > 0
            ? row.bankFilterValues
            : [row.bankName].filter(Boolean)
        for (const label of labels) {
          bankOpeningBalanceByFilter.set(
            label,
            roundCurrency((bankOpeningBalanceByFilter.get(label) || 0) + netAmount)
          )
        }
      }

      const cashLedgerOpeningBalance = roundCurrency(
        [
          ...openingLedgerPayments.flatMap((payment) => mapPaymentToCashLedgerRows(payment)),
          ...openingJournalVoucherEntries.flatMap((entry) => mapJournalVoucherToCashLedgerRows(entry))
        ].reduce((sum, row) => sum + Number(row.amountIn || 0) - Number(row.amountOut || 0), 0)
      )

      const openingReceiptsByPartyId = new Map<string, number>()
      for (const payment of paymentsAsOf) {
        if (!payment.billId) continue
        const paymentAmount = roundCurrency(normalizeNonNegative(payment._sum.amount))

        if (
          payment.billType === 'sales' &&
          payment.partyId &&
          isPartyOpeningBalanceReference(payment.billId)
        ) {
          openingReceiptsByPartyId.set(
            payment.partyId,
            roundCurrency((openingReceiptsByPartyId.get(payment.partyId) || 0) + paymentAmount)
          )
        }

        if (!isSalesReceiptType(payment.billType) && payment.billType !== 'purchase') continue

        const targetMap = isSalesReceiptType(payment.billType) ? salesReceiptByBillId : purchasePaidByBillId
        targetMap.set(
          payment.billId,
          roundCurrency((targetMap.get(payment.billId) || 0) + paymentAmount)
        )
      }

      const openingOutstandingByPartyId = new Map<string, number>()
      for (const party of parties) {
        const openingSigned = getSignedPartyOpeningBalance(party.openingBalance, party.openingBalanceType)
        const openingReceipts = roundCurrency(openingReceiptsByPartyId.get(party.id) || 0)
        const openingOutstanding =
          openingSigned > 0
            ? roundCurrency(Math.max(0, openingSigned - openingReceipts))
            : roundCurrency(openingSigned)
        openingOutstandingByPartyId.set(party.id, openingOutstanding)
      }

      const outstandingMap = new Map<string, OutstandingAccumulator>()
      const outstandingAsOfDate = dateTo || new Date()

      for (const bill of salesBillsAsOf) {
      const receivedAmount = roundCurrency(salesReceiptByBillId.get(bill.id) || 0)
      const balanceAmount = roundCurrency(Math.max(0, normalizeNonNegative(bill.totalAmount) - receivedAmount))
      if (balanceAmount <= 0) continue

      const groupKey = `${bill.companyId}:${bill.partyId}`
      const existing = outstandingMap.get(groupKey) || {
        partyId: bill.partyId,
        companyId: bill.companyId,
        companyName: companyNameMap.get(bill.companyId) || bill.companyId,
        partyName: String(bill.party?.name || 'Unknown'),
        phone1: String(bill.party?.phone1 || ''),
        address: String(bill.party?.address || ''),
        saleAmount: 0,
        receivedAmount: 0,
        balanceAmount: 0,
        invoiceCount: 0,
        oldestBillDate: '',
        lastBillDate: ''
      }

      existing.saleAmount += normalizeNonNegative(bill.totalAmount)
      existing.receivedAmount += receivedAmount
      existing.balanceAmount += balanceAmount
      existing.invoiceCount += 1
      const billDateKey = dateKey(bill.billDate)
      if (billDateKey && (!existing.oldestBillDate || billDateKey < existing.oldestBillDate)) {
        existing.oldestBillDate = billDateKey
      }
      if (!existing.lastBillDate || billDateKey > existing.lastBillDate) {
        existing.lastBillDate = billDateKey
      }
      outstandingMap.set(groupKey, existing)
      }

      for (const party of parties) {
        const openingSigned = getSignedPartyOpeningBalance(party.openingBalance, party.openingBalanceType)
        const openingOutstanding = roundCurrency(openingOutstandingByPartyId.get(party.id) || 0)
        const openingReceipts = roundCurrency(openingReceiptsByPartyId.get(party.id) || 0)

        if (openingSigned === 0 && openingOutstanding === 0) continue

        const groupKey = `${party.companyId}:${party.id}`
        const existing = outstandingMap.get(groupKey) || {
          partyId: party.id,
          companyId: party.companyId,
          companyName: companyNameMap.get(party.companyId) || party.companyId,
          partyName: String(party.name || 'Unknown'),
          phone1: String(party.phone1 || ''),
          address: String(party.address || ''),
          saleAmount: 0,
          receivedAmount: 0,
          balanceAmount: 0,
          invoiceCount: 0,
          oldestBillDate: '',
          lastBillDate: ''
        }

        if (openingSigned > 0) {
          existing.saleAmount += openingSigned
          existing.receivedAmount += openingReceipts
        }

        existing.balanceAmount += openingOutstanding
        const openingDateKey = dateKey(party.openingBalanceDate)
        if (openingDateKey && (!existing.oldestBillDate || openingDateKey < existing.oldestBillDate)) {
          existing.oldestBillDate = openingDateKey
        }
        if (openingDateKey && (!existing.lastBillDate || openingDateKey > existing.lastBillDate)) {
          existing.lastBillDate = openingDateKey
        }
        outstandingMap.set(groupKey, existing)
      }

      const outstandingRows = Array.from(outstandingMap.values())
      .map((row) => ({
        ...row,
        saleAmount: roundCurrency(row.saleAmount),
        receivedAmount: roundCurrency(row.receivedAmount),
        balanceAmount: roundCurrency(row.balanceAmount),
        status: normalizeOutstandingStatus(row.balanceAmount, row.receivedAmount),
        daysOverdue: getDaysOverdue(row.oldestBillDate || row.lastBillDate, outstandingAsOfDate),
        ageBucket: getOutstandingAgeBucket(getDaysOverdue(row.oldestBillDate || row.lastBillDate, outstandingAsOfDate))
      }))
      .sort((a, b) => b.balanceAmount - a.balanceAmount || a.partyName.localeCompare(b.partyName))

      const outstandingByPartyId = new Map(outstandingRows.map((row) => [row.partyId, row]))

      const partiesWithContext = parties.map((party) => {
        const outstandingRow = outstandingByPartyId.get(party.id)
        return {
          id: party.id,
          companyId: party.companyId,
          companyName: companyNameMap.get(party.companyId) || party.companyId,
          name: String(party.name || ''),
          address: String(party.address || ''),
          phone1: String(party.phone1 || ''),
          openingBalance: roundCurrency(normalizeNonNegative(party.openingBalance)),
          openingBalanceType: normalizePartyOpeningBalanceType(party.openingBalanceType),
          openingBalanceDate: dateKey(party.openingBalanceDate),
          openingOutstandingAmount: roundCurrency(openingOutstandingByPartyId.get(party.id) || 0),
          balanceAmount: roundCurrency(outstandingRow?.balanceAmount || 0)
        }
      }).sort((a, b) => b.balanceAmount - a.balanceAmount || a.name.localeCompare(b.name))

      const selectedPartyId =
      needsLedgerView && requestedPartyId && partiesWithContext.some((party) => party.id === requestedPartyId)
        ? requestedPartyId
        : needsLedgerView
          ? partiesWithContext[0]?.id || ''
          : ''

      const selectedParty = partiesWithContext.find((party) => party.id === selectedPartyId) || null

      const [ledgerSales, ledgerPayments, openingSalesAggregate, openingPaymentsAggregate] = selectedPartyId
      ? await Promise.all([
          prisma.salesBill.findMany({
            where: buildOperationalSalesBillWhere({
              companyId: { in: targetCompanyIds },
              partyId: selectedPartyId,
              status: { not: 'cancelled' },
              ...(dateFrom || dateTo
                ? {
                    billDate: {
                      ...(dateFrom ? { gte: dateFrom } : {}),
                      ...(dateTo ? { lte: dateTo } : {})
                    }
                  }
                : {})
            }),
            select: {
              id: true,
              companyId: true,
              billNo: true,
              billDate: true,
              totalAmount: true,
              salesItems: {
                select: {
                  weight: true,
                  bags: true,
                  rate: true,
                  product: {
                    select: {
                      name: true
                    }
                  }
                }
              }
            },
            orderBy: [{ billDate: 'asc' }, { createdAt: 'asc' }]
          }),
          prisma.payment.findMany({
            where: {
              companyId: { in: targetCompanyIds },
              billType: 'sales',
              partyId: selectedPartyId,
              deletedAt: null,
              ...(dateFrom || dateTo
                ? {
                    payDate: {
                      ...(dateFrom ? { gte: dateFrom } : {}),
                      ...(dateTo ? { lte: dateTo } : {})
                    }
                  }
                : {})
            },
            select: {
              id: true,
              companyId: true,
              billId: true,
              payDate: true,
              amount: true,
              mode: true,
              txnRef: true,
              note: true,
              bankNameSnapshot: true
            },
            orderBy: [{ payDate: 'asc' }, { createdAt: 'asc' }]
          }),
          dateFrom
            ? prisma.salesBill.aggregate({
                where: buildOperationalSalesBillWhere({
                  companyId: { in: targetCompanyIds },
                  partyId: selectedPartyId,
                  status: { not: 'cancelled' },
                  billDate: { lt: dateFrom }
                }),
                _sum: {
                  totalAmount: true
                }
              })
            : Promise.resolve(null),
          dateFrom
            ? prisma.payment.aggregate({
                where: {
                  companyId: { in: targetCompanyIds },
                  billType: 'sales',
                  partyId: selectedPartyId,
                  deletedAt: null,
                  payDate: { lt: dateFrom }
                },
                _sum: {
                  amount: true
                }
              })
            : Promise.resolve(null)
        ])
      : [[], [], null, null]

      const openingBalance = roundCurrency(
      (selectedParty
        ? getSignedPartyOpeningBalance(selectedParty.openingBalance, selectedParty.openingBalanceType)
        : 0) +
      normalizeNonNegative(openingSalesAggregate?._sum.totalAmount) -
        normalizeNonNegative(openingPaymentsAggregate?._sum.amount)
      )

      const ledgerPaymentBillIds = Array.from(new Set(ledgerPayments.map((payment) => payment.billId)))
      const ledgerBillMap =
      ledgerPaymentBillIds.length > 0
        ? new Map(
            (
              await prisma.salesBill.findMany({
                where: { id: { in: ledgerPaymentBillIds }, companyId: { in: targetCompanyIds } },
                select: { id: true, billNo: true }
              })
            ).map((bill) => [bill.id, bill.billNo])
          )
        : new Map<string, string>()

      const ledgerBaseRows = [
      ...ledgerSales.map((bill) => ({
        id: `sale-${bill.id}`,
        date: bill.billDate,
        type: 'sale' as PartyLedgerEntryType,
        refNo: String(bill.billNo || ''),
        description:
          bill.salesItems.length > 0
            ? bill.salesItems
                .map((item) => {
                  const detailBits = [String(item.product?.name || 'Item')]
                  if (normalizeNonNegative(item.weight) > 0) {
                    detailBits.push(`${roundCurrency(normalizeNonNegative(item.weight))} Qt.`)
                  }
                  if (Number(item.bags || 0) > 0) {
                    detailBits.push(`${Number(item.bags)} bags`)
                  }
                  if (normalizeNonNegative(item.rate) > 0) {
                    detailBits.push(`Rate ${roundCurrency(normalizeNonNegative(item.rate))}`)
                  }
                  return detailBits.join(' ')
                })
                .join(' | ')
            : 'Sales Bill',
        companyId: bill.companyId,
        companyName: companyNameMap.get(bill.companyId) || bill.companyId,
        paymentMode: '-',
        debit: roundCurrency(normalizeNonNegative(bill.totalAmount)),
        credit: 0,
        note: ''
      })),
      ...ledgerPayments.map((payment) => ({
        id: `payment-${payment.id}`,
        date: payment.payDate,
        type: 'receipt' as PartyLedgerEntryType,
        refNo: String(ledgerBillMap.get(payment.billId) || payment.txnRef || ''),
        description: isPartyOpeningBalanceReference(payment.billId) ? 'Opening Receivable Receipt' : 'Payment Receipt',
        companyId: payment.companyId,
        companyName: companyNameMap.get(payment.companyId) || payment.companyId,
        paymentMode: formatPaymentMode(payment.mode),
        debit: 0,
        credit: roundCurrency(normalizeNonNegative(payment.amount)),
        note: String(payment.note || payment.bankNameSnapshot || '').trim()
      }))
    ].sort((a, b) => {
      const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime()
      if (dateDiff !== 0) return dateDiff
      if (a.type === b.type) return a.refNo.localeCompare(b.refNo)
      if (a.type === 'opening') return -1
      if (b.type === 'opening') return 1
      return a.type === 'sale' ? -1 : 1
    })

      let runningBalance = openingBalance
      const ledgerRows = needsLedgerView
      ? [
          ...(dateFrom || openingBalance !== 0
            ? [
                {
                  id: 'opening-balance',
                  date: dateFrom ? dateKey(dateFrom) : '',
                  type: 'opening' as PartyLedgerEntryType,
                  refNo: '-',
                  description: 'Opening Receivable',
                  companyId: selectedParty?.companyId || '',
                  companyName: selectedParty?.companyName || '',
                  paymentMode: '-',
                  debit: 0,
                  credit: 0,
                  note: '',
                  runningBalance
                }
              ]
            : []),
          ...ledgerBaseRows.map((row) => {
            runningBalance = roundCurrency(runningBalance + row.debit - row.credit)
            return {
              ...row,
              date: dateKey(row.date),
              runningBalance
            }
          })
        ]
      : []

      const totalLedgerSales = needsLedgerView
      ? roundCurrency(ledgerBaseRows.reduce((sum, row) => sum + row.debit, 0))
      : 0
      const totalLedgerReceipts = needsLedgerView
      ? roundCurrency(ledgerBaseRows.reduce((sum, row) => sum + row.credit, 0))
      : 0

      const dailySummaryMap = new Map<string, DailySummaryAccumulator>()
      const dailyTransactionRows: Array<{
      id: string
      date: string
      companyId: string
      companyName: string
      category: string
      type: string
      refNo: string
      partyName: string
      productName: string
      amount: number
      quantity: number
      direction: string
      paymentMode: string
      bankName: string
      note: string
    }> = []

      if (needsDailyView) {
      for (const bill of purchaseBills) {
      const key = dateKey(bill.billDate)
      const amount = roundCurrency(normalizeNonNegative(bill.totalAmount))
      const quantity = roundCurrency(
        bill.purchaseItems.reduce((sum, item) => sum + normalizeNonNegative(item.qty), 0)
      )
      const productName = formatProductNames(
        bill.purchaseItems.map((item) => item.productNameSnapshot || item.product?.name || '')
      )

      addDailyMetric(dailySummaryMap, key, bill.companyId, (row) => {
        row.totalPurchase += amount
      })

      dailyTransactionRows.push({
        id: `purchase-${bill.id}`,
        date: key,
        companyId: bill.companyId,
        companyName: companyNameMap.get(bill.companyId) || bill.companyId,
        category: 'purchase',
        type: 'Purchase',
        refNo: String(bill.billNo || ''),
        partyName: String(bill.farmerNameSnapshot || bill.farmer?.name || 'Farmer'),
        productName,
        amount,
        quantity,
        direction: 'OUT',
        paymentMode: '-',
        bankName: '-',
        note: 'Regular purchase'
      })
    }

      for (const bill of specialPurchaseBills) {
      const key = dateKey(bill.billDate)
      const amount = roundCurrency(normalizeNonNegative(bill.totalAmount))
      const quantity = roundCurrency(
        bill.specialPurchaseItems.reduce((sum, item) => sum + normalizeNonNegative(item.weight), 0)
      )
      const productName = formatProductNames(bill.specialPurchaseItems.map((item) => item.product?.name || ''))

      addDailyMetric(dailySummaryMap, key, bill.companyId, (row) => {
        row.totalPurchase += amount
      })

      dailyTransactionRows.push({
        id: `special-purchase-${bill.id}`,
        date: key,
        companyId: bill.companyId,
        companyName: companyNameMap.get(bill.companyId) || bill.companyId,
        category: 'purchase',
        type: 'Supplier Purchase',
        refNo: String(bill.supplierInvoiceNo || ''),
        partyName: String(bill.supplier?.name || 'Supplier'),
        productName,
        amount,
        quantity,
        direction: 'OUT',
        paymentMode: '-',
        bankName: '-',
        note: 'Special purchase'
      })
    }

      for (const bill of salesBills) {
      const key = dateKey(bill.billDate)
      const amount = roundCurrency(normalizeNonNegative(bill.totalAmount))
      const quantity = roundCurrency(
        bill.salesItems.reduce((sum, item) => sum + normalizeNonNegative(item.weight), 0)
      )
      const productName = formatProductNames(bill.salesItems.map((item) => item.product?.name || ''))

      addDailyMetric(dailySummaryMap, key, bill.companyId, (row) => {
        row.totalSales += amount
      })

      dailyTransactionRows.push({
        id: `sale-${bill.id}`,
        date: key,
        companyId: bill.companyId,
        companyName: companyNameMap.get(bill.companyId) || bill.companyId,
        category: 'sales',
        type: 'Sale',
        refNo: String(bill.billNo || ''),
        partyName: String(bill.party?.name || 'Buyer'),
        productName,
        amount,
        quantity,
        direction: 'IN',
        paymentMode: '-',
        bankName: '-',
        note: 'Sales bill'
      })
    }

      for (const payment of payments) {
      const key = dateKey(payment.payDate)
      const amount = roundCurrency(normalizeNonNegative(payment.amount))
      const isIncomingReceipt = isIncomingCashflowPaymentType(payment.billType)
      const isOutgoingPayment = isOutgoingCashflowPaymentType(payment.billType)
      const isSelfTransfer = isSelfTransferPaymentType(payment.billType)
      const refNo = isIncomingReceipt
        ? String(salesBillNoMap.get(payment.billId) || payment.txnRef || '')
        : payment.billType === 'purchase'
          ? String(purchaseBillNoMap.get(payment.billId) || specialPurchaseBillNoMap.get(payment.billId) || payment.txnRef || '')
          : String(payment.txnRef || '')
      const bankName = String(payment.bankNameSnapshot || '').trim() || '-'

      addDailyMetric(dailySummaryMap, key, payment.companyId, (row) => {
        if (isIncomingReceipt) {
          row.totalSalesReceipt += amount
        } else if (isOutgoingPayment) {
          row.totalPurchasePayment += amount
        }
      })

      dailyTransactionRows.push({
        id: `payment-${payment.id}`,
        date: key,
        companyId: payment.companyId,
        companyName: companyNameMap.get(payment.companyId) || payment.companyId,
        category: isSelfTransfer ? 'transfer' : isIncomingReceipt ? 'payment-in' : isOutgoingPayment ? 'payment-out' : 'payment',
        type: getPaymentTypeLabel(payment.billType),
        refNo,
        partyName: isSelfTransfer
          ? [payment.bankNameSnapshot, payment.bankBranchSnapshot].map((value) => String(value || '').trim()).filter(Boolean).join(' -> ')
          : String(payment.party?.name || payment.farmer?.name || getCashBankTargetLabel(payment.billId) || payment.bankNameSnapshot || ''),
        productName: '-',
        amount,
        quantity: 0,
        direction: isSelfTransfer ? 'TRANSFER' : isIncomingReceipt ? 'IN' : isOutgoingPayment ? 'OUT' : '-',
        paymentMode: formatPaymentMode(payment.mode),
        bankName,
        note: String(payment.note || '').trim() || formatPaymentMode(payment.mode)
      })
    }

      for (const entry of stockAdjustments) {
      const key = dateKey(entry.entryDate)
      const quantityIn = roundCurrency(normalizeNonNegative(entry.qtyIn))
      const quantityOut = roundCurrency(normalizeNonNegative(entry.qtyOut))
      const adjustmentQty = roundCurrency(quantityIn + quantityOut)

      addDailyMetric(dailySummaryMap, key, entry.companyId, (row) => {
        row.totalStockAdjustmentQty += adjustmentQty
      })

      dailyTransactionRows.push({
        id: `adjustment-${entry.id}`,
        date: key,
        companyId: entry.companyId,
        companyName: companyNameMap.get(entry.companyId) || entry.companyId,
        category: 'stock-adjustment',
        type: quantityIn > 0 ? 'Stock Adjustment In' : 'Stock Adjustment Out',
        refNo: String(entry.refId || ''),
        partyName: '-',
        productName: String(entry.product?.name || '-'),
        amount: 0,
        quantity: adjustmentQty,
        direction: quantityIn > 0 ? 'IN' : 'OUT',
        paymentMode: '-',
        bankName: '-',
        note: 'Stock adjustment'
      })
    }
      }

      const dailySummaryRows = Array.from(dailySummaryMap.values())
      .map((row) => ({
        date: row.date,
        totalSales: roundCurrency(row.totalSales),
        totalPurchase: roundCurrency(row.totalPurchase),
        totalStockAdjustmentQty: roundCurrency(row.totalStockAdjustmentQty),
        totalPurchasePayment: roundCurrency(row.totalPurchasePayment),
        totalSalesReceipt: roundCurrency(row.totalSalesReceipt),
        netCashflow: roundCurrency(row.totalSalesReceipt - row.totalPurchasePayment),
        transactionCount: row.transactionCount,
        companyCount: row.companyIds.size
      }))
      .sort((a, b) => b.date.localeCompare(a.date))

      const bankLedgerRows = needsBankLedgerView
        ? [
            ...payments.flatMap((payment) => mapPaymentToBankLedgerRows(payment)),
            ...journalVoucherEntries.flatMap((entry) => mapJournalVoucherToBankLedgerRows(entry))
          ].sort((a, b) => b.date.localeCompare(a.date) || a.partyName.localeCompare(b.partyName) || a.id.localeCompare(b.id))
        : []

      const consolidateCashLedgerRows = (rows: Array<{
        id: string
        date: string
        companyId: string
        companyName: string
        direction: string
        billType: string
        billNo: string
        refNo: string
        partyName: string
        bankName: string
        mode: string
        amountIn: number
        amountOut: number
        txnRef: string
        ifscCode: string
        accountNo: string
        note: string
      }>) => {
        const consolidated = new Map<string, typeof rows[number] & { farmerCount: number }>()
        const passthrough: typeof rows = []

        for (const row of rows) {
          const shouldConsolidate =
            row.billType === 'Purchase Payment' &&
            row.direction === 'OUT' &&
            row.amountOut > 0 &&
            row.mode.toLowerCase() === 'cash' &&
            row.partyName.trim().length > 0 &&
            row.partyName.trim().toLowerCase() !== 'cash'

          if (!shouldConsolidate) {
            passthrough.push(row)
            continue
          }

          const key = `${row.companyId}:${row.date}`
          const existing = consolidated.get(key)
          if (existing) {
            existing.amountOut = roundCurrency(existing.amountOut + row.amountOut)
            existing.farmerCount += 1
            existing.note = `Consolidated farmer cash payment for ${existing.farmerCount} farmers`
            continue
          }

          consolidated.set(key, {
            ...row,
            id: `cash-farmer-day:${key}`,
            billNo: '',
            refNo: `DAY-${row.date}`,
            partyName: 'Farmer Payment',
            note: 'Consolidated farmer cash payment for 1 farmer',
            txnRef: '',
            ifscCode: '',
            accountNo: '',
            farmerCount: 1
          })
        }

        return [
          ...passthrough,
          ...Array.from(consolidated.values()).map((row) => {
            const { farmerCount, ...nextRow } = row
            void farmerCount
            return nextRow
          })
        ].sort((a, b) => b.date.localeCompare(a.date) || a.partyName.localeCompare(b.partyName) || a.id.localeCompare(b.id))
      }

      const cashLedgerRows = needsCashLedgerView
        ? consolidateCashLedgerRows([
            ...payments.flatMap((payment) => mapPaymentToCashLedgerRows(payment)),
            ...journalVoucherEntries.flatMap((entry) => mapJournalVoucherToCashLedgerRows(entry))
          ])
        : []

      const bankFilterOptions = needsBankLedgerView
        ? Array.from(
            new Set(
              [
                ...masterBankFilterOptions,
                ...bankLedgerRows.flatMap((row) =>
                  Array.isArray(row.bankFilterValues) && row.bankFilterValues.length > 0
                    ? row.bankFilterValues
                    : [row.bankName].filter(Boolean)
                )
              ].filter(Boolean)
            )
          ).sort((left, right) => left.localeCompare(right))
        : []

      const totalSaleAmount = roundCurrency(normalizeNonNegative(salesTotalAggregate._sum.totalAmount))
      const totalPurchaseAmount = roundCurrency(
      normalizeNonNegative(purchaseTotalAggregate._sum.totalAmount) +
        normalizeNonNegative(specialPurchaseTotalAggregate._sum.totalAmount)
      )
      const totalPaidAmount = roundCurrency(
        paymentTotalsByType.reduce(
          (sum, row) => sum + (isOutgoingCashflowPaymentType(row.billType) ? normalizeNonNegative(row._sum.amount) : 0),
          0
        )
      )
      const totalReceivedAmount = roundCurrency(
        paymentTotalsByType.reduce(
          (sum, row) => sum + (isIncomingCashflowPaymentType(row.billType) ? normalizeNonNegative(row._sum.amount) : 0),
          0
        )
      )
      const purchaseBalanceTotal = roundCurrency(
      purchaseBillsAsOf.reduce(
        (sum, bill) => sum + Math.max(0, normalizeNonNegative(bill.totalAmount) - (purchasePaidByBillId.get(bill.id) || 0)),
        0
      ) +
        specialPurchaseBillsAsOf.reduce(
          (sum, bill) => sum + Math.max(0, normalizeNonNegative(bill.totalAmount) - (purchasePaidByBillId.get(bill.id) || 0)),
          0
        )
      )
      const salesBalanceTotal = roundCurrency(
      salesBillsAsOf.reduce(
        (sum, bill) => sum + Math.max(0, normalizeNonNegative(bill.totalAmount) - (salesReceiptByBillId.get(bill.id) || 0)),
        0
      )
      )
      const totalBalance = roundCurrency(purchaseBalanceTotal + salesBalanceTotal)
      const netOutstanding = roundCurrency(salesBalanceTotal - purchaseBalanceTotal)
      const totalStockAdjustmentQty = roundCurrency(
      normalizeNonNegative(stockAdjustmentAggregate._sum.qtyIn) + normalizeNonNegative(stockAdjustmentAggregate._sum.qtyOut)
      )

      return {
      companies: permittedCompanies,
      summary: {
        totalSaleAmount,
        totalPurchaseAmount,
        totalPaidAmount,
        totalReceivedAmount,
        totalBalance,
        netOutstanding,
        salesBalanceTotal,
        purchaseBalanceTotal,
        totalStockAdjustmentQty
      },
      outstanding: requestedView === 'outstanding' || requestedView === 'overview' ? outstandingRows : [],
      parties: needsLedgerView ? partiesWithContext : [],
      partyLedger: needsLedgerView
        ? {
            selectedPartyId,
            selectedPartyName: selectedParty?.name || '',
            selectedPartyCompanyName: selectedParty?.companyName || '',
            openingBalance,
            totalSales: totalLedgerSales,
            totalReceipts: totalLedgerReceipts,
            closingBalance: ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].runningBalance : openingBalance,
            rows: ledgerRows
          }
        : undefined,
      dailyTransactions: needsDailyView
        ? dailyTransactionRows.sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type))
        : [],
      dailyTransactionSummary: needsDailyView ? dailySummaryRows : [],
      dailyConsolidated: needsDailyView ? dailySummaryRows : [],
      bankLedger: needsBankLedgerView ? bankLedgerRows : [],
      cashLedger: needsCashLedgerView ? cashLedgerRows : [],
      filterOptions: {
        banks: bankFilterOptions
      },
      meta: {
        scope: 'company',
        companyIds: targetCompanyIds,
        companyId: targetCompanyIds[0] || '',
        companyName: selectedCompanyName,
        companyAddress: selectedCompanyDetail?.address || '',
        companyPhone: selectedCompanyDetail?.phone || '',
        canAggregateCompanies: aggregateEligibleCompanyIds.length > 1,
        bankSync: {
          activeProvider: 'manual',
          providers: bankSyncProviders
        },
        openingBalances: {
          bankLedger: bankLedgerOpeningBalance,
          cashLedger: cashLedgerOpeningBalance,
          bankLedgerByBank: Object.fromEntries(bankOpeningBalanceByFilter)
        },
        financialYearId: financialYearFilter.selectedFinancialYearId || '',
        financialYearLabel: financialYearFilter.effectiveFinancialYear?.label || '',
        dateFrom: dateFrom ? dateKey(dateFrom) : '',
        dateTo: dateTo ? dateKey(dateTo) : '',
        generatedAt: new Date().toISOString()
      }
      }
    })

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
