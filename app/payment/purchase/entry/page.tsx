'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CreditCard, DollarSign } from 'lucide-react'

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
    krashakAnubandhNumber?: string | null
  } | null
  supplier?: {
    id: string
    name: string
    address: string
    phone1: string
  } | null
}

interface Bank {
  id: string
  name: string
  branch?: string
  ifscCode: string
  accountNumber?: string
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

function getBillAnubandhanNo(bill: PurchaseBill): string {
  return bill.farmer?.krashakAnubandhNumber?.trim() || ''
}

function normalizeFilterValue(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function matchesBillFilter(bill: PurchaseBill, query: string, exactBillNoOnly: boolean): boolean {
  if (!query) return true

  const billNo = normalizeFilterValue(bill.billNo)
  const anubandhanNo = normalizeFilterValue(getBillAnubandhanNo(bill))

  if (exactBillNoOnly) {
    return billNo === query
  }

  return billNo.includes(query) || anubandhanNo.includes(query)
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
  const [banks, setBanks] = useState<Bank[]>([])

  const [billFilter, setBillFilter] = useState('')
  const [selectedPartyKey, setSelectedPartyKey] = useState('')
  const [selectedPartyName, setSelectedPartyName] = useState('')

  const [selectedBillId, setSelectedBillId] = useState('')
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([])

  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'cash' | 'online' | 'bank'>('cash')
  const [selectedBank, setSelectedBank] = useState('none')
  const [onlinePayAmount, setOnlinePayAmount] = useState('')
  const [onlinePaymentDate, setOnlinePaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [onlineMethod, setOnlineMethod] = useState<'upi' | 'wallet' | 'card' | 'netbanking' | 'other'>('upi')
  const [onlineHandle, setOnlineHandle] = useState('')
  const [ifscCode, setIfscCode] = useState('')
  const [beneficiaryBankAccount, setBeneficiaryBankAccount] = useState('')
  const [bankNameSnapshot, setBankNameSnapshot] = useState('')
  const [bankBranchSnapshot, setBankBranchSnapshot] = useState('')
  const [asFlag, setAsFlag] = useState('A')
  const [txnRef, setTxnRef] = useState('')
  const [note, setNote] = useState('')

  const [isSubmittingSingle, setIsSubmittingSingle] = useState(false)
  const [isSubmittingMulti, setIsSubmittingMulti] = useState(false)

  const [isMultiModalOpen, setIsMultiModalOpen] = useState(false)
  const [multiPaymentAmount, setMultiPaymentAmount] = useState('')

  const [hasAppliedBillQuery, setHasAppliedBillQuery] = useState(false)
  const isCashMode = mode === 'cash'
  const isOnlineMode = mode === 'online'
  const isBankMode = mode === 'bank'

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

  const billFilterQuery = normalizeFilterValue(billFilter)
  const hasExactBillNoMatch = useMemo(() => {
    if (!billFilterQuery) return false
    return pendingBills.some((bill) => normalizeFilterValue(bill.billNo) === billFilterQuery)
  }, [billFilterQuery, pendingBills])

  const filteredPartyGroups = useMemo(() => {
    if (!billFilterQuery) return partyGroups

    return partyGroups.filter((group) =>
      group.bills.some((bill) => matchesBillFilter(bill, billFilterQuery, hasExactBillNoMatch))
    )
  }, [billFilterQuery, hasExactBillNoMatch, partyGroups])

  const selectedPartyBills = useMemo(() => {
    if (!selectedPartyKey) return []

    const bills = pendingBills.filter((bill) => getBillPartyKey(bill) === selectedPartyKey)
    const filteredBills = bills.filter((bill) => matchesBillFilter(bill, billFilterQuery, hasExactBillNoMatch))

    return getSortedOldestFirstBills(filteredBills)
  }, [billFilterQuery, hasExactBillNoMatch, pendingBills, selectedPartyKey])

  const selectedPartyPendingTotal = useMemo(() => {
    return selectedPartyBills.reduce((sum, bill) => sum + Number(bill.balanceAmount || 0), 0)
  }, [selectedPartyBills])

  const filteredPartyBills = selectedPartyBills

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

  const fetchBanks = useCallback(async (targetCompanyId: string) => {
    try {
      const response = await fetch(`/api/banks?companyId=${targetCompanyId}`)
      if (!response.ok) {
        setBanks([])
        return
      }
      const payload = await response.json()
      setBanks(Array.isArray(payload) ? payload : [])
    } catch (error) {
      console.error('Error fetching banks:', error)
      setBanks([])
    }
  }, [])

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
    void fetchBanks(companyId)
  }, [companyId, fetchBanks, fetchPurchaseBills])

  useEffect(() => {
    if (isCashMode) {
      setOnlinePayAmount('')
      return
    }
    if (!amount) {
      setOnlinePayAmount('')
      return
    }
    setOnlinePayAmount(toNonNegative(amount))
  }, [amount, isCashMode])

  useEffect(() => {
    if (isCashMode) return
    setOnlinePaymentDate(payDate)
  }, [isCashMode, payDate])

  useEffect(() => {
    if (!isBankMode) {
      setSelectedBank('none')
      setIfscCode('')
      setBeneficiaryBankAccount('')
      setBankNameSnapshot('')
      setBankBranchSnapshot('')
      return
    }
    if (!selectedBank || selectedBank === 'none') {
      setIfscCode('')
      setBeneficiaryBankAccount('')
      setBankNameSnapshot('')
      setBankBranchSnapshot('')
      return
    }

    const selected = banks.find((bank) => bank.id === selectedBank)
    if (!selected) return
    setIfscCode(selected.ifscCode || '')
    setBeneficiaryBankAccount(selected.accountNumber || '')
    setBankNameSnapshot(selected.name || '')
    setBankBranchSnapshot(selected.branch || '')
  }, [banks, isBankMode, selectedBank])

  useEffect(() => {
    if (!isOnlineMode) {
      setOnlineMethod('upi')
      setOnlineHandle('')
    }
  }, [isOnlineMode])

  useEffect(() => {
    if (filteredPartyGroups.length === 0) {
      setSelectedPartyKey('')
      setSelectedPartyName('')
      setSelectedBillId('')
      setSelectedBillIds([])
      return
    }

    if (selectedPartyKey && filteredPartyGroups.some((group) => group.partyKey === selectedPartyKey)) {
      return
    }

    const firstGroup = filteredPartyGroups[0]
    if (!firstGroup) return
    setSelectedPartyKey(firstGroup.partyKey)
    setSelectedPartyName(firstGroup.partyName)
    setSelectedBillId(firstGroup.bills[0]?.id || '')
    setSelectedBillIds([])
  }, [filteredPartyGroups, selectedPartyKey])

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
    if (!billFilterQuery || !hasExactBillNoMatch) return

    const exactBill = pendingBills.find((bill) => normalizeFilterValue(bill.billNo) === billFilterQuery)
    if (!exactBill) return

    const partyKey = getBillPartyKey(exactBill)
    const partyName = getBillPartyName(exactBill)

    if (selectedPartyKey !== partyKey) {
      setSelectedPartyKey(partyKey)
      setSelectedPartyName(partyName)
      setSelectedBillIds([])
    }

    if (selectedBillId !== exactBill.id) {
      setSelectedBillId(exactBill.id)
    }
  }, [billFilterQuery, hasExactBillNoMatch, pendingBills, selectedBillId, selectedPartyKey])

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

  const handleToggleBillSelection = (billId: string) => {
    setSelectedBillIds((current) => {
      if (current.includes(billId)) {
        return current.filter((id) => id !== billId)
      }
      return [...current, billId]
    })
    setSelectedBillId(billId)
  }

  const buildPaymentNote = () => {
    const lines: string[] = []
    const baseNote = note.trim()
    if (baseNote) lines.push(baseNote)

    if (isOnlineMode) {
      lines.push(`Online method: ${onlineMethod.toUpperCase()}`)
      if (onlineHandle.trim()) {
        lines.push(`Online ID: ${onlineHandle.trim()}`)
      }
    }

    return lines.join(' | ') || null
  }

  const submitSinglePayment = async (targetBillId: string, targetAmount: number) => {
    const finalNote = buildPaymentNote()
    const paymentData = {
      companyId,
      billType: 'purchase',
      billId: targetBillId,
      payDate,
      amount: targetAmount,
      mode,
      bankId: !isBankMode || selectedBank === 'none' ? null : selectedBank,
      onlinePayAmount: isCashMode ? null : Number(onlinePayAmount || targetAmount),
      onlinePaymentDate: isCashMode ? null : onlinePaymentDate || payDate,
      ifscCode: isBankMode ? ifscCode || null : null,
      beneficiaryBankAccount: isBankMode ? beneficiaryBankAccount || null : null,
      bankNameSnapshot: isBankMode ? bankNameSnapshot || null : null,
      bankBranchSnapshot: isBankMode ? bankBranchSnapshot || null : null,
      asFlag: isBankMode ? asFlag || 'A' : 'A',
      txnRef,
      note: finalNote
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

    const finalNote = buildPaymentNote()

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
          bankId: !isBankMode || selectedBank === 'none' ? null : selectedBank,
          onlinePayAmount: isCashMode ? null : Number(onlinePayAmount || paymentAmount),
          onlinePaymentDate: isCashMode ? null : onlinePaymentDate || payDate,
          ifscCode: isBankMode ? ifscCode || null : null,
          beneficiaryBankAccount: isBankMode ? beneficiaryBankAccount || null : null,
          bankNameSnapshot: isBankMode ? bankNameSnapshot || null : null,
          bankBranchSnapshot: isBankMode ? bankBranchSnapshot || null : null,
          asFlag: isBankMode ? asFlag || 'A' : 'A',
          txnRef,
          note: finalNote,
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

                  <div className="space-y-3 rounded-md border bg-gray-50 p-3">
                    <p className="text-sm font-semibold">Filter Bills</p>
                    <div>
                      <Label htmlFor="billFilter">Bill No. / Anubandhan No.</Label>
                      <Input
                        id="billFilter"
                        value={billFilter}
                        onChange={(e) => setBillFilter(e.target.value)}
                        placeholder="Search by bill no. or anubandhan no."
                      />
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

                  {isOnlineMode && (
                    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-700">Online Details</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <Label htmlFor="onlineMethod">Online Method</Label>
                          <Select value={onlineMethod} onValueChange={(value: 'upi' | 'wallet' | 'card' | 'netbanking' | 'other') => setOnlineMethod(value)}>
                            <SelectTrigger id="onlineMethod">
                              <SelectValue placeholder="Select online method" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="upi">UPI</SelectItem>
                              <SelectItem value="wallet">Wallet</SelectItem>
                              <SelectItem value="card">Card</SelectItem>
                              <SelectItem value="netbanking">Net Banking</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label htmlFor="onlinePayAmount">Online Amount</Label>
                          <Input
                            id="onlinePayAmount"
                            type="number"
                            min="0"
                            step="0.01"
                            value={onlinePayAmount}
                            onChange={(e) => setOnlinePayAmount(toNonNegative(e.target.value))}
                            placeholder="Enter online amount"
                          />
                        </div>

                        <div>
                          <Label htmlFor="onlinePaymentDate">Online Payment Date</Label>
                          <Input
                            id="onlinePaymentDate"
                            type="date"
                            value={onlinePaymentDate}
                            onChange={(e) => setOnlinePaymentDate(e.target.value)}
                          />
                        </div>

                        <div>
                          <Label htmlFor="onlineHandle">{onlineMethod === 'upi' ? 'UPI ID' : 'Online Reference'}</Label>
                          <Input
                            id="onlineHandle"
                            value={onlineHandle}
                            onChange={(e) => setOnlineHandle(e.target.value)}
                            placeholder={onlineMethod === 'upi' ? 'example@upi' : 'Enter reference'}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {isBankMode && (
                    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-700">Bank Transfer Details</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <Label htmlFor="selectedBank">Bank</Label>
                          <Select value={selectedBank} onValueChange={setSelectedBank}>
                            <SelectTrigger id="selectedBank">
                              <SelectValue placeholder="Select bank" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No Bank</SelectItem>
                              {banks.map((bank) => (
                                <SelectItem key={bank.id} value={bank.id}>
                                  {bank.name} ({bank.branch || 'Branch N/A'})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label htmlFor="onlinePayAmount">Transfer Amount</Label>
                          <Input
                            id="onlinePayAmount"
                            type="number"
                            min="0"
                            step="0.01"
                            value={onlinePayAmount}
                            onChange={(e) => setOnlinePayAmount(toNonNegative(e.target.value))}
                            placeholder="Enter transfer amount"
                          />
                        </div>

                        <div>
                          <Label htmlFor="onlinePaymentDate">Transfer Date</Label>
                          <Input
                            id="onlinePaymentDate"
                            type="date"
                            value={onlinePaymentDate}
                            onChange={(e) => setOnlinePaymentDate(e.target.value)}
                          />
                        </div>

                        <div>
                          <Label htmlFor="ifscCode">IFSC Code</Label>
                          <Input
                            id="ifscCode"
                            value={ifscCode}
                            onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                            placeholder="Enter IFSC code"
                          />
                        </div>

                        <div>
                          <Label htmlFor="beneficiaryBankAccount">Bank Account</Label>
                          <Input
                            id="beneficiaryBankAccount"
                            value={beneficiaryBankAccount}
                            onChange={(e) => setBeneficiaryBankAccount(e.target.value)}
                            placeholder="Enter beneficiary account"
                          />
                        </div>

                        <div>
                          <Label htmlFor="asFlag">AS Flag</Label>
                          <Input
                            id="asFlag"
                            value={asFlag}
                            onChange={(e) => setAsFlag(e.target.value.toUpperCase())}
                            maxLength={10}
                            placeholder="A / S flag"
                          />
                        </div>
                      </div>
                    </div>
                  )}

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
                                  : 'No bills match current Bill No./Anubandhan filters.'}
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
