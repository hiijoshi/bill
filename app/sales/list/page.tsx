'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { Eye, Edit, Ban, Printer, FileText, Download, MessageCircle } from 'lucide-react'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { isAbortError } from '@/lib/http'
import { openWhatsappChat } from '@/lib/whatsapp'

interface SalesBill {
  id: string
  invoiceNo: string
  invoiceDate: string
  totalAmount: number
  receivedAmount: number
  balanceAmount: number
  status: string
  party: {
    name: string
    address: string
    phone1: string
  }
  salesItems: Array<{
    weight?: number
    qty?: number
    bags?: number
    rate?: number
    amount?: number
    product?: {
      name: string
    }
  }>
  transportBills: Array<{
    transportName?: string
    lorryNo?: string
    freightAmount?: number
    otherAmount?: number
    insuranceAmount?: number
  }>
}

interface RawSalesItem {
  weight?: unknown
  qty?: unknown
  bags?: unknown
  rate?: unknown
  amount?: unknown
  product?: {
    name?: unknown
  }
}

interface RawTransportBill {
  transportName?: unknown
  lorryNo?: unknown
  freightAmount?: unknown
  otherAmount?: unknown
  insuranceAmount?: unknown
}

interface RawSalesBill {
  id?: unknown
  invoiceNo?: unknown
  billNo?: unknown
  invoiceDate?: unknown
  billDate?: unknown
  totalAmount?: unknown
  receivedAmount?: unknown
  balanceAmount?: unknown
  status?: unknown
  party?: {
    name?: unknown
    address?: unknown
    phone1?: unknown
  }
  salesItems?: RawSalesItem[]
  transportBills?: RawTransportBill[]
}

type BillViewTab = 'active' | 'paid' | 'cancelled' | 'all'

const clampNonNegative = (value: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function normalizeBillStatus(
  totalAmount: number,
  receivedAmount: number,
  balanceAmount: number,
  statusRaw: unknown
): 'paid' | 'partial' | 'unpaid' | 'cancelled' {
  const normalizedStatus = String(statusRaw || '').trim().toLowerCase()
  if (normalizedStatus === 'cancelled') return 'cancelled'
  if (balanceAmount <= 0 && totalAmount > 0) return 'paid'
  if (receivedAmount > 0) return 'partial'
  return 'unpaid'
}

function normalizeSalesBill(raw: RawSalesBill): SalesBill {
  const totalAmount = clampNonNegative(Number(raw?.totalAmount || 0))
  const receivedAmount = clampNonNegative(Number(raw?.receivedAmount || 0))
  const explicitBalance = clampNonNegative(Number(raw?.balanceAmount || 0))
  const status = normalizeBillStatus(totalAmount, receivedAmount, explicitBalance, raw?.status)
  const balanceAmount = status === 'cancelled' ? explicitBalance : Math.max(0, totalAmount - receivedAmount)

  return {
    id: String(raw?.id || ''),
    invoiceNo: String(raw?.invoiceNo || raw?.billNo || ''),
    invoiceDate: String(raw?.invoiceDate || raw?.billDate || ''),
    totalAmount,
    receivedAmount,
    balanceAmount,
    status,
    party: {
      name: String(raw?.party?.name || ''),
      address: String(raw?.party?.address || ''),
      phone1: String(raw?.party?.phone1 || '')
    },
    salesItems: Array.isArray(raw?.salesItems)
      ? raw.salesItems.map((item) => ({
          weight: clampNonNegative(Number(item?.weight || item?.qty || 0)),
          qty: clampNonNegative(Number(item?.qty || item?.weight || 0)),
          bags: clampNonNegative(Number(item?.bags || 0)),
          rate: clampNonNegative(Number(item?.rate || 0)),
          amount: clampNonNegative(Number(item?.amount || 0)),
          product: item?.product ? { name: String(item.product.name || '') } : undefined
        }))
      : [],
    transportBills: Array.isArray(raw?.transportBills)
      ? raw.transportBills.map((item) => ({
          transportName: String(item?.transportName || ''),
          lorryNo: String(item?.lorryNo || ''),
          freightAmount: clampNonNegative(Number(item?.freightAmount || 0)),
          otherAmount: clampNonNegative(Number(item?.otherAmount || 0)),
          insuranceAmount: clampNonNegative(Number(item?.insuranceAmount || 0))
        }))
      : []
  }
}

function isValidDateValue(value: string): boolean {
  if (!value) return false
  const d = new Date(value)
  return Number.isFinite(d.getTime())
}

function parseDateOrNull(value: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function startOfDay(value: string): Date | null {
  const date = parseDateOrNull(value)
  if (!date) return null
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfDay(value: string): Date | null {
  const date = parseDateOrNull(value)
  if (!date) return null
  date.setHours(23, 59, 59, 999)
  return date
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateSafe(value: string): string {
  if (!isValidDateValue(value)) return '-'
  return new Date(value).toLocaleDateString()
}

function getBillTotalBags(bill: SalesBill): number {
  return bill.salesItems.reduce((sum, item) => sum + Number(item.bags || 0), 0)
}

function getBillTotalWeight(bill: SalesBill): number {
  return bill.salesItems.reduce((sum, item) => sum + Number(item.weight || item.qty || 0), 0)
}

function getBillAverageRate(bill: SalesBill): number {
  const totalWeight = getBillTotalWeight(bill)
  if (totalWeight <= 0) {
    return bill.salesItems.length > 0 ? Number(bill.salesItems[0].rate || 0) : 0
  }
  const weighted = bill.salesItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  return weighted / totalWeight
}

function isZeroRateBill(bill: SalesBill): boolean {
  return Math.abs(getBillAverageRate(bill)) < 0.000001
}

function getPrimaryTransport(bill: SalesBill) {
  return bill.transportBills[0] || null
}

function formatTransportCell(bill: SalesBill): string {
  const transport = getPrimaryTransport(bill)
  if (!transport) return '-'
  const name = String(transport.transportName || '').trim()
  const lorry = String(transport.lorryNo || '').trim()
  if (name && lorry) return `${name} / ${lorry}`
  return name || lorry || '-'
}

function openWhatsappReminder(bill: SalesBill) {
  const opened = openWhatsappChat(
    bill.party.phone1 || '',
    `Dear ${bill.party.name || 'Customer'}, your outstanding amount is Rs. ${Number(bill.balanceAmount || 0).toFixed(2)} against invoice ${bill.invoiceNo || bill.id}. Please arrange the pending payment at the earliest. Thank you.`
  )

  if (!opened) {
    window.alert('Party mobile number is missing')
    return
  }
}

export default function SalesListPage() {
  const router = useRouter()
  const [salesBills, setSalesBills] = useState<SalesBill[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState('')
  const [billView, setBillView] = useState<BillViewTab>('active')
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([])

  // Filter states
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [partyName, setPartyName] = useState('')
  const [partyAddress, setPartyAddress] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [weight, setWeight] = useState('')
  const [rate, setRate] = useState('')
  const [partyContact, setPartyContact] = useState('')
  const [payable, setPayable] = useState('')
  const [filterZeroRateBills, setFilterZeroRateBills] = useState(false)

  const fetchSalesBills = useCallback(async () => {
    try {
      const companyIdParam = await resolveCompanyId(window.location.search)

      if (!companyIdParam) {
        alert('Company not selected')
        router.push('/company/select')
        return
      }

      setCompanyId(companyIdParam)
      stripCompanyParamsFromUrl()

      const cacheKey = `sales-bills:${companyIdParam}`
      const cached = getClientCache<SalesBill[]>(cacheKey, 15_000)
      if (cached) {
        setSalesBills(cached)
        setLoading(false)
      }

      const response = await fetch(`/api/sales-bills?companyId=${companyIdParam}&includeCancelled=true`)
      if (response.status === 401) {
        setLoading(false)
        router.push('/login')
        return
      }
      if (response.status === 403) {
        setSalesBills([])
        setLoading(false)
        return
      }
      const raw = await response.json().catch(() => [])
      const data = (Array.isArray(raw) ? raw : []).map(normalizeSalesBill)
      setSalesBills(data)
      setClientCache(cacheKey, data)
      setLoading(false)
    } catch (error) {
      if (isAbortError(error)) return
      console.error('Error fetching sales bills:', error)
      setSalesBills([])
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSalesBills()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchSalesBills])

  const filteredBills = useMemo(() => {
    let filtered = salesBills

    if (invoiceNumber) {
      filtered = filtered.filter(bill => bill.invoiceNo.toLowerCase().includes(invoiceNumber.toLowerCase()))
    }

    if (partyName) {
      filtered = filtered.filter(bill => bill.party.name.toLowerCase().includes(partyName.toLowerCase()))
    }

    if (partyAddress) {
      filtered = filtered.filter(bill => bill.party.address?.toLowerCase().includes(partyAddress.toLowerCase()))
    }

    if (partyContact) {
      filtered = filtered.filter(bill => bill.party.phone1?.toLowerCase().includes(partyContact.toLowerCase()))
    }

    if (dateFrom) {
      const fromDate = startOfDay(dateFrom)
      if (!fromDate) return filtered
      filtered = filtered.filter((bill) => {
        const billDate = parseDateOrNull(bill.invoiceDate)
        if (!billDate) return false
        return billDate >= fromDate
      })
    }

    if (dateTo) {
      const toDate = endOfDay(dateTo)
      if (!toDate) return filtered
      filtered = filtered.filter((bill) => {
        const billDate = parseDateOrNull(bill.invoiceDate)
        if (!billDate) return false
        return billDate <= toDate
      })
    }

    if (weight) {
      filtered = filtered.filter((bill) => getBillTotalWeight(bill).toString().includes(weight))
    }

    if (rate) {
      filtered = filtered.filter((bill) => getBillAverageRate(bill).toString().includes(rate))
    }

    if (filterZeroRateBills) {
      filtered = filtered.filter((bill) => isZeroRateBill(bill))
    }

    if (payable) {
      filtered = filtered.filter(bill => bill.totalAmount.toString().includes(payable))
    }

    return filtered
  }, [salesBills, invoiceNumber, partyName, partyAddress, dateFrom, dateTo, weight, rate, filterZeroRateBills, partyContact, payable])

  const paidBills = useMemo(
    () => filteredBills.filter((bill) => bill.status === 'paid'),
    [filteredBills]
  )

  const cancelledBills = useMemo(
    () => filteredBills.filter((bill) => bill.status === 'cancelled'),
    [filteredBills]
  )

  const activeBills = useMemo(
    () => filteredBills.filter((bill) => bill.status !== 'paid' && bill.status !== 'cancelled'),
    [filteredBills]
  )

  const visibleBills = useMemo(() => {
    if (billView === 'paid') return paidBills
    if (billView === 'cancelled') return cancelledBills
    if (billView === 'all') return filteredBills
    return activeBills
  }, [activeBills, billView, cancelledBills, filteredBills, paidBills])

  const visibleBillIdSet = useMemo(() => new Set(visibleBills.map((bill) => bill.id)), [visibleBills])
  const selectedVisibleBillCount = useMemo(
    () => visibleBills.reduce((count, bill) => count + (selectedBillIds.includes(bill.id) ? 1 : 0), 0),
    [selectedBillIds, visibleBills]
  )
  const allVisibleSelected = visibleBills.length > 0 && visibleBills.every((bill) => selectedBillIds.includes(bill.id))

  useEffect(() => {
    setSelectedBillIds((current) => {
      const next = current.filter((billId) => visibleBillIdSet.has(billId))
      return next.length === current.length ? current : next
    })
  }, [visibleBillIdSet])

  const clearFilters = () => {
    setInvoiceNumber('')
    setPartyName('')
    setPartyAddress('')
    setPartyContact('')
    setDateFrom('')
    setDateTo('')
    setWeight('')
    setRate('')
    setFilterZeroRateBills(false)
    setPayable('')
  }

  const handleAutoFilters = () => {
    const today = new Date()
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

    let nextFrom = dateFrom || toDateInputValue(monthStart)
    let nextTo = dateTo || toDateInputValue(today)

    if (nextFrom > nextTo) {
      const tmp = nextFrom
      nextFrom = nextTo
      nextTo = tmp
    }

    setDateFrom(nextFrom)
    setDateTo(nextTo)
  }

  const handleView = (billId: string) => {
    const viewPath = companyId
      ? `/sales/view?billId=${billId}&companyId=${encodeURIComponent(companyId)}`
      : `/sales/view?billId=${billId}`
    router.push(viewPath)
  }

  const handleEdit = (billId: string) => {
    const editPath = companyId
      ? `/sales/entry?billId=${billId}&companyId=${encodeURIComponent(companyId)}`
      : `/sales/entry?billId=${billId}`
    router.push(editPath)
  }

  const handleCancel = async (billId: string) => {
    const bill = salesBills.find((row) => row.id === billId)
    if (!bill) return
    if (bill.status === 'cancelled') {
      alert('This bill is already cancelled.')
      return
    }

    if (!confirm('Are you sure you want to cancel this sales bill?')) {
      return
    }

    try {
      const response = await fetch('/api/sales-bills/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billId,
          companyId
        })
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        alert(payload.error || 'Failed to cancel sales bill.')
        return
      }

      alert('Sales bill cancelled successfully!')
      void fetchSalesBills()
    } catch (error) {
      console.error('Error cancelling sales bill:', error)
      alert(error instanceof Error ? error.message : 'Failed to cancel sales bill')
    }
  }

  const handlePrint = (billId: string) => {
    const printPath = companyId
      ? `/sales/${billId}/print?type=invoice&companyId=${encodeURIComponent(companyId)}`
      : `/sales/${billId}/print?type=invoice`
    router.push(printPath)
  }

  const handleToggleBillSelection = (billId: string) => {
    setSelectedBillIds((current) =>
      current.includes(billId) ? current.filter((value) => value !== billId) : [...current, billId]
    )
  }

  const handleToggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedBillIds((current) => current.filter((billId) => !visibleBillIdSet.has(billId)))
      return
    }

    setSelectedBillIds((current) => {
      const next = new Set(current)
      for (const bill of visibleBills) {
        next.add(bill.id)
      }
      return Array.from(next)
    })
  }

  const handleBulkPrint = () => {
    const selectedBills = visibleBills.filter((bill) => selectedBillIds.includes(bill.id))
    if (selectedBills.length === 0) {
      alert('Select at least one sales bill to bulk print')
      return
    }

    const params = new URLSearchParams()
    params.set('type', 'invoice')
    if (companyId) {
      params.set('companyId', companyId)
    }

    for (const bill of selectedBills) {
      params.append('selected', bill.id)
    }

    router.push(`/sales/bulk-print?${params.toString()}`)
  }

  const csvEscape = (value: string | number) => {
    const str = String(value ?? '')
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const downloadTextFile = (name: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const exportToExcel = () => {
    if (visibleBills.length === 0) {
      alert('No sales bills to export')
      return
    }

    const rows = [
      [
        'Invoice No',
        'Date',
        'Party',
        'No. of Bags',
        'Total Weight (Qt)',
        'Avg Rate',
        'Other Amount',
        'Insurance Amount',
        'Transport Name',
        'Lorry No',
        'Receivable',
        'Received',
        'Balance',
        'Status'
      ],
      ...visibleBills.map((bill) => {
        const transport = getPrimaryTransport(bill)
        return [
          bill.invoiceNo,
          formatDateSafe(bill.invoiceDate),
          bill.party.name,
          getBillTotalBags(bill).toFixed(2),
          getBillTotalWeight(bill).toFixed(2),
          getBillAverageRate(bill).toFixed(2),
          Number(transport?.otherAmount || 0).toFixed(2),
          Number(transport?.insuranceAmount || 0).toFixed(2),
          transport?.transportName || '-',
          transport?.lorryNo || '-',
          Number(bill.totalAmount || 0).toFixed(2),
          Number(bill.receivedAmount || 0).toFixed(2),
          Number(bill.balanceAmount || 0).toFixed(2),
          bill.status
        ]
      })
    ]

    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
    downloadTextFile(`sales-list-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8;')
  }

  const exportToPdf = () => {
    if (visibleBills.length === 0) {
      alert('No sales bills to export')
      return
    }
    const popup = window.open('', '_blank', 'width=1300,height=900')
    if (!popup) {
      alert('Please allow popups to export PDF')
      return
    }

    const bodyRows = visibleBills
      .map((bill) => {
        const transport = getPrimaryTransport(bill)
        return `<tr>
          <td>${bill.invoiceNo}</td>
          <td>${formatDateSafe(bill.invoiceDate)}</td>
          <td>${bill.party.name}</td>
          <td style=\"text-align:right\">${getBillTotalBags(bill).toFixed(2)}</td>
          <td style=\"text-align:right\">${getBillTotalWeight(bill).toFixed(2)}</td>
          <td style=\"text-align:right\">${getBillAverageRate(bill).toFixed(2)}</td>
          <td style=\"text-align:right\">${Number(transport?.otherAmount || 0).toFixed(2)}</td>
          <td style=\"text-align:right\">${Number(transport?.insuranceAmount || 0).toFixed(2)}</td>
          <td>${transport?.transportName || '-'}</td>
          <td>${transport?.lorryNo || '-'}</td>
          <td style=\"text-align:right\">₹${Number(bill.totalAmount || 0).toFixed(2)}</td>
          <td style=\"text-align:right\">₹${Number(bill.receivedAmount || 0).toFixed(2)}</td>
          <td style=\"text-align:right\">₹${Number(bill.balanceAmount || 0).toFixed(2)}</td>
          <td>${bill.status}</td>
        </tr>`
      })
      .join('')

    popup.document.write(`<!doctype html>
<html>
  <head>
    <title>Sales List</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 16px; }
      h1 { margin: 0 0 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border: 1px solid #d1d5db; padding: 6px; }
      th { background: #f3f4f6; text-align: left; }
    </style>
  </head>
  <body>
    <h1>Sales List</h1>
    <p>Generated: ${new Date().toLocaleString()}</p>
    <table>
      <thead>
        <tr>
          <th>Invoice</th><th>Date</th><th>Party</th><th>Bags</th><th>Weight</th><th>Rate</th><th>Other</th><th>Insurance</th><th>Transport</th><th>Lorry</th><th>Receivable</th><th>Received</th><th>Balance</th><th>Status</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </body>
</html>`)
    popup.document.close()
    popup.focus()
    popup.print()
  }

  const totalBills = visibleBills.length
  const totalAmount = useMemo(
    () => visibleBills.reduce((sum, bill) => sum + (bill.totalAmount || 0), 0),
    [visibleBills]
  )

  if (loading) {
    return (
      <AppLoaderShell
        kind="sales"
        companyId={companyId}
        title="Opening sales list"
        message="Collecting invoices, party filters, dispatch details, and print selections."
      />
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Sales List</h1>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="invoiceNumber">Invoice Number</Label>
                <Input
                  id="invoiceNumber"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Enter invoice number"
                />
              </div>
              <div>
                <Label htmlFor="partyName">Party Name</Label>
                <Input
                  id="partyName"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  placeholder="Enter party name"
                />
              </div>
              <div>
                <Label htmlFor="partyAddress">Party Address</Label>
                <Input
                  id="partyAddress"
                  value={partyAddress}
                  onChange={(e) => setPartyAddress(e.target.value)}
                  placeholder="Enter party address"
                />
              </div>
              <div>
                <Label htmlFor="partyContact">Party Contact</Label>
                <Input
                  id="partyContact"
                  value={partyContact}
                  onChange={(e) => setPartyContact(e.target.value)}
                  placeholder="Enter party contact"
                />
              </div>
              <div>
                <Label htmlFor="dateFrom">Date From</Label>
                <Input
                  id="dateFrom"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="dateTo">Date To</Label>
                <Input
                  id="dateTo"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="weight">Weight</Label>
                <Input
                  id="weight"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="Enter weight"
                />
              </div>
              <div>
                <Label htmlFor="rate">Rate</Label>
                <Input
                  id="rate"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="Enter rate"
                />
              </div>
              <div>
                <Label htmlFor="payable">Receivable</Label>
                <Input
                  id="payable"
                  value={payable}
                  onChange={(e) => setPayable(e.target.value)}
                  placeholder="Enter receivable amount"
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={filterZeroRateBills}
                  onChange={(event) => setFilterZeroRateBills(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                Filter zero rate bills
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={handleAutoFilters}>Auto</Button>
              <Button variant="outline" onClick={clearFilters}>Clear</Button>
              <Button variant="outline" onClick={exportToExcel}>
                <Download className="w-4 h-4 mr-2" />
                Excel
              </Button>
              <Button variant="outline" onClick={exportToPdf}>
                <FileText className="w-4 h-4 mr-2" />
                PDF
              </Button>
              <Button onClick={handleBulkPrint} disabled={selectedVisibleBillCount === 0}>
                <Printer className="mr-2 h-4 w-4" />
                Bulk Print / PDF
              </Button>
              <span className="text-sm text-slate-600">
                {selectedVisibleBillCount} selected
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Sales Bills Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle>Sales Bills</CardTitle>
              <Tabs defaultValue="active" className="w-full lg:w-auto">
                <TabsList className="w-full lg:w-auto">
                  <TabsTrigger value="active" onClick={() => setBillView('active')}>
                    Active ({activeBills.length})
                  </TabsTrigger>
                  <TabsTrigger value="paid" onClick={() => setBillView('paid')}>
                    Paid ({paidBills.length})
                  </TabsTrigger>
                  <TabsTrigger value="cancelled" onClick={() => setBillView('cancelled')}>
                    Cancelled ({cancelledBills.length})
                  </TabsTrigger>
                  <TabsTrigger value="all" onClick={() => setBillView('all')}>
                    All ({filteredBills.length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-600">
                {selectedVisibleBillCount} selected from current list
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={handleToggleSelectAllVisible}
                  disabled={visibleBills.length === 0}
                >
                  {allVisibleSelected ? 'Clear Visible Selection' : 'Select All Visible'}
                </Button>
                <Button onClick={handleBulkPrint} disabled={selectedVisibleBillCount === 0}>
                  <Printer className="mr-2 h-4 w-4" />
                  Bulk Print / PDF
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={handleToggleSelectAllVisible}
                        aria-label="Select all visible sales bills"
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </TableHead>
                    <TableHead>Invoice No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Party Name</TableHead>
                    <TableHead>Party Address</TableHead>
                    <TableHead>Party Contact</TableHead>
                    <TableHead>No. of Bags</TableHead>
                    <TableHead>Total Weight</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Other Amt</TableHead>
                    <TableHead>Insurance Amt</TableHead>
                    <TableHead>Transport</TableHead>
                    <TableHead>Receivable</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleBills.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={17} className="py-8 text-center text-gray-500">
                        No bills found in this tab.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleBills.map((bill) => (
                      <TableRow key={bill.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedBillIds.includes(bill.id)}
                            onChange={() => handleToggleBillSelection(bill.id)}
                            aria-label={`Select sales bill ${bill.invoiceNo || bill.id}`}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </TableCell>
                        <TableCell>{bill.invoiceNo || '-'}</TableCell>
                        <TableCell>{formatDateSafe(bill.invoiceDate)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span>{bill.party.name}</span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openWhatsappReminder(bill)}
                              disabled={!bill.party.phone1}
                              title="Open WhatsApp reminder"
                            >
                              <MessageCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>{bill.party.address}</TableCell>
                        <TableCell>{bill.party.phone1}</TableCell>
                        <TableCell>{getBillTotalBags(bill).toFixed(2)}</TableCell>
                        <TableCell>{getBillTotalWeight(bill).toFixed(2)}</TableCell>
                        <TableCell>{getBillAverageRate(bill).toFixed(2)}</TableCell>
                        <TableCell>₹{Number(getPrimaryTransport(bill)?.otherAmount || 0).toFixed(2)}</TableCell>
                        <TableCell>₹{Number(getPrimaryTransport(bill)?.insuranceAmount || 0).toFixed(2)}</TableCell>
                        <TableCell>{formatTransportCell(bill)}</TableCell>
                        <TableCell>₹{(bill.totalAmount || 0).toFixed(2)}</TableCell>
                        <TableCell>₹{(bill.receivedAmount || 0).toFixed(2)}</TableCell>
                        <TableCell>₹{(bill.balanceAmount || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={
                            bill.status === 'paid' ? 'default' :
                            bill.status === 'partial' ? 'secondary' :
                            bill.status === 'cancelled' ? 'outline' : 'destructive'
                          }>
                            {bill.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleView(bill.id)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {bill.status !== 'cancelled' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEdit(bill.id)}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            ) : null}
                            {bill.status !== 'cancelled' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleCancel(bill.id)}
                                title="Mark Cancelled"
                              >
                                <Ban className="w-4 h-4" />
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePrint(bill.id)}
                            >
                              <Printer className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Footer with totals */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between items-center">
              <div className="text-lg font-semibold">
                Total Bills: {totalBills}
              </div>
              <div className="text-lg font-semibold">
                Total Amount: ₹{totalAmount.toFixed(2)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
