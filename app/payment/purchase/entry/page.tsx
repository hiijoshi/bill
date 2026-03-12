'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CreditCard, DollarSign, Search } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface PurchaseBill {
  id: string
  billNo: string
  billDate: string
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  farmer?: {
    id: string
    name: string
    address: string
    phone1: string
  } | null
  supplier?: {
    id: string
    name: string
    address: string
    phone1: string
  } | null
}

type PartyBillGroup = {
  partyKey: string
  partyName: string
  bills: PurchaseBill[]
  totalPending: number
}

type AllocationPreviewRow = {
  billId: string
  billNo: string
  billDate: string
  balanceBefore: number
  allocatedAmount: number
  balanceAfter: number
}

function formatDateSafe(value: string): string {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString() : '-'
}

function formatAmount(value: number): string {
  return `Rs ${Math.max(0, Number(value) || 0).toFixed(2)}`
}

function getBillPartyName(bill: PurchaseBill): string {
  return bill.supplier?.name || bill.farmer?.name || 'Unknown'
}

function getBillPartyPhone(bill: PurchaseBill): string {
  return bill.supplier?.phone1 || bill.farmer?.phone1 || 'N/A'
}

function getBillPartyKey(bill: PurchaseBill): string {
  if (bill.supplier?.id) return `supplier:${bill.supplier.id}`
  if (bill.farmer?.id) return `farmer:${bill.farmer.id}`
  return `name:${getBillPartyName(bill).trim().toLowerCase()}`
}

function normalizePaymentStatus(status: string): string {
  const normalized = (status || '').toLowerCase()
  if (normalized === 'paid') return 'paid'
  if (normalized === 'partial' || normalized === 'partially_paid' || normalized === 'partially-paid') {
    return 'partial'
  }
  return 'unpaid'
}

function getStatusBadgeClass(status: string): string {
  const normalized = normalizePaymentStatus(status)
  if (normalized === 'paid') return 'bg-green-100 text-green-800'
  if (normalized === 'partial') return 'bg-yellow-100 text-yellow-800'
  return 'bg-red-100 text-red-800'
}

function getSortedOldestFirstBills(bills: PurchaseBill[]): PurchaseBill[] {
  return bills.slice().sort((a, b) => {
    const dateA = new Date(a.billDate).getTime()
    const dateB = new Date(b.billDate).getTime()

    if (dateA !== dateB) return dateA - dateB
    return Number(a.balanceAmount || 0) - Number(b.balanceAmount || 0)
  })
}

function buildAllocationPreview(bills: PurchaseBill[], enteredAmount: number): AllocationPreviewRow[] {
  const sortedBills = getSortedOldestFirstBills(bills)
  const rows: AllocationPreviewRow[] = []
  let remaining = Number.isFinite(enteredAmount) ? Math.max(0, enteredAmount) : 0

  for (const bill of sortedBills) {
    const balanceBefore = Number(bill.balanceAmount || 0)
    const allocatedAmount = remaining > 0 ? Math.min(remaining, balanceBefore) : 0
    const balanceAfter = Math.max(0, balanceBefore - allocatedAmount)

    rows.push({
      billId: bill.id,
      billNo: bill.billNo,
      billDate: bill.billDate,
      balanceBefore,
      allocatedAmount,
      balanceAfter
    })

    remaining -= allocatedAmount
  }

  return rows
}

export default function PurchasePaymentEntryPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PurchasePaymentEntryPageContent />
    </Suspense>
  )
}

function PurchasePaymentEntryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const billIdFromQuery = searchParams.get('billId') || ''

  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(true)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0])

  const [purchaseBills, setPurchaseBills] = useState<PurchaseBill[]>([])

  const [partySearch, setPartySearch] = useState('')
  const [selectedPartyKey, setSelectedPartyKey] = useState('')
  const [selectedPartyName, setSelectedPartyName] = useState('')

  const [billTableSearch, setBillTableSearch] = useState('')
  const [selectedBillId, setSelectedBillId] = useState('')
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([])

  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'cash' | 'online' | 'bank'>('cash')
  const [txnRef, setTxnRef] = useState('')
  const [note, setNote] = useState('')

  const [isSubmittingSingle, setIsSubmittingSingle] = useState(false)
  const [isSubmittingMulti, setIsSubmittingMulti] = useState(false)

  const [isMultiModalOpen, setIsMultiModalOpen] = useState(false)
  const [multiPaymentAmount, setMultiPaymentAmount] = useState('')

  const [hasAppliedBillQuery, setHasAppliedBillQuery] = useState(false)

  const pendingBills = useMemo(() => {
    return purchaseBills.filter((bill) => Number(bill.balanceAmount || 0) > 0)
  }, [purchaseBills])

  const partyGroups = useMemo<PartyBillGroup[]>(() => {
    const grouped = new Map<string, PartyBillGroup>()

    for (const bill of pendingBills) {
      const partyKey = getBillPartyKey(bill)
      const partyName = getBillPartyName(bill)
      const existing = grouped.get(partyKey)

      if (!existing) {
        grouped.set(partyKey, {
          partyKey,
          partyName,
          bills: [bill],
          totalPending: Number(bill.balanceAmount || 0)
        })
        continue
      }

      existing.bills.push(bill)
      existing.totalPending += Number(bill.balanceAmount || 0)
    }

    return Array.from(grouped.values()).sort((a, b) => b.totalPending - a.totalPending)
  }, [pendingBills])

  const filteredPartyGroups = useMemo(() => {
    const query = partySearch.trim().toLowerCase()
    if (!query) return partyGroups

    return partyGroups.filter((group) => group.partyName.toLowerCase().includes(query))
  }, [partyGroups, partySearch])

  const selectedPartyBills = useMemo(() => {
    if (!selectedPartyKey) return []

    const bills = pendingBills.filter((bill) => getBillPartyKey(bill) === selectedPartyKey)
    return getSortedOldestFirstBills(bills)
  }, [pendingBills, selectedPartyKey])

  const selectedPartyPendingTotal = useMemo(() => {
    return selectedPartyBills.reduce((sum, bill) => sum + Number(bill.balanceAmount || 0), 0)
  }, [selectedPartyBills])

  const filteredPartyBills = useMemo(() => {
    const query = billTableSearch.trim().toLowerCase()
    if (!query) return selectedPartyBills

    return selectedPartyBills.filter((bill) => {
      const dateLabel = formatDateSafe(bill.billDate).toLowerCase()
      return (
        (bill.billNo || '').toLowerCase().includes(query) ||
        dateLabel.includes(query) ||
        String(bill.totalAmount || '').toLowerCase().includes(query)
      )
    })
  }, [billTableSearch, selectedPartyBills])

  const selectedBillData = useMemo(() => {
    if (!selectedBillId) return null
    return pendingBills.find((bill) => bill.id === selectedBillId) || null
  }, [pendingBills, selectedBillId])

  const selectedMultiBills = useMemo(() => {
    const selected = new Set(selectedBillIds)
    return selectedPartyBills.filter((bill) => selected.has(bill.id))
  }, [selectedBillIds, selectedPartyBills])

  const selectedMultiPendingTotal = useMemo(() => {
    return selectedMultiBills.reduce((sum, bill) => sum + Number(bill.balanceAmount || 0), 0)
  }, [selectedMultiBills])

  const multiPreviewAmount = useMemo(() => {
    if (!multiPaymentAmount) return 0
    const parsed = Number(multiPaymentAmount)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, parsed)
  }, [multiPaymentAmount])

  const allocationPreview = useMemo(() => {
    return buildAllocationPreview(selectedMultiBills, multiPreviewAmount)
  }, [multiPreviewAmount, selectedMultiBills])

  const totalAllocatedInPreview = useMemo(() => {
    return allocationPreview.reduce((sum, row) => sum + row.allocatedAmount, 0)
  }, [allocationPreview])

  const hiddenSelectedCount = useMemo(() => {
    if (!billTableSearch.trim()) return 0

    const visibleBillIds = new Set(filteredPartyBills.map((bill) => bill.id))
    return selectedMultiBills.filter((bill) => !visibleBillIds.has(bill.id)).length
  }, [billTableSearch, filteredPartyBills, selectedMultiBills])

  const toNonNegative = (value: string) => {
    if (value === '') return ''
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return ''
    return String(Math.max(0, parsed))
  }

  const fetchPurchaseBills = useCallback(
    async (targetCompanyId: string) => {
      try {
        let url = `/api/purchase-bills?companyId=${targetCompanyId}`

        const params = new URLSearchParams()
        if (dateFrom) params.append('dateFrom', dateFrom)
        if (dateTo) params.append('dateTo', dateTo)
        if (params.toString()) {
          url += `&${params.toString()}`
        }

        const response = await fetch(url)

        if (response.status === 401) {
          setPurchaseBills([])
          setLoading(false)
          router.push('/login')
          return
        }

        if (response.status === 403) {
          setPurchaseBills([])
          setLoading(false)
          return
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch purchase bills (${response.status})`)
        }

        const payload = await response.json()
        const rows: PurchaseBill[] = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : []

        const pendingRows = rows.filter((bill) => Number(bill?.balanceAmount || 0) > 0)
        setPurchaseBills(pendingRows)
      } catch (error) {
        console.error('Error fetching purchase bills:', error)
        setPurchaseBills([])
      } finally {
        setLoading(false)
      }
    },
    [dateFrom, dateTo, router]
  )

  useEffect(() => {
    ;(async () => {
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (!resolvedCompanyId) {
        setLoading(false)
        router.push('/company/select')
        return
      }

      setCompanyId(resolvedCompanyId)
      stripCompanyParamsFromUrl()
    })()
  }, [router])

  useEffect(() => {
    if (!companyId) return
    setLoading(true)
    void fetchPurchaseBills(companyId)
  }, [companyId, fetchPurchaseBills])

  useEffect(() => {
    if (!selectedPartyKey) {
      setSelectedBillIds([])
      return
    }

    setSelectedBillIds((current) => {
      const allowed = new Set(selectedPartyBills.map((bill) => bill.id))
      return current.filter((id) => allowed.has(id))
    })
  }, [selectedPartyBills, selectedPartyKey])

  useEffect(() => {
    if (!selectedPartyKey) {
      setSelectedBillId('')
      return
    }

    if (!selectedPartyBills.some((bill) => bill.id === selectedBillId)) {
      setSelectedBillId(selectedPartyBills[0]?.id || '')
    }
  }, [selectedPartyBills, selectedPartyKey, selectedBillId])

  useEffect(() => {
    if (partyGroups.length === 0) {
      setSelectedPartyKey('')
      setSelectedPartyName('')
      setSelectedBillId('')
      setSelectedBillIds([])
      return
    }

    if (selectedPartyKey && partyGroups.some((group) => group.partyKey === selectedPartyKey)) {
      return
    }

    setSelectedPartyKey('')
    setSelectedPartyName('')
    setSelectedBillId('')
    setSelectedBillIds([])
  }, [partyGroups, selectedPartyKey])

  useEffect(() => {
    if (selectedPartyKey || partyGroups.length === 0) return
    const firstGroup = partyGroups[0]
    if (!firstGroup) return
    setSelectedPartyKey(firstGroup.partyKey)
    setSelectedPartyName(firstGroup.partyName)
    setSelectedBillId(firstGroup.bills[0]?.id || '')
  }, [partyGroups, selectedPartyKey])

  useEffect(() => {
    if (!billIdFromQuery || hasAppliedBillQuery || pendingBills.length === 0) return

    const targetBill = pendingBills.find((bill) => bill.id === billIdFromQuery)
    if (targetBill) {
      const partyKey = getBillPartyKey(targetBill)
      const partyName = getBillPartyName(targetBill)
      setSelectedPartyKey(partyKey)
      setSelectedPartyName(partyName)
      setSelectedBillId(targetBill.id)
    }

    setHasAppliedBillQuery(true)
  }, [billIdFromQuery, hasAppliedBillQuery, pendingBills])

  const handleSelectParty = (group: PartyBillGroup) => {
    setSelectedPartyKey(group.partyKey)
    setSelectedPartyName(group.partyName)
    setSelectedBillId(group.bills[0]?.id || '')
    setSelectedBillIds([])
    setBillTableSearch('')
  }

  const handleToggleBillSelection = (billId: string) => {
    setSelectedBillIds((current) => {
      if (current.includes(billId)) {
        return current.filter((id) => id !== billId)
      }
      return [...current, billId]
    })
    setSelectedBillId(billId)
  }

  const submitSinglePayment = async (targetBillId: string, targetAmount: number) => {
    const paymentData = {
      companyId,
      billType: 'purchase',
      billId: targetBillId,
      payDate,
      amount: targetAmount,
      mode,
      txnRef,
      note
    }

    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paymentData)
    })

    if (response.ok) {
      return { ok: true as const }
    }

    const errorData = await response.json().catch(() => ({} as { error?: string; details?: Array<{ message?: string }> }))
    const detail = Array.isArray(errorData.details) && errorData.details.length > 0 ? errorData.details[0]?.message : ''

    return {
      ok: false as const,
      error: detail || errorData.error || 'Unknown error'
    }
  }

  const handleSubmitSinglePayment = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedPartyKey) {
      alert('Please select a party first.')
      return
    }

    if (!selectedBillId) {
      alert('Please select one bill to record payment.')
      return
    }

    if (selectedBillIds.length > 1) {
      alert('Multiple bills are selected. Please use "Pay Multiple Bills".')
      return
    }

    if (!amount) {
      alert('Please enter amount.')
      return
    }

    const paymentAmount = Number(amount)
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      alert('Amount must be greater than 0.')
      return
    }

    const currentBill = pendingBills.find((bill) => bill.id === selectedBillId)
    if (!currentBill) {
      alert('Selected bill is no longer available.')
      return
    }

    if (paymentAmount > Number(currentBill.balanceAmount || 0)) {
      alert(`Amount cannot exceed balance: ${formatAmount(currentBill.balanceAmount)}`)
      return
    }

    setIsSubmittingSingle(true)
    try {
      const result = await submitSinglePayment(selectedBillId, paymentAmount)
      if (!result.ok) {
        throw new Error(result.error || 'Unable to record payment')
      }

      alert('Purchase payment recorded successfully.')
      setAmount('')
      setTxnRef('')
      setNote('')
      await fetchPurchaseBills(companyId)
    } catch (error) {
      console.error('Error recording single payment:', error)
      alert(`Error recording payment: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSubmittingSingle(false)
    }
  }

  const handleOpenMultiPaymentModal = () => {
    if (selectedMultiBills.length < 2) {
      alert('Select at least 2 bills to pay multiple bills.')
      return
    }

    setMultiPaymentAmount(String(selectedMultiPendingTotal.toFixed(2)))
    setIsMultiModalOpen(true)
  }

  const handleSubmitMultiPayment = async () => {
    if (selectedMultiBills.length < 2) {
      alert('At least 2 bills are required for multi-bill payment.')
      return
    }

    if (!multiPaymentAmount) {
      alert('Enter payment amount.')
      return
    }

    const paymentAmount = Number(multiPaymentAmount)
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      alert('Amount must be greater than 0.')
      return
    }

    if (paymentAmount > selectedMultiPendingTotal) {
      alert(`Amount cannot exceed selected pending total: ${formatAmount(selectedMultiPendingTotal)}`)
      return
    }

    setIsSubmittingMulti(true)
    try {
      const response = await fetch('/api/payments/allocate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          companyId,
          billType: 'purchase',
          billIds: selectedMultiBills.map((bill) => bill.id),
          payDate,
          amount: paymentAmount,
          mode,
          txnRef,
          note,
          rule: 'oldest'
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({} as { error?: string; details?: Array<{ message?: string }> }))
        const detail = Array.isArray(errorData.details) && errorData.details.length > 0 ? errorData.details[0]?.message : ''
        throw new Error(detail || errorData.error || 'Unable to allocate payment')
      }

      const data = await response.json().catch(() => ({} as { paymentCount?: number; totalAllocated?: number }))
      const paymentCount = Number(data.paymentCount || 0)
      const allocatedAmount = Number(data.totalAllocated || 0)

      alert(`Payment allocated successfully across ${paymentCount} bill(s). Total allocated: ${formatAmount(allocatedAmount)}.`)

      setIsMultiModalOpen(false)
      setMultiPaymentAmount('')
      setAmount('')
      setTxnRef('')
      setNote('')
      setSelectedBillIds([])

      await fetchPurchaseBills(companyId)
    } catch (error) {
      console.error('Error allocating payment across bills:', error)
      alert(`Error allocating payment: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSubmittingMulti(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout companyId={companyId}>
        <div className="flex h-64 items-center justify-center">
          <div className="text-lg">Loading...</div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <h1 className="text-3xl font-bold">Record Purchase Payment</h1>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Payment Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmitSinglePayment} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="dateFrom">From Date</Label>
                      <Input
                        id="dateFrom"
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="dateTo">To Date</Label>
                      <Input
                        id="dateTo"
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="partySearch">Select Party</Label>
                    <div className="relative">
                      <Input
                        id="partySearch"
                        value={partySearch}
                        onChange={(e) => setPartySearch(e.target.value)}
                        placeholder="Search farmer/supplier..."
                        className="pr-9"
                      />
                      <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    </div>

                    <div className="grid max-h-40 grid-cols-1 gap-2 overflow-y-auto rounded-md border bg-gray-50 p-2 md:grid-cols-2">
                      {filteredPartyGroups.length === 0 ? (
                        <p className="col-span-full text-sm text-gray-500">No parties found.</p>
                      ) : (
                        filteredPartyGroups.map((group) => (
                          <button
                            key={group.partyKey}
                            type="button"
                            onClick={() => handleSelectParty(group)}
                            className={`rounded-md border px-3 py-2 text-left transition ${
                              selectedPartyKey === group.partyKey
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 bg-white hover:bg-gray-100'
                            }`}
                          >
                            <p className="truncate text-sm font-medium">{group.partyName}</p>
                            <p className="text-xs text-gray-500">
                              {group.bills.length} bill(s) | {formatAmount(group.totalPending)}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  {selectedBillData ? (
                    <div className="rounded-md border bg-gray-50 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">Selected Bill</p>
                        <Badge className={getStatusBadgeClass(selectedBillData.status)}>{normalizePaymentStatus(selectedBillData.status)}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <p>
                          <span className="text-gray-500">Bill No:</span> {selectedBillData.billNo}
                        </p>
                        <p>
                          <span className="text-gray-500">Bill Date:</span> {formatDateSafe(selectedBillData.billDate)}
                        </p>
                        <p>
                          <span className="text-gray-500">Party:</span> {getBillPartyName(selectedBillData)}
                        </p>
                        <p>
                          <span className="text-gray-500">Balance:</span>{' '}
                          <span className="font-semibold text-red-600">{formatAmount(selectedBillData.balanceAmount)}</span>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-3 text-sm text-gray-500">
                      Select one bill from the unpaid bills table to record a normal payment.
                    </div>
                  )}

                  <div>
                    <Label htmlFor="payDate">Payment Date</Label>
                    <Input id="payDate" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} required />
                  </div>

                  <div>
                    <Label htmlFor="amount">Payment Amount</Label>
                    <Input
                      id="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(toNonNegative(e.target.value))}
                      placeholder="Enter amount"
                      required
                    />
                    {selectedBillData && (
                      <p className="mt-1 text-sm text-gray-500">Max payable for selected bill: {formatAmount(selectedBillData.balanceAmount)}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="mode">Payment Mode</Label>
                    <Select value={mode} onValueChange={(value: 'cash' | 'online' | 'bank') => setMode(value)}>
                      <SelectTrigger id="mode">
                        <SelectValue placeholder="Select payment mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="bank">Bank Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="txnRef">Transaction Reference</Label>
                    <Input
                      id="txnRef"
                      value={txnRef}
                      onChange={(e) => setTxnRef(e.target.value)}
                      placeholder="Enter transaction reference (optional)"
                    />
                  </div>

                  <div>
                    <Label htmlFor="note">Note</Label>
                    <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Enter note (optional)" />
                  </div>

                  {selectedBillIds.length > 1 && (
                    <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                      {selectedBillIds.length} bills are selected. Use the &quot;Pay Multiple Bills&quot; action on the right panel.
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button type="submit" disabled={isSubmittingSingle}>
                      {isSubmittingSingle ? 'Recording...' : 'Record Payment'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => router.back()}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Unpaid Bills
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedPartyKey ? (
                  <div className="rounded-md border border-dashed p-6 text-center text-gray-500">
                    Select a party on the left to view unpaid bills.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-md border bg-gray-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{selectedPartyName}</p>
                        <Badge variant="outline">{selectedPartyBills.length} unpaid bill(s)</Badge>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">Total pending: {formatAmount(selectedPartyPendingTotal)}</p>
                    </div>

                    {selectedPartyBills.length > 1 && (
                      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                        <p className="font-semibold">This party has multiple unpaid bills</p>
                        <p>Select 2 or more bills and continue with Pay Multiple Bills.</p>
                      </div>
                    )}

                    <div className="relative">
                      <Input
                        value={billTableSearch}
                        onChange={(e) => setBillTableSearch(e.target.value)}
                        placeholder="Search bills in this party..."
                        className="pr-9"
                      />
                      <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    </div>

                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">Sel</TableHead>
                            <TableHead>Bill No</TableHead>
                            <TableHead>Bill Date</TableHead>
                            <TableHead>Total</TableHead>
                            <TableHead>Paid</TableHead>
                            <TableHead>Balance</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredPartyBills.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="py-6 text-center text-sm text-gray-500">
                                {selectedPartyBills.length === 0
                                  ? 'No unpaid bills found for this party and date range.'
                                  : selectedBillId || selectedBillIds.length > 0
                                    ? 'No rows match current search. Selected bills are kept.'
                                    : 'No bills found for current search.'}
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredPartyBills.map((bill) => {
                              const isChecked = selectedBillIds.includes(bill.id)
                              const isSelectedBill = selectedBillId === bill.id
                              return (
                                <TableRow
                                  key={bill.id}
                                  data-state={isSelectedBill ? 'selected' : undefined}
                                  className="cursor-pointer"
                                  onClick={() => setSelectedBillId(bill.id)}
                                >
                                  <TableCell>
                                    <input
                                      aria-label={`Select bill ${bill.billNo}`}
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleToggleBillSelection(bill.id)}
                                      onClick={(event) => event.stopPropagation()}
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium">{bill.billNo}</TableCell>
                                  <TableCell>{formatDateSafe(bill.billDate)}</TableCell>
                                  <TableCell>{formatAmount(bill.totalAmount)}</TableCell>
                                  <TableCell>{formatAmount(bill.paidAmount)}</TableCell>
                                  <TableCell className="font-semibold text-red-600">{formatAmount(bill.balanceAmount)}</TableCell>
                                  <TableCell>
                                    <Badge className={getStatusBadgeClass(bill.status)}>{normalizePaymentStatus(bill.status)}</Badge>
                                  </TableCell>
                                </TableRow>
                              )
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {hiddenSelectedCount > 0 && (
                      <p className="text-xs text-gray-500">{hiddenSelectedCount} selected bill(s) are hidden by current search filter.</p>
                    )}

                    <div className="sticky top-4 rounded-md border bg-gray-50 p-3">
                      <p className="text-sm font-semibold">Selection Summary</p>
                      <div className="mt-2 space-y-1 text-sm">
                        <p>
                          Selected bills: <span className="font-semibold">{selectedMultiBills.length}</span>
                        </p>
                        <p>
                          Total pending: <span className="font-semibold text-red-600">{formatAmount(selectedMultiPendingTotal)}</span>
                        </p>
                      </div>

                      <Button
                        type="button"
                        className="mt-3 w-full"
                        disabled={selectedMultiBills.length < 2 || isSubmittingMulti}
                        onClick={handleOpenMultiPaymentModal}
                      >
                        Pay Multiple Bills
                      </Button>

                      {selectedMultiBills.length < 2 && (
                        <p className="mt-2 text-xs text-gray-500">Select at least 2 bills to continue.</p>
                      )}
                    </div>

                    {selectedBillData && (
                      <div className="rounded-md border pt-3 text-sm">
                        <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                          <p>
                            <span className="text-gray-500">Bill Number:</span> {selectedBillData.billNo}
                          </p>
                          <p>
                            <span className="text-gray-500">Bill Date:</span> {formatDateSafe(selectedBillData.billDate)}
                          </p>
                          <p>
                            <span className="text-gray-500">Party Name:</span> {getBillPartyName(selectedBillData)}
                          </p>
                          <p>
                            <span className="text-gray-500">Party Contact:</span> {getBillPartyPhone(selectedBillData)}
                          </p>
                          <p>
                            <span className="text-gray-500">Total:</span> {formatAmount(selectedBillData.totalAmount)}
                          </p>
                          <p>
                            <span className="text-gray-500">Paid:</span> {formatAmount(selectedBillData.paidAmount)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={isMultiModalOpen} onOpenChange={(open) => (!isSubmittingMulti ? setIsMultiModalOpen(open) : undefined)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-0">
          <div className="grid max-h-[90vh] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="overflow-y-auto p-6">
              <DialogHeader>
                <DialogTitle>Pay Multiple Bills - {selectedPartyName || 'Selected Party'}</DialogTitle>
                <DialogDescription>
                  {selectedMultiBills.length} selected bill(s) | pending total {formatAmount(selectedMultiPendingTotal)}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill No</TableHead>
                      <TableHead>Bill Date</TableHead>
                      <TableHead>Pending</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {getSortedOldestFirstBills(selectedMultiBills).map((bill) => (
                      <TableRow key={bill.id}>
                        <TableCell className="font-medium">{bill.billNo}</TableCell>
                        <TableCell>{formatDateSafe(bill.billDate)}</TableCell>
                        <TableCell className="font-semibold text-red-600">{formatAmount(bill.balanceAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="overflow-y-auto border-l bg-gray-50 p-6">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="multiPaymentAmount">Payment Amount</Label>
                  <Input
                    id="multiPaymentAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={multiPaymentAmount}
                    onChange={(e) => setMultiPaymentAmount(toNonNegative(e.target.value))}
                    placeholder="Enter amount to allocate"
                  />
                </div>

                <div className="rounded-md border bg-white p-3 text-sm">
                  <p className="font-semibold">Allocation Rule</p>
                  <p className="text-gray-600">Oldest bill first. Smaller balance is prioritized when bill dates are same.</p>
                </div>

                <div className="rounded-md border bg-white p-3">
                  <p className="mb-2 text-sm font-semibold">Allocation Preview</p>
                  <div className="max-h-64 overflow-y-auto rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bill</TableHead>
                          <TableHead>Pending</TableHead>
                          <TableHead>Allocated</TableHead>
                          <TableHead>Remaining</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allocationPreview.map((row) => (
                          <TableRow key={row.billId}>
                            <TableCell className="font-medium">{row.billNo}</TableCell>
                            <TableCell>{formatAmount(row.balanceBefore)}</TableCell>
                            <TableCell className="text-green-700">{formatAmount(row.allocatedAmount)}</TableCell>
                            <TableCell className="text-red-600">{formatAmount(row.balanceAfter)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-3 space-y-1 text-sm">
                    <p>
                      Total allocated: <span className="font-semibold text-green-700">{formatAmount(totalAllocatedInPreview)}</span>
                    </p>
                    <p>
                      Pending after allocation:{' '}
                      <span className="font-semibold text-red-600">
                        {formatAmount(Math.max(0, selectedMultiPendingTotal - totalAllocatedInPreview))}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setIsMultiModalOpen(false)} disabled={isSubmittingMulti}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmitMultiPayment}
                  disabled={isSubmittingMulti || selectedMultiBills.length < 2}
                >
                  {isSubmittingMulti ? 'Allocating...' : 'Confirm Allocation'}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}
