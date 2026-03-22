'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, FileText, RefreshCw, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { printHtmlDocument } from '@/lib/report-print'

type ReportView = 'outstanding' | 'ledger' | 'daily-transaction' | 'daily-consolidated' | 'bank-ledger'
type OutstandingSort = 'highest' | 'lowest'
type ReportScope = 'company' | 'individual-trader'
type BankDirectionFilter = 'all' | 'in' | 'out'

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
  lastBillDate: string
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
  direction: 'IN' | 'OUT'
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
}

const surfaceCardClass = 'rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]'
const operationsViewOptions: Array<{ value: ReportView; label: string }> = [
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'ledger', label: 'Party Ledger' },
  { value: 'daily-transaction', label: 'Daily Transaction' },
  { value: 'daily-consolidated', label: 'Daily Consolidated' },
  { value: 'bank-ledger', label: 'Bank Ledger' }
]

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

function formatFlowSummaryText(value: number, positiveLabel = 'Inflow', negativeLabel = 'Outflow'): string {
  const normalized = Number(value || 0)
  if (Math.abs(normalized) < 0.005) {
    return `Balanced ${currencyText(0)}`
  }
  return `${normalized >= 0 ? positiveLabel : negativeLabel} ${absoluteCurrencyText(normalized)}`
}

function formatLedgerBalanceSummary(value: number): string {
  const normalized = Number(value || 0)
  if (Math.abs(normalized) < 0.005) {
    return `Balanced ${currencyText(0)}`
  }
  return `${normalized >= 0 ? 'Debit' : 'Credit'} ${absoluteCurrencyText(normalized)}`
}

function formatOutstandingDeltaText(value: number): string {
  const normalized = Number(value || 0)
  if (Math.abs(normalized) < 0.005) {
    return `Balanced ${currencyText(0)}`
  }
  return `${normalized >= 0 ? 'Receivable' : 'Payable'} ${absoluteCurrencyText(normalized)}`
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

function printTable(title: string, subtitle: string, headers: string[], rows: string[][]) {
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => `<td style="${index >= Math.max(0, row.length - 3) ? 'text-align:right;' : ''}">${escapeHtml(cell)}</td>`)
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
        <td class="label">Opening Bal</td>
        <td class="value">${escapeHtml(options.openingBalance)}</td>
      </tr>
      <tr>
        <td class="label">${escapeHtml(options.extraLabel || '')}</td>
        <td>${escapeHtml(options.extraValue || '')}</td>
        <td></td>
        <td></td>
        <td class="label">Closing Bal</td>
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
  if (row.type === 'opening') return 'Opening Balance'
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
  if (activeView === 'outstanding') return 'Search party, mobile, address, company, last bill date...'
  if (activeView === 'ledger') return 'Search date, reference, mode, notes...'
  if (activeView === 'daily-transaction') return 'Search type, party, product, company, bank, note...'
  if (activeView === 'daily-consolidated') return 'Search date, reference, party, product, mode, note...'
  return 'Search bank, party, bill, IFSC, account, reference...'
}

export default function OperationsReportWorkspace({
  initialCompanyId,
  initialView = 'outstanding',
  embedded = false,
  onBackToDashboard
}: OperationsReportWorkspaceProps) {
  const today = useMemo(() => new Date(), [])
  const firstDay = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today])

  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [scope] = useState<ReportScope>('company')
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>(initialCompanyId ? [initialCompanyId] : [])
  const [dateFrom, setDateFrom] = useState(toDateInputValue(firstDay))
  const [dateTo, setDateTo] = useState(toDateInputValue(today))
  const [selectedPartyId, setSelectedPartyId] = useState('')
  const [activeView, setActiveView] = useState<ReportView>(initialView)
  const [outstandingSort, setOutstandingSort] = useState<OutstandingSort>('highest')
  const [bankFilter, setBankFilter] = useState('all')
  const [bankDirectionFilter, setBankDirectionFilter] = useState<BankDirectionFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [loadingCompanies, setLoadingCompanies] = useState(true)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [lastGeneratedAt, setLastGeneratedAt] = useState('')
  const [reportData, setReportData] = useState<OperationsReportPayload | null>(null)
  const selectedCompanyId = selectedCompanyIds[0] || ''

  useEffect(() => {
    setActiveView(initialView)
  }, [initialView])

  const loadCompanies = useCallback(async () => {
    setLoadingCompanies(true)
    try {
      const response = await fetch('/api/companies', { cache: 'no-store' })
      if (!response.ok) {
        throw new Error('Unable to load companies')
      }

      const payload = await response.json().catch(() => [])
      const rows = Array.isArray(payload) ? payload : []
      const normalized = rows
        .map((row) => ({
          id: String(row?.id || ''),
          name: String(row?.name || '')
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
      setCompanies([])
    } finally {
      setLoadingCompanies(false)
    }
  }, [initialCompanyId])

  useEffect(() => {
    void loadCompanies()
  }, [loadCompanies])

  useEffect(() => {
    if (scope === 'company' && selectedCompanyIds.length === 0 && companies.length > 0) {
      setSelectedCompanyIds([companies[0].id])
    }
  }, [companies, scope, selectedCompanyIds.length])

  const generateReport = useCallback(async () => {
    if (scope === 'company' && selectedCompanyIds.length === 0) {
      setErrorMessage('Select at least one company to generate the report.')
      return
    }
    if (!dateFrom || !dateTo) {
      setErrorMessage('Select date range first.')
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams({
        dateFrom,
        dateTo
      })

      if (scope === 'company' && selectedCompanyIds.length === 1) {
        params.set('companyId', selectedCompanyIds[0])
      }

      if (scope === 'company' && selectedCompanyIds.length > 1) {
        params.set('companyIds', selectedCompanyIds.join(','))
      }

      if (selectedPartyId) {
        params.set('partyId', selectedPartyId)
      }

      const response = await fetch(`/api/reports/operations?${params.toString()}`, { cache: 'no-store' })
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}))
        throw new Error(String(errorPayload?.error || 'Failed to generate operations report'))
      }

      const payload = (await response.json()) as OperationsReportPayload
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
  }, [dateFrom, dateTo, scope, selectedCompanyIds, selectedPartyId])

  useEffect(() => {
    if (loadingCompanies) return
    if (scope === 'company' && selectedCompanyIds.length === 0) return
    void generateReport()
  }, [generateReport, loadingCompanies, scope, selectedCompanyIds.length, dateFrom, dateTo])

  const summary = reportData?.summary || {
    totalSaleAmount: 0,
    totalPurchaseAmount: 0,
    totalPaidAmount: 0,
    totalReceivedAmount: 0,
    totalBalance: 0,
    netOutstanding: 0,
    salesBalanceTotal: 0,
    purchaseBalanceTotal: 0,
    totalStockAdjustmentQty: 0
  }

  const showCompanyColumn = (reportData?.meta?.companyIds?.length || selectedCompanyIds.length) > 1
  const parties = useMemo(() => reportData?.parties || [], [reportData?.parties])
  const bankOptions = reportData?.filterOptions?.banks || []

  const filteredOutstanding = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const rows = (reportData?.outstanding || []).filter((row) => {
      if (!query) return true
      return (
        row.partyName.toLowerCase().includes(query) ||
        row.phone1.toLowerCase().includes(query) ||
        row.address.toLowerCase().includes(query) ||
        row.companyName.toLowerCase().includes(query) ||
        row.lastBillDate.toLowerCase().includes(query)
      )
    })

    return rows.sort((a, b) => {
      if (outstandingSort === 'lowest') {
        return a.balanceAmount - b.balanceAmount || a.partyName.localeCompare(b.partyName)
      }
      return b.balanceAmount - a.balanceAmount || a.partyName.localeCompare(b.partyName)
    })
  }, [outstandingSort, reportData?.outstanding, searchTerm])

  const filteredLedgerRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
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
  }, [reportData?.partyLedger?.rows, searchTerm])

  const filteredDailyTransactions = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
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
  }, [reportData?.dailyTransactions, searchTerm])

  const filteredDailyTransactionSummary = useMemo(
    () => buildDateSummaryFromTransactions(filteredDailyTransactions),
    [filteredDailyTransactions]
  )

  const filteredDailyConsolidated = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const matchingDates = new Set(filteredDailyTransactions.map((row) => row.date))
    return (reportData?.dailyConsolidated || []).filter((row) => {
      if (!query) return true
      return row.date.toLowerCase().includes(query) || matchingDates.has(row.date)
    })
  }, [filteredDailyTransactions, reportData?.dailyConsolidated, searchTerm])

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

  const filteredBankLedger = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return (reportData?.bankLedger || []).filter((row) => {
      if (bankFilter !== 'all' && row.bankName !== bankFilter) return false
      if (bankDirectionFilter !== 'all' && row.direction.toLowerCase() !== bankDirectionFilter) return false
      if (!query) return true
      return (
        row.date.toLowerCase().includes(query) ||
        row.refNo.toLowerCase().includes(query) ||
        row.billNo.toLowerCase().includes(query) ||
        row.partyName.toLowerCase().includes(query) ||
        row.bankName.toLowerCase().includes(query) ||
        row.mode.toLowerCase().includes(query) ||
        row.txnRef.toLowerCase().includes(query) ||
        row.ifscCode.toLowerCase().includes(query) ||
        row.accountNo.toLowerCase().includes(query) ||
        row.companyName.toLowerCase().includes(query) ||
        row.direction.toLowerCase().includes(query)
      )
    })
  }, [bankDirectionFilter, bankFilter, reportData?.bankLedger, searchTerm])

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

  const bankLedgerStatementRows = useMemo(() => {
    const sortedRows = [...filteredBankLedger].sort(
      (a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime() ||
        a.refNo.localeCompare(b.refNo) ||
        a.id.localeCompare(b.id)
    )

    let runningBalance = 0

    return sortedRows.map((row) => {
      runningBalance += Number(row.amountIn || 0) - Number(row.amountOut || 0)
      return {
        type: row.direction === 'IN' ? 'Receipt' : 'Payment',
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
  }, [filteredBankLedger, showCompanyColumn])

  const bankLedgerOpeningBalance = 0
  const bankLedgerClosingBalance = useMemo(
    () => filteredBankLedger.reduce((sum, row) => sum + row.amountIn - row.amountOut, 0),
    [filteredBankLedger]
  )
  const bankLedgerTotalDebit = useMemo(
    () => filteredBankLedger.reduce((sum, row) => sum + row.amountOut, 0),
    [filteredBankLedger]
  )
  const bankLedgerTotalCredit = useMemo(
    () => filteredBankLedger.reduce((sum, row) => sum + row.amountIn, 0),
    [filteredBankLedger]
  )
  const selectedBankLabel = bankFilter === 'all' ? 'All Banks' : bankFilter
  const selectedCompanySummary = useMemo(() => {
    const targetIds = reportData?.meta?.companyIds?.length ? reportData.meta.companyIds : selectedCompanyIds
    const targetNames = targetIds
      .map((companyId) => companies.find((company) => company.id === companyId)?.name || companyId)
      .filter(Boolean)

    if (targetNames.length === 0) return 'No company selected'
    if (targetNames.length === 1) return targetNames[0]
    if (targetNames.length === 2) return targetNames.join(', ')
    return `${targetNames[0]}, ${targetNames[1]} +${targetNames.length - 2} more`
  }, [companies, reportData?.meta?.companyIds, selectedCompanyIds])

  const toggleCompanySelection = (companyId: string) => {
    setSelectedCompanyIds((previous) => {
      if (previous.includes(companyId)) {
        if (previous.length === 1) return previous
        return previous.filter((value) => value !== companyId)
      }
      return [...previous, companyId]
    })
  }

  const activeSummaryCards = useMemo(() => {
    if (activeView === 'outstanding') {
      const saleTotal = filteredOutstanding.reduce((sum, row) => sum + row.saleAmount, 0)
      const receivedTotal = filteredOutstanding.reduce((sum, row) => sum + row.receivedAmount, 0)
      const balanceTotal = filteredOutstanding.reduce((sum, row) => sum + row.balanceAmount, 0)
      return [
        { label: 'Outstanding Parties', value: String(filteredOutstanding.length), tone: 'text-slate-900' },
        { label: 'Sale Amount', value: currencyText(saleTotal), tone: 'text-slate-900' },
        { label: 'Received Amount', value: currencyText(receivedTotal), tone: 'text-emerald-700' },
        { label: 'Balance Amount', value: currencyText(balanceTotal), tone: 'text-amber-700' }
      ]
    }

    if (activeView === 'ledger') {
      return [
        { label: 'Opening Balance', value: formatLedgerBalanceSummary(reportData?.partyLedger?.openingBalance || 0), tone: 'text-slate-900' },
        { label: 'Sales Entries', value: currencyText(reportData?.partyLedger?.totalSales || 0), tone: 'text-slate-900' },
        { label: 'Receipt Entries', value: currencyText(reportData?.partyLedger?.totalReceipts || 0), tone: 'text-emerald-700' },
        { label: 'Closing Balance', value: formatLedgerBalanceSummary(reportData?.partyLedger?.closingBalance || 0), tone: 'text-amber-700' }
      ]
    }

    if (activeView === 'daily-transaction') {
      const purchaseTotal = filteredDailyTransactionSummary.reduce((sum, row) => sum + row.totalPurchase, 0)
      const salesTotal = filteredDailyTransactionSummary.reduce((sum, row) => sum + row.totalSales, 0)
      const paymentIn = filteredDailyTransactionSummary.reduce((sum, row) => sum + row.totalSalesReceipt, 0)
      const paymentOut = filteredDailyTransactionSummary.reduce((sum, row) => sum + row.totalPurchasePayment, 0)
      return [
        { label: 'Daily Activities', value: String(filteredDailyTransactions.length), tone: 'text-slate-900' },
        { label: 'Sales Value', value: currencyText(salesTotal), tone: 'text-emerald-700' },
        { label: 'Purchase Value', value: currencyText(purchaseTotal), tone: 'text-rose-700' },
        {
          label: 'Net Payment Flow',
          value: formatFlowSummaryText(paymentIn - paymentOut),
          tone: paymentIn - paymentOut >= 0 ? 'text-sky-700' : 'text-rose-700'
        }
      ]
    }

    if (activeView === 'daily-consolidated') {
      const totalSales = filteredDailyConsolidated.reduce((sum, row) => sum + row.totalSales, 0)
      const totalPurchase = filteredDailyConsolidated.reduce((sum, row) => sum + row.totalPurchase, 0)
      const totalNet = filteredDailyConsolidated.reduce((sum, row) => sum + row.netCashflow, 0)
      return [
        { label: 'Business Days', value: String(filteredDailyConsolidated.length), tone: 'text-slate-900' },
        { label: 'Total Sales', value: currencyText(totalSales), tone: 'text-emerald-700' },
        { label: 'Total Purchase', value: currencyText(totalPurchase), tone: 'text-rose-700' },
        { label: 'Net Cashflow', value: formatFlowSummaryText(totalNet), tone: totalNet >= 0 ? 'text-sky-700' : 'text-rose-700' }
      ]
    }

    const totalIn = filteredBankLedger.reduce((sum, row) => sum + row.amountIn, 0)
    const totalOut = filteredBankLedger.reduce((sum, row) => sum + row.amountOut, 0)
    return [
      { label: 'Bank Entries', value: String(filteredBankLedger.length), tone: 'text-slate-900' },
      { label: 'Payment In', value: currencyText(totalIn), tone: 'text-emerald-700' },
      { label: 'Payment Out', value: currencyText(totalOut), tone: 'text-rose-700' },
      { label: 'Net Bank Flow', value: formatFlowSummaryText(totalIn - totalOut), tone: totalIn - totalOut >= 0 ? 'text-sky-700' : 'text-rose-700' }
    ]
  }, [
    activeView,
    filteredBankLedger,
    filteredDailyConsolidated,
    filteredDailyTransactionSummary,
    filteredDailyTransactions,
    filteredOutstanding,
    reportData?.partyLedger?.closingBalance,
    reportData?.partyLedger?.openingBalance,
    reportData?.partyLedger?.totalReceipts,
    reportData?.partyLedger?.totalSales
  ])

  const activeViewMeta = useMemo(() => {
    if (activeView === 'outstanding') {
      return {
        label: 'Outstanding Board',
        description: 'Use this view to isolate receivable pressure, largest pending parties, and unpaid invoice clusters.',
        cues: ['Party-wise receivable scan', 'Status-first filtering', 'Collection follow-up friendly']
      }
    }

    if (activeView === 'ledger') {
      return {
        label: 'Ledger Statement',
        description: 'This view is shaped like an account statement: opening balance, sales, receipts, and a running balance trail.',
        cues: ['Statement-style running balance', 'Party-specific transaction history', 'Best for print or shareable exports']
      }
    }

    if (activeView === 'daily-transaction') {
      return {
        label: 'Daily Activity Feed',
        description: 'See the day exactly as it moved: sales, purchases, stock movement, receipts, and outgoing payments together.',
        cues: ['Chronological activity scan', 'Cross-module movement in one feed', 'Useful for operations review']
      }
    }

    if (activeView === 'daily-consolidated') {
      return {
        label: 'Consolidated Business Day',
        description: 'This is the daily management summary for business totals, payment flow, operational load, and the detailed work done each day.',
        cues: ['One row per business day', 'Cashflow-first summary', 'Daily work detail below']
      }
    }

    return {
      label: 'Bank Movement Ledger',
      description: 'Track bank and online movement separately from party ledgers, with inflow, outflow, bank, and txn reference fields.',
      cues: ['Bank-wise reconciliation', 'Inflow vs outflow tracking', 'Reference-led audit trail']
    }
  }, [activeView])

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
          'Last Bill Date',
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
          formatDateLabel(row.lastBillDate),
          row.status,
          numberText(row.saleAmount),
          numberText(row.receivedAmount),
          numberText(row.balanceAmount),
          String(row.invoiceCount)
        ])
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

    if (activeView === 'daily-transaction') {
      return {
        title: 'Daily Transaction Report',
        subtitle,
        fileName: `daily-transaction-${scopeLabel}-${dateFrom}-${dateTo}.csv`,
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

    if (activeView === 'daily-consolidated') {
      return {
        title: 'Daily Consolidated Report',
        subtitle,
        fileName: `daily-consolidated-${scopeLabel}-${dateFrom}-${dateTo}.csv`,
        headers: ['Date', 'Total Sales', 'Total Purchase', 'Stock Adjustment (Qt.)', 'Purchase Payment', 'Sales Receipt', 'Net Cashflow', 'Transactions', 'Companies'],
        rows: filteredDailyConsolidated.map((row) => [
          formatDateLabel(row.date),
          numberText(row.totalSales),
          numberText(row.totalPurchase),
          numberText(row.totalStockAdjustmentQty),
          numberText(row.totalPurchasePayment),
          numberText(row.totalSalesReceipt),
          formatFlowSummaryText(row.netCashflow),
          String(row.transactionCount),
          String(row.companyCount)
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

    if (activeView === 'ledger' || activeView === 'bank-ledger') {
      const isPartyLedger = activeView === 'ledger'
      const totalDebit = isPartyLedger ? reportData?.partyLedger?.totalSales || 0 : bankLedgerTotalDebit
      const totalCredit = isPartyLedger ? reportData?.partyLedger?.totalReceipts || 0 : bankLedgerTotalCredit
      const finalBalance = isPartyLedger ? reportData?.partyLedger?.closingBalance || 0 : bankLedgerClosingBalance

      const csvRows = [
        ['Company Name', selectedCompanySummary],
        ['Company Address', reportData?.meta?.companyAddress || '-'],
        ['Company Phone', reportData?.meta?.companyPhone || '-'],
        [isPartyLedger ? 'Party Name' : 'Bank Name', isPartyLedger ? selectedLedgerParty?.name || reportData?.partyLedger?.selectedPartyName || '-' : selectedBankLabel],
        ['Address', isPartyLedger ? selectedLedgerParty?.address || '-' : '-'],
        [isPartyLedger ? 'Phone' : 'Direction', isPartyLedger ? selectedLedgerParty?.phone1 || '-' : bankDirectionFilter === 'all' ? 'All' : bankDirectionFilter.toUpperCase()],
        ['Statement Period', `${formatDateLabel(dateFrom)} to ${formatDateLabel(dateTo)}`],
        ['Opening Balance', isPartyLedger ? formatLedgerBalance(reportData?.partyLedger?.openingBalance || 0) : formatLedgerBalance(bankLedgerOpeningBalance)],
        ['Closing Balance', formatLedgerBalance(finalBalance)],
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

    printTable(activeExport.title, activeExport.subtitle, activeExport.headers, activeExport.rows)
  }

  const clearActiveFilters = () => {
    setSearchTerm('')
    setOutstandingSort('highest')
    setBankFilter('all')
    setBankDirectionFilter('all')
  }

  return (
    <div className="space-y-6">
      <section className={`${surfaceCardClass} overflow-hidden`}>
        <div className="border-b border-slate-100 bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_55%,#eef6ff_100%)] px-6 py-5 md:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <h2 className={embedded ? 'text-2xl font-semibold tracking-tight text-slate-950' : 'text-3xl font-semibold tracking-tight text-slate-950'}>
                Operations Reports
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Outstanding, ledger, daily and bank reporting in one place.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {operationsViewOptions.map((item) => {
                  const active = activeView === item.value
                  return (
                    <Button
                      key={item.value}
                      type="button"
                      variant={active ? 'default' : 'outline'}
                      className={
                        active
                          ? 'rounded-2xl bg-slate-950 text-white hover:bg-slate-800'
                          : 'rounded-2xl border-slate-200 bg-white/90 text-slate-700 hover:bg-white'
                      }
                      onClick={() => setActiveView(item.value)}
                    >
                      {item.label}
                    </Button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              {!embedded && onBackToDashboard ? (
                <Button variant="outline" onClick={onBackToDashboard} className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50">
                  Back to Dashboard
                </Button>
              ) : null}
              <Button onClick={() => void generateReport()} disabled={loading || loadingCompanies} className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800">
                {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
                {loading ? 'Refreshing...' : 'Refresh'}
              </Button>
              {renderExportMenu()}
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-6 md:p-8 xl:grid-cols-[1.45fr_0.9fr]">
          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Report Setup</p>
              <h3 className="text-lg font-semibold text-slate-950">Filters and search</h3>
              <p className="text-sm text-slate-500">Choose the company, date range, and view-specific filters before you export or review the statement.</p>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
              <div className="space-y-2">
                <Label>Companies</Label>
                <details className="group relative">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 marker:hidden [&::-webkit-details-marker]:hidden">
                    <span className="truncate">{selectedCompanySummary}</span>
                    <span className="ml-3 shrink-0 text-xs text-slate-400">{selectedCompanyIds.length} selected</span>
                  </summary>
                  <div className="absolute z-20 mt-2 w-[320px] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)]">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <p className="text-sm font-semibold text-slate-950">Choose companies</p>
                      <div className="flex gap-2 text-xs">
                        <button
                          type="button"
                          className="rounded-full border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
                          onClick={() => setSelectedCompanyIds(companies.map((company) => company.id))}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
                          onClick={() => setSelectedCompanyIds(companies[0]?.id ? [companies[0].id] : [])}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
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
                                onChange={() => toggleCompanySelection(company.id)}
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-slate-900">{company.name}</span>
                                <span className="block text-xs text-slate-500">{company.id}</span>
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
                  className="rounded-2xl border-slate-200 bg-white"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="operationsDateTo">Date To</Label>
                <Input
                  id="operationsDateTo"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="rounded-2xl border-slate-200 bg-white"
                />
              </div>

              {activeView === 'ledger' ? (
                <div className="space-y-2">
                  <Label>Party Ledger Party</Label>
                  <Select value={selectedPartyId || 'none'} onValueChange={(value) => setSelectedPartyId(value === 'none' ? '' : value)}>
                    <SelectTrigger className="rounded-2xl border-slate-200 bg-white">
                      <SelectValue placeholder="Select party" />
                    </SelectTrigger>
                    <SelectContent>
                      {parties.length === 0 ? <SelectItem value="none">No party found</SelectItem> : null}
                      {parties.map((party) => (
                        <SelectItem key={party.id} value={party.id}>
                          {party.name}{showCompanyColumn ? ` - ${party.companyName}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {activeView === 'outstanding' ? (
                <div className="space-y-2">
                  <Label>Outstanding Order</Label>
                  <Select value={outstandingSort} onValueChange={(value) => setOutstandingSort(value as OutstandingSort)}>
                    <SelectTrigger className="rounded-2xl border-slate-200 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="highest">Highest to Lowest</SelectItem>
                      <SelectItem value="lowest">Lowest to Highest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {activeView === 'bank-ledger' ? (
                <>
                  <div className="space-y-2">
                    <Label>Bank</Label>
                    <Select value={bankFilter} onValueChange={setBankFilter}>
                      <SelectTrigger className="rounded-2xl border-slate-200 bg-white">
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
                    <Label>Direction</Label>
                    <Select value={bankDirectionFilter} onValueChange={(value) => setBankDirectionFilter(value as BankDirectionFilter)}>
                      <SelectTrigger className="rounded-2xl border-slate-200 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="in">In</SelectItem>
                        <SelectItem value="out">Out</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label htmlFor="operationsSearch">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="operationsSearch"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder={getSearchPlaceholder(activeView)}
                    className="rounded-2xl border-slate-200 bg-white pl-9"
                  />
                </div>
              </div>

              <div className="flex items-end">
                <Button type="button" variant="outline" className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50" onClick={clearActiveFilters}>
                  Clear Filters
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-[#f8fbff] p-5">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-sky-500">Active Workspace</p>
              <h3 className="text-lg font-semibold text-slate-950">{activeViewMeta.label}</h3>
              <p className="text-sm leading-6 text-slate-600">{activeViewMeta.description}</p>
              {lastGeneratedAt ? <p className="pt-1 text-xs text-slate-400">Updated: {lastGeneratedAt}</p> : null}
            </div>

            <div className="mt-5 space-y-3">
              {activeViewMeta.cues.map((cue) => (
                <div key={cue} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
                  {cue}
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {activeSummaryCards.map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-400">{card.label}</p>
                  <p className={`mt-2 text-lg font-semibold ${card.tone}`}>{card.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <div className="rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {[
          { label: 'Total Sales', value: currencyText(summary.totalSaleAmount), tone: 'text-slate-900', shell: 'bg-white', accent: 'bg-slate-900/80' },
          { label: 'Total Purchase', value: currencyText(summary.totalPurchaseAmount), tone: 'text-slate-900', shell: 'bg-white', accent: 'bg-slate-400' },
          { label: 'Purchase Payment', value: currencyText(summary.totalPaidAmount), tone: 'text-rose-700', shell: 'bg-rose-50/70', accent: 'bg-rose-500' },
          { label: 'Sales Receipt', value: currencyText(summary.totalReceivedAmount), tone: 'text-emerald-700', shell: 'bg-emerald-50/70', accent: 'bg-emerald-500' },
          { label: 'Sales Outstanding', value: currencyText(summary.salesBalanceTotal), tone: 'text-amber-700', shell: 'bg-amber-50/70', accent: 'bg-amber-500' },
          {
            label: 'Net Outstanding',
            value: formatOutstandingDeltaText(summary.netOutstanding),
            tone: summary.netOutstanding >= 0 ? 'text-sky-700' : 'text-rose-700',
            shell: 'bg-sky-50/70',
            accent: summary.netOutstanding >= 0 ? 'bg-sky-500' : 'bg-rose-500'
          }
        ].map((card) => (
          <Card key={card.label} className={`${surfaceCardClass} overflow-hidden ${card.shell}`}>
            <CardContent className="pt-0">
              <div className={`h-1.5 ${card.accent}`} />
              <div className="px-1 pb-1 pt-5">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">{card.label}</p>
                <p className={`mt-3 text-2xl font-semibold ${card.tone}`}>{card.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {activeView === 'outstanding' ? (
        <Card className={surfaceCardClass}>
          <CardHeader className="border-b border-slate-100 pb-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <CardTitle className="text-2xl tracking-tight text-slate-950">Outstanding Report</CardTitle>
                <CardDescription className="mt-2">
                  Party-wise outstanding built from sale amount, received amount, balance amount, and last bill visibility.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {showCompanyColumn ? <TableHead>Company</TableHead> : null}
                    <TableHead>Party</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Last Bill</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sale Amount</TableHead>
                    <TableHead className="text-right">Received Amount</TableHead>
                    <TableHead className="text-right">Balance Amount</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOutstanding.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={showCompanyColumn ? 10 : 9} className="py-8 text-center text-slate-500">
                        No outstanding rows found for this filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredOutstanding.map((row) => (
                      <TableRow key={`${row.companyId}-${row.partyId}`}>
                        {showCompanyColumn ? <TableCell>{row.companyName}</TableCell> : null}
                        <TableCell className="font-medium text-slate-900">{row.partyName}</TableCell>
                        <TableCell>{row.phone1 || '-'}</TableCell>
                        <TableCell>{row.address || '-'}</TableCell>
                        <TableCell>{formatDateLabel(row.lastBillDate)}</TableCell>
                        <TableCell className="capitalize">{row.status}</TableCell>
                        <TableCell className="text-right">{currencyText(row.saleAmount)}</TableCell>
                        <TableCell className="text-right text-emerald-700">{currencyText(row.receivedAmount)}</TableCell>
                        <TableCell className="text-right font-semibold text-amber-700">{currencyText(row.balanceAmount)}</TableCell>
                        <TableCell className="text-right">{row.invoiceCount}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeView === 'ledger' ? (
        <Card className={surfaceCardClass}>
          <CardHeader className="border-b border-slate-100 pb-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Statement view</span>
                  {reportData?.partyLedger?.selectedPartyName ? (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                      Party: {reportData.partyLedger.selectedPartyName}
                    </span>
                  ) : null}
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                    Range: {formatDateLabel(dateFrom)} to {formatDateLabel(dateTo)}
                  </span>
                </div>
                <CardTitle className="mt-4 text-2xl tracking-tight text-slate-950">Party Ledger</CardTitle>
                <CardDescription className="mt-2">
                  {reportData?.partyLedger?.selectedPartyName
                    ? `${reportData.partyLedger.selectedPartyName}${reportData.partyLedger.selectedPartyCompanyName ? ` (${reportData.partyLedger.selectedPartyCompanyName})` : ''} with running balance across sales and payment entries.`
                    : 'Select a party to load the ledger.'}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            <div className="overflow-hidden rounded-[1.5rem] border border-[#8fa57e] bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.3)]">
              <div className="border-b border-[#8fa57e] bg-[#a9d08e] px-4 py-4 text-center text-[2rem] font-semibold text-slate-950">
                Party Ledger
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[980px]">
                  <div className="grid gap-px border-b border-[#1f2937] bg-[#1f2937]">
                    <div className="bg-[#d9d9d9] px-4 py-3 text-center text-[1.45rem] font-semibold text-slate-950">
                      {reportData?.meta?.companyName || '-'}
                    </div>
                    <div className="bg-white px-4 py-3 text-center text-sm leading-7 text-slate-700">
                      {reportData?.meta?.companyAddress || '-'}
                      <br />
                      {reportData?.meta?.companyPhone ? `Mobile ${reportData.meta.companyPhone}` : '-'}
                    </div>
                  </div>

                  <div className="grid gap-px border-b border-[#1f2937] bg-[#1f2937] md:grid-cols-[160px_1.4fr_0.7fr_0.7fr_0.8fr_0.9fr]">
                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Party Name</div>
                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">
                      {selectedLedgerParty?.name || reportData?.partyLedger?.selectedPartyName || '-'}
                    </div>
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Date</div>
                    <div className="bg-white px-3 py-3 text-sm text-slate-700">
                      {formatDateLabel(dateFrom)} to {formatDateLabel(dateTo)}
                    </div>

                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Address</div>
                    <div className="bg-white px-3 py-3 text-sm leading-7 text-slate-700">
                      {selectedLedgerParty?.address || '-'}
                    </div>
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Opening Bal</div>
                    <div className="bg-white px-3 py-3 text-sm text-slate-700">
                      {formatLedgerBalance(reportData?.partyLedger?.openingBalance || 0)}
                    </div>

                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Phone</div>
                    <div className="bg-white px-3 py-3 text-sm text-slate-700">
                      {selectedLedgerParty?.phone1 || '-'}
                    </div>
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Closing Bal</div>
                    <div className="bg-white px-3 py-3 text-sm text-slate-700">
                      {formatLedgerBalance(reportData?.partyLedger?.closingBalance || 0)}
                    </div>
                  </div>

                  <div className="max-h-[620px] overflow-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-[#8fa57e]">
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-left font-semibold text-slate-950">Type</th>
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-left font-semibold text-slate-950">Date</th>
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-left font-semibold text-slate-950">Voucher No</th>
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-left font-semibold text-slate-950">Particular</th>
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-right font-semibold text-slate-950">Debit (Rs)</th>
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-right font-semibold text-slate-950">Credit (Rs)</th>
                          <th className="sticky top-0 z-10 bg-[#d9d9d9] px-4 py-3 text-right font-semibold text-slate-950">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLedgerRows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                              No ledger entries found for this party and date range.
                            </td>
                          </tr>
                        ) : (
                          partyLedgerStatementRows.map((row, index) => (
                            <tr key={`${row.type}-${row.voucherNo}-${index}`} className="border-b border-[#d7dfcf]">
                              <td className="border-r border-[#d7dfcf] px-4 py-3 text-slate-700">{row.type}</td>
                              <td className="border-r border-[#d7dfcf] px-4 py-3 text-slate-700">{row.date || ''}</td>
                              <td className="border-r border-[#d7dfcf] px-4 py-3 text-slate-700">{row.voucherNo || '-'}</td>
                              <td className="min-w-[320px] border-r border-[#d7dfcf] px-4 py-3 text-slate-950">{row.particular || '-'}</td>
                              <td className="border-r border-[#d7dfcf] px-4 py-3 text-right text-slate-900">{row.debit || '0'}</td>
                              <td className="border-r border-[#d7dfcf] px-4 py-3 text-right text-slate-900">{row.credit || '0'}</td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-950">{row.balance}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#f5f5f5] font-semibold">
                          <td className="border-r border-[#d7dfcf] px-4 py-3">Total</td>
                          <td className="border-r border-[#d7dfcf] px-4 py-3"></td>
                          <td className="border-r border-[#d7dfcf] px-4 py-3"></td>
                          <td className="border-r border-[#d7dfcf] px-4 py-3"></td>
                          <td className="border-r border-[#d7dfcf] px-4 py-3 text-right">{numberText(reportData?.partyLedger?.totalSales || 0)}</td>
                          <td className="border-r border-[#d7dfcf] px-4 py-3 text-right">{numberText(reportData?.partyLedger?.totalReceipts || 0)}</td>
                          <td className="px-4 py-3 text-right">{formatLedgerBalance(reportData?.partyLedger?.closingBalance || 0)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeView === 'daily-transaction' ? (
        <>
          <Card className={surfaceCardClass}>
            <CardHeader className="border-b border-slate-100 pb-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <CardTitle className="text-2xl tracking-tight text-slate-950">Date-wise Summary</CardTitle>
                  <CardDescription className="mt-2">
                    Daily totals covering sale value, purchase value, stock adjustment quantity, and payment movement.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Purchase</TableHead>
                      <TableHead className="text-right">Stock Adj. (Qt.)</TableHead>
                      <TableHead className="text-right">Receipt In</TableHead>
                      <TableHead className="text-right">Payment Out</TableHead>
                      <TableHead className="text-right">Net Cashflow</TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDailyTransactionSummary.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-slate-500">
                          No daily summary rows found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDailyTransactionSummary.map((row) => (
                        <TableRow key={row.date}>
                          <TableCell>{formatDateLabel(row.date)}</TableCell>
                          <TableCell className="text-right">{currencyText(row.totalSales)}</TableCell>
                          <TableCell className="text-right">{currencyText(row.totalPurchase)}</TableCell>
                          <TableCell className="text-right">{numberText(row.totalStockAdjustmentQty)}</TableCell>
                          <TableCell className="text-right text-emerald-700">{currencyText(row.totalSalesReceipt)}</TableCell>
                          <TableCell className="text-right text-rose-700">{currencyText(row.totalPurchasePayment)}</TableCell>
                          <TableCell className={`text-right font-semibold ${row.netCashflow >= 0 ? 'text-sky-700' : 'text-rose-700'}`}>
                            {formatFlowSummaryText(row.netCashflow)}
                          </TableCell>
                          <TableCell className="text-right">{row.transactionCount}</TableCell>
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
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <CardTitle className="text-2xl tracking-tight text-slate-950">Daily Transaction Report</CardTitle>
                  <CardDescription className="mt-2">
                    Transactions, purchases, sales, stock adjustments, and payment entries arranged into one daily activity feed.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {showCompanyColumn ? <TableHead>Company</TableHead> : null}
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Party</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Bank</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDailyTransactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={showCompanyColumn ? 12 : 11} className="py-8 text-center text-slate-500">
                          No daily transactions found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDailyTransactions.map((row) => (
                        <TableRow key={row.id}>
                          {showCompanyColumn ? <TableCell>{row.companyName}</TableCell> : null}
                          <TableCell>{formatDateLabel(row.date)}</TableCell>
                          <TableCell>{row.type}</TableCell>
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
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {activeView === 'daily-consolidated' ? (
        <>
          <Card className={surfaceCardClass}>
            <CardHeader className="border-b border-slate-100 pb-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <CardTitle className="text-2xl tracking-tight text-slate-950">Daily Consolidated Report</CardTitle>
                  <CardDescription className="mt-2">
                    One business summary row per day including total sales, total purchase, stock adjustment, purchase payment, and sales receipt.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total Sales</TableHead>
                      <TableHead className="text-right">Total Purchase</TableHead>
                      <TableHead className="text-right">Stock Adjustment (Qt.)</TableHead>
                      <TableHead className="text-right">Purchase Payment</TableHead>
                      <TableHead className="text-right">Sales Receipt</TableHead>
                      <TableHead className="text-right">Net Cashflow</TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                      <TableHead className="text-right">Companies</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDailyConsolidated.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-slate-500">
                          No consolidated rows found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDailyConsolidated.map((row) => (
                        <TableRow key={row.date}>
                          <TableCell>{formatDateLabel(row.date)}</TableCell>
                          <TableCell className="text-right">{currencyText(row.totalSales)}</TableCell>
                          <TableCell className="text-right">{currencyText(row.totalPurchase)}</TableCell>
                          <TableCell className="text-right">{numberText(row.totalStockAdjustmentQty)}</TableCell>
                          <TableCell className="text-right text-rose-700">{currencyText(row.totalPurchasePayment)}</TableCell>
                          <TableCell className="text-right text-emerald-700">{currencyText(row.totalSalesReceipt)}</TableCell>
                          <TableCell className={`text-right font-semibold ${row.netCashflow >= 0 ? 'text-sky-700' : 'text-rose-700'}`}>
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
            </CardContent>
          </Card>

          <Card className={`${surfaceCardClass} overflow-hidden`}>
            <CardHeader className="border-b border-slate-100 bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_52%,#fff7ed_100%)] pb-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-700">
                      Today Highlight
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                      {formatDateLabel(toDateInputValue(today))}
                    </span>
                  </div>
                  <CardTitle className="mt-4 text-2xl tracking-tight text-slate-950">Today&apos;s Activity Snapshot</CardTitle>
                  <CardDescription className="mt-2">
                    A quick view of what happened today before you open the daily detail groups below.
                  </CardDescription>
                </div>
                {todayActivityGroup ? (
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                      {todayActivityGroup.rows.length} entries
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                      Total amount: {currencyText(todayActivityGroup.totalAmount)}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                      Total qty: {numberText(todayActivityGroup.totalQuantity)}
                    </span>
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              {todayActivityGroup ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: 'Sales', value: String(todayActivityGroup.salesCount), tone: 'text-emerald-700' },
                      { label: 'Purchases', value: String(todayActivityGroup.purchaseCount), tone: 'text-rose-700' },
                      { label: 'Payments', value: String(todayActivityGroup.paymentCount), tone: 'text-sky-700' },
                      { label: 'Adjustments', value: String(todayActivityGroup.adjustmentCount), tone: 'text-amber-700' }
                    ].map((card) => (
                      <div key={card.label} className="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.14em] text-slate-400">{card.label}</p>
                        <p className={`mt-3 text-2xl font-semibold ${card.tone}`}>{card.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 px-4 py-4">
                      <p className="text-sm font-semibold text-slate-950">Today work list</p>
                      <p className="mt-1 text-sm text-slate-500">Recent work captured for today under the current company, date range, and search filters.</p>
                    </div>
                    <div className="max-h-[360px] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="sticky top-0 z-10 bg-white">Type</TableHead>
                            <TableHead className="sticky top-0 z-10 bg-white">Reference</TableHead>
                            <TableHead className="sticky top-0 z-10 bg-white">Party</TableHead>
                            <TableHead className="sticky top-0 z-10 bg-white">Product</TableHead>
                            <TableHead className="sticky top-0 z-10 bg-white text-right">Qty</TableHead>
                            <TableHead className="sticky top-0 z-10 bg-white text-right">Amount</TableHead>
                            <TableHead className="sticky top-0 z-10 bg-white">Direction</TableHead>
                            <TableHead className="sticky top-0 z-10 bg-white">Mode</TableHead>
                            <TableHead className="sticky top-0 z-10 bg-white">Bank</TableHead>
                            <TableHead className="sticky top-0 z-10 bg-white">Note</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {todayActivityGroup.rows.map((row) => (
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
                </>
              ) : (
                <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No activity captured for today within the current company, date range, and search filters.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className={surfaceCardClass}>
            <CardHeader className="border-b border-slate-100 pb-5">
              <CardTitle className="text-2xl tracking-tight text-slate-950">Daily Work Detail</CardTitle>
              <CardDescription>
                This shows what was actually done each day: sales, purchases, receipts, payments, and stock adjustments behind the consolidated totals.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              {consolidatedActivityGroups.length === 0 ? (
                <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No daily work details found for this range.
                </div>
              ) : (
                consolidatedActivityGroups.map((group, index) => (
                  <details
                    key={group.date}
                    open={index === 0}
                    className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white"
                  >
                    <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-base font-semibold text-slate-950">{formatDateLabel(group.date)}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {group.rows.length} work entries | Sales: {group.salesCount} | Purchase: {group.purchaseCount} | Payments: {group.paymentCount} | Adjustments: {group.adjustmentCount}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                          Total amount: {currencyText(group.totalAmount)}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                          Total qty: {numberText(group.totalQuantity)}
                        </span>
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
        </>
      ) : null}

      {activeView === 'bank-ledger' ? (
        <Card className={surfaceCardClass}>
          <CardHeader className="border-b border-slate-100 pb-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <CardTitle className="text-2xl tracking-tight text-slate-950">Bank Ledger</CardTitle>
                <CardDescription className="mt-2">
                  All bank and online payment movement with date-wise inflow, outflow, party, and bank references.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {renderExportButtons('rounded-2xl border-slate-200 bg-white hover:bg-slate-50')}
              </div>
            </div>
            {bankSyncProviders.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                {bankSyncProviders.map((provider) => (
                  <span
                    key={provider.provider}
                    title={provider.message}
                    className={`rounded-full border px-3 py-1 ${
                      provider.ready
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {provider.label}: {provider.ready ? 'Ready now' : 'Future-ready'}
                  </span>
                ))}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            <div className="overflow-hidden rounded-[1.5rem] border border-[#8fa57e] bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.3)]">
              <div className="border-b border-[#8fa57e] bg-[#a9d08e] px-4 py-4 text-center text-[2rem] font-semibold text-slate-950">
                Bank Ledger
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[980px]">
                  <div className="grid gap-px border-b border-[#1f2937] bg-[#1f2937]">
                    <div className="bg-[#d9d9d9] px-4 py-3 text-center text-[1.45rem] font-semibold text-slate-950">
                      {reportData?.meta?.companyName || '-'}
                    </div>
                    <div className="bg-white px-4 py-3 text-center text-sm leading-7 text-slate-700">
                      {reportData?.meta?.companyAddress || '-'}
                      <br />
                      {reportData?.meta?.companyPhone ? `Mobile ${reportData.meta.companyPhone}` : '-'}
                    </div>
                  </div>

                  <div className="grid gap-px border-b border-[#1f2937] bg-[#1f2937] md:grid-cols-[160px_1.4fr_0.7fr_0.7fr_0.8fr_0.9fr]">
                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Bank Name</div>
                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">{selectedBankLabel}</div>
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Date</div>
                    <div className="bg-white px-3 py-3 text-sm text-slate-700">
                      {formatDateLabel(dateFrom)} to {formatDateLabel(dateTo)}
                    </div>

                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Direction</div>
                    <div className="bg-white px-3 py-3 text-sm text-slate-700">
                      {bankDirectionFilter === 'all' ? 'All' : bankDirectionFilter.toUpperCase()}
                    </div>
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Opening Bal</div>
                    <div className="bg-white px-3 py-3 text-sm text-slate-700">
                      {formatLedgerBalance(bankLedgerOpeningBalance)}
                    </div>

                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Entries</div>
                    <div className="bg-white px-3 py-3 text-sm text-slate-700">{filteredBankLedger.length}</div>
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3" />
                    <div className="bg-white px-3 py-3 text-sm font-semibold text-slate-950">Closing Bal</div>
                    <div className="bg-white px-3 py-3 text-sm text-slate-700">
                      {formatLedgerBalance(bankLedgerClosingBalance)}
                    </div>
                  </div>

                  <div className="max-h-[620px] overflow-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-[#8fa57e]">
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-left font-semibold text-slate-950">Type</th>
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-left font-semibold text-slate-950">Date</th>
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-left font-semibold text-slate-950">Voucher No</th>
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-left font-semibold text-slate-950">Particular</th>
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-right font-semibold text-slate-950">Debit (Rs)</th>
                          <th className="sticky top-0 z-10 border-r border-[#1f2937] bg-[#d9d9d9] px-4 py-3 text-right font-semibold text-slate-950">Credit (Rs)</th>
                          <th className="sticky top-0 z-10 bg-[#d9d9d9] px-4 py-3 text-right font-semibold text-slate-950">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bankLedgerStatementRows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                              No bank ledger rows found for this range.
                            </td>
                          </tr>
                        ) : (
                          bankLedgerStatementRows.map((row, index) => (
                            <tr key={`${row.type}-${row.voucherNo}-${index}`} className="border-b border-[#d7dfcf]">
                              <td className="border-r border-[#d7dfcf] px-4 py-3 text-slate-700">{row.type}</td>
                              <td className="border-r border-[#d7dfcf] px-4 py-3 text-slate-700">{row.date}</td>
                              <td className="border-r border-[#d7dfcf] px-4 py-3 text-slate-700">{row.voucherNo || '-'}</td>
                              <td className="min-w-[320px] border-r border-[#d7dfcf] px-4 py-3 text-slate-950">{row.particular || '-'}</td>
                              <td className="border-r border-[#d7dfcf] px-4 py-3 text-right text-slate-900">{row.debit || '0'}</td>
                              <td className="border-r border-[#d7dfcf] px-4 py-3 text-right text-slate-900">{row.credit || '0'}</td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-950">{row.balance}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#f5f5f5] font-semibold">
                          <td className="border-r border-[#d7dfcf] px-4 py-3">Total</td>
                          <td className="border-r border-[#d7dfcf] px-4 py-3"></td>
                          <td className="border-r border-[#d7dfcf] px-4 py-3"></td>
                          <td className="border-r border-[#d7dfcf] px-4 py-3"></td>
                          <td className="border-r border-[#d7dfcf] px-4 py-3 text-right">{numberText(bankLedgerTotalDebit)}</td>
                          <td className="border-r border-[#d7dfcf] px-4 py-3 text-right">{numberText(bankLedgerTotalCredit)}</td>
                          <td className="px-4 py-3 text-right">{formatLedgerBalance(bankLedgerClosingBalance)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
