'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Eye, Edit, Trash2, Printer, FileText, Download } from 'lucide-react'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { isAbortError } from '@/lib/http'

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

const clampNonNegative = (value: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function normalizeSalesBill(raw: any): SalesBill {
  return {
    id: String(raw?.id || ''),
    invoiceNo: String(raw?.invoiceNo || raw?.billNo || ''),
    invoiceDate: String(raw?.invoiceDate || raw?.billDate || ''),
    totalAmount: clampNonNegative(Number(raw?.totalAmount || 0)),
    receivedAmount: clampNonNegative(Number(raw?.receivedAmount || 0)),
    balanceAmount: clampNonNegative(Number(raw?.balanceAmount || 0)),
    status: String(raw?.status || 'unpaid'),
    party: {
      name: String(raw?.party?.name || ''),
      address: String(raw?.party?.address || ''),
      phone1: String(raw?.party?.phone1 || '')
    },
    salesItems: Array.isArray(raw?.salesItems)
      ? raw.salesItems.map((item: any) => ({
          weight: clampNonNegative(Number(item?.weight || item?.qty || 0)),
          qty: clampNonNegative(Number(item?.qty || item?.weight || 0)),
          bags: clampNonNegative(Number(item?.bags || 0)),
          rate: clampNonNegative(Number(item?.rate || 0)),
          amount: clampNonNegative(Number(item?.amount || 0)),
          product: item?.product ? { name: String(item.product.name || '') } : undefined
        }))
      : [],
    transportBills: Array.isArray(raw?.transportBills)
      ? raw.transportBills.map((item: any) => ({
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

function getPrimaryTransport(bill: SalesBill) {
  return bill.transportBills[0] || null
}

export default function SalesListPage() {
  const router = useRouter()
  const [salesBills, setSalesBills] = useState<SalesBill[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState('')

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

      const response = await fetch(`/api/sales-bills?companyId=${companyIdParam}`)
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

    if (payable) {
      filtered = filtered.filter(bill => bill.totalAmount.toString().includes(payable))
    }

    return filtered
  }, [salesBills, invoiceNumber, partyName, partyAddress, dateFrom, dateTo, weight, rate, partyContact, payable])

  const clearFilters = () => {
    setInvoiceNumber('')
    setPartyName('')
    setPartyAddress('')
    setPartyContact('')
    setDateFrom('')
    setDateTo('')
    setWeight('')
    setRate('')
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

  const handleDelete = (billId: string) => {
    // Find the bill to check its date
    const bill = salesBills.find(b => b.id === billId)
    if (!bill) return

    // Check if bill is within 15 days from today
    if (!isValidDateValue(bill.invoiceDate)) {
      alert('Invalid bill date. Please edit and save this bill first.')
      return
    }
    const billDate = new Date(bill.invoiceDate)
    const currentDate = new Date()
    const daysDifference = Math.floor((currentDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24))

    if (daysDifference > 15) {
      alert(`Cannot delete bill. Bill is older than 15 days. Bill age: ${daysDifference} days. Only bills within 15 days can be deleted.`)
      return
    }

    if (confirm('Are you sure you want to delete this bill? This action cannot be undone.')) {
      deleteBill(billId)
    }
  }

  const deleteBill = async (billId: string) => {
    try {
      const response = await fetch(`/api/sales-bills?billId=${billId}&companyId=${companyId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        alert('Sales bill deleted successfully!')
        void fetchSalesBills() // Refresh the list
      } else {
        const errorData = await response.json()
        alert('Error deleting sales bill: ' + (errorData.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Error deleting sales bill:', error)
      alert('Error deleting sales bill: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handlePrint = (billId: string) => {
    const printPath = companyId
      ? `/sales/${billId}/print?type=invoice&companyId=${encodeURIComponent(companyId)}`
      : `/sales/${billId}/print?type=invoice`
    router.push(printPath)
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
    if (filteredBills.length === 0) {
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
        'Payable',
        'Received',
        'Balance',
        'Status'
      ],
      ...filteredBills.map((bill) => {
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
    if (filteredBills.length === 0) {
      alert('No sales bills to export')
      return
    }
    const popup = window.open('', '_blank', 'width=1300,height=900')
    if (!popup) {
      alert('Please allow popups to export PDF')
      return
    }

    const bodyRows = filteredBills
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
          <th>Invoice</th><th>Date</th><th>Party</th><th>Bags</th><th>Weight</th><th>Rate</th><th>Other</th><th>Insurance</th><th>Transport</th><th>Lorry</th><th>Payable</th><th>Received</th><th>Balance</th><th>Status</th>
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

  const totalBills = filteredBills.length
  const totalAmount = useMemo(
    () => filteredBills.reduce((sum, bill) => sum + (bill.totalAmount || 0), 0),
    [filteredBills]
  )

  if (loading) {
    return (
      <DashboardLayout companyId={companyId}>
        <div className="flex justify-center items-center h-64">
          <div className="text-lg">Loading...</div>
        </div>
      </DashboardLayout>
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
                <Label htmlFor="payable">Payable</Label>
                <Input
                  id="payable"
                  value={payable}
                  onChange={(e) => setPayable(e.target.value)}
                  placeholder="Enter payable amount"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
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
            </div>
          </CardContent>
        </Card>

        {/* Sales Bills Table */}
        <Card>
          <CardHeader>
            <CardTitle>Sales Bills</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
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
                    <TableHead>Payable</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBills.map((bill) => (
                    <TableRow key={bill.id}>
                      <TableCell>{bill.invoiceNo || '-'}</TableCell>
                      <TableCell>{formatDateSafe(bill.invoiceDate)}</TableCell>
                      <TableCell>{bill.party.name}</TableCell>
                      <TableCell>{bill.party.address}</TableCell>
                      <TableCell>{bill.party.phone1}</TableCell>
                      <TableCell>{getBillTotalBags(bill).toFixed(2)}</TableCell>
                      <TableCell>{getBillTotalWeight(bill).toFixed(2)}</TableCell>
                      <TableCell>{getBillAverageRate(bill).toFixed(2)}</TableCell>
                      <TableCell>₹{Number(getPrimaryTransport(bill)?.otherAmount || 0).toFixed(2)}</TableCell>
                      <TableCell>₹{Number(getPrimaryTransport(bill)?.insuranceAmount || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        {getPrimaryTransport(bill)
                          ? `${getPrimaryTransport(bill)?.transportName || '-'} / ${getPrimaryTransport(bill)?.lorryNo || '-'}`
                          : '-'}
                      </TableCell>
                      <TableCell>₹{(bill.totalAmount || 0).toFixed(2)}</TableCell>
                      <TableCell>₹{(bill.receivedAmount || 0).toFixed(2)}</TableCell>
                      <TableCell>₹{(bill.balanceAmount || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={
                          bill.status === 'paid' ? 'default' :
                          bill.status === 'partial' ? 'secondary' : 'destructive'
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(bill.id)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(bill.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
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
                  ))}
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
