'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Eye, Edit, Ban, Printer, FileText, Download, CreditCard } from 'lucide-react'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Farmer {
  id: string
  name?: string
  address?: string
  krashakAnubandhNumber?: string
}

interface Supplier {
  id: string
  name: string
  address: string
  gstNumber: string
}

interface PurchaseItem {
  bags: number
  qty: number
  rate: number
  hammali: number
  amount: number
  markaNo?: string | null
}

interface RawPurchaseItem {
  bags?: unknown
  qty?: unknown
  rate?: unknown
  hammali?: unknown
  amount?: unknown
  markaNo?: unknown
}

interface SpecialPurchaseItem {
  noOfBags: number
  weight: number
  rate: number
  netAmount: number
  otherAmount: number
  grossAmount: number
}

interface RawSpecialPurchaseItem {
  noOfBags?: unknown
  weight?: unknown
  rate?: unknown
  netAmount?: unknown
  otherAmount?: unknown
  grossAmount?: unknown
}

interface RegularPurchaseBill {
  id: string
  billNo: string
  billDate: string
  markaNo?: string | null
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  farmer?: Farmer | null
  farmerNameSnapshot?: string | null
  farmerAddressSnapshot?: string | null
  krashakAnubandhSnapshot?: string | null
  purchaseItems: PurchaseItem[]
  type: 'regular'
}

interface SpecialPurchaseBill {
  id: string
  supplierInvoiceNo: string
  billDate: string
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  supplier: Supplier
  specialPurchaseItems: SpecialPurchaseItem[]
  type: 'special'
}

interface RawRegularPurchaseBill {
  id?: unknown
  billNo?: unknown
  billDate?: unknown
  markaNo?: unknown
  totalAmount?: unknown
  paidAmount?: unknown
  balanceAmount?: unknown
  status?: unknown
  farmer?: Farmer | null
  farmerNameSnapshot?: string | null
  farmerAddressSnapshot?: string | null
  krashakAnubandhSnapshot?: string | null
  purchaseItems?: RawPurchaseItem[]
}

interface RawSpecialPurchaseBill {
  id?: unknown
  supplierInvoiceNo?: unknown
  billDate?: unknown
  totalAmount?: unknown
  paidAmount?: unknown
  balanceAmount?: unknown
  status?: unknown
  supplier?: Supplier
  specialPurchaseItems?: RawSpecialPurchaseItem[]
}

type PurchaseBill = RegularPurchaseBill | SpecialPurchaseBill
type BillViewTab = 'active' | 'paid' | 'cancelled' | 'all'
type PurchaseTypeFilter = 'all' | 'regular' | 'special'

const clampNonNegative = (value: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

const normalizeBillFinancials = (totalRaw: unknown, paidRaw: unknown, balanceRaw: unknown, statusRaw: unknown) => {
  const totalAmount = clampNonNegative(Number(totalRaw || 0))
  const paidAmount = clampNonNegative(Number(paidRaw || 0))
  const normalizedStatus = String(statusRaw || '').trim().toLowerCase()
  const balanceAmount =
    normalizedStatus === 'cancelled'
      ? clampNonNegative(Number(balanceRaw || 0))
      : Math.max(0, totalAmount - paidAmount)
  const status = normalizedStatus === 'cancelled'
    ? 'cancelled'
    : balanceAmount === 0
      ? 'paid'
      : paidAmount <= 0
        ? 'unpaid'
        : 'partial'

  return { totalAmount, paidAmount, balanceAmount, status }
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

function normalizeFilterText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function getRegularFarmerName(bill: RegularPurchaseBill): string {
  return String(bill.farmerNameSnapshot || bill.farmer?.name || 'Unknown Farmer')
}

function getRegularFarmerAddress(bill: RegularPurchaseBill): string {
  return String(bill.farmerAddressSnapshot || bill.farmer?.address || '')
}

function getRegularAnubandh(bill: RegularPurchaseBill): string {
  return String(bill.krashakAnubandhSnapshot || bill.farmer?.krashakAnubandhNumber || '')
}

function getBillMarka(bill: PurchaseBill): string {
  if (bill.type !== 'regular') return ''
  const markas = bill.purchaseItems
    .map((item) => String(item.markaNo || '').trim())
    .filter(Boolean)

  if (markas.length === 0) {
    return String(bill.markaNo || '')
  }

  return Array.from(new Set(markas)).join(', ')
}

function getBillSelectionKey(bill: PurchaseBill): string {
  return `${bill.type}:${bill.id}`
}

export default function PurchaseListPage() {
  const router = useRouter()
  const [purchaseBills, setPurchaseBills] = useState<PurchaseBill[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState('')
  const [billView, setBillView] = useState<BillViewTab>('active')
  const [selectedBillKeys, setSelectedBillKeys] = useState<string[]>([])

  // Filter states
  const [billNumber, setBillNumber] = useState('')
  const [partyName, setPartyName] = useState('')
  const [partyAddress, setPartyAddress] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [weight, setWeight] = useState('')
  const [rate, setRate] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [payable, setPayable] = useState('')
  const [markaNumber, setMarkaNumber] = useState('')
  const [purchaseType, setPurchaseType] = useState<PurchaseTypeFilter>('all')

  const fetchPurchaseBills = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const companyIdParam = await resolveCompanyId(window.location.search)
      if (isCancelled()) return

      if (!companyIdParam) {
        alert('Company not selected')
        router.push('/company/select')
        return
      }

      setCompanyId(companyIdParam)
      stripCompanyParamsFromUrl()

      const cacheKey = `purchase-bills:${companyIdParam}`
      const cached = getClientCache<PurchaseBill[]>(cacheKey, 15_000)
      if (cached) {
        setPurchaseBills(cached)
        setLoading(false)
      }

      // Fetch both regular and special purchase bills
      const [regularResponse, specialResponse] = await Promise.all([
        fetch(`/api/purchase-bills?companyId=${companyIdParam}&includeCancelled=true`),
        fetch(`/api/special-purchase-bills?companyId=${companyIdParam}&includeCancelled=true`)
      ])
      if (isCancelled()) return

      if (regularResponse.status === 401 || specialResponse.status === 401) {
        setLoading(false)
        router.push('/login')
        return
      }

      if (regularResponse.status === 403 || specialResponse.status === 403) {
        setPurchaseBills([])
        setLoading(false)
        return
      }

      const regularRaw = await regularResponse.json().catch(() => [])
      const specialRaw = await specialResponse.json().catch(() => [])
      if (isCancelled()) return
      const regularData = Array.isArray(regularRaw) ? (regularRaw as RawRegularPurchaseBill[]) : []
      const specialData = Array.isArray(specialRaw) ? (specialRaw as RawSpecialPurchaseBill[]) : []

      // Add type field to distinguish between regular and special purchases
      const regularBills: RegularPurchaseBill[] = regularData.map((bill) => {
        const normalized = normalizeBillFinancials(
          bill?.totalAmount,
          bill?.paidAmount,
          bill?.balanceAmount,
          bill?.status
        )
        return {
          id: String(bill.id || ''),
          billNo: String(bill.billNo || ''),
          billDate: String(bill.billDate || ''),
          markaNo: typeof bill.markaNo === 'string' ? bill.markaNo : null,
          ...normalized,
          farmer: bill.farmer || null,
          farmerNameSnapshot: bill.farmerNameSnapshot || null,
          farmerAddressSnapshot: bill.farmerAddressSnapshot || null,
          krashakAnubandhSnapshot: bill.krashakAnubandhSnapshot || null,
          purchaseItems: Array.isArray(bill?.purchaseItems)
            ? bill.purchaseItems.map((item) => ({
                bags: clampNonNegative(Number(item?.bags || 0)),
                qty: clampNonNegative(Number(item?.qty || 0)),
                rate: clampNonNegative(Number(item?.rate || 0)),
                hammali: clampNonNegative(Number(item?.hammali || 0)),
                amount: clampNonNegative(Number(item?.amount || 0)),
                markaNo: typeof item?.markaNo === 'string' ? item.markaNo : null
              }))
            : [],
          type: 'regular' as const
        }
      })
      const specialBills: SpecialPurchaseBill[] = specialData.map((bill) => {
        const normalized = normalizeBillFinancials(
          bill?.totalAmount,
          bill?.paidAmount,
          bill?.balanceAmount,
          bill?.status
        )
        return {
          id: String(bill.id || ''),
          supplierInvoiceNo: String(bill.supplierInvoiceNo || ''),
          billDate: String(bill.billDate || ''),
          ...normalized,
          supplier: bill.supplier || {
            id: '',
            name: '',
            address: '',
            gstNumber: ''
          },
          specialPurchaseItems: Array.isArray(bill?.specialPurchaseItems)
            ? bill.specialPurchaseItems.map((item) => ({
                noOfBags: clampNonNegative(Number(item?.noOfBags || 0)),
                weight: clampNonNegative(Number(item?.weight || 0)),
                rate: clampNonNegative(Number(item?.rate || 0)),
                netAmount: clampNonNegative(Number(item?.netAmount || 0)),
                otherAmount: clampNonNegative(Number(item?.otherAmount || 0)),
                grossAmount: clampNonNegative(Number(item?.grossAmount || 0))
              }))
            : [],
          type: 'special' as const
        }
      })

      // Combine both arrays and sort by date (newest first)
      const allBills = [...regularBills, ...specialBills].sort((a, b) => 
        new Date(b.billDate).getTime() - new Date(a.billDate).getTime()
      )

      setPurchaseBills(allBills)
      setClientCache(cacheKey, allBills)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching purchase bills:', error)
      setPurchaseBills([])
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await fetchPurchaseBills(() => cancelled)
    })()
    return () => {
      cancelled = true
    }
  }, [fetchPurchaseBills])

  const filteredBills = (() => {
    let filtered = purchaseBills

    // Filter by purchase type
    if (purchaseType !== 'all') {
      filtered = filtered.filter(bill => bill.type === purchaseType)
    }

    if (billNumber) {
      const normalizedBillNumber = normalizeFilterText(billNumber)
      filtered = filtered.filter(bill => {
        const billNo = bill.type === 'regular' ? bill.billNo : bill.supplierInvoiceNo
        return normalizeFilterText(billNo).includes(normalizedBillNumber)
      })
    }

    if (partyName) {
      const normalizedPartyName = normalizeFilterText(partyName)
      filtered = filtered.filter(bill => {
        const partyNameValue = bill.type === 'regular'
          ? getRegularFarmerName(bill)
          : bill.supplier?.name
        return normalizeFilterText(partyNameValue).includes(normalizedPartyName)
      })
    }

    if (partyAddress) {
      const normalizedPartyAddress = normalizeFilterText(partyAddress)
      filtered = filtered.filter(bill => {
        const partyAddressValue = bill.type === 'regular'
          ? getRegularFarmerAddress(bill)
          : bill.supplier?.address
        return normalizeFilterText(partyAddressValue).includes(normalizedPartyAddress)
      })
    }

    if (dateFrom) {
      const fromDate = startOfDay(dateFrom)
      if (!fromDate) return filtered
      filtered = filtered.filter((bill) => {
        const billDate = parseDateOrNull(bill.billDate)
        if (!billDate) return false
        return billDate >= fromDate
      })
    }

    if (dateTo) {
      const toDate = endOfDay(dateTo)
      if (!toDate) return filtered
      filtered = filtered.filter((bill) => {
        const billDate = parseDateOrNull(bill.billDate)
        if (!billDate) return false
        return billDate <= toDate
      })
    }

    if (weight) {
      filtered = filtered.filter(bill => {
        if (bill.type === 'regular') {
          return bill.purchaseItems.some(item => item.qty.toString().includes(weight))
        } else {
          return bill.specialPurchaseItems.some(item => item.weight.toString().includes(weight))
        }
      })
    }

    if (rate) {
      filtered = filtered.filter(bill => {
        if (bill.type === 'regular') {
          return bill.purchaseItems.some(item => item.rate.toString().includes(rate))
        } else {
          return bill.specialPurchaseItems.some(item => item.rate.toString().includes(rate))
        }
      })
    }

    if (registrationNumber) {
      const normalizedRegistrationNumber = normalizeFilterText(registrationNumber)
      filtered = filtered.filter(bill => {
        if (bill.type === 'regular') {
          return normalizeFilterText(getRegularAnubandh(bill)).includes(normalizedRegistrationNumber)
        } else {
          return normalizeFilterText(bill.supplier?.gstNumber).includes(normalizedRegistrationNumber)
        }
      })
    }

    if (markaNumber) {
      const normalizedMarka = normalizeFilterText(markaNumber)
      filtered = filtered.filter((bill) => normalizeFilterText(getBillMarka(bill)).includes(normalizedMarka))
    }

    if (payable) {
      filtered = filtered.filter(bill => bill.totalAmount.toString().includes(payable))
    }

    return filtered
  })()

  const paidBills = filteredBills.filter((bill) => bill.status === 'paid')
  const cancelledBills = filteredBills.filter((bill) => bill.status === 'cancelled')
  const activeBills = filteredBills.filter((bill) => bill.status !== 'paid' && bill.status !== 'cancelled')
  const visibleBills =
    billView === 'paid'
      ? paidBills
      : billView === 'cancelled'
        ? cancelledBills
        : billView === 'all'
          ? filteredBills
          : activeBills

  const selectedBillKeySet = new Set(selectedBillKeys)
  const visibleBillKeySet = new Set(visibleBills.map((bill) => getBillSelectionKey(bill)))
  const selectedVisibleBillCount = visibleBills.reduce(
    (count, bill) => count + (selectedBillKeySet.has(getBillSelectionKey(bill)) ? 1 : 0),
    0
  )
  const allVisibleSelected =
    visibleBills.length > 0 && visibleBills.every((bill) => selectedBillKeySet.has(getBillSelectionKey(bill)))

  useEffect(() => {
    setSelectedBillKeys((current) => {
      const next = current.filter((key) => visibleBillKeySet.has(key))
      return next.length === current.length ? current : next
    })
  }, [visibleBills])

  const clearFilters = () => {
    setBillNumber('')
    setPartyName('')
    setPartyAddress('')
    setDateFrom('')
    setDateTo('')
    setWeight('')
    setRate('')
    setRegistrationNumber('')
    setPayable('')
    setMarkaNumber('')
    setPurchaseType('all')
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

  const handleView = (bill: PurchaseBill) => {
    if (bill.type === 'regular') {
      const path = companyId
        ? `/purchase/view?billId=${bill.id}&companyId=${encodeURIComponent(companyId)}`
        : `/purchase/view?billId=${bill.id}`
      router.push(path)
    } else {
      const path = companyId
        ? `/purchase/special-view?billId=${bill.id}&companyId=${encodeURIComponent(companyId)}`
        : `/purchase/special-view?billId=${bill.id}`
      router.push(path)
    }
  }

  const handleEdit = (bill: PurchaseBill) => {
    if (bill.type === 'regular') {
      const path = companyId
        ? `/purchase/edit?billId=${bill.id}&companyId=${encodeURIComponent(companyId)}`
        : `/purchase/edit?billId=${bill.id}`
      router.push(path)
    } else {
      const path = companyId
        ? `/purchase/special-edit?billId=${bill.id}&companyId=${encodeURIComponent(companyId)}`
        : `/purchase/special-edit?billId=${bill.id}`
      router.push(path)
    }
  }

  const handlePayment = (bill: PurchaseBill) => {
    const path = companyId
      ? `/payment/purchase/entry?billId=${bill.id}&companyId=${encodeURIComponent(companyId)}`
      : `/payment/purchase/entry?billId=${bill.id}`
    router.push(path)
  }

  const handleCancel = async (bill: PurchaseBill) => {
    if (bill.status === 'cancelled') {
      alert('This bill is already cancelled.')
      return
    }

    const billTypeLabel = bill.type === 'regular' ? 'purchase' : 'special purchase'
    if (!confirm(`Are you sure you want to cancel this ${billTypeLabel} bill?`)) {
      return
    }

    try {
      const apiUrl = bill.type === 'regular' ? '/api/purchase-bills/cancel' : '/api/special-purchase-bills/cancel'
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          billId: bill.id,
          companyId
        })
      })

      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        alert(payload.error || 'Failed to cancel bill.')
        return
      }

      alert(`${bill.type === 'regular' ? 'Purchase' : 'Special Purchase'} bill cancelled successfully!`)
      void fetchPurchaseBills()
    } catch (error) {
      console.error('Error cancelling bill:', error)
      alert(error instanceof Error ? error.message : 'Failed to cancel bill')
    }
  }

  const handlePrint = (bill: PurchaseBill) => {
    if (bill.type === 'regular') {
      const printPath = companyId
        ? `/purchase/${bill.id}/print?companyId=${encodeURIComponent(companyId)}`
        : `/purchase/${bill.id}/print`
      router.push(printPath)
      return
    }
    const specialPrintPath = companyId
      ? `/purchase/special/${bill.id}/print?companyId=${encodeURIComponent(companyId)}`
      : `/purchase/special/${bill.id}/print`
    router.push(specialPrintPath)
  }

  const handleToggleBillSelection = (bill: PurchaseBill) => {
    const key = getBillSelectionKey(bill)
    setSelectedBillKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    )
  }

  const handleToggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedBillKeys((current) => current.filter((key) => !visibleBillKeySet.has(key)))
      return
    }

    setSelectedBillKeys((current) => {
      const next = new Set(current)
      for (const bill of visibleBills) {
        next.add(getBillSelectionKey(bill))
      }
      return Array.from(next)
    })
  }

  const handleBulkPrint = () => {
    const selectedBills = visibleBills.filter((bill) => selectedBillKeySet.has(getBillSelectionKey(bill)))
    if (selectedBills.length === 0) {
      alert('Select at least one purchase bill to bulk print')
      return
    }

    const params = new URLSearchParams()
    if (companyId) {
      params.set('companyId', companyId)
    }

    for (const bill of selectedBills) {
      params.append('selected', getBillSelectionKey(bill))
    }

    router.push(`/purchase/bulk-print?${params.toString()}`)
  }

  const getBillWeightQt = (bill: PurchaseBill) => {
    if (bill.type === 'regular') {
      return bill.purchaseItems.reduce((sum, item) => sum + Number(item.qty || 0), 0)
    }
    return bill.specialPurchaseItems.reduce((sum, item) => sum + Number(item.weight || 0), 0)
  }

  const getBillBags = (bill: PurchaseBill) => {
    if (bill.type === 'regular') {
      return bill.purchaseItems.reduce((sum, item) => sum + Number(item.bags || 0), 0)
    }
    return bill.specialPurchaseItems.reduce((sum, item) => sum + Number(item.noOfBags || 0), 0)
  }

  const getBillRate = (bill: PurchaseBill) => {
    if (bill.type === 'regular') {
      return bill.purchaseItems.length > 0 ? Number(bill.purchaseItems[0].rate || 0) : 0
    }
    return bill.specialPurchaseItems.length > 0 ? Number(bill.specialPurchaseItems[0].rate || 0) : 0
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
      alert('No purchase bills to export')
      return
    }

    const rows = [
      [
        'Type',
        'Bill/Invoice No',
        'Date',
        'Party Name',
        'Party Address',
        'Krashak Anubandh Number',
        'Marka',
        'Bags',
        'Weight (Qt)',
        'Rate',
        'Payable',
        'Paid',
        'Balance',
        'Status'
      ],
      ...visibleBills.map((bill) => [
        bill.type === 'regular' ? 'Farmer' : 'Supplier',
        bill.type === 'regular' ? bill.billNo : bill.supplierInvoiceNo,
        new Date(bill.billDate).toLocaleDateString(),
        bill.type === 'regular' ? getRegularFarmerName(bill) : bill.supplier.name,
        bill.type === 'regular' ? getRegularFarmerAddress(bill) : bill.supplier.address,
        bill.type === 'regular' ? getRegularAnubandh(bill) : bill.supplier.gstNumber,
        getBillMarka(bill),
        getBillBags(bill).toFixed(0),
        getBillWeightQt(bill).toFixed(2),
        getBillRate(bill).toFixed(2),
        Number(bill.totalAmount || 0).toFixed(2),
        Number(bill.paidAmount || 0).toFixed(2),
        Number(bill.balanceAmount || 0).toFixed(2),
        bill.status
      ])
    ]
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
    downloadTextFile(`purchase-list-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8;')
  }

  const exportToPdf = () => {
    if (visibleBills.length === 0) {
      alert('No purchase bills to export')
      return
    }
    const popup = window.open('', '_blank', 'width=1200,height=900')
    if (!popup) {
      alert('Please allow popups to export PDF')
      return
    }

    const bodyRows = visibleBills
      .map((bill) => {
        const billNo = bill.type === 'regular' ? bill.billNo : bill.supplierInvoiceNo
        const partyName = bill.type === 'regular' ? getRegularFarmerName(bill) : bill.supplier.name
        return `<tr>
          <td>${bill.type === 'regular' ? 'Farmer' : 'Supplier'}</td>
          <td>${billNo}</td>
          <td>${new Date(bill.billDate).toLocaleDateString()}</td>
          <td>${partyName}</td>
          <td>${getBillMarka(bill)}</td>
          <td style="text-align:right">${getBillBags(bill).toFixed(0)}</td>
          <td style="text-align:right">${getBillWeightQt(bill).toFixed(2)}</td>
          <td style="text-align:right">${getBillRate(bill).toFixed(2)}</td>
          <td style="text-align:right">₹${Number(bill.totalAmount || 0).toFixed(2)}</td>
          <td style="text-align:right">₹${Number(bill.paidAmount || 0).toFixed(2)}</td>
          <td style="text-align:right">₹${Number(bill.balanceAmount || 0).toFixed(2)}</td>
          <td>${bill.status}</td>
        </tr>`
      })
      .join('')

    popup.document.write(`<!doctype html>
<html>
  <head>
    <title>Purchase List</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 16px; }
      h1 { margin: 0 0 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 6px; }
      th { background: #f3f4f6; text-align: left; }
    </style>
  </head>
  <body>
    <h1>Purchase List</h1>
    <p>Generated: ${new Date().toLocaleString()}</p>
    <table>
      <thead>
        <tr>
          <th>Type</th><th>Bill</th><th>Date</th><th>Party</th><th>Marka</th><th>Bags</th><th>Weight (Qt)</th><th>Rate</th><th>Payable</th><th>Paid</th><th>Balance</th><th>Status</th>
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
  const totalAmount = visibleBills.reduce((sum, bill) => sum + bill.totalAmount, 0)
  const regularBillsCount = visibleBills.filter((bill) => bill.type === 'regular').length
  const specialBillsCount = visibleBills.filter((bill) => bill.type === 'special').length
  const totalBags = visibleBills.reduce((sum, bill) => sum + getBillBags(bill), 0)
  const totalWeightQt = visibleBills.reduce((sum, bill) => sum + getBillWeightQt(bill), 0)
  const totalWeightKg = totalWeightQt * 100

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
          <h1 className="text-3xl font-bold">Purchase List</h1>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="purchaseType">Purchase Type</Label>
                <Select value={purchaseType} onValueChange={(value: PurchaseTypeFilter) => setPurchaseType(value)}>
                  <SelectTrigger id="purchaseType">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Purchases</SelectItem>
                    <SelectItem value="regular">Regular Purchase (Farmers)</SelectItem>
                    <SelectItem value="special">Special Purchase (Suppliers)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="billNumber">Bill/Invoice Number</Label>
                <Input
                  id="billNumber"
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                  placeholder="Enter bill or invoice number"
                />
              </div>
              <div>
                <Label htmlFor="partyName">Party Name</Label>
                <Input
                  id="partyName"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  placeholder="Enter farmer or supplier name"
                />
              </div>
              <div>
                <Label htmlFor="partyAddress">Party Address</Label>
                <Input
                  id="partyAddress"
                  value={partyAddress}
                  onChange={(e) => setPartyAddress(e.target.value)}
                  placeholder="Enter address"
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
                <Label htmlFor="registrationNumber">
                  {purchaseType === 'special' ? 'GST Number' : 'Krashak Anubandh Number'}
                </Label>
                <Input
                  id="registrationNumber"
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  placeholder={purchaseType === 'special' ? 'Enter GST number' : 'Enter Krashak Anubandh Number'}
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
              <div>
                <Label htmlFor="markaNumber">Marka Filter</Label>
                <Input
                  id="markaNumber"
                  value={markaNumber}
                  onChange={(e) => setMarkaNumber(e.target.value.toUpperCase())}
                  placeholder="Filter by marka"
                />
              </div>
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

        {/* Purchase Bills Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle>Purchase Bills</CardTitle>
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
                        aria-label="Select all visible purchase bills"
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Bill/Invoice No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Party Name</TableHead>
                    <TableHead>Party Address</TableHead>
                    <TableHead>Krashak Anubandh Number</TableHead>
                    <TableHead>Marka</TableHead>
                    <TableHead>Bags</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Payable</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleBills.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={16} className="py-8 text-center text-gray-500">
                        No bills found in this tab.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleBills.map((bill) => (
                      <TableRow key={bill.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedBillKeySet.has(getBillSelectionKey(bill))}
                            onChange={() => handleToggleBillSelection(bill)}
                            aria-label={`Select purchase bill ${bill.type === 'regular' ? bill.billNo : bill.supplierInvoiceNo}`}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant={bill.type === 'regular' ? 'default' : 'secondary'}>
                            {bill.type === 'regular' ? 'Farmer' : 'Supplier'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {bill.type === 'regular' ? bill.billNo : bill.supplierInvoiceNo}
                        </TableCell>
                        <TableCell>{new Date(bill.billDate).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {bill.type === 'regular' ? getRegularFarmerName(bill) : bill.supplier.name}
                        </TableCell>
                        <TableCell>
                          {bill.type === 'regular' ? getRegularFarmerAddress(bill) : bill.supplier.address}
                        </TableCell>
                        <TableCell>
                          {bill.type === 'regular'
                            ? getRegularAnubandh(bill)
                            : bill.supplier.gstNumber
                          }
                        </TableCell>
                        <TableCell>{getBillMarka(bill) || '-'}</TableCell>
                        <TableCell>
                          {getBillBags(bill).toFixed(0)}
                        </TableCell>
                        <TableCell>
                          {getBillWeightQt(bill).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {getBillRate(bill).toFixed(2)}
                        </TableCell>
                        <TableCell>₹{bill.totalAmount.toFixed(2)}</TableCell>
                        <TableCell>₹{bill.paidAmount.toFixed(2)}</TableCell>
                        <TableCell>₹{bill.balanceAmount.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={
                            bill.status === 'paid' ? 'default' :
                            (bill.status === 'partial' || bill.status === 'partially_paid') ? 'secondary' :
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
                              onClick={() => handleView(bill)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {bill.status !== 'cancelled' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEdit(bill)}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            ) : null}
                            {bill.status !== 'cancelled' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleCancel(bill)}
                                title="Mark Cancelled"
                              >
                                <Ban className="w-4 h-4" />
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handlePrint(bill)}
                            >
                              <Printer className="w-4 h-4" />
                            </Button>
                            {bill.status !== 'cancelled' && bill.balanceAmount > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handlePayment(bill)}
                                title="Record Payment"
                              >
                                <CreditCard className="w-4 h-4" />
                              </Button>
                            )}
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-sm text-gray-600">Total Bills</div>
                <div className="text-lg font-semibold">{totalBills}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600">Regular Purchase</div>
                <div className="text-lg font-semibold">{regularBillsCount}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600">Special Purchase</div>
                <div className="text-lg font-semibold">{specialBillsCount}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-gray-600">Total Amount</div>
                <div className="text-lg font-semibold">₹{totalAmount.toFixed(2)}</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="text-center">
                  <div className="text-sm text-gray-600">Total Bags</div>
                  <div className="text-lg font-semibold">{totalBags.toFixed(0)}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-gray-600">Total Weight</div>
                  <div className="text-lg font-semibold">{totalWeightQt.toFixed(2)} qt</div>
                  <div className="text-xs text-gray-500">{totalWeightKg.toFixed(2)} kg</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
