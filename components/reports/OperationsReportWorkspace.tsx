'use client'

import { Fragment, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Activity,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Building2,
  CalendarRange,
  CircleDollarSign,
  Coins,
  Download,
  FileText,
  Landmark,
  Receipt,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet
} from 'lucide-react'
import { motion } from 'framer-motion'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ReportWorkspaceSkeleton } from '@/components/performance/page-placeholders'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { getFinancialYearDateRangeInput } from '@/lib/client-financial-years'
import { loadShellCompanies } from '@/lib/client-shell-data'
import { printHtmlDocument } from '@/lib/report-print'
import { useClientFinancialYear } from '@/lib/use-client-financial-year'
import { cn } from '@/lib/utils'

type ReportView = 'overview' | 'outstanding' | 'ledger' | 'daily' | 'bank-ledger' | 'cash-ledger'
type OutstandingSort = 'highest' | 'lowest'
type ReportScope = 'company' | 'individual-trader'
type LedgerDirectionFilter = 'all' | 'in' | 'out' | 'transfer'
type OutstandingAgeBucket = 'Current' | '1-7 Days' | '8-15 Days' | '16-30 Days' | '31-60 Days' | '61-90 Days' | '90+ Days'

type CompanyRecord = {
  id: string
  name: string
}

type SummaryPayload = {
  totalSaleAmount: number
  totalPurchaseAmount: number
  totalPaidAmount: number
  totalReceivedAmount: number
  totalBalance: number
  netOutstanding: number
  salesBalanceTotal: number
  purchaseBalanceTotal: number
  totalStockAdjustmentQty: number
}

type OutstandingRow = {
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
  daysOverdue: number
  ageBucket: OutstandingAgeBucket
  status: 'paid' | 'partial' | 'unpaid'
}

type PartyOption = {
  id: string
  companyId: string
  companyName: string
  name: string
  address: string
  phone1: string
  balanceAmount: number
}

type LedgerRow = {
  id: string
  date: string
  type: 'opening' | 'sale' | 'receipt'
  refNo: string
  description: string
  companyId: string
  companyName: string
  paymentMode: string
  debit: number
  credit: number
  note: string
  runningBalance: number
}

type DailyTransactionRow = {
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
}

type DailySummaryRow = {
  date: string
  totalSales: number
  totalPurchase: number
  totalStockAdjustmentQty: number
  totalPurchasePayment: number
  totalSalesReceipt: number
  netCashflow: number
  transactionCount: number
  companyCount: number
}

type BankLedgerRow = {
  id: string
  date: string
  companyId: string
  companyName: string
  direction: 'IN' | 'OUT' | 'TRANSFER' | '-'
  billType: string
  billNo: string
  refNo: string
  partyName: string
  bankName: string
  bankFilterValues?: string[]
  mode: string
  amountIn: number
  amountOut: number
  txnRef: string
  ifscCode: string
  accountNo: string
  note: string
}

type BankSyncProviderStatus = {
  provider: string
  label: string
  mode: 'manual_import' | 'auto_sync'
  configured: boolean
  ready: boolean
  supportsImport: boolean
  supportsAutoSync: boolean
  supportsHistoricalSync: boolean
  supportsWebhook: boolean
  message: string
}

type OperationsReportPayload = {
  companies?: CompanyRecord[]
  summary?: SummaryPayload
  outstanding?: OutstandingRow[]
  parties?: PartyOption[]
  partyLedger?: {
    selectedPartyId: string
    selectedPartyName: string
    selectedPartyCompanyName: string
    openingBalance: number
    totalSales: number
    totalReceipts: number
    closingBalance: number
    rows: LedgerRow[]
  }
  dailyTransactions?: DailyTransactionRow[]
  dailyTransactionSummary?: DailySummaryRow[]
  dailyConsolidated?: DailySummaryRow[]
  bankLedger?: BankLedgerRow[]
  cashLedger?: BankLedgerRow[]
  filterOptions?: {
    banks?: string[]
  }
  meta?: {
    scope?: ReportScope
    companyIds?: string[]
    companyId?: string
    companyName?: string
    companyAddress?: string
    companyPhone?: string
    canAggregateCompanies?: boolean
    bankSync?: {
      activeProvider?: string
      providers?: BankSyncProviderStatus[]
    }
    openingBalances?: {
      bankLedger?: number
      cashLedger?: number
      bankLedgerByBank?: Record<string, number>
    }
    dateFrom?: string
    dateTo?: string
    generatedAt?: string
  }
}

interface OperationsReportWorkspaceProps {
  initialCompanyId?: string
  initialView?: ReportView
  embedded?: boolean
  onBackToDashboard?: () => void
  companyOptions?: CompanyRecord[]
  initialReportData?: OperationsReportPayload | null
  initialDateFrom?: string
  initialDateTo?: string
  initialLastGeneratedAt?: string
  initialSelectedPartyId?: string
}

const surfaceCardClass = 'rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]'
const OPERATIONS_REPORT_CACHE_AGE_MS = 20_000
const SHELL_COMPANIES_CACHE_KEY = 'shell:companies'
const SHELL_COMPANIES_CACHE_AGE_MS = 5 * 60_000
const operationsViewOptions: Array<{ value: ReportView; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'ledger', label: 'Party Ledger' },
  { value: 'daily', label: 'Daily' },
  { value: 'cash-ledger', label: 'Cash' },
  { value: 'bank-ledger', label: 'Bank' }
]

const OUTSTANDING_BUCKET_OPTIONS: OutstandingAgeBucket[] = [
  'Current',
  '1-7 Days',
  '8-15 Days',
  '16-30 Days',
  '31-60 Days',
  '61-90 Days',
  '90+ Days'
]

type MetricTone = 'emerald' | 'rose' | 'sky' | 'amber' | 'violet'

type MetricCardConfig = {
  key: string
  label: string
  value: string
  hint: string
  tone: MetricTone
  icon: typeof Activity
}

type StatementDisplayRow = {
  id: string
  date: string
  badge: string
  badgeTone: MetricTone
  icon: typeof Activity
  title: string
  subtitle: string
  flow: string
  reference: string
  debit: number
  credit: number
  balance: string
  details: Array<{ label: string; value: string }>
}

function toneClasses(tone: MetricTone) {
  if (tone === 'emerald') {
    return {
      card: 'from-emerald-500 via-emerald-500 to-teal-500 text-white shadow-emerald-500/25',
      soft: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      accent: 'text-emerald-700',
    }
  }
  if (tone === 'rose') {
    return {
      card: 'from-rose-500 via-rose-500 to-orange-500 text-white shadow-rose-500/25',
      soft: 'border-rose-200 bg-rose-50 text-rose-700',
      accent: 'text-rose-700',
    }
  }
  if (tone === 'amber') {
    return {
      card: 'from-amber-500 via-orange-500 to-yellow-500 text-white shadow-amber-500/25',
      soft: 'border-amber-200 bg-amber-50 text-amber-700',
      accent: 'text-amber-700',
    }
  }
  if (tone === 'violet') {
    return {
      card: 'from-violet-500 via-indigo-500 to-sky-500 text-white shadow-violet-500/25',
      soft: 'border-violet-200 bg-violet-50 text-violet-700',
      accent: 'text-violet-700',
    }
  }
  return {
    card: 'from-sky-500 via-blue-500 to-indigo-500 text-white shadow-sky-500/25',
    soft: 'border-sky-200 bg-sky-50 text-sky-700',
    accent: 'text-sky-700',
  }
}

function toDateInputValue(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function numberText(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0))
}

function currencyText(value: number): string {
  return `Rs ${numberText(value)}`
}

function absoluteCurrencyText(value: number): string {
  return currencyText(Math.abs(Number(value || 0)))
}

function roundAmount(value: number): number {
  return Number(Number(value || 0).toFixed(2))
}

function formatFlowSummaryText(value: number, positiveLabel = 'Inflow', negativeLabel = 'Outflow'): string {
  const normalized = Number(value || 0)
  if (Math.abs(normalized) < 0.005) {
    return `Balanced ${currencyText(0)}`
  }
  return `${normalized >= 0 ? positiveLabel : negativeLabel} ${absoluteCurrencyText(normalized)}`
}

function csvEscape(value: string | number): string {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function downloadTextFile(name: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function printTable(
  title: string,
  subtitle: string,
  headers: string[],
  rows: string[][],
  options: {
    rightAlignedColumnCount?: number
  } = {}
) {
  const rightAlignedColumnCount = Math.max(0, options.rightAlignedColumnCount ?? 3)
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, index) =>
              `<td style="${index >= Math.max(0, row.length - rightAlignedColumnCount) ? 'text-align:right;' : ''}">${escapeHtml(cell)}</td>`
          )
          .join('')}</tr>`
    )
    .join('')

  printHtmlDocument(
    title,
    `
    <style>
      body { font-family: Arial, sans-serif; padding: 18px; color: #0f172a; }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0 0 14px; color: #475569; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border: 1px solid #d1d5db; padding: 6px; vertical-align: top; }
      th { background: #f8fafc; text-align: left; }
    </style>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
    <p>Generated: ${escapeHtml(new Date().toLocaleString('en-IN'))}</p>
    <table>
      <thead>
        <tr>${headerHtml}</tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `
  )
}

function printLedgerStatement(options: {
  title: string
  companyName: string
  companyAddress: string
  companyPhone: string
  subjectLabel: string
  subjectName: string
  subjectAddress: string
  statementPeriod: string
  openingBalance: string
  closingBalance: string
  openingLabel?: string
  closingLabel?: string
  extraLabel?: string
  extraValue?: string
  rows: Array<{
    type: string
    date: string
    voucherNo: string
    particular: string
    debit: string
    credit: string
    balance: string
  }>
  totalDebit: string
  totalCredit: string
  finalBalance: string
}) {
  const bodyRows = options.rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.type || '')}</td>
        <td>${escapeHtml(row.date || '')}</td>
        <td>${escapeHtml(row.voucherNo || '')}</td>
        <td>${escapeHtml(row.particular || '')}</td>
        <td style="text-align:right;">${escapeHtml(row.debit)}</td>
        <td style="text-align:right;">${escapeHtml(row.credit)}</td>
        <td style="text-align:right;font-weight:700;">${escapeHtml(row.balance)}</td>
      </tr>`
    )
    .join('')

  printHtmlDocument(
    options.title,
    `
    <style>
      body { font-family: Arial, sans-serif; padding: 22px; color: #0f172a; }
      .title { background: #a9d08e; border: 1px solid #1f2937; padding: 18px 14px; font-size: 30px; font-weight: 700; text-align: center; }
      .company { width: 100%; border-collapse: collapse; margin-top: 26px; }
      .company td { border: 1px solid #1f2937; padding: 8px 12px; font-size: 14px; text-align: center; }
      .company .name { background: #d9d9d9; font-size: 18px; font-weight: 700; }
      .meta-grid { width: 100%; border-collapse: collapse; margin-top: 0; }
      .meta-grid td { border: 1px solid #1f2937; padding: 8px 10px; font-size: 14px; vertical-align: top; }
      .meta-grid .label { width: 160px; font-weight: 700; }
      .meta-grid .value { font-weight: 600; }
      .ledger { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 12px; }
      .ledger th, .ledger td { border: 1px solid #1f2937; padding: 8px 10px; vertical-align: top; }
      .ledger th { background: #d9d9d9; font-size: 13px; text-align: left; }
      .ledger tfoot td { font-weight: 700; background: #f5f5f5; }
    </style>
    <div class="title">${escapeHtml(options.title)}</div>
    <table class="company">
      <tr>
        <td class="name">${escapeHtml(options.companyName || '-')}</td>
      </tr>
      <tr>
        <td>
          ${options.companyAddress ? `<strong>Address-</strong> ${escapeHtml(options.companyAddress)}<br/>` : ''}
          ${options.companyPhone ? `<strong>Mobile</strong> ${escapeHtml(options.companyPhone)}` : ''}
        </td>
      </tr>
    </table>
    <table class="meta-grid">
      <tr>
        <td class="label">${escapeHtml(options.subjectLabel)}</td>
        <td class="value">${escapeHtml(options.subjectName || '-')}</td>
        <td></td>
        <td></td>
        <td class="label">Date</td>
        <td class="value">${escapeHtml(options.statementPeriod)}</td>
      </tr>
      <tr>
        <td class="label">Address</td>
        <td>${escapeHtml(options.subjectAddress || '-')}</td>
        <td></td>
        <td></td>
        <td class="label">${escapeHtml(options.openingLabel || 'Opening Bal')}</td>
        <td class="value">${escapeHtml(options.openingBalance)}</td>
      </tr>
      <tr>
        <td class="label">${escapeHtml(options.extraLabel || '')}</td>
        <td>${escapeHtml(options.extraValue || '')}</td>
        <td></td>
        <td></td>
        <td class="label">${escapeHtml(options.closingLabel || 'Closing Bal')}</td>
        <td class="value">${escapeHtml(options.closingBalance)}</td>
      </tr>
    </table>
    <table class="ledger">
      <thead>
        <tr>
          <th>Type</th>
          <th>Date</th>
          <th>Voucher No</th>
          <th>Particular</th>
          <th>Debit</th>
          <th>Credit</th>
          <th>Balance</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td></td>
          <td></td>
          <td></td>
          <td style="text-align:right;">${escapeHtml(options.totalDebit)}</td>
          <td style="text-align:right;">${escapeHtml(options.totalCredit)}</td>
          <td style="text-align:right;">${escapeHtml(options.finalBalance)}</td>
        </tr>
      </tfoot>
    </table>
  `
  )
}

function formatDateLabel(value: string): string {
  if (!value) return '-'
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function getLedgerPrimaryDescription(row: LedgerRow): string {
  if (row.type === 'opening') return 'Opening Receivable'
  if (row.type === 'sale') return row.refNo && row.refNo !== '-' ? `Invoice #${row.refNo}` : 'Sales Bill'
  return row.refNo && row.refNo !== '-' ? `Receipt #${row.refNo}` : 'Payment Receipt'
}

function getLedgerSecondaryDescription(row: LedgerRow): string {
  const parts = [row.description, row.paymentMode && row.paymentMode !== '-' ? row.paymentMode : '', row.note]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  return parts.join(' • ')
}

function getLedgerBalanceNature(value: number): 'DR' | 'CR' {
  return Number(value || 0) >= 0 ? 'DR' : 'CR'
}

function getLedgerAbsoluteBalance(value: number): number {
  return Math.abs(Number(value || 0))
}

function formatLedgerBalance(value: number): string {
  return `${numberText(getLedgerAbsoluteBalance(value))} ${getLedgerBalanceNature(value)}.`
}

function buildDateSummaryFromTransactions(rows: DailyTransactionRow[]): DailySummaryRow[] {
  const summaryMap = new Map<string, DailySummaryRow>()

  for (const row of rows) {
    const existing = summaryMap.get(row.date) || {
      date: row.date,
      totalSales: 0,
      totalPurchase: 0,
      totalStockAdjustmentQty: 0,
      totalPurchasePayment: 0,
      totalSalesReceipt: 0,
      netCashflow: 0,
      transactionCount: 0,
      companyCount: 0
    }

    existing.transactionCount += 1

    if (row.category === 'sales') existing.totalSales += Number(row.amount || 0)
    if (row.category === 'purchase') existing.totalPurchase += Number(row.amount || 0)
    if (row.category === 'stock-adjustment') existing.totalStockAdjustmentQty += Number(row.quantity || 0)
    if (row.category === 'payment-in') existing.totalSalesReceipt += Number(row.amount || 0)
    if (row.category === 'payment-out') existing.totalPurchasePayment += Number(row.amount || 0)

    summaryMap.set(row.date, existing)
  }

  return Array.from(summaryMap.values())
    .map((row) => ({
      ...row,
      totalSales: Number(row.totalSales.toFixed(2)),
      totalPurchase: Number(row.totalPurchase.toFixed(2)),
      totalStockAdjustmentQty: Number(row.totalStockAdjustmentQty.toFixed(2)),
      totalPurchasePayment: Number(row.totalPurchasePayment.toFixed(2)),
      totalSalesReceipt: Number(row.totalSalesReceipt.toFixed(2)),
      netCashflow: Number((row.totalSalesReceipt - row.totalPurchasePayment).toFixed(2))
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

function getSearchPlaceholder(activeView: ReportView): string {
  if (activeView === 'overview') return 'Search party, company, bank, reference, or note across the current report context...'
  if (activeView === 'outstanding') return 'Search party, mobile, address, company, overdue bucket, or bill dates...'
  if (activeView === 'ledger') return 'Search date, reference, mode, notes...'
  if (activeView === 'daily') return 'Search type, party, product, company, bank, or note...'
  if (activeView === 'cash-ledger') return 'Search cash entry, party, counter account, reference, note...'
  return 'Search bank, party, bill, IFSC, account, reference...'
}

function buildOperationsCacheKey(args: {
  view: ReportView
  scope: ReportScope
  companyIds: string[]
  dateFrom: string
  dateTo: string
  partyId?: string
}) {
  return [
    'operations-report',
    args.view,
    args.scope,
    args.companyIds.join(','),
    args.dateFrom,
    args.dateTo,
    args.view === 'ledger' ? String(args.partyId || '') : ''
  ].join(':')
}

export default function OperationsReportWorkspace({
  initialCompanyId,
  initialView = 'overview',
  embedded = false,
  onBackToDashboard,
  companyOptions,
  initialReportData = null,
  initialDateFrom = '',
  initialDateTo = '',
  initialLastGeneratedAt = '',
  initialSelectedPartyId = ''
}: OperationsReportWorkspaceProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const today = useMemo(() => new Date(), [])

  const [companies, setCompanies] = useState<CompanyRecord[]>(companyOptions || [])
  const [scope] = useState<ReportScope>('company')
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>(initialCompanyId ? [initialCompanyId] : [])
  const [dateFrom, setDateFrom] = useState(initialDateFrom)
  const [dateTo, setDateTo] = useState(initialDateTo)
  const [selectedPartyId, setSelectedPartyId] = useState(initialSelectedPartyId)
  const [activeView, setActiveView] = useState<ReportView>(initialView)
  const [outstandingSort, setOutstandingSort] = useState<OutstandingSort>('highest')
  const [outstandingBucketFilter, setOutstandingBucketFilter] = useState<'all' | OutstandingAgeBucket>('all')
  const [bankFilter, setBankFilter] = useState('all')
  const [bankDirectionFilter, setBankDirectionFilter] = useState<LedgerDirectionFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [loadingCompanies, setLoadingCompanies] = useState(!(Array.isArray(companyOptions) && companyOptions.length > 0))
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [lastGeneratedAt, setLastGeneratedAt] = useState(initialLastGeneratedAt)
  const [reportData, setReportData] = useState<OperationsReportPayload | null>(initialReportData)
  const [expandedStatementRows, setExpandedStatementRows] = useState<Record<string, boolean>>({})
  const { financialYear } = useClientFinancialYear()
  const deferredSearchTerm = useDeferredValue(searchTerm)
  const companyFilterRef = useRef<HTMLDetailsElement | null>(null)
  const skipInitialFinancialYearSyncRef = useRef(Boolean(initialDateFrom || initialDateTo))
  const skipPreparedGenerationRef = useRef(
    Boolean(initialReportData && (initialCompanyId || initialDateFrom || initialDateTo))
  )
  const selectedCompanyId = selectedCompanyIds[0] || ''
  const canAggregateCompanies = reportData?.meta?.canAggregateCompanies ?? true

  useEffect(() => {
    setActiveView(initialView)
  }, [initialView])

  useEffect(() => {
    const requestedPartyId = String(searchParams.get('partyId') || '').trim()
    if (!requestedPartyId) return
    setSelectedPartyId((previous) => (previous === requestedPartyId ? previous : requestedPartyId))
  }, [searchParams])

  const loadCompanies = useCallback(async () => {
    setLoadingCompanies(true)
    try {
      if (Array.isArray(companyOptions) && companyOptions.length > 0) {
        setCompanies(companyOptions)
        setSelectedCompanyIds((previous) => {
          if (initialCompanyId && companyOptions.some((company) => company.id === initialCompanyId)) {
            return [initialCompanyId]
          }

          const validPrevious = previous.filter((companyId) => companyOptions.some((company) => company.id === companyId))
          if (validPrevious.length > 0) {
            return validPrevious
          }

          return companyOptions[0]?.id ? [companyOptions[0].id] : []
        })
        return
      }

      const normalized = (await loadShellCompanies())
        .map((row) => ({
          id: String(row.id || ''),
          name: String(row.name || '')
        }))
        .filter((row) => row.id && row.name)

      setCompanies(normalized)
      setSelectedCompanyIds((previous) => {
        if (initialCompanyId && normalized.some((company) => company.id === initialCompanyId)) {
          return [initialCompanyId]
        }

        const validPrevious = previous.filter((companyId) => normalized.some((company) => company.id === companyId))
        if (validPrevious.length > 0) {
          return validPrevious
        }

        return normalized[0]?.id ? [normalized[0].id] : []
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load companies')
      setCompanies(getClientCache<CompanyRecord[]>(SHELL_COMPANIES_CACHE_KEY, SHELL_COMPANIES_CACHE_AGE_MS) || [])
    } finally {
      setLoadingCompanies(false)
    }
  }, [companyOptions, initialCompanyId])

  useEffect(() => {
    void loadCompanies()
  }, [loadCompanies])

  useEffect(() => {
    if (scope === 'company' && selectedCompanyIds.length === 0 && companies.length > 0) {
      setSelectedCompanyIds([companies[0].id])
    }
  }, [companies, scope, selectedCompanyIds.length])

  useEffect(() => {
    if (skipInitialFinancialYearSyncRef.current) {
      skipInitialFinancialYearSyncRef.current = false
      return
    }
    const range = getFinancialYearDateRangeInput(financialYear)
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
  }, [financialYear?.id])

  useEffect(() => {
    if (canAggregateCompanies || selectedCompanyIds.length <= 1) return
    setSelectedCompanyIds([selectedCompanyIds[0]])
  }, [canAggregateCompanies, selectedCompanyIds])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const details = companyFilterRef.current
      const target = event.target
      if (!details?.open || !(target instanceof Node)) return
      if (details.contains(target)) return
      details.open = false
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [])

  const buildOperationsParams = useCallback(
    (view: ReportView, partyId?: string) => {
      const params = new URLSearchParams({
        dateFrom,
        dateTo,
        view
      })

      if (scope === 'company' && selectedCompanyIds.length === 1) {
        params.set('companyId', selectedCompanyIds[0])
      }

      if (scope === 'company' && selectedCompanyIds.length > 1) {
        params.set('companyIds', selectedCompanyIds.join(','))
      }

      if (view === 'ledger' && partyId) {
        params.set('partyId', partyId)
      }

      return params
    },
    [dateFrom, dateTo, scope, selectedCompanyIds]
  )

  const fetchOperationsPayload = useCallback(
    async (view: ReportView, options?: { background?: boolean; partyId?: string }) => {
      const cacheKey = buildOperationsCacheKey({
        view,
        scope,
        companyIds: selectedCompanyIds,
        dateFrom,
        dateTo,
        partyId: view === 'ledger' ? options?.partyId || selectedPartyId : ''
      })
      const cachedPayload = getClientCache<OperationsReportPayload>(cacheKey, OPERATIONS_REPORT_CACHE_AGE_MS)
      if (cachedPayload) {
        return { payload: cachedPayload, cacheKey, fromCache: true }
      }

      const response = await fetch(`/api/reports/operations?${buildOperationsParams(view, options?.partyId || selectedPartyId).toString()}`, {
        cache: 'no-store'
      })
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}))
        throw new Error(String(errorPayload?.error || 'Failed to generate operations report'))
      }

      const payload = (await response.json()) as OperationsReportPayload
      setClientCache(cacheKey, payload)
      return { payload, cacheKey, fromCache: false }
    },
    [buildOperationsParams, dateFrom, dateTo, scope, selectedCompanyIds, selectedPartyId]
  )

  const generateReport = useCallback(async () => {
    if (scope === 'company' && selectedCompanyIds.length === 0) {
      setErrorMessage('Select at least one company to generate the report.')
      return
    }
    if (!dateFrom || !dateTo) {
      setErrorMessage('Select date range first.')
      return
    }

    const cacheKey = buildOperationsCacheKey({
      view: activeView,
      scope,
      companyIds: selectedCompanyIds,
      dateFrom,
      dateTo,
      partyId: activeView === 'ledger' ? selectedPartyId : ''
    })
    const cachedPayload = getClientCache<OperationsReportPayload>(cacheKey, OPERATIONS_REPORT_CACHE_AGE_MS)
    if (cachedPayload) {
      if (Array.isArray(cachedPayload.companies) && cachedPayload.companies.length > 0) {
        setCompanies(cachedPayload.companies)
      }
      setReportData(cachedPayload)
      setSelectedPartyId((previous) => cachedPayload.partyLedger?.selectedPartyId || previous)
      setLastGeneratedAt(
        cachedPayload.meta?.generatedAt
          ? new Date(cachedPayload.meta.generatedAt).toLocaleString('en-IN')
          : new Date().toLocaleString('en-IN')
      )
      setErrorMessage('')
      return
    }

    setLoading(true)
    try {
      const { payload } = await fetchOperationsPayload(activeView)
      if (Array.isArray(payload.companies) && payload.companies.length > 0) {
        setCompanies(payload.companies)
      }
      setReportData(payload)
      setSelectedPartyId((previous) => payload.partyLedger?.selectedPartyId || previous)
      setLastGeneratedAt(
        payload.meta?.generatedAt ? new Date(payload.meta.generatedAt).toLocaleString('en-IN') : new Date().toLocaleString('en-IN')
      )
      setErrorMessage('')
    } catch (error) {
      setReportData(null)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to generate operations report')
    } finally {
      setLoading(false)
    }
  }, [activeView, dateFrom, dateTo, fetchOperationsPayload, scope, selectedCompanyIds, selectedPartyId])

  const prefetchReportView = useCallback(
    async (view: ReportView) => {
      if (view === activeView) return
      if (scope === 'company' && selectedCompanyIds.length === 0) return
      if (!dateFrom || !dateTo) return
      try {
        await fetchOperationsPayload(view, {
          partyId: view === 'ledger' ? selectedPartyId : ''
        })
      } catch {
        // Intentionally ignore background prefetch failures.
      }
    },
    [activeView, dateFrom, dateTo, fetchOperationsPayload, scope, selectedCompanyIds.length, selectedPartyId]
  )

  useEffect(() => {
    if (loadingCompanies) return
    if (scope === 'company' && selectedCompanyIds.length === 0) return
    if (skipPreparedGenerationRef.current) {
      skipPreparedGenerationRef.current = false
      return
    }
    void generateReport()
  }, [generateReport, loadingCompanies, scope, selectedCompanyIds.length, dateFrom, dateTo])

  const showCompanyColumn = (reportData?.meta?.companyIds?.length || selectedCompanyIds.length) > 1
  const parties = useMemo(() => reportData?.parties || [], [reportData?.parties])
  const bankOptions = reportData?.filterOptions?.banks || []

  useEffect(() => {
    if (bankFilter === 'all') return
    if (bankOptions.includes(bankFilter)) return
    setBankFilter('all')
  }, [bankFilter, bankOptions])

  const filteredOutstanding = useMemo(() => {
    const query = deferredSearchTerm.trim().toLowerCase()
    const rows = (reportData?.outstanding || []).filter((row) => {
      if (outstandingBucketFilter !== 'all' && row.ageBucket !== outstandingBucketFilter) return false
      if (!query) return true
      return (
        row.partyName.toLowerCase().includes(query) ||
        row.phone1.toLowerCase().includes(query) ||
        row.address.toLowerCase().includes(query) ||
        row.companyName.toLowerCase().includes(query) ||
        row.lastBillDate.toLowerCase().includes(query) ||
        row.oldestBillDate.toLowerCase().includes(query) ||
        row.ageBucket.toLowerCase().includes(query) ||
        String(row.daysOverdue).includes(query)
      )
    })

    return rows.sort((a, b) => {
      if (outstandingSort === 'lowest') {
        return a.balanceAmount - b.balanceAmount || a.partyName.localeCompare(b.partyName)
      }
      return b.balanceAmount - a.balanceAmount || a.partyName.localeCompare(b.partyName)
    })
  }, [deferredSearchTerm, outstandingBucketFilter, outstandingSort, reportData?.outstanding])

  const outstandingTotals = useMemo(
    () =>
      filteredOutstanding.reduce(
        (totals, row) => ({
          saleAmount: roundAmount(totals.saleAmount + row.saleAmount),
          receivedAmount: roundAmount(totals.receivedAmount + row.receivedAmount),
          balanceAmount: roundAmount(totals.balanceAmount + row.balanceAmount),
          invoiceCount: totals.invoiceCount + row.invoiceCount
        }),
        {
          saleAmount: 0,
          receivedAmount: 0,
          balanceAmount: 0,
          invoiceCount: 0
        }
      ),
    [filteredOutstanding]
  )

  const outstandingTotalExportRow = useMemo(
    () => [
      ...(showCompanyColumn
        ? ['Total', '', '', '', '', '', '', '', '']
        : ['Total', '', '', '', '', '', '', '']),
      numberText(outstandingTotals.saleAmount),
      numberText(outstandingTotals.receivedAmount),
      numberText(outstandingTotals.balanceAmount),
      String(outstandingTotals.invoiceCount)
    ],
    [outstandingTotals, showCompanyColumn]
  )

  const filteredLedgerRows = useMemo(() => {
    const query = deferredSearchTerm.trim().toLowerCase()
    return (reportData?.partyLedger?.rows || []).filter((row) => {
      if (!query) return true
      return (
        row.date.toLowerCase().includes(query) ||
        row.refNo.toLowerCase().includes(query) ||
        row.description.toLowerCase().includes(query) ||
        row.companyName.toLowerCase().includes(query) ||
        row.paymentMode.toLowerCase().includes(query) ||
        row.note.toLowerCase().includes(query)
      )
    })
  }, [deferredSearchTerm, reportData?.partyLedger?.rows])

  const filteredDailyTransactions = useMemo(() => {
    const query = deferredSearchTerm.trim().toLowerCase()
    return (reportData?.dailyTransactions || []).filter((row) => {
      if (!query) return true
      return (
        row.date.toLowerCase().includes(query) ||
        row.type.toLowerCase().includes(query) ||
        row.refNo.toLowerCase().includes(query) ||
        row.partyName.toLowerCase().includes(query) ||
        row.productName.toLowerCase().includes(query) ||
        row.note.toLowerCase().includes(query) ||
        row.companyName.toLowerCase().includes(query) ||
        row.paymentMode.toLowerCase().includes(query) ||
        row.bankName.toLowerCase().includes(query)
      )
    })
  }, [deferredSearchTerm, reportData?.dailyTransactions])

  const filteredDailyTransactionSummary = useMemo(
    () => buildDateSummaryFromTransactions(filteredDailyTransactions),
    [filteredDailyTransactions]
  )

  const filteredDailyConsolidated = useMemo(() => {
    const query = deferredSearchTerm.trim().toLowerCase()
    const matchingDates = new Set(filteredDailyTransactions.map((row) => row.date))
    return (reportData?.dailyConsolidated || []).filter((row) => {
      if (!query) return true
      return row.date.toLowerCase().includes(query) || matchingDates.has(row.date)
    })
  }, [deferredSearchTerm, filteredDailyTransactions, reportData?.dailyConsolidated])

  const consolidatedActivityGroups = useMemo(() => {
    const groupMap = new Map<
      string,
      {
        date: string
        totalAmount: number
        totalQuantity: number
        salesCount: number
        purchaseCount: number
        paymentCount: number
        adjustmentCount: number
        rows: DailyTransactionRow[]
      }
    >()

    for (const row of filteredDailyTransactions) {
      const existing = groupMap.get(row.date) || {
        date: row.date,
        totalAmount: 0,
        totalQuantity: 0,
        salesCount: 0,
        purchaseCount: 0,
        paymentCount: 0,
        adjustmentCount: 0,
        rows: []
      }

      existing.totalAmount += Number(row.amount || 0)
      existing.totalQuantity += Number(row.quantity || 0)

      if (row.category === 'sales') existing.salesCount += 1
      if (row.category === 'purchase') existing.purchaseCount += 1
      if (row.category === 'payment-in' || row.category === 'payment-out') existing.paymentCount += 1
      if (row.category === 'stock-adjustment') existing.adjustmentCount += 1

      existing.rows.push(row)
      groupMap.set(row.date, existing)
    }

    return Array.from(groupMap.values())
      .map((group) => ({
        ...group,
        totalAmount: Number(group.totalAmount.toFixed(2)),
        totalQuantity: Number(group.totalQuantity.toFixed(2)),
        rows: group.rows.sort((a, b) => a.type.localeCompare(b.type) || a.refNo.localeCompare(b.refNo))
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [filteredDailyTransactions])

  const todayActivityGroup = useMemo(() => {
    const todayKey = toDateInputValue(today)
    return consolidatedActivityGroups.find((group) => group.date === todayKey) || null
  }, [consolidatedActivityGroups, today])

  const selectedLedgerParty = useMemo(() => {
    const targetId = reportData?.partyLedger?.selectedPartyId || selectedPartyId
    if (!targetId) return null
    return parties.find((party) => party.id === targetId) || null
  }, [parties, reportData?.partyLedger?.selectedPartyId, selectedPartyId])

  const buildSearchText = (row: BankLedgerRow): string => {
    return [
      row.date,
      row.refNo,
      row.billNo,
      row.partyName,
      row.bankName,
      row.mode,
      row.txnRef,
      row.ifscCode,
      row.accountNo,
      row.companyName,
      row.direction,
      row.note
    ]
      .filter(Boolean)
      .join(' | ')
      .toLowerCase()
  }

  const bankLedgerRowsWithSearch = useMemo(() => {
    return (reportData?.bankLedger || []).map((row) => ({
      ...row,
      searchText: buildSearchText(row)
    }))
  }, [reportData?.bankLedger])

  const cashLedgerRowsWithSearch = useMemo(() => {
    return (reportData?.cashLedger || []).map((row) => ({
      ...row,
      searchText: buildSearchText(row)
    }))
  }, [reportData?.cashLedger])

  const filteredBankLedger = useMemo(() => {
    const query = deferredSearchTerm.trim().toLowerCase()
    return bankLedgerRowsWithSearch.filter((row) => {
      const rowBankFilters =
        Array.isArray(row.bankFilterValues) && row.bankFilterValues.length > 0
          ? row.bankFilterValues
          : [row.bankName].filter(Boolean)
      if (bankFilter !== 'all' && !rowBankFilters.includes(bankFilter)) return false
      if (bankDirectionFilter !== 'all' && row.direction.toLowerCase() !== bankDirectionFilter) return false
      if (!query) return true
      return row.searchText.includes(query)
    })
  }, [bankDirectionFilter, bankFilter, bankLedgerRowsWithSearch, deferredSearchTerm])

  const filteredCashLedger = useMemo(() => {
    const query = deferredSearchTerm.trim().toLowerCase()
    return cashLedgerRowsWithSearch.filter((row) => {
      if (bankDirectionFilter !== 'all' && row.direction.toLowerCase() !== bankDirectionFilter) return false
      if (!query) return true
      return row.searchText.includes(query)
    })
  }, [bankDirectionFilter, cashLedgerRowsWithSearch, deferredSearchTerm])

  const partyLedgerStatementRows = useMemo(
    () =>
      filteredLedgerRows.map((row) => ({
        type: row.type === 'opening' ? 'Opening' : row.type === 'sale' ? 'Invoice' : 'Receipt',
        date: row.type === 'opening' ? '' : formatDateLabel(row.date),
        voucherNo: row.refNo || '-',
        particular: [getLedgerPrimaryDescription(row), getLedgerSecondaryDescription(row)].filter(Boolean).join(' | '),
        debit: row.debit > 0 ? numberText(row.debit) : '',
        credit: row.credit > 0 ? numberText(row.credit) : '',
        balance: formatLedgerBalance(row.runningBalance)
      })),
    [filteredLedgerRows]
  )

  const bankLedgerOpeningBalance = useMemo(() => {
    if (bankFilter !== 'all') {
      return roundAmount(reportData?.meta?.openingBalances?.bankLedgerByBank?.[bankFilter] || 0)
    }
    return roundAmount(reportData?.meta?.openingBalances?.bankLedger || 0)
  }, [bankFilter, reportData?.meta?.openingBalances?.bankLedger, reportData?.meta?.openingBalances?.bankLedgerByBank])
  const bankLedgerClosingBalance = useMemo(
    () => roundAmount(bankLedgerOpeningBalance + filteredBankLedger.reduce((sum, row) => sum + row.amountIn - row.amountOut, 0)),
    [bankLedgerOpeningBalance, filteredBankLedger]
  )
  const bankLedgerTotalDebit = useMemo(
    () => roundAmount(filteredBankLedger.reduce((sum, row) => sum + row.amountOut, 0)),
    [filteredBankLedger]
  )
  const bankLedgerTotalCredit = useMemo(
    () => roundAmount(filteredBankLedger.reduce((sum, row) => sum + row.amountIn, 0)),
    [filteredBankLedger]
  )
  const cashLedgerOpeningBalance = useMemo(
    () => roundAmount(reportData?.meta?.openingBalances?.cashLedger || 0),
    [reportData?.meta?.openingBalances?.cashLedger]
  )
  const cashLedgerClosingBalance = useMemo(
    () => roundAmount(cashLedgerOpeningBalance + filteredCashLedger.reduce((sum, row) => sum + row.amountIn - row.amountOut, 0)),
    [cashLedgerOpeningBalance, filteredCashLedger]
  )
  const cashLedgerTotalDebit = useMemo(
    () => roundAmount(filteredCashLedger.reduce((sum, row) => sum + row.amountOut, 0)),
    [filteredCashLedger]
  )
  const cashLedgerTotalCredit = useMemo(
    () => roundAmount(filteredCashLedger.reduce((sum, row) => sum + row.amountIn, 0)),
    [filteredCashLedger]
  )

  const bankLedgerStatementRows = useMemo(() => {
    const sortedRows = [...filteredBankLedger].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.refNo.localeCompare(b.refNo) ||
        a.id.localeCompare(b.id)
    )

    let runningBalance = bankLedgerOpeningBalance

    return sortedRows.map((row) => {
      runningBalance = roundAmount(runningBalance + Number(row.amountIn || 0) - Number(row.amountOut || 0))
      return {
        type: row.direction === 'IN' ? 'Receipt' : row.direction === 'OUT' ? 'Payment' : 'Transfer',
        date: formatDateLabel(row.date),
        voucherNo: row.refNo || row.billNo || '-',
        particular: [
          showCompanyColumn ? row.companyName : '',
          row.partyName,
          row.bankName,
          row.mode,
          row.txnRef || row.note
        ]
          .filter(Boolean)
          .join(' | '),
        debit: row.amountOut > 0 ? numberText(row.amountOut) : '',
        credit: row.amountIn > 0 ? numberText(row.amountIn) : '',
        balance: formatLedgerBalance(runningBalance)
      }
    })
  }, [bankLedgerOpeningBalance, filteredBankLedger, showCompanyColumn])

  const cashLedgerDisplayRows = useMemo<StatementDisplayRow[]>(() => {
    const sortedRows = [...filteredCashLedger].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.refNo.localeCompare(b.refNo) ||
        a.id.localeCompare(b.id)
    )

    let runningBalance = cashLedgerOpeningBalance
    const rows: StatementDisplayRow[] = []
    let pendingGroup:
      | {
          key: string
          date: string
          companyName: string
          mode: string
          debit: number
          references: string[]
          parties: string[]
          count: number
          balance: string
        }
      | null = null

    const flushPendingGroup = () => {
      if (!pendingGroup) return

      rows.push({
        id: `cash-ledger-farmer-group:${pendingGroup.key}`,
        date: formatDateLabel(pendingGroup.date),
        badge: 'Cash Out',
        badgeTone: 'rose',
        icon: ArrowUpRight,
        title: `Farmer Payment (${pendingGroup.count} entr${pendingGroup.count === 1 ? 'y' : 'ies'})`,
        subtitle: pendingGroup.parties.slice(0, 3).join(', ') + (pendingGroup.parties.length > 3 ? ` +${pendingGroup.parties.length - 3} more` : ''),
        flow: 'Cash consolidated payout',
        reference: pendingGroup.references[0] || 'Consolidated',
        debit: pendingGroup.debit,
        credit: 0,
        balance: pendingGroup.balance,
        details: [
          { label: 'Company', value: pendingGroup.companyName || '-' },
          { label: 'Mode', value: pendingGroup.mode || '-' },
          { label: 'Farmer Count', value: String(pendingGroup.parties.length) },
          { label: 'Farmers', value: pendingGroup.parties.join(', ') || '-' },
          { label: 'References', value: pendingGroup.references.join(', ') || '-' },
          { label: 'Note', value: 'Consolidated farmer cash payment entries for faster ledger reading.' }
        ]
      })

      pendingGroup = null
    }

    for (const row of sortedRows) {
      runningBalance = roundAmount(runningBalance + Number(row.amountIn || 0) - Number(row.amountOut || 0))
      const normalizedBillType = String(row.billType || '').trim().toLowerCase()
      const isFarmerCashPayment =
        normalizedBillType === 'purchase payment' &&
        row.direction === 'OUT' &&
        Number(row.amountOut || 0) > 0 &&
        Boolean(String(row.partyName || '').trim())

      if (!isFarmerCashPayment) {
        flushPendingGroup()
        rows.push({
          id: `${row.id}`,
          date: formatDateLabel(row.date),
          badge: row.direction === 'IN' ? 'Cash In' : row.direction === 'OUT' ? 'Cash Out' : 'Transfer',
          badgeTone: row.direction === 'IN' ? 'emerald' : row.direction === 'OUT' ? 'rose' : 'amber',
          icon: row.direction === 'IN' ? ArrowDownLeft : row.direction === 'OUT' ? ArrowUpRight : Wallet,
          title: row.partyName || row.billType || 'Cash movement',
          subtitle: row.bankName || 'Cash ledger',
          flow: row.bankName ? `Cash → ${row.bankName}` : row.mode || 'Cash flow',
          reference: row.refNo || row.billNo || '-',
          debit: row.amountOut,
          credit: row.amountIn,
          balance: formatLedgerBalance(runningBalance),
          details: [
            { label: 'Company', value: row.companyName || '-' },
            { label: 'Mode', value: row.mode || '-' },
            { label: 'Transaction Ref', value: row.txnRef || '-' },
            { label: 'Note', value: row.note || '-' }
          ]
        })
        continue
      }

      const groupKey = [
        row.date,
        showCompanyColumn ? row.companyName : '',
        row.mode,
        row.direction
      ].join('|')

      if (!pendingGroup || pendingGroup.key !== groupKey) {
        flushPendingGroup()
        pendingGroup = {
          key: groupKey,
          date: row.date,
          companyName: row.companyName,
          mode: row.mode,
          debit: 0,
          references: [],
          parties: [],
          count: 0,
          balance: formatLedgerBalance(runningBalance)
        }
      }

      pendingGroup.debit = roundAmount(pendingGroup.debit + Number(row.amountOut || 0))
      pendingGroup.count += 1
      pendingGroup.balance = formatLedgerBalance(runningBalance)
      if (row.refNo || row.billNo) {
        pendingGroup.references.push(row.refNo || row.billNo)
      }
      if (row.partyName) {
        pendingGroup.parties.push(row.partyName)
      }
    }

    flushPendingGroup()
    return rows
  }, [cashLedgerOpeningBalance, filteredCashLedger, showCompanyColumn])

  const cashLedgerStatementRows = useMemo(() => {
    return cashLedgerDisplayRows.map((row) => ({
      type: row.badge,
      date: row.date,
      voucherNo: row.reference || '-',
      particular: [row.title, row.subtitle, row.flow].filter(Boolean).join(' | '),
      debit: row.debit > 0 ? numberText(row.debit) : '',
      credit: row.credit > 0 ? numberText(row.credit) : '',
      balance: row.balance
    }))
  }, [cashLedgerDisplayRows])

  const selectedBankLabel = bankFilter === 'all' ? 'All Banks' : bankFilter
  const companyNameById = useMemo(
    () => new Map(companies.map((company) => [company.id, company.name])),
    [companies]
  )

  const selectedCompanySummary = useMemo(() => {
    const targetIds = reportData?.meta?.companyIds?.length ? reportData.meta.companyIds : selectedCompanyIds
    const targetNames = targetIds
      .map((companyId) => companyNameById.get(companyId) || companyId)
      .filter(Boolean)

    if (targetNames.length === 0) return 'No company selected'
    if (targetNames.length === 1) return targetNames[0]
    if (targetNames.length === 2) return targetNames.join(', ')
    return `${targetNames[0]}, ${targetNames[1]} +${targetNames.length - 2} more`
  }, [companyNameById, reportData?.meta?.companyIds, selectedCompanyIds])

  const recoveryProgress = useMemo(() => {
    const totalSales = Number(reportData?.summary?.totalSaleAmount || 0)
    const totalReceipts = Number(reportData?.summary?.totalReceivedAmount || 0)
    if (totalSales <= 0) return 0
    return Math.max(0, Math.min(100, Number(((totalReceipts / totalSales) * 100).toFixed(1))))
  }, [reportData?.summary?.totalReceivedAmount, reportData?.summary?.totalSaleAmount])

  const overviewMetricCards = useMemo<MetricCardConfig[]>(() => {
    const todayLabel = todayActivityGroup ? `${todayActivityGroup.rows.length} entries today` : 'No activity in current filters'
    return [
      {
        key: 'receivables',
        label: 'Receivables',
        value: currencyText(reportData?.summary?.salesBalanceTotal || 0),
        hint: `${filteredOutstanding.length} parties pending`,
        tone: 'sky',
        icon: CircleDollarSign,
      },
      {
        key: 'payables',
        label: 'Payables',
        value: currencyText(reportData?.summary?.purchaseBalanceTotal || 0),
        hint: `Purchase dues across ${selectedCompanySummary}`,
        tone: 'rose',
        icon: TrendingDown,
      },
      {
        key: 'net',
        label: 'Net Position',
        value: currencyText(reportData?.summary?.netOutstanding || 0),
        hint: `Recovery progress ${recoveryProgress.toFixed(1)}%`,
        tone: 'emerald',
        icon: TrendingUp,
      },
      {
        key: 'today',
        label: "Today's Activity",
        value: todayActivityGroup ? currencyText(todayActivityGroup.totalAmount) : currencyText(0),
        hint: todayLabel,
        tone: 'violet',
        icon: Sparkles,
      }
    ]
  }, [
    filteredOutstanding.length,
    recoveryProgress,
    reportData?.summary?.netOutstanding,
    reportData?.summary?.purchaseBalanceTotal,
    reportData?.summary?.salesBalanceTotal,
    selectedCompanySummary,
    todayActivityGroup,
  ])

  const activeMetricCards = useMemo<MetricCardConfig[]>(() => {
    if (activeView === 'ledger') {
      return [
        {
          key: 'opening',
          label: 'Opening',
          value: formatLedgerBalance(reportData?.partyLedger?.openingBalance || 0),
          hint: 'Opening receivable position',
          tone: 'violet',
          icon: Wallet,
        },
        {
          key: 'debit',
          label: 'Debit',
          value: currencyText(reportData?.partyLedger?.totalSales || 0),
          hint: 'Invoices posted in this range',
          tone: 'rose',
          icon: Receipt,
        },
        {
          key: 'credit',
          label: 'Credit',
          value: currencyText(reportData?.partyLedger?.totalReceipts || 0),
          hint: 'Receipts adjusted',
          tone: 'emerald',
          icon: ArrowDownLeft,
        },
        {
          key: 'closing',
          label: 'Closing',
          value: formatLedgerBalance(reportData?.partyLedger?.closingBalance || 0),
          hint: 'Current running balance',
          tone: 'sky',
          icon: CircleDollarSign,
        },
        {
          key: 'count',
          label: 'Count',
          value: String(filteredLedgerRows.length),
          hint: 'Ledger lines in view',
          tone: 'amber',
          icon: Activity,
        },
      ]
    }

    if (activeView === 'bank-ledger') {
      return [
        {
          key: 'opening',
          label: 'Opening',
          value: formatLedgerBalance(bankLedgerOpeningBalance),
          hint: selectedBankLabel,
          tone: 'violet',
          icon: Landmark,
        },
        {
          key: 'debit',
          label: 'Debit',
          value: currencyText(bankLedgerTotalDebit),
          hint: 'Outflow from bank',
          tone: 'rose',
          icon: ArrowUpRight,
        },
        {
          key: 'credit',
          label: 'Credit',
          value: currencyText(bankLedgerTotalCredit),
          hint: 'Inflow to bank',
          tone: 'emerald',
          icon: ArrowDownLeft,
        },
        {
          key: 'closing',
          label: 'Closing',
          value: formatLedgerBalance(bankLedgerClosingBalance),
          hint: 'Closing bank position',
          tone: 'sky',
          icon: Building2,
        },
        {
          key: 'count',
          label: 'Count',
          value: String(filteredBankLedger.length),
          hint: 'Bank entries in view',
          tone: 'amber',
          icon: Activity,
        },
      ]
    }

    if (activeView === 'cash-ledger') {
      return [
        {
          key: 'opening',
          label: 'Opening',
          value: formatLedgerBalance(cashLedgerOpeningBalance),
          hint: 'Cash book opening',
          tone: 'violet',
          icon: Wallet,
        },
        {
          key: 'debit',
          label: 'Debit',
          value: currencyText(cashLedgerTotalDebit),
          hint: 'Cash paid out',
          tone: 'rose',
          icon: ArrowUpRight,
        },
        {
          key: 'credit',
          label: 'Credit',
          value: currencyText(cashLedgerTotalCredit),
          hint: 'Cash received in',
          tone: 'emerald',
          icon: ArrowDownLeft,
        },
        {
          key: 'closing',
          label: 'Closing',
          value: formatLedgerBalance(cashLedgerClosingBalance),
          hint: 'Closing cash balance',
          tone: 'sky',
          icon: Coins,
        },
        {
          key: 'count',
          label: 'Count',
          value: String(cashLedgerDisplayRows.length),
          hint: 'Cash entries in view',
          tone: 'amber',
          icon: Activity,
        },
      ]
    }

    if (activeView === 'outstanding') {
      return [
        {
          key: 'sale',
          label: 'Sale Amount',
          value: currencyText(outstandingTotals.saleAmount),
          hint: 'Gross exposure',
          tone: 'violet',
          icon: Receipt,
        },
        {
          key: 'received',
          label: 'Received',
          value: currencyText(outstandingTotals.receivedAmount),
          hint: 'Recovered from parties',
          tone: 'emerald',
          icon: ArrowDownLeft,
        },
        {
          key: 'balance',
          label: 'Balance',
          value: currencyText(outstandingTotals.balanceAmount),
          hint: 'Pending to recover',
          tone: 'rose',
          icon: CircleDollarSign,
        },
        {
          key: 'overdue',
          label: 'Overdue Parties',
          value: String(filteredOutstanding.filter((row) => row.daysOverdue > 0).length),
          hint: 'Need collection follow-up',
          tone: 'amber',
          icon: TrendingDown,
        },
        {
          key: 'count',
          label: 'Count',
          value: String(filteredOutstanding.length),
          hint: 'Rows in view',
          tone: 'sky',
          icon: Activity,
        },
      ]
    }

    return [
      {
        key: 'sales',
        label: 'Sales',
        value: currencyText(filteredDailyTransactionSummary.reduce((sum, row) => sum + row.totalSales, 0)),
        hint: 'Total sales in range',
        tone: 'emerald',
        icon: TrendingUp,
      },
      {
        key: 'purchase',
        label: 'Purchase',
        value: currencyText(filteredDailyTransactionSummary.reduce((sum, row) => sum + row.totalPurchase, 0)),
        hint: 'Total purchase in range',
        tone: 'rose',
        icon: TrendingDown,
      },
      {
        key: 'receipt',
        label: 'Receipt',
        value: currencyText(filteredDailyTransactionSummary.reduce((sum, row) => sum + row.totalSalesReceipt, 0)),
        hint: 'Money received',
        tone: 'sky',
        icon: ArrowDownLeft,
      },
      {
        key: 'payment',
        label: 'Payment',
        value: currencyText(filteredDailyTransactionSummary.reduce((sum, row) => sum + row.totalPurchasePayment, 0)),
        hint: 'Money paid out',
        tone: 'amber',
        icon: ArrowUpRight,
      },
      {
        key: 'count',
        label: 'Count',
        value: String(filteredDailyTransactions.length),
        hint: 'Daily activity lines',
        tone: 'violet',
        icon: Activity,
      },
    ]
  }, [
    activeView,
    bankLedgerClosingBalance,
    bankLedgerOpeningBalance,
    bankLedgerTotalCredit,
    bankLedgerTotalDebit,
    cashLedgerClosingBalance,
    cashLedgerDisplayRows.length,
    cashLedgerOpeningBalance,
    cashLedgerTotalCredit,
    cashLedgerTotalDebit,
    filteredBankLedger.length,
    filteredCashLedger.length,
    filteredDailyTransactionSummary,
    filteredDailyTransactions.length,
    filteredLedgerRows.length,
    filteredOutstanding,
    outstandingTotals.balanceAmount,
    outstandingTotals.receivedAmount,
    outstandingTotals.saleAmount,
    reportData?.partyLedger?.closingBalance,
    reportData?.partyLedger?.openingBalance,
    reportData?.partyLedger?.totalReceipts,
    reportData?.partyLedger?.totalSales,
    selectedBankLabel,
  ])

  const topOutstandingRows = useMemo(() => filteredOutstanding.slice(0, 5), [filteredOutstanding])

  const statementRows = useMemo<Record<'ledger' | 'bank-ledger' | 'cash-ledger', StatementDisplayRow[]>>(() => ({
    ledger: filteredLedgerRows.map((row) => ({
      id: row.id,
      date: row.type === 'opening' ? 'Opening' : formatDateLabel(row.date),
      badge: row.type === 'opening' ? 'Opening' : row.type === 'sale' ? 'Invoice' : 'Receipt',
      badgeTone: row.type === 'sale' ? 'rose' : row.type === 'receipt' ? 'emerald' : 'violet',
      icon: row.type === 'sale' ? Receipt : row.type === 'receipt' ? ArrowDownLeft : Wallet,
      title: getLedgerPrimaryDescription(row),
      subtitle: getLedgerSecondaryDescription(row) || 'No extra narration',
      flow: row.paymentMode && row.paymentMode !== '-' ? row.paymentMode : 'Ledger movement',
      reference: row.refNo || '-',
      debit: row.debit,
      credit: row.credit,
      balance: formatLedgerBalance(row.runningBalance),
      details: [
        { label: 'Company', value: row.companyName || '-' },
        { label: 'Description', value: row.description || '-' },
        { label: 'Note', value: row.note || '-' }
      ]
    })),
    'bank-ledger': filteredBankLedger.map((row, index) => ({
      id: `${row.id}-${index}`,
      date: formatDateLabel(row.date),
      badge: row.direction === 'IN' ? 'Credit' : row.direction === 'OUT' ? 'Debit' : 'Transfer',
      badgeTone: row.direction === 'IN' ? 'emerald' : row.direction === 'OUT' ? 'rose' : 'sky',
      icon: row.direction === 'IN' ? ArrowDownLeft : row.direction === 'OUT' ? ArrowUpRight : ArrowRightLeft,
      title: row.partyName || row.billType || 'Bank movement',
      subtitle: row.bankName || 'Bank ledger',
      flow: [row.bankName, row.direction === 'TRANSFER' ? row.note : row.mode].filter(Boolean).join(' → '),
      reference: row.refNo || row.billNo || '-',
      debit: row.amountOut,
      credit: row.amountIn,
      balance: bankLedgerStatementRows[index]?.balance || formatLedgerBalance(bankLedgerOpeningBalance),
      details: [
        { label: 'Company', value: row.companyName || '-' },
        { label: 'Mode', value: row.mode || '-' },
        { label: 'Transaction Ref', value: row.txnRef || '-' },
        { label: 'IFSC', value: row.ifscCode || '-' },
        { label: 'Account', value: row.accountNo || '-' },
        { label: 'Note', value: row.note || '-' }
      ]
    })),
    'cash-ledger': cashLedgerDisplayRows,
  }), [
    bankLedgerOpeningBalance,
    bankLedgerStatementRows,
    cashLedgerDisplayRows,
    filteredBankLedger,
    filteredLedgerRows,
  ])

  const closeCompanyFilter = useCallback(() => {
    if (companyFilterRef.current) {
      companyFilterRef.current.open = false
    }
  }, [])

  const updateOperationsRoute = useCallback(
    (nextView: ReportView, nextPartyId?: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('reportType', 'operations')
      params.set('view', nextView)

      const normalizedPartyId = String(nextPartyId || '').trim()
      if (nextView === 'ledger' && normalizedPartyId) {
        params.set('partyId', normalizedPartyId)
      } else {
        params.delete('partyId')
      }

      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const handleViewChange = useCallback(
    (nextView: ReportView) => {
      startTransition(() => {
        setActiveView(nextView)
        updateOperationsRoute(nextView, nextView === 'ledger' ? selectedPartyId : '')
      })
    },
    [selectedPartyId, updateOperationsRoute]
  )

  const handleLedgerPartyChange = useCallback(
    (value: string) => {
      const nextPartyId = value === 'none' ? '' : value
      setSelectedPartyId(nextPartyId)
      updateOperationsRoute('ledger', nextPartyId)
    },
    [updateOperationsRoute]
  )

  const toggleCompanySelection = (companyId: string) => {
    setSelectedCompanyIds((previous) => {
      let nextCompanyIds = previous

      if (!canAggregateCompanies) {
        nextCompanyIds = [companyId]
      } else if (previous.includes(companyId)) {
        nextCompanyIds = previous.length === 1 ? previous : previous.filter((value) => value !== companyId)
      } else {
        nextCompanyIds = [...previous, companyId]
      }

      closeCompanyFilter()

      return nextCompanyIds
    })
  }

  const toggleStatementRow = useCallback((key: string) => {
    setExpandedStatementRows((current) => ({
      ...current,
      [key]: !current[key]
    }))
  }, [])

  useEffect(() => {
    if (loading || !reportData) return
    const nextViews: ReportView[] =
      activeView === 'overview'
        ? ['outstanding', 'daily']
        : activeView === 'outstanding'
          ? ['ledger', 'bank-ledger']
          : activeView === 'ledger'
            ? ['outstanding', 'cash-ledger']
            : activeView === 'daily'
              ? ['overview', 'bank-ledger']
              : activeView === 'cash-ledger'
                ? ['bank-ledger', 'daily']
                : ['cash-ledger', 'overview']

    const timeout = window.setTimeout(() => {
      for (const nextView of nextViews) {
        void prefetchReportView(nextView)
      }
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [activeView, loading, prefetchReportView, reportData])

  const activeExport = useMemo(() => {
    const scopeLabel =
      selectedCompanyIds.length === 1 ? selectedCompanyId || 'company' : `${selectedCompanyIds.length || 1}-companies`
    const subtitle = `${selectedCompanySummary} | ${formatDateLabel(dateFrom)} to ${formatDateLabel(dateTo)}`

    if (activeView === 'outstanding') {
      return {
        title: 'Outstanding Report',
        subtitle,
        fileName: `outstanding-${scopeLabel}-${dateFrom}-${dateTo}.csv`,
        headers: [
          ...(showCompanyColumn ? ['Company'] : []),
          'Party Name',
          'Mobile',
          'Address',
          'Oldest Due Date',
          'Last Bill Date',
          'Overdue Days',
          'Age Bucket',
          'Status',
          'Sale Amount',
          'Received Amount',
          'Balance Amount',
          'Invoices'
        ],
        rows: filteredOutstanding.map((row) => [
          ...(showCompanyColumn ? [row.companyName] : []),
          row.partyName,
          row.phone1 || '-',
          row.address || '-',
          formatDateLabel(row.oldestBillDate),
          formatDateLabel(row.lastBillDate),
          String(row.daysOverdue),
          row.ageBucket,
          row.status,
          numberText(row.saleAmount),
          numberText(row.receivedAmount),
          numberText(row.balanceAmount),
          String(row.invoiceCount)
        ])
      }
    }

    if (activeView === 'overview') {
      return {
        title: 'Ledger Overview',
        subtitle,
        fileName: `ledger-overview-${scopeLabel}-${dateFrom}-${dateTo}.csv`,
        headers: ['Metric', 'Value', 'Context'],
        rows: [
          ['Receivables', currencyText(reportData?.summary?.salesBalanceTotal || 0), selectedCompanySummary],
          ['Payables', currencyText(reportData?.summary?.purchaseBalanceTotal || 0), selectedCompanySummary],
          ['Net Position', currencyText(reportData?.summary?.netOutstanding || 0), `${recoveryProgress.toFixed(1)}% recovery`],
          ['Today Activity', todayActivityGroup ? currencyText(todayActivityGroup.totalAmount) : currencyText(0), todayActivityGroup ? `${todayActivityGroup.rows.length} entries` : 'No entries'],
        ]
      }
    }

    if (activeView === 'ledger') {
      return {
        title: `Party Ledger${reportData?.partyLedger?.selectedPartyName ? ` - ${reportData.partyLedger.selectedPartyName}` : ''}`,
        subtitle,
        fileName: `party-ledger-${scopeLabel}-${dateFrom}-${dateTo}.csv`,
        headers: ['Type', 'Date', 'Voucher No', 'Particular', 'Debit (Rs)', 'Credit (Rs)', 'Balance'],
        rows: partyLedgerStatementRows.map((row) => [
          row.type,
          row.date || '',
          row.voucherNo || '-',
          row.particular || '-',
          row.debit || '-',
          row.credit || '-',
          row.balance
        ])
      }
    }

    if (activeView === 'daily') {
      return {
        title: 'Daily Report',
        subtitle,
        fileName: `daily-report-${scopeLabel}-${dateFrom}-${dateTo}.csv`,
        headers: [
          ...(showCompanyColumn ? ['Company'] : []),
          'Date',
          'Type',
          'Reference',
          'Party',
          'Product',
          'Quantity',
          'Amount',
          'Direction',
          'Mode',
          'Bank',
          'Note'
        ],
        rows: filteredDailyTransactions.map((row) => [
          ...(showCompanyColumn ? [row.companyName] : []),
          formatDateLabel(row.date),
          row.type,
          row.refNo || '-',
          row.partyName || '-',
          row.productName || '-',
          numberText(row.quantity),
          numberText(row.amount),
          row.direction,
          row.paymentMode || '-',
          row.bankName || '-',
          row.note || '-'
        ])
      }
    }

    if (activeView === 'cash-ledger') {
      return {
        title: 'Cash Ledger',
        subtitle,
        fileName: `cash-ledger-${scopeLabel}-${dateFrom}-${dateTo}.csv`,
        headers: ['Type', 'Date', 'Voucher No', 'Particular', 'Debit (Rs)', 'Credit (Rs)', 'Balance'],
        rows: cashLedgerStatementRows.map((row) => [
          row.type,
          row.date,
          row.voucherNo || '-',
          row.particular || '-',
          row.debit || '-',
          row.credit || '-',
          row.balance
        ])
      }
    }

    return {
      title: 'Bank Ledger',
      subtitle,
      fileName: `bank-ledger-${scopeLabel}-${dateFrom}-${dateTo}.csv`,
      headers: ['Type', 'Date', 'Voucher No', 'Particular', 'Debit (Rs)', 'Credit (Rs)', 'Balance'],
      rows: bankLedgerStatementRows.map((row) => [
        row.type,
        row.date,
        row.voucherNo || '-',
        row.particular || '-',
        row.debit || '-',
        row.credit || '-',
        row.balance
      ])
    }
  }, [
    activeView,
    dateFrom,
    dateTo,
    filteredDailyConsolidated,
    filteredDailyTransactions,
    filteredOutstanding,
    bankLedgerStatementRows,
    cashLedgerStatementRows,
    partyLedgerStatementRows,
    reportData?.partyLedger?.selectedPartyName,
    selectedCompanyIds.length,
    selectedCompanyId,
    selectedCompanySummary,
    showCompanyColumn
  ])

  const bankSyncProviders = reportData?.meta?.bankSync?.providers || []

  const renderExportButtons = (buttonClassName: string) => (
    <>
      <Button variant="outline" onClick={exportCsv} disabled={loading} className={buttonClassName}>
        <Download className="mr-2 h-4 w-4" />
        CSV
      </Button>
      <Button variant="outline" onClick={exportPdf} disabled={loading} className={buttonClassName}>
        <FileText className="mr-2 h-4 w-4" />
        PDF
      </Button>
    </>
  )

  const renderExportMenu = () => (
    <details className="relative">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 marker:hidden hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <Download className="h-4 w-4" />
        Export
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-44 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)]">
        <button
          type="button"
          onClick={exportCsv}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
        >
          <Download className="h-4 w-4" />
          CSV
        </button>
        <button
          type="button"
          onClick={exportPdf}
          className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
        >
          <FileText className="h-4 w-4" />
          PDF
        </button>
      </div>
    </details>
  )

  const exportCsv = () => {
    if (activeExport.rows.length === 0) {
      alert('No rows available to export')
      return
    }

    if (activeView === 'outstanding') {
      const csv = [
        activeExport.headers.map(csvEscape).join(','),
        ...activeExport.rows.map((row) => row.map(csvEscape).join(',')),
        outstandingTotalExportRow.map(csvEscape).join(',')
      ].join('\n')
      downloadTextFile(activeExport.fileName, csv, 'text/csv;charset=utf-8;')
      return
    }

    if (activeView === 'ledger' || activeView === 'bank-ledger' || activeView === 'cash-ledger') {
      const isPartyLedger = activeView === 'ledger'
      const isCashLedger = activeView === 'cash-ledger'
      const totalDebit = isPartyLedger ? reportData?.partyLedger?.totalSales || 0 : isCashLedger ? cashLedgerTotalDebit : bankLedgerTotalDebit
      const totalCredit = isPartyLedger ? reportData?.partyLedger?.totalReceipts || 0 : isCashLedger ? cashLedgerTotalCredit : bankLedgerTotalCredit
      const finalBalance = isPartyLedger
        ? reportData?.partyLedger?.closingBalance || 0
        : isCashLedger
          ? cashLedgerClosingBalance
          : bankLedgerClosingBalance

      const csvRows = [
        ['Company Name', selectedCompanySummary],
        ['Company Address', reportData?.meta?.companyAddress || '-'],
        ['Company Phone', reportData?.meta?.companyPhone || '-'],
        [
          isPartyLedger ? 'Party Name' : isCashLedger ? 'Cash Ledger' : 'Bank Name',
          isPartyLedger ? selectedLedgerParty?.name || reportData?.partyLedger?.selectedPartyName || '-' : isCashLedger ? 'Cash Book' : selectedBankLabel
        ],
        ['Address', isPartyLedger ? selectedLedgerParty?.address || '-' : '-'],
        [isPartyLedger ? 'Phone' : 'Direction', isPartyLedger ? selectedLedgerParty?.phone1 || '-' : bankDirectionFilter === 'all' ? 'All' : bankDirectionFilter.toUpperCase()],
        ['Statement Period', `${formatDateLabel(dateFrom)} to ${formatDateLabel(dateTo)}`],
        [
          isPartyLedger ? 'Opening Receivable' : 'Opening Balance',
          isPartyLedger
            ? formatLedgerBalance(reportData?.partyLedger?.openingBalance || 0)
            : formatLedgerBalance(isCashLedger ? cashLedgerOpeningBalance : bankLedgerOpeningBalance)
        ],
        [isPartyLedger ? 'Closing Receivable' : 'Closing Balance', formatLedgerBalance(finalBalance)],
        [],
        activeExport.headers,
        ...activeExport.rows,
        [],
        ['Total', '', '', '', numberText(totalDebit), numberText(totalCredit), formatLedgerBalance(finalBalance)]
      ]
      const csv = csvRows.map((row) => row.map((cell) => csvEscape(cell || '')).join(',')).join('\n')
      downloadTextFile(activeExport.fileName, csv, 'text/csv;charset=utf-8;')
      return
    }

    const csv = [activeExport.headers.map(csvEscape).join(','), ...activeExport.rows.map((row) => row.map(csvEscape).join(','))].join('\n')
    downloadTextFile(activeExport.fileName, csv, 'text/csv;charset=utf-8;')
  }

  const exportPdf = () => {
    if (activeExport.rows.length === 0) {
      alert('No rows available to export')
      return
    }

    if (activeView === 'ledger') {
      printLedgerStatement({
        title: 'Party Ledger',
        companyName: selectedCompanySummary,
        companyAddress: reportData?.meta?.companyAddress || (showCompanyColumn ? 'Multiple selected companies' : '-'),
        companyPhone: reportData?.meta?.companyPhone || '-',
        subjectLabel: 'Party Name',
        subjectName: selectedLedgerParty?.name || reportData?.partyLedger?.selectedPartyName || '-',
        subjectAddress: selectedLedgerParty?.address || '-',
        statementPeriod: `${formatDateLabel(dateFrom)} to ${formatDateLabel(dateTo)}`,
        openingBalance: formatLedgerBalance(reportData?.partyLedger?.openingBalance || 0),
        closingBalance: formatLedgerBalance(reportData?.partyLedger?.closingBalance || 0),
        openingLabel: 'Opening Receivable',
        closingLabel: 'Closing Receivable',
        extraLabel: 'Phone',
        extraValue: selectedLedgerParty?.phone1 || '-',
        rows: partyLedgerStatementRows,
        totalDebit: numberText(reportData?.partyLedger?.totalSales || 0),
        totalCredit: numberText(reportData?.partyLedger?.totalReceipts || 0),
        finalBalance: formatLedgerBalance(reportData?.partyLedger?.closingBalance || 0)
      })
      return
    }

    if (activeView === 'bank-ledger') {
      printLedgerStatement({
        title: 'Bank Ledger',
        companyName: selectedCompanySummary,
        companyAddress: reportData?.meta?.companyAddress || (showCompanyColumn ? 'Multiple selected companies' : '-'),
        companyPhone: reportData?.meta?.companyPhone || '-',
        subjectLabel: 'Bank Name',
        subjectName: selectedBankLabel,
        subjectAddress: '-',
        statementPeriod: `${formatDateLabel(dateFrom)} to ${formatDateLabel(dateTo)}`,
        openingBalance: formatLedgerBalance(bankLedgerOpeningBalance),
        closingBalance: formatLedgerBalance(bankLedgerClosingBalance),
        extraLabel: 'Direction',
        extraValue: bankDirectionFilter === 'all' ? 'All' : bankDirectionFilter.toUpperCase(),
        rows: bankLedgerStatementRows,
        totalDebit: numberText(bankLedgerTotalDebit),
        totalCredit: numberText(bankLedgerTotalCredit),
        finalBalance: formatLedgerBalance(bankLedgerClosingBalance)
      })
      return
    }

    if (activeView === 'cash-ledger') {
      printLedgerStatement({
        title: 'Cash Ledger',
        companyName: selectedCompanySummary,
        companyAddress: reportData?.meta?.companyAddress || (showCompanyColumn ? 'Multiple selected companies' : '-'),
        companyPhone: reportData?.meta?.companyPhone || '-',
        subjectLabel: 'Cash Ledger',
        subjectName: 'Cash Book',
        subjectAddress: '-',
        statementPeriod: `${formatDateLabel(dateFrom)} to ${formatDateLabel(dateTo)}`,
        openingBalance: formatLedgerBalance(cashLedgerOpeningBalance),
        closingBalance: formatLedgerBalance(cashLedgerClosingBalance),
        extraLabel: 'Direction',
        extraValue: bankDirectionFilter === 'all' ? 'All' : bankDirectionFilter.toUpperCase(),
        rows: cashLedgerStatementRows,
        totalDebit: numberText(cashLedgerTotalDebit),
        totalCredit: numberText(cashLedgerTotalCredit),
        finalBalance: formatLedgerBalance(cashLedgerClosingBalance)
      })
      return
    }

    if (activeView === 'outstanding') {
      printTable(
        activeExport.title,
        activeExport.subtitle,
        activeExport.headers,
        [...activeExport.rows, outstandingTotalExportRow],
        { rightAlignedColumnCount: 4 }
      )
      return
    }

    printTable(activeExport.title, activeExport.subtitle, activeExport.headers, activeExport.rows)
  }

  const clearActiveFilters = () => {
    setSearchTerm('')
    setOutstandingSort('highest')
    setOutstandingBucketFilter('all')
    setBankFilter('all')
    setBankDirectionFilter('all')
  }

  const openOutstandingPartyLedger = useCallback((row: OutstandingRow) => {
    setSelectedCompanyIds([row.companyId])
    setSelectedPartyId(row.partyId)
    setActiveView('ledger')
    closeCompanyFilter()
    updateOperationsRoute('ledger', row.partyId)
  }, [closeCompanyFilter, updateOperationsRoute])

  if ((loadingCompanies || loading) && !reportData) {
    return <ReportWorkspaceSkeleton />
  }

  return (
    <div className="space-y-6">
      {!embedded ? (
        <section className="overflow-hidden rounded-[2rem] border border-slate-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_28%),linear-gradient(135deg,#071226_0%,#111c33_45%,#f8fafc_180%)] shadow-[0_40px_100px_-48px_rgba(15,23,42,0.45)]">
          <div className="px-6 py-6 md:px-8 md:py-7">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-4xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-sky-100/90">
                  <Sparkles className="h-3.5 w-3.5" />
                  Ledger Intelligence
                </div>
                <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white">
                  Premium ledger and reporting workspace
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-200/85">
                  Instant overview, receivable drilldown, daily movement, and cash-bank traceability in one modern reporting canvas.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-200/75">
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">
                    Scope: {selectedCompanySummary}
                  </span>
                  {lastGeneratedAt ? (
                    <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">
                      Synced: {lastGeneratedAt}
                    </span>
                  ) : null}
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">
                    Recovery progress: {recoveryProgress.toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 xl:justify-end">
                {onBackToDashboard ? (
                  <Button variant="outline" onClick={onBackToDashboard} className="rounded-2xl border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white">
                    Back to Dashboard
                  </Button>
                ) : null}
                <Button
                  onClick={() => void generateReport()}
                  disabled={loading || loadingCompanies}
                  className="rounded-2xl bg-white text-slate-950 shadow-lg shadow-slate-950/15 hover:bg-slate-100"
                >
                  <RefreshCw className={cn('mr-2 h-4 w-4', loading ? 'animate-spin' : '')} />
                  {loading ? 'Refreshing...' : 'Refresh'}
                </Button>
                {renderExportMenu()}
              </div>
            </div>

            <div className="mt-6 flex overflow-x-auto pb-1">
              <div className="flex min-w-max items-center gap-2 rounded-[1.4rem] border border-white/15 bg-white/10 p-1.5 backdrop-blur-md">
                {operationsViewOptions.map((item) => {
                  const active = activeView === item.value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => handleViewChange(item.value)}
                      onMouseEnter={() => void prefetchReportView(item.value)}
                      className={cn(
                        'rounded-[1rem] px-4 py-2.5 text-sm font-medium transition-all duration-200',
                        active
                          ? 'bg-white text-slate-950 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.55)]'
                          : 'text-slate-200/85 hover:bg-white/10 hover:text-white'
                      )}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-[1.8rem] border border-slate-200/80 bg-white/80 p-4 shadow-[0_24px_60px_-46px_rgba(15,23,42,0.18)] backdrop-blur md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex overflow-x-auto pb-1">
              <div className="flex min-w-max items-center gap-2 rounded-[1.3rem] border border-slate-200 bg-slate-50/90 p-1.5">
                {operationsViewOptions.map((item) => {
                  const active = activeView === item.value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => handleViewChange(item.value)}
                      onMouseEnter={() => void prefetchReportView(item.value)}
                      className={cn(
                        'rounded-[1rem] px-4 py-2.5 text-sm font-medium transition-colors',
                        active
                          ? 'bg-slate-950 text-white shadow-[0_14px_30px_-20px_rgba(15,23,42,0.45)]'
                          : 'text-slate-600 hover:bg-white hover:text-slate-950'
                      )}
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void generateReport()}
                disabled={loading || loadingCompanies}
                className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
              >
                <RefreshCw className={cn('mr-2 h-4 w-4', loading ? 'animate-spin' : '')} />
                {loading ? 'Refreshing...' : 'Refresh'}
              </Button>
              {renderExportMenu()}
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="rounded-[1.8rem] border border-slate-200/80 bg-white/90 p-5 shadow-[0_32px_70px_-46px_rgba(15,23,42,0.35)] backdrop-blur-xl md:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Smart Filters</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-950">Fast report controls</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                Active view: {operationsViewOptions.find((item) => item.value === activeView)?.label}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                Range: {formatDateLabel(dateFrom)} to {formatDateLabel(dateTo)}
              </span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <Label>Companies</Label>
              <details ref={companyFilterRef} className="group relative">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm marker:hidden [&::-webkit-details-marker]:hidden">
                  <span className="truncate">{selectedCompanySummary}</span>
                  <span className="ml-3 shrink-0 text-xs text-slate-400">{selectedCompanyIds.length} selected</span>
                </summary>
                <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)] sm:right-auto sm:w-[360px]">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <p className="text-sm font-semibold text-slate-950">Choose companies</p>
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
                        disabled={!canAggregateCompanies}
                        onClick={() => {
                          setSelectedCompanyIds(companies.map((company) => company.id))
                          closeCompanyFilter()
                        }}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
                        onClick={() => {
                          setSelectedCompanyIds(companies[0]?.id ? [companies[0].id] : [])
                          closeCompanyFilter()
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  {!canAggregateCompanies ? (
                    <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      Multi-company reports are disabled for this user. Use All Companies report access to enable aggregation.
                    </p>
                  ) : null}
                  <div className="mt-3 max-h-56 space-y-2 overflow-auto pr-1">
                    {companies.length === 0 ? (
                      <p className="text-sm text-slate-500">No company found.</p>
                    ) : (
                      companies.map((company) => {
                        const checked = selectedCompanyIds.includes(company.id)
                        return (
                          <label
                            key={company.id}
                            className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-3 py-2 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded border-slate-300"
                              checked={checked}
                              disabled={!canAggregateCompanies && !checked && selectedCompanyIds.length >= 1}
                              onChange={() => toggleCompanySelection(company.id)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-slate-900">{company.name}</span>
                            </span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>
              </details>
            </div>

            <div className="space-y-2">
              <Label htmlFor="operationsDateFrom">Date From</Label>
              <Input
                id="operationsDateFrom"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="min-h-11 rounded-2xl border-slate-200 bg-white shadow-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="operationsDateTo">Date To</Label>
              <Input
                id="operationsDateTo"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="min-h-11 rounded-2xl border-slate-200 bg-white shadow-sm"
              />
            </div>

            {activeView === 'ledger' ? (
              <div className="space-y-2">
                <Label>Party</Label>
                <Select value={selectedPartyId || 'none'} onValueChange={handleLedgerPartyChange}>
                  <SelectTrigger className="min-h-11 rounded-2xl border-slate-200 bg-white shadow-sm">
                    <SelectValue placeholder="Select party" />
                  </SelectTrigger>
                  <SelectContent>
                    {parties.length === 0 ? <SelectItem value="none">No party found</SelectItem> : null}
                    {parties.map((party) => (
                      <SelectItem key={party.id} value={party.id}>
                        {party.name}
                        {showCompanyColumn ? ` - ${party.companyName}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {activeView === 'outstanding' ? (
              <>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={outstandingSort} onValueChange={(value) => setOutstandingSort(value as OutstandingSort)}>
                    <SelectTrigger className="min-h-11 rounded-2xl border-slate-200 bg-white shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="highest">Highest to Lowest</SelectItem>
                      <SelectItem value="lowest">Lowest to Highest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Bucket</Label>
                  <Select
                    value={outstandingBucketFilter}
                    onValueChange={(value) => setOutstandingBucketFilter(value as 'all' | OutstandingAgeBucket)}
                  >
                    <SelectTrigger className="min-h-11 rounded-2xl border-slate-200 bg-white shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Buckets</SelectItem>
                      {OUTSTANDING_BUCKET_OPTIONS.map((bucket) => (
                        <SelectItem key={bucket} value={bucket}>
                          {bucket}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : null}

            {activeView === 'bank-ledger' ? (
              <>
                <div className="space-y-2">
                  <Label>Bank</Label>
                  <Select value={bankFilter} onValueChange={setBankFilter}>
                    <SelectTrigger className="min-h-11 rounded-2xl border-slate-200 bg-white shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Banks</SelectItem>
                      {bankOptions.map((bankName) => (
                        <SelectItem key={bankName} value={bankName}>
                          {bankName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={bankDirectionFilter} onValueChange={(value) => setBankDirectionFilter(value as LedgerDirectionFilter)}>
                    <SelectTrigger className="min-h-11 rounded-2xl border-slate-200 bg-white shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="in">In</SelectItem>
                      <SelectItem value="out">Out</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : null}

            {activeView === 'cash-ledger' ? (
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={bankDirectionFilter} onValueChange={(value) => setBankDirectionFilter(value as LedgerDirectionFilter)}>
                  <SelectTrigger className="min-h-11 rounded-2xl border-slate-200 bg-white shadow-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="in">In</SelectItem>
                    <SelectItem value="out">Out</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="space-y-2">
              <Label htmlFor="operationsSearch">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  id="operationsSearch"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={getSearchPlaceholder(activeView)}
                  className="min-h-11 rounded-2xl border-slate-200 bg-white pl-9 shadow-sm"
                />
              </div>
            </div>

            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 rounded-2xl border-slate-200 bg-white hover:bg-slate-50"
                onClick={clearActiveFilters}
              >
                Clear Filters
              </Button>
            </div>

            <div className="flex items-end">
              <Button
                type="button"
                className="min-h-11 rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                onClick={() => void generateReport()}
                disabled={loading}
              >
                <CalendarRange className="mr-2 h-4 w-4" />
                Refresh View
              </Button>
            </div>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <div className="rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {(activeView === 'overview' ? overviewMetricCards : activeMetricCards).map((card) => {
          const tone = toneClasses(card.tone)
          return (
            <motion.div
              key={`${activeView}-${card.key}`}
              layout
              whileHover={{ y: -3, scale: 1.01 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className={cn(
                'overflow-hidden rounded-[1.7rem] bg-gradient-to-br p-[1px] shadow-[0_24px_60px_-38px_rgba(15,23,42,0.35)]',
                tone.card
              )}
            >
              <div className="h-full rounded-[calc(1.7rem-1px)] bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.04))] p-5 backdrop-blur-md">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">{card.label}</p>
                    <p className="mt-4 text-2xl font-semibold tracking-tight text-white">{card.value}</p>
                    <p className="mt-2 text-sm text-white/75">{card.hint}</p>
                  </div>
                  <div className="rounded-2xl bg-white/15 p-3 text-white shadow-inner shadow-white/10">
                    <card.icon className="h-5 w-5" />
                  </div>
                </div>
              </div>
            </motion.div>
          )
        })}
      </section>

      {(activeView === 'overview' || activeView === 'outstanding') && reportData?.summary ? (
        <section className={surfaceCardClass}>
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.35fr_0.65fr]">
            <div className="rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Collection runway</p>
                  <p className="mt-1 text-sm text-slate-500">How much of booked sales has been recovered in the selected period.</p>
                </div>
                <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-sky-700">
                  {recoveryProgress.toFixed(1)}%
                </Badge>
              </div>
              <div className="mt-4">
                <Progress value={recoveryProgress} className="h-2.5 rounded-full bg-slate-100" />
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Booked Sales</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{currencyText(reportData.summary.totalSaleAmount)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Receipts</p>
                  <p className="mt-2 text-xl font-semibold text-emerald-700">{currencyText(reportData.summary.totalReceivedAmount)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Net Outstanding</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{currencyText(reportData.summary.netOutstanding)}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-950 p-5 text-white">
              <p className="text-sm font-semibold">Quick stats</p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <span className="text-white/70">Receivables</span>
                  <span className="font-semibold">{currencyText(reportData.summary.salesBalanceTotal)}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <span className="text-white/70">Payables</span>
                  <span className="font-semibold">{currencyText(reportData.summary.purchaseBalanceTotal)}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <span className="text-white/70">Stock Adjustment</span>
                  <span className="font-semibold">{numberText(reportData.summary.totalStockAdjustmentQty)} Qt</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <span className="text-white/70">Today Activity</span>
                  <span className="font-semibold">{todayActivityGroup ? `${todayActivityGroup.rows.length} entries` : 'No entries'}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeView === 'overview' ? (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className={surfaceCardClass}>
            <CardHeader className="border-b border-slate-100 pb-5">
              <CardTitle className="text-2xl tracking-tight text-slate-950">Top receivable watchlist</CardTitle>
              <CardDescription>
                Highest pending parties from the current scope, ready for immediate drilldown into party ledger.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="overflow-hidden rounded-[1.4rem] border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {showCompanyColumn ? <TableHead>Company</TableHead> : null}
                      <TableHead>Party</TableHead>
                      <TableHead>Bucket</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topOutstandingRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={showCompanyColumn ? 5 : 4} className="py-10 text-center text-slate-500">
                          No receivable party found in the current range.
                        </TableCell>
                      </TableRow>
                    ) : (
                      topOutstandingRows.map((row, index) => (
                        <TableRow key={`${row.companyId}-${row.partyId}`} className={cn(index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60', 'hover:bg-sky-50')}>
                          {showCompanyColumn ? <TableCell>{row.companyName}</TableCell> : null}
                          <TableCell>
                            <button
                              type="button"
                              className="text-left"
                              onClick={() => openOutstandingPartyLedger(row)}
                            >
                              <span className="font-medium text-slate-950">{row.partyName}</span>
                              <span className="mt-1 block text-xs text-slate-500">{row.phone1 || row.address || '-'}</span>
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
                              {row.ageBucket}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{row.invoiceCount}</TableCell>
                          <TableCell className="text-right font-semibold text-rose-700">{currencyText(row.balanceAmount)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className={surfaceCardClass}>
            <CardHeader className="border-b border-slate-100 pb-5">
              <CardTitle className="text-2xl tracking-tight text-slate-950">Today&apos;s flow</CardTitle>
              <CardDescription>
                Quick operating pulse for the current day inside the selected reporting scope.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              {todayActivityGroup ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Sales', value: todayActivityGroup.salesCount, tone: 'emerald' },
                      { label: 'Purchases', value: todayActivityGroup.purchaseCount, tone: 'rose' },
                      { label: 'Payments', value: todayActivityGroup.paymentCount, tone: 'sky' },
                      { label: 'Adjustments', value: todayActivityGroup.adjustmentCount, tone: 'amber' }
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                        <p className={cn('mt-2 text-xl font-semibold', toneClasses(item.tone as MetricTone).accent)}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
                    <p className="text-sm font-semibold text-slate-950">Amount tracked today</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">{currencyText(todayActivityGroup.totalAmount)}</p>
                    <p className="mt-1 text-sm text-slate-500">{numberText(todayActivityGroup.totalQuantity)} total quantity across tracked transactions.</p>
                  </div>
                </>
              ) : (
                <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No activity captured for today under the current filters.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeView === 'outstanding' ? (
        <Card className={surfaceCardClass}>
          <CardHeader className="border-b border-slate-100 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] pb-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <CardTitle className="text-2xl tracking-tight text-slate-950">Outstanding Report</CardTitle>
                <CardDescription className="mt-2">
                  Party-wise outstanding with clickable ledger drilldown, overdue day aging, and bucket visibility for collection follow-up.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="overflow-hidden rounded-[1.4rem] border border-slate-200">
              <div className="max-h-[640px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {showCompanyColumn ? <TableHead className="sticky top-0 z-10 bg-slate-50">Company</TableHead> : null}
                    <TableHead className="sticky top-0 z-10 bg-slate-50">Party</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50">Mobile</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50">Address</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50">Oldest Due</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50">Last Bill</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Overdue Days</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50">Bucket</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50">Status</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Sale Amount</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Received Amount</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Balance Amount</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Invoices</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOutstanding.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={showCompanyColumn ? 13 : 12} className="py-8 text-center text-slate-500">
                        No outstanding rows found for this filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {filteredOutstanding.map((row, index) => (
                        <TableRow key={`${row.companyId}-${row.partyId}`} className={cn(index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60', 'hover:bg-sky-50')}>
                          {showCompanyColumn ? <TableCell>{row.companyName}</TableCell> : null}
                          <TableCell className="font-medium text-slate-900">
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto p-0 text-left font-medium text-sky-700 underline-offset-4 hover:text-sky-900"
                              onClick={() => openOutstandingPartyLedger(row)}
                            >
                              {row.partyName}
                            </Button>
                          </TableCell>
                          <TableCell>{row.phone1 || '-'}</TableCell>
                          <TableCell>{row.address || '-'}</TableCell>
                          <TableCell>{formatDateLabel(row.oldestBillDate)}</TableCell>
                          <TableCell>{formatDateLabel(row.lastBillDate)}</TableCell>
                          <TableCell className="text-right">{row.daysOverdue}</TableCell>
                          <TableCell>{row.ageBucket}</TableCell>
                          <TableCell className="capitalize">{row.status}</TableCell>
                          <TableCell className="text-right">{currencyText(row.saleAmount)}</TableCell>
                          <TableCell className="text-right text-emerald-700">{currencyText(row.receivedAmount)}</TableCell>
                          <TableCell className="text-right font-semibold text-amber-700">{currencyText(row.balanceAmount)}</TableCell>
                          <TableCell className="text-right">{row.invoiceCount}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 border-slate-200 bg-slate-50/80">
                        <TableCell colSpan={showCompanyColumn ? 9 : 8} className="text-right font-semibold text-slate-900">
                          Total
                        </TableCell>
                        <TableCell className="text-right font-semibold text-slate-900">{currencyText(outstandingTotals.saleAmount)}</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-700">{currencyText(outstandingTotals.receivedAmount)}</TableCell>
                        <TableCell className="text-right font-semibold text-amber-700">{currencyText(outstandingTotals.balanceAmount)}</TableCell>
                        <TableCell className="text-right font-semibold text-slate-900">{outstandingTotals.invoiceCount}</TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeView === 'ledger' ? (
        <StatementReportCard
          title="Party Ledger"
          description={
            reportData?.partyLedger?.selectedPartyName
              ? `${reportData.partyLedger.selectedPartyName}${reportData.partyLedger.selectedPartyCompanyName ? ` (${reportData.partyLedger.selectedPartyCompanyName})` : ''} with running balance across invoices and receipts.`
              : 'Select a party to load a premium ledger view with balances, movement, and drilldown details.'
          }
          subjectLabel="Party"
          subjectValue={selectedLedgerParty?.name || reportData?.partyLedger?.selectedPartyName || '-'}
          subjectMeta={selectedLedgerParty?.phone1 || selectedLedgerParty?.address || reportData?.partyLedger?.selectedPartyCompanyName || undefined}
          rows={statementRows.ledger}
          openingLabel="Opening"
          openingValue={formatLedgerBalance(reportData?.partyLedger?.openingBalance || 0)}
          closingLabel="Closing"
          closingValue={formatLedgerBalance(reportData?.partyLedger?.closingBalance || 0)}
          debitLabel="Debit"
          debitValue={currencyText(reportData?.partyLedger?.totalSales || 0)}
          creditLabel="Credit"
          creditValue={currencyText(reportData?.partyLedger?.totalReceipts || 0)}
          countLabel="Count"
          countValue={String(filteredLedgerRows.length)}
          emptyMessage="No ledger entries found for this party and date range."
          expandedRows={expandedStatementRows}
          onToggleRow={toggleStatementRow}
          exportActions={renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
          headerBadges={
            <>
              <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                Statement view
              </Badge>
              <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                Range: {formatDateLabel(dateFrom)} to {formatDateLabel(dateTo)}
              </Badge>
            </>
          }
        />
      ) : null}

      {activeView === 'daily' ? (
        <>
          <Card className={`${surfaceCardClass} overflow-hidden`}>
            <CardHeader className="border-b border-slate-100 bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_55%,#eef6ff_100%)] pb-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                      Daily pulse
                    </Badge>
                    <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                      {formatDateLabel(dateFrom)} to {formatDateLabel(dateTo)}
                    </Badge>
                  </div>
                  <CardTitle className="mt-4 text-2xl tracking-tight text-slate-950">Daily Operations Dashboard</CardTitle>
                  <CardDescription className="mt-2">
                    One compact place for date-wise totals, transaction feed, and grouped daily activity without opening multiple screens.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 p-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {activeMetricCards.map((card) => {
                  const tone = toneClasses(card.tone)
                  return (
                    <motion.div
                      key={card.key}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn('rounded-[1.35rem] border px-4 py-4 shadow-sm transition-transform hover:-translate-y-0.5', tone.card)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{card.label}</p>
                          <p className="mt-3 text-2xl font-semibold text-slate-950">{card.value}</p>
                          <p className="mt-1 text-sm text-slate-500">{card.hint}</p>
                        </div>
                        <div className={cn('rounded-2xl border p-3', tone.soft)}>
                          <card.icon className="h-5 w-5" />
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
                <div className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <p className="text-base font-semibold text-slate-950">Date-wise summary</p>
                    <p className="mt-1 text-sm text-slate-500">Daily totals for sales, purchase, cashflow, and transaction activity.</p>
                  </div>
                  <div className="max-h-[430px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky top-0 z-10 bg-white">Date</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Sales</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Purchase</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Receipt</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Payment</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Net</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Count</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredDailyTransactionSummary.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                              No daily summary rows found.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredDailyTransactionSummary.map((row, index) => (
                            <TableRow key={row.date} className={cn(index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60', 'hover:bg-sky-50')}>
                              <TableCell className="font-medium text-slate-900">{formatDateLabel(row.date)}</TableCell>
                              <TableCell className="text-right text-emerald-700">{currencyText(row.totalSales)}</TableCell>
                              <TableCell className="text-right text-rose-700">{currencyText(row.totalPurchase)}</TableCell>
                              <TableCell className="text-right text-emerald-700">{currencyText(row.totalSalesReceipt)}</TableCell>
                              <TableCell className="text-right text-rose-700">{currencyText(row.totalPurchasePayment)}</TableCell>
                              <TableCell className={cn('text-right font-semibold', row.netCashflow >= 0 ? 'text-sky-700' : 'text-rose-700')}>
                                {formatFlowSummaryText(row.netCashflow)}
                              </TableCell>
                              <TableCell className="text-right">{row.transactionCount}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <p className="text-base font-semibold text-slate-950">Consolidated timeline</p>
                    <p className="mt-1 text-sm text-slate-500">A cleaner business summary for each day with totals and company spread.</p>
                  </div>
                  <div className="max-h-[430px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky top-0 z-10 bg-white">Date</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Sales</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Purchase</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Adj. Qty</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Net</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Txn</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Co.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredDailyConsolidated.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                              No consolidated daily rows found.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredDailyConsolidated.map((row, index) => (
                            <TableRow key={row.date} className={cn(index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60', 'hover:bg-sky-50')}>
                              <TableCell className="font-medium text-slate-900">{formatDateLabel(row.date)}</TableCell>
                              <TableCell className="text-right text-emerald-700">{currencyText(row.totalSales)}</TableCell>
                              <TableCell className="text-right text-rose-700">{currencyText(row.totalPurchase)}</TableCell>
                              <TableCell className="text-right">{numberText(row.totalStockAdjustmentQty)}</TableCell>
                              <TableCell className={cn('text-right font-semibold', row.netCashflow >= 0 ? 'text-sky-700' : 'text-rose-700')}>
                                {formatFlowSummaryText(row.netCashflow)}
                              </TableCell>
                              <TableCell className="text-right">{row.transactionCount}</TableCell>
                              <TableCell className="text-right">{row.companyCount}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1fr_1.35fr]">
                <div className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <p className="text-base font-semibold text-slate-950">Today&apos;s pulse</p>
                    <p className="mt-1 text-sm text-slate-500">Current-day activity spotlight within the active date range and filters.</p>
                  </div>
                  <div className="p-5">
                    {todayActivityGroup ? (
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          {[
                            { label: 'Sales', value: String(todayActivityGroup.salesCount), tone: 'text-emerald-700' },
                            { label: 'Purchases', value: String(todayActivityGroup.purchaseCount), tone: 'text-rose-700' },
                            { label: 'Payments', value: String(todayActivityGroup.paymentCount), tone: 'text-sky-700' },
                            { label: 'Adjustments', value: String(todayActivityGroup.adjustmentCount), tone: 'text-amber-700' }
                          ].map((card) => (
                            <div key={card.label} className="rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-4">
                              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{card.label}</p>
                              <p className={cn('mt-2 text-2xl font-semibold', card.tone)}>{card.value}</p>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-4">
                          <p className="text-sm font-semibold text-slate-950">Amount tracked</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-950">{currencyText(todayActivityGroup.totalAmount)}</p>
                          <p className="mt-1 text-sm text-slate-500">{numberText(todayActivityGroup.totalQuantity)} total quantity moved today.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        No activity captured for today within the current filters.
                      </div>
                    )}
                  </div>
                </div>

                <div className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <p className="text-base font-semibold text-slate-950">Daily activity feed</p>
                    <p className="mt-1 text-sm text-slate-500">Compact transaction feed with structured movement, mode, bank, and notes.</p>
                  </div>
                  <div className="max-h-[520px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {showCompanyColumn ? <TableHead className="sticky top-0 z-10 bg-white">Company</TableHead> : null}
                          <TableHead className="sticky top-0 z-10 bg-white">Date</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white">Activity</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white">Reference</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white">Flow</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Qty</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white text-right">Amount</TableHead>
                          <TableHead className="sticky top-0 z-10 bg-white">Detail</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredDailyTransactions.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={showCompanyColumn ? 8 : 7} className="py-10 text-center text-slate-500">
                              No daily transactions found.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredDailyTransactions.map((row, index) => {
                            const txnTone =
                              row.direction === 'IN'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : row.direction === 'OUT'
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : 'border-sky-200 bg-sky-50 text-sky-700'
                            const TxnIcon =
                              row.direction === 'IN'
                                ? ArrowDownLeft
                                : row.direction === 'OUT'
                                  ? ArrowUpRight
                                  : ArrowRightLeft
                            return (
                              <TableRow key={row.id} className={cn(index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60', 'hover:bg-sky-50')}>
                                {showCompanyColumn ? <TableCell>{row.companyName}</TableCell> : null}
                                <TableCell>{formatDateLabel(row.date)}</TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className={cn('rounded-2xl border p-2', txnTone)}>
                                      <TxnIcon className="h-4 w-4" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-slate-950">{row.type}</p>
                                      <p className="text-xs text-slate-500">{row.category}</p>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>{row.refNo || '-'}</TableCell>
                                <TableCell>
                                  <div className="space-y-1">
                                    <p className="font-medium text-slate-900">{row.partyName || row.bankName || '-'}</p>
                                    <p className="text-xs text-slate-500">{[row.paymentMode, row.bankName].filter(Boolean).join(' • ') || row.direction}</p>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">{numberText(row.quantity)}</TableCell>
                                <TableCell className="text-right font-medium">{currencyText(row.amount)}</TableCell>
                                <TableCell className="max-w-[240px]">
                                  <p className="truncate text-sm text-slate-700">{row.productName || row.note || '-'}</p>
                                </TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>

              <Card className="overflow-hidden rounded-[1.4rem] border border-slate-200 shadow-none">
                <CardHeader className="border-b border-slate-100 bg-white pb-4">
                  <CardTitle className="text-xl tracking-tight text-slate-950">Grouped daily work detail</CardTitle>
                  <CardDescription>
                    Drill into each date without losing context. Expand a day to inspect the exact transactions behind the totals.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  {consolidatedActivityGroups.length === 0 ? (
                    <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      No daily work details found for this range.
                    </div>
                  ) : (
                    consolidatedActivityGroups.map((group, index) => (
                      <details key={group.date} open={index === 0} className="overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white">
                        <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-base font-semibold text-slate-950">{formatDateLabel(group.date)}</p>
                            <p className="mt-1 text-sm text-slate-500">
                              {group.rows.length} entries | Sales: {group.salesCount} | Purchase: {group.purchaseCount} | Payments: {group.paymentCount} | Adjustments: {group.adjustmentCount}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                            <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                              Amount: {currencyText(group.totalAmount)}
                            </Badge>
                            <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                              Qty: {numberText(group.totalQuantity)}
                            </Badge>
                          </div>
                        </summary>
                        <div className="border-t border-slate-100 px-4 py-4">
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Type</TableHead>
                                  <TableHead>Reference</TableHead>
                                  <TableHead>Party</TableHead>
                                  <TableHead>Product</TableHead>
                                  <TableHead className="text-right">Qty</TableHead>
                                  <TableHead className="text-right">Amount</TableHead>
                                  <TableHead>Direction</TableHead>
                                  <TableHead>Mode</TableHead>
                                  <TableHead>Bank</TableHead>
                                  <TableHead>Note</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {group.rows.map((row) => (
                                  <TableRow key={row.id}>
                                    <TableCell className="font-medium text-slate-900">{row.type}</TableCell>
                                    <TableCell>{row.refNo || '-'}</TableCell>
                                    <TableCell>{row.partyName || '-'}</TableCell>
                                    <TableCell>{row.productName || '-'}</TableCell>
                                    <TableCell className="text-right">{numberText(row.quantity)}</TableCell>
                                    <TableCell className="text-right">{currencyText(row.amount)}</TableCell>
                                    <TableCell>{row.direction}</TableCell>
                                    <TableCell>{row.paymentMode || '-'}</TableCell>
                                    <TableCell>{row.bankName || '-'}</TableCell>
                                    <TableCell>{row.note || '-'}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </details>
                    ))
                  )}
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </>
      ) : null}

      {activeView === 'cash-ledger' ? (
        <StatementReportCard
          title="Cash Ledger"
          description="Compact cash book with inflow, outflow, counter-account movement, and expandable details for fast daily verification."
          subjectLabel="Ledger"
          subjectValue="Cash Book"
          subjectMeta={bankDirectionFilter === 'all' ? 'All directions' : `Direction: ${bankDirectionFilter.toUpperCase()}`}
          rows={statementRows['cash-ledger']}
          openingLabel="Opening"
          openingValue={formatLedgerBalance(cashLedgerOpeningBalance)}
          closingLabel="Closing"
          closingValue={formatLedgerBalance(cashLedgerClosingBalance)}
          debitLabel="Debit"
          debitValue={currencyText(cashLedgerTotalDebit)}
          creditLabel="Credit"
          creditValue={currencyText(cashLedgerTotalCredit)}
          countLabel="Count"
          countValue={String(cashLedgerDisplayRows.length)}
          emptyMessage="No cash ledger rows found for this range."
          expandedRows={expandedStatementRows}
          onToggleRow={toggleStatementRow}
          exportActions={renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
          headerBadges={
            <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
              Range: {formatDateLabel(dateFrom)} to {formatDateLabel(dateTo)}
            </Badge>
          }
        />
      ) : null}

      {activeView === 'bank-ledger' ? (
        <StatementReportCard
          title="Bank Ledger"
          description="Premium bank movement view with clean debit/credit flow, bank-specific context, and reconciliation-ready detail."
          subjectLabel="Bank"
          subjectValue={selectedBankLabel}
          subjectMeta={bankDirectionFilter === 'all' ? 'All directions' : `Direction: ${bankDirectionFilter.toUpperCase()}`}
          rows={statementRows['bank-ledger']}
          openingLabel="Opening"
          openingValue={formatLedgerBalance(bankLedgerOpeningBalance)}
          closingLabel="Closing"
          closingValue={formatLedgerBalance(bankLedgerClosingBalance)}
          debitLabel="Debit"
          debitValue={currencyText(bankLedgerTotalDebit)}
          creditLabel="Credit"
          creditValue={currencyText(bankLedgerTotalCredit)}
          countLabel="Count"
          countValue={String(filteredBankLedger.length)}
          emptyMessage="No bank ledger rows found for this range."
          expandedRows={expandedStatementRows}
          onToggleRow={toggleStatementRow}
          exportActions={renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
          headerBadges={
            <>
              <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                Range: {formatDateLabel(dateFrom)} to {formatDateLabel(dateTo)}
              </Badge>
              {bankSyncProviders.map((provider) => (
                <Badge
                  key={provider.provider}
                  variant="outline"
                  className={cn(
                    'rounded-full',
                    provider.ready
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  )}
                  title={provider.message}
                >
                  {provider.label}: {provider.ready ? 'Ready' : 'Future-ready'}
                </Badge>
              ))}
            </>
          }
        />
      ) : null}
    </div>
  )
}

function StatementReportCard({
  title,
  description,
  subjectLabel,
  subjectValue,
  subjectMeta,
  rows,
  openingLabel,
  openingValue,
  closingLabel,
  closingValue,
  debitLabel,
  debitValue,
  creditLabel,
  creditValue,
  countLabel,
  countValue,
  emptyMessage,
  expandedRows,
  onToggleRow,
  exportActions,
  headerBadges,
}: {
  title: string
  description: string
  subjectLabel: string
  subjectValue: string
  subjectMeta?: string
  rows: StatementDisplayRow[]
  openingLabel: string
  openingValue: string
  closingLabel: string
  closingValue: string
  debitLabel: string
  debitValue: string
  creditLabel: string
  creditValue: string
  countLabel: string
  countValue: string
  emptyMessage: string
  expandedRows: Record<string, boolean>
  onToggleRow: (key: string) => void
  exportActions?: ReactNode
  headerBadges?: ReactNode
}) {
  return (
    <Card className={surfaceCardClass}>
      <CardHeader className="border-b border-slate-100 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] pb-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <CardTitle className="text-2xl tracking-tight text-slate-950">{title}</CardTitle>
            <CardDescription className="mt-2">{description}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
              {subjectLabel}: {subjectValue}
            </Badge>
            {subjectMeta ? (
              <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                {subjectMeta}
              </Badge>
            ) : null}
            {headerBadges}
          </div>
          {exportActions ? (
            <div className="flex flex-wrap gap-2">
              {exportActions}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        <div className="grid gap-4 md:grid-cols-5">
          {[
            { label: openingLabel, value: openingValue },
            { label: debitLabel, value: debitValue },
            { label: creditLabel, value: creditValue },
            { label: closingLabel, value: closingValue },
            { label: countLabel, value: countValue },
          ].map((item) => (
            <div key={item.label} className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-[1.4rem] border border-slate-200">
          <div className="max-h-[720px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-950">Txn</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-950">Date</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-950">Reference</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-950">Narration</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-right font-semibold text-slate-950">Debit</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-right font-semibold text-slate-950">Credit</th>
                  <th className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-right font-semibold text-slate-950">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      {emptyMessage}
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => {
                    const expanded = Boolean(expandedRows[row.id])
                    const tone = toneClasses(row.badgeTone)
                    return (
                      <Fragment key={row.id}>
                        <tr
                          className={cn(index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60', 'cursor-pointer border-b border-slate-200 transition-colors hover:bg-sky-50')}
                          onClick={() => onToggleRow(row.id)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className={cn('rounded-2xl border p-2', tone.soft)}>
                                <row.icon className="h-4 w-4" />
                              </div>
                              <div>
                                <Badge variant="outline" className={cn('rounded-full text-[11px]', tone.soft)}>
                                  {row.badge}
                                </Badge>
                                <div className="mt-1 text-xs text-slate-500">{row.flow || '-'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{row.date}</td>
                          <td className="px-4 py-3 text-slate-700">{row.reference}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-950">{row.title}</p>
                            <p className="mt-1 text-xs text-slate-500">{row.subtitle}</p>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-rose-700">{row.debit > 0 ? currencyText(row.debit) : '-'}</td>
                          <td className="px-4 py-3 text-right font-medium text-emerald-700">{row.credit > 0 ? currencyText(row.credit) : '-'}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-950">{row.balance}</td>
                        </tr>
                        {expanded ? (
                          <tr className="border-b border-slate-200 bg-slate-950/[0.03]">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid gap-3 md:grid-cols-3">
                                {row.details.map((detail) => (
                                  <div key={`${row.id}:${detail.label}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{detail.label}</p>
                                    <p className="mt-1 text-sm text-slate-700">{detail.value}</p>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
