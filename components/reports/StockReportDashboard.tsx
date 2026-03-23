'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, FileText, RefreshCw, Search, Table2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { printSimpleTableReport } from '@/lib/report-print'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'

type EntryType = 'all' | 'purchase' | 'sales' | 'adjustment'

interface CompanyRecord {
  id: string
  name: string
}

interface StockLedgerRecord {
  id: string
  companyId: string
  entryDate: string
  productId: string
  type: string
  qtyIn: number
  qtyOut: number
  refTable?: string
  refId?: string
  product?: {
    id?: string
    name?: string
    unit?: string
  } | null
}

interface StockRow {
  id: string
  companyId: string
  companyName: string
  entryDate: string
  productName: string
  unit: string
  type: string
  qtyIn: number
  qtyOut: number
  netMovement: number
  refTable: string
  refId: string
  _sortTs: number
}

interface StockReportDashboardProps {
  initialCompanyId?: string
  embedded?: boolean
  onBackToDashboard?: () => void
}

const COMPANIES_CACHE_KEY = 'shell:companies'
const COMPANIES_CACHE_AGE_MS = 60_000

const numberFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const normalizeAmount = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const toDateInputValue = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatDisplayDate = (value: string): string => {
  const parsed = parseDate(value)
  if (!parsed) return '-'
  return parsed.toLocaleDateString('en-IN')
}

const normalizeCollection = <T,>(payload: unknown): T[] => {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: T[] }).data
  }
  return []
}

const csvEscape = (value: string | number): string => `"${String(value ?? '').replace(/"/g, '""')}"`

export default function StockReportDashboard({
  initialCompanyId,
  embedded = false,
  onBackToDashboard
}: StockReportDashboardProps) {
  const today = useMemo(() => new Date(), [])
  const firstDay = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today])

  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId || '')
  const [dateFrom, setDateFrom] = useState(toDateInputValue(firstDay))
  const [dateTo, setDateTo] = useState(toDateInputValue(today))
  const [entryTypeFilter, setEntryTypeFilter] = useState<EntryType>('all')
  const [searchTerm, setSearchTerm] = useState('')

  const [loadingCompanies, setLoadingCompanies] = useState(true)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [lastGeneratedAt, setLastGeneratedAt] = useState('')
  const [generatedRows, setGeneratedRows] = useState<StockRow[]>([])

  useEffect(() => {
    if (!initialCompanyId) return
    setSelectedCompanyId(initialCompanyId)
  }, [initialCompanyId])

  useEffect(() => {
    let cancelled = false

    const loadCompanies = async () => {
      setLoadingCompanies(true)
      try {
        const cachedCompanies = getClientCache<CompanyRecord[]>(COMPANIES_CACHE_KEY, COMPANIES_CACHE_AGE_MS)
        if (cachedCompanies && cachedCompanies.length > 0) {
          if (cancelled) return
          setCompanies(cachedCompanies)
          const availableIds = new Set(cachedCompanies.map((row) => row.id))
          setSelectedCompanyId((previous) => {
            if (initialCompanyId && availableIds.has(initialCompanyId)) return initialCompanyId
            if (previous && availableIds.has(previous)) return previous
            return cachedCompanies[0]?.id || ''
          })
          return
        }

        const response = await fetch('/api/companies', { cache: 'no-store' })
        if (!response.ok) {
          throw new Error('Unable to load companies')
        }

        const payload = await response.json().catch(() => [])
        const rows = normalizeCollection<CompanyRecord>(payload)

        if (cancelled) return

        setCompanies(rows)
        setClientCache(COMPANIES_CACHE_KEY, rows)
        const availableIds = new Set(rows.map((row) => row.id))
        setSelectedCompanyId((previous) => {
          if (initialCompanyId && availableIds.has(initialCompanyId)) return initialCompanyId
          if (previous && availableIds.has(previous)) return previous
          return rows[0]?.id || ''
        })
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Failed to load companies'
        setErrorMessage(message)
        setCompanies([])
      } finally {
        if (!cancelled) setLoadingCompanies(false)
      }
    }

    void loadCompanies()

    return () => {
      cancelled = true
    }
  }, [initialCompanyId])

  const generateReport = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      setErrorMessage('Please select date range before generating the report.')
      return
    }

    const fromDate = parseDate(`${dateFrom}T00:00:00`)
    const toDate = parseDate(`${dateTo}T23:59:59`)
    if (!fromDate || !toDate || fromDate > toDate) {
      setErrorMessage('Invalid date range selected.')
      return
    }

    const targetCompanyIds = selectedCompanyId ? [selectedCompanyId] : []

    if (targetCompanyIds.length === 0) {
      setErrorMessage('No company available for the selected report scope.')
      return
    }

    setLoading(true)

    try {
      const companyNameMap = new Map(companies.map((company) => [company.id, company.name]))

      const datasets = await Promise.all(
        targetCompanyIds.map(async (companyId) => {
          const params = new URLSearchParams({
            companyId,
            dateFrom,
            dateTo
          })
          const response = await fetch(`/api/stock-ledger?${params.toString()}`)
          if (!response.ok) {
            throw new Error(`Failed to load stock entries for ${companyNameMap.get(companyId) || companyId}`)
          }
          const payload = await response.json().catch(() => [])
          return {
            companyId,
            companyName: companyNameMap.get(companyId) || companyId,
            rows: normalizeCollection<StockLedgerRecord>(payload)
          }
        })
      )

      const nextRows: StockRow[] = []

      for (const dataset of datasets) {
        for (const entry of dataset.rows) {
          const entryDate = parseDate(entry.entryDate)
          if (!entryDate || entryDate < fromDate || entryDate > toDate) continue

          const normalizedType = String(entry.type || '').toLowerCase()
          if (entryTypeFilter !== 'all' && normalizedType !== entryTypeFilter) continue

          nextRows.push({
            id: entry.id,
            companyId: dataset.companyId,
            companyName: dataset.companyName,
            entryDate: entry.entryDate,
            productName: String(entry.product?.name || '').trim() || 'Unknown Product',
            unit: String(entry.product?.unit || '').trim() || '-',
            type: normalizedType || 'unknown',
            qtyIn: normalizeAmount(entry.qtyIn),
            qtyOut: normalizeAmount(entry.qtyOut),
            netMovement: normalizeAmount(entry.qtyIn) - normalizeAmount(entry.qtyOut),
            refTable: String(entry.refTable || '').trim() || '-',
            refId: String(entry.refId || '').trim() || '-',
            _sortTs: entryDate.getTime()
          })
        }
      }

      nextRows.sort((a, b) => b._sortTs - a._sortTs)

      setGeneratedRows(nextRows)
      setLastGeneratedAt(new Date().toLocaleString('en-IN'))

      if (nextRows.length === 0) {
        setErrorMessage('No stock records found for selected filters.')
      } else {
        setErrorMessage('')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stock report generation failed.'
      setErrorMessage(message)
      setGeneratedRows([])
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, selectedCompanyId, companies, entryTypeFilter])

  const selectedCompanyName = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId)?.name || selectedCompanyId || 'Selected company',
    [companies, selectedCompanyId]
  )

  useEffect(() => {
    if (loadingCompanies) return
    if (!selectedCompanyId) return
    void generateReport()
  }, [loadingCompanies, selectedCompanyId, dateFrom, dateTo, entryTypeFilter, generateReport])

  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return generatedRows

    return generatedRows.filter((row) => {
      return (
        row.productName.toLowerCase().includes(query) ||
        row.companyName.toLowerCase().includes(query) ||
        row.type.toLowerCase().includes(query) ||
        row.refTable.toLowerCase().includes(query) ||
        row.refId.toLowerCase().includes(query)
      )
    })
  }, [generatedRows, searchTerm])

  const summary = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.totalQtyIn += row.qtyIn
        acc.totalQtyOut += row.qtyOut
        acc.netMovement += row.netMovement
        acc.products.add(row.productName)
        return acc
      },
      {
        totalQtyIn: 0,
        totalQtyOut: 0,
        netMovement: 0,
        products: new Set<string>()
      }
    )
  }, [filteredRows])

  const stockInsights = useMemo(() => {
    const productMap = new Map<string, { name: string; turnover: number; net: number; qtyOut: number; count: number; unit: string }>()
    const companyMap = new Map<string, { name: string; count: number; net: number }>()
    const dayMap = new Map<string, { day: string; count: number; net: number }>()
    let adjustmentCount = 0

    filteredRows.forEach((row) => {
      const productKey = `${row.productName}:${row.unit}`
      const productRow = productMap.get(productKey) || {
        name: row.productName,
        turnover: 0,
        net: 0,
        qtyOut: 0,
        count: 0,
        unit: row.unit
      }
      productRow.turnover += row.qtyIn + row.qtyOut
      productRow.net += row.netMovement
      productRow.qtyOut += row.qtyOut
      productRow.count += 1
      productMap.set(productKey, productRow)

      const companyRow = companyMap.get(row.companyName) || { name: row.companyName, count: 0, net: 0 }
      companyRow.count += 1
      companyRow.net += row.netMovement
      companyMap.set(row.companyName, companyRow)

      const dayKey = row.entryDate.slice(0, 10)
      const dayRow = dayMap.get(dayKey) || { day: dayKey, count: 0, net: 0 }
      dayRow.count += 1
      dayRow.net += row.netMovement
      dayMap.set(dayKey, dayRow)

      if (row.type === 'adjustment') adjustmentCount += 1
    })

    const topMover = Array.from(productMap.values()).sort((a, b) => b.turnover - a.turnover)[0] || null
    const biggestOutflow = Array.from(productMap.values()).sort((a, b) => b.qtyOut - a.qtyOut)[0] || null
    const busiestDay = Array.from(dayMap.values()).sort((a, b) => b.count - a.count)[0] || null
    const mostActiveCompany = Array.from(companyMap.values()).sort((a, b) => b.count - a.count)[0] || null
    const topProducts = Array.from(productMap.values()).sort((a, b) => b.turnover - a.turnover).slice(0, 4)

    return {
      topMover,
      biggestOutflow,
      busiestDay,
      mostActiveCompany,
      adjustmentCount,
      topProducts
    }
  }, [filteredRows])

  const downloadCsv = () => {
    if (filteredRows.length === 0) {
      setErrorMessage('No rows available to export. Generate report first.')
      return
    }

    const headers = [
      'Date',
      'Company_Name',
      'Product_Name',
      'Unit',
      'Entry_Type',
      'Qty_In',
      'Qty_Out',
      'Net_Movement',
      'Reference_Table',
      'Reference_Id'
    ]

    const csv = [
      headers.join(','),
      ...filteredRows.map((row) =>
        [
          formatDisplayDate(row.entryDate),
          row.companyName,
          row.productName,
          row.unit,
          row.type,
          row.qtyIn,
          row.qtyOut,
          row.netMovement,
          row.refTable,
          row.refId
        ]
          .map((value) => csvEscape(value))
          .join(',')
      )
    ].join('\n')

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `stock_report_${dateFrom}_${dateTo}_${stamp}.csv`

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const downloadPdf = () => {
    if (filteredRows.length === 0) {
      setErrorMessage('No rows available to export. Generate report first.')
      return
    }

    printSimpleTableReport(
      'Stock Report',
      `${selectedCompanyName} | ${dateFrom} to ${dateTo}`,
      ['Date', 'Company', 'Product', 'Unit', 'Entry Type', 'Qty In', 'Qty Out', 'Net Movement', 'Reference Table', 'Reference Id'],
      filteredRows.map((row) => [
        formatDisplayDate(row.entryDate),
        row.companyName,
        row.productName,
        row.unit,
        row.type,
        String(row.qtyIn),
        String(row.qtyOut),
        String(row.netMovement),
        row.refTable,
        row.refId
      ])
    )
  }

  const surfaceCardClass = 'rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]'
  const mutedPillClass = 'rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600'

  return (
    <div className="space-y-6">
      <section className={`${surfaceCardClass} p-6 md:p-8`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl">
            <h2 className={embedded ? 'mt-3 text-2xl font-semibold tracking-tight text-slate-950' : 'mt-3 text-3xl font-semibold tracking-tight text-slate-950'}>
              Stock Report
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Stock ledger entries with product-wise inward, outward and net movement for the selected company.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            {!embedded && onBackToDashboard && (
              <Button variant="outline" onClick={onBackToDashboard} className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50">
                Back to Dashboard
              </Button>
            )}
            <Button onClick={generateReport} disabled={loading || loadingCompanies} className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800">
              {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
              {loading ? 'Generating...' : 'Refresh'}
            </Button>
            <Button
              variant="outline"
              onClick={downloadCsv}
              disabled={filteredRows.length === 0 || loading}
              className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50"
            >
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button
              variant="outline"
              onClick={downloadPdf}
              disabled={filteredRows.length === 0 || loading}
              className="rounded-2xl border-slate-200 bg-white hover:bg-slate-50"
            >
              <FileText className="mr-2 h-4 w-4" />
              PDF
            </Button>
          </div>
        </div>
      </section>

      {errorMessage && (
        <div className="rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-5">
          <CardTitle className="text-2xl tracking-tight text-slate-950">Filter Options</CardTitle>
          <CardDescription>Stock report auto-refreshes on company, date and entry type changes.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>Company</Label>
              <Select
                value={selectedCompanyId || 'none'}
                onValueChange={(value) => setSelectedCompanyId(value === 'none' ? '' : value)}
                disabled={companies.length === 0}
              >
                <SelectTrigger className="rounded-2xl border-slate-200 bg-white">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.length === 0 && <SelectItem value="none">No company found</SelectItem>}
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stockDateFrom">Date From</Label>
              <Input id="stockDateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded-2xl border-slate-200 bg-white" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stockDateTo">Date To</Label>
              <Input id="stockDateTo" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded-2xl border-slate-200 bg-white" />
            </div>

            <div className="space-y-2">
              <Label>Entry Type</Label>
              <Select value={entryTypeFilter} onValueChange={(value) => setEntryTypeFilter(value as EntryType)}>
                <SelectTrigger className="rounded-2xl border-slate-200 bg-white">
                  <SelectValue placeholder="All entry types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="purchase">Purchase (In)</SelectItem>
                  <SelectItem value="sales">Sales (Out)</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stockSearch">Search Product / Ref</Label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  id="stockSearch"
                  className="rounded-2xl border-slate-200 bg-white pl-9"
                  placeholder="Product / Reference"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className={mutedPillClass}>Connected with stock-ledger entries</span>
            {lastGeneratedAt && <span className={mutedPillClass}>Last generated: {lastGeneratedAt}</span>}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className={surfaceCardClass}>
          <CardHeader className="border-b border-slate-100 pb-5">
            <CardTitle className="text-2xl tracking-tight text-slate-950">Movement Signals</CardTitle>
            <CardDescription>Useful stock cues pulled from the filtered ledger result.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Highest turnover product</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{stockInsights.topMover?.name || 'No data yet'}</p>
              <p className="mt-2 text-sm text-slate-500">
                {stockInsights.topMover ? `${numberFormatter.format(stockInsights.topMover.turnover)} ${stockInsights.topMover.unit} moved across ${stockInsights.topMover.count} entries` : 'Generate or widen filters to see this signal.'}
              </p>
            </div>

            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Largest outflow pressure</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{stockInsights.biggestOutflow?.name || 'No data yet'}</p>
              <p className="mt-2 text-sm text-slate-500">
                {stockInsights.biggestOutflow ? `${numberFormatter.format(stockInsights.biggestOutflow.qtyOut)} ${stockInsights.biggestOutflow.unit} moved out` : 'No outward pressure detected in the current rows.'}
              </p>
            </div>

            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Busiest day</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{stockInsights.busiestDay ? formatDisplayDate(stockInsights.busiestDay.day) : 'No date yet'}</p>
              <p className="mt-2 text-sm text-slate-500">
                {stockInsights.busiestDay ? `${stockInsights.busiestDay.count} entries with net ${numberFormatter.format(stockInsights.busiestDay.net)}` : 'No daily movement summary available.'}
              </p>
            </div>

            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Adjustments / active company</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{stockInsights.adjustmentCount} / {stockInsights.mostActiveCompany?.name || 'N/A'}</p>
              <p className="mt-2 text-sm text-slate-500">
                {stockInsights.mostActiveCompany ? `${stockInsights.mostActiveCompany.count} entries from the busiest company in scope` : 'No company activity available.'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className={surfaceCardClass}>
          <CardHeader className="border-b border-slate-100 pb-5">
            <CardTitle className="text-2xl tracking-tight text-slate-950">Top Product Watchlist</CardTitle>
            <CardDescription>Products with the highest movement in the current stock report.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {stockInsights.topProducts.length > 0 ? (
              stockInsights.topProducts.map((product, index) => (
                <div key={`${product.name}-${index}`} className="flex items-center justify-between rounded-[1rem] border border-slate-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-950">{product.name}</p>
                    <p className="text-xs text-slate-500">
                      Net {numberFormatter.format(product.net)} {product.unit} • {product.count} entries
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">
                    {numberFormatter.format(product.turnover)} {product.unit}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-[1rem] border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
                No product movement found for the current filters.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className={surfaceCardClass}>
          <CardContent className="pt-6">
            <p className="text-xs text-slate-500">Total Entries</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{filteredRows.length}</p>
          </CardContent>
        </Card>
        <Card className={surfaceCardClass}>
          <CardContent className="pt-6">
            <p className="text-xs text-slate-500">Total Qty In</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-700">{numberFormatter.format(summary.totalQtyIn)}</p>
          </CardContent>
        </Card>
        <Card className={surfaceCardClass}>
          <CardContent className="pt-6">
            <p className="text-xs text-slate-500">Total Qty Out</p>
            <p className="mt-1 text-2xl font-semibold text-rose-700">{numberFormatter.format(summary.totalQtyOut)}</p>
          </CardContent>
        </Card>
        <Card className={surfaceCardClass}>
          <CardContent className="pt-6">
            <p className="text-xs text-slate-500">Net Movement / Products</p>
            <p className="mt-1 text-2xl font-semibold text-sky-700">
              {numberFormatter.format(summary.netMovement)} / {summary.products.size}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-5">
          <CardTitle className="flex items-center gap-2 text-2xl tracking-tight text-slate-950">
            <Table2 className="h-5 w-5" />
            Stock Movement Table
          </CardTitle>
          <CardDescription>{filteredRows.length} rows after filters</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="overflow-x-auto rounded-[1.35rem] border border-slate-200">
            <Table className="bg-white">
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty In</TableHead>
                  <TableHead className="text-right">Qty Out</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row, index) => (
                  <TableRow key={row.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>{formatDisplayDate(row.entryDate)}</TableCell>
                    <TableCell>{row.companyName}</TableCell>
                    <TableCell>{row.productName}</TableCell>
                    <TableCell>{row.unit}</TableCell>
                    <TableCell className="capitalize">{row.type}</TableCell>
                    <TableCell className="text-right">{numberFormatter.format(row.qtyIn)}</TableCell>
                    <TableCell className="text-right">{numberFormatter.format(row.qtyOut)}</TableCell>
                    <TableCell className="text-right">{numberFormatter.format(row.netMovement)}</TableCell>
                    <TableCell>{`${row.refTable} / ${row.refId}`}</TableCell>
                  </TableRow>
                ))}

                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-slate-500">
                      {loading ? 'Generating stock report...' : 'No stock rows found. Update filters and click Generate Report.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
