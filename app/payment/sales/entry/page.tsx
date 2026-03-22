'use client'

import { useState, useEffect, Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardLayout from '@/app/components/DashboardLayout'
import { ArrowLeft, CreditCard, DollarSign, MessageCircle, Search } from 'lucide-react'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { openWhatsappChat } from '@/lib/whatsapp'

interface SalesBill {
  id: string
  billNo: string
  billDate: string
  totalAmount: number
  receivedAmount: number
  balanceAmount: number
  status: string
  party: {
    id: string
    name: string
    address: string
    phone1: string
  }
}

interface Bank {
  id: string
  name: string
  branch?: string
  ifscCode: string
  accountNumber?: string
}

interface PaymentMode {
  id: string
  name: string
  code: string
  isActive: boolean
}

type PartyBillGroup = {
  partyName: string
  bills: SalesBill[]
  totalPending: number
}

const formatDateSafe = (value: string): string => {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '-'
  return parsed.toLocaleDateString()
}

const isCashModeCode = (modeCode: string, modeName: string): boolean => {
  const code = (modeCode || '').trim().toLowerCase()
  const name = (modeName || '').trim().toLowerCase()
  return code === 'cash' || code === 'c' || name.includes('cash') || name.includes('nakad')
}

export default function SalesPaymentEntryPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SalesPaymentEntryPageContent />
    </Suspense>
  )
}

function SalesPaymentEntryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const billId = searchParams.get('billId') || ''

  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [salesBills, setSalesBills] = useState<SalesBill[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([])
  const [selectedBill, setSelectedBill] = useState('')
  const [selectedPartyName, setSelectedPartyName] = useState('')
  const [partySearch, setPartySearch] = useState('')
  const [paymentFlow, setPaymentFlow] = useState<'single' | 'multi'>('single')
  const [multiBillSelection, setMultiBillSelection] = useState<string[]>([])
  const [multiBillFilter, setMultiBillFilter] = useState('')

  // Receipt form state
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [selectedPaymentMode, setSelectedPaymentMode] = useState('')
  const [selectedBank, setSelectedBank] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const [cashPaymentDate, setCashPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [onlinePayAmount, setOnlinePayAmount] = useState('')
  const [onlinePaymentDate, setOnlinePaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [ifscCode, setIfscCode] = useState('')
  const [beneficiaryBankAccount, setBeneficiaryBankAccount] = useState('')
  const [bankNameSnapshot, setBankNameSnapshot] = useState('')
  const [bankBranchSnapshot, setBankBranchSnapshot] = useState('')
  const [asFlag, setAsFlag] = useState('A')
  const [txnRef, setTxnRef] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const toNonNegative = (value: string) => {
    if (value === '') return ''
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return ''
    return String(Math.max(0, parsed))
  }

  const pendingBills = useMemo(
    () =>
      salesBills
        .slice()
        .sort((a, b) => Number(b.balanceAmount || 0) - Number(a.balanceAmount || 0)),
    [salesBills]
  )
  const totalPendingAmount = useMemo(
    () => pendingBills.reduce((sum, bill) => sum + Number(bill.balanceAmount || 0), 0),
    [pendingBills]
  )

  const partyGroups = useMemo<PartyBillGroup[]>(() => {
    const grouped = new Map<string, PartyBillGroup>()
    for (const bill of pendingBills) {
      const partyName = (bill.party?.name || 'Unknown').trim() || 'Unknown'
      const existing = grouped.get(partyName)
      if (!existing) {
        grouped.set(partyName, {
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
    if (!selectedPartyName) return []
    return pendingBills.filter((bill) => (bill.party?.name || 'Unknown') === selectedPartyName)
  }, [pendingBills, selectedPartyName])

  const selectedBillData = useMemo(
    () => salesBills.find((bill) => bill.id === selectedBill),
    [salesBills, selectedBill]
  )
  const selectedPaymentModeObj = useMemo(
    () => paymentModes.find((pm) => pm.code === selectedPaymentMode) || null,
    [paymentModes, selectedPaymentMode]
  )
  const isCashMode = useMemo(
    () => isCashModeCode(selectedPaymentModeObj?.code || selectedPaymentMode, selectedPaymentModeObj?.name || ''),
    [selectedPaymentModeObj, selectedPaymentMode]
  )

  const selectedPartyPendingTotal = useMemo(
    () => selectedPartyBills.reduce((sum, bill) => sum + Number(bill.balanceAmount || 0), 0),
    [selectedPartyBills]
  )

  const receiptSummary = useMemo(() => {
    const bills = selectedPartyBills.length > 0
      ? selectedPartyBills
      : selectedBillData
        ? [selectedBillData]
        : []

    const totalAmount = bills.reduce((sum, bill) => sum + Number(bill.totalAmount || 0), 0)
    const receivedAmount = bills.reduce((sum, bill) => sum + Number(bill.receivedAmount || 0), 0)
    const balanceAmount = bills.reduce((sum, bill) => sum + Number(bill.balanceAmount || 0), 0)

    const status: 'paid' | 'partial' | 'unpaid' =
      balanceAmount <= 0 ? 'paid' : receivedAmount > 0 ? 'partial' : 'unpaid'

    return {
      billCount: bills.length,
      totalAmount,
      receivedAmount,
      balanceAmount,
      status
    }
  }, [selectedBillData, selectedPartyBills])

  const selectedMultiBills = useMemo(
    () => selectedPartyBills.filter((bill) => multiBillSelection.includes(bill.id)),
    [multiBillSelection, selectedPartyBills]
  )

  const selectedMultiPendingTotal = useMemo(
    () => selectedMultiBills.reduce((sum, bill) => sum + Number(bill.balanceAmount || 0), 0),
    [selectedMultiBills]
  )

  const handleWhatsappReminder = () => {
    const partyPhone =
      selectedBillData?.party?.phone1 ||
      selectedPartyBills[0]?.party?.phone1 ||
      ''
    const partyLabel =
      selectedPartyName ||
      selectedBillData?.party?.name ||
      selectedPartyBills[0]?.party?.name ||
      'Customer'
    const outstandingAmount =
      paymentFlow === 'multi' && selectedPartyName
        ? selectedPartyPendingTotal
        : selectedBillData?.balanceAmount || selectedPartyPendingTotal

    if (!openWhatsappChat(
      partyPhone,
      `Dear ${partyLabel}, your outstanding amount is Rs. ${Number(outstandingAmount || 0).toFixed(2)}. Please arrange the pending payment at the earliest. Thank you.`
    )) {
      alert('Party mobile number is missing')
      return
    }
  }

  useEffect(() => {
    // Keep multi-selection clean when bills refresh
    setMultiBillSelection((prev) => prev.filter((id) => pendingBills.some((bill) => bill.id === id)))
  }, [pendingBills])

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
    void fetchSalesBills(companyId)
    void fetchBanks(companyId)
    void fetchPaymentModes(companyId)
  }, [companyId])

  const fetchBanks = async (targetCompanyId: string) => {
    try {
      const response = await fetch(`/api/banks?companyId=${targetCompanyId}`)
      if (response.ok) {
        const data = await response.json()
        setBanks(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Error fetching banks:', error)
    }
  }

  const fetchPaymentModes = async (targetCompanyId: string) => {
    try {
      const response = await fetch(`/api/payment-modes?companyId=${targetCompanyId}`)
      if (response.ok) {
        const data = await response.json()
        const rows = Array.isArray(data) ? data : []
        setPaymentModes(rows.filter((pm: PaymentMode) => pm.isActive))
      }
    } catch (error) {
      console.error('Error fetching payment modes:', error)
    }
  }

  useEffect(() => {
    if (salesBills.length === 0) {
      setSelectedPartyName('')
      setSelectedBill('')
      return
    }

    const billFromQuery = billId ? salesBills.find((bill) => bill.id === billId) : undefined
    if (billFromQuery) {
      const nextPartyName = billFromQuery.party?.name || 'Unknown'
      if (selectedPartyName !== nextPartyName) setSelectedPartyName(nextPartyName)
      if (selectedBill !== billFromQuery.id) setSelectedBill(billFromQuery.id)
      return
    }

    if (selectedPartyName) {
      const partyStillExists = salesBills.some((bill) => (bill.party?.name || 'Unknown') === selectedPartyName)
      if (!partyStillExists) {
        setSelectedPartyName('')
        setSelectedBill('')
        return
      }

      const nextBills = salesBills.filter((bill) => (bill.party?.name || 'Unknown') === selectedPartyName)
      if (!nextBills.some((bill) => bill.id === selectedBill)) {
        setSelectedBill(nextBills[0]?.id || '')
      }
      return
    }

    if (selectedBill) setSelectedBill('')
  }, [salesBills, billId, selectedPartyName, selectedBill])

  useEffect(() => {
    if (selectedPartyName || partyGroups.length === 0) return
    const firstGroup = partyGroups[0]
    if (!firstGroup) return
    setSelectedPartyName(firstGroup.partyName)
    setSelectedBill(firstGroup.bills[0]?.id || '')
  }, [partyGroups, selectedPartyName])

  useEffect(() => {
    if (!selectedPartyName) {
      setSelectedBill('')
      return
    }
    if (selectedPartyBills.some((bill) => bill.id === selectedBill)) {
      return
    }
    setSelectedBill(selectedPartyBills[0]?.id || '')
  }, [selectedPartyName, selectedPartyBills, selectedBill])

  useEffect(() => {
    if (!selectedPaymentMode) return
    if (!amount) {
      setCashAmount('')
      setOnlinePayAmount('')
      return
    }
    if (isCashMode) {
      setCashAmount(toNonNegative(amount))
      return
    }
    setOnlinePayAmount(toNonNegative(amount))
  }, [amount, isCashMode, selectedPaymentMode])

  useEffect(() => {
    if (isCashMode) {
      setCashPaymentDate(receiptDate)
      return
    }
    setOnlinePaymentDate(receiptDate)
  }, [isCashMode, receiptDate])

  useEffect(() => {
    if (!selectedBank || selectedBank === 'none') {
      setIfscCode('')
      setBeneficiaryBankAccount('')
      setBankNameSnapshot('')
      setBankBranchSnapshot('')
      return
    }
    const bank = banks.find((entry) => entry.id === selectedBank)
    if (!bank) return
    setIfscCode(bank.ifscCode || '')
    setBeneficiaryBankAccount(bank.accountNumber || '')
    setBankNameSnapshot(bank.name || '')
    setBankBranchSnapshot(bank.branch || '')
  }, [banks, selectedBank])

  const fetchSalesBills = async (targetCompanyId: string) => {
    try {
      const response = await fetch(`/api/sales-bills?companyId=${targetCompanyId}`)
      const data = await response.json()
      const rows = Array.isArray(data) ? data : []
      
      // Filter bills that have pending balance
      const pendingBills = rows.filter((bill: SalesBill) => Number(bill?.balanceAmount || 0) > 0)
      setSalesBills(pendingBills)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching sales bills:', error)
      setSalesBills([])
      setLoading(false)
    }
  }

  const toggleMultiBill = (billId: string) => {
    setMultiBillSelection((prev) =>
      prev.includes(billId) ? prev.filter((id) => id !== billId) : [...prev, billId]
    )
  }

  const submitReceipt = async (targetBillId: string, targetAmount: number) => {
    const receiptData = {
      companyId,
      billType: 'sales',
      billId: targetBillId,
      payDate: receiptDate,
      amount: targetAmount,
      mode: selectedPaymentMode,
      bankId: selectedBank === 'none' ? null : selectedBank,
      cashAmount: isCashMode ? Number(cashAmount || targetAmount) : null,
      cashPaymentDate: isCashMode ? cashPaymentDate || receiptDate : null,
      onlinePayAmount: isCashMode ? null : Number(onlinePayAmount || targetAmount),
      onlinePaymentDate: isCashMode ? null : onlinePaymentDate || receiptDate,
      ifscCode: isCashMode ? null : ifscCode || null,
      beneficiaryBankAccount: isCashMode ? null : beneficiaryBankAccount || null,
      bankNameSnapshot: isCashMode ? null : bankNameSnapshot || null,
      bankBranchSnapshot: isCashMode ? null : bankBranchSnapshot || null,
      asFlag: isCashMode ? 'A' : asFlag || 'A',
      txnRef,
      note
    }

    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(receiptData),
    })

    if (response.ok) return { ok: true as const }

    const errorData = await response.json().catch(() => ({} as { error?: string; details?: Array<{ message?: string }> }))
    const detail = Array.isArray(errorData.details) && errorData.details.length > 0
      ? errorData.details[0]?.message
      : ''

    return {
      ok: false as const,
      error: detail || errorData.error || 'Unknown error'
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!amount) {
      alert('Please enter amount')
      return
    }

    if (!selectedPaymentMode) {
      alert('Please select payment mode')
      return
    }

    // Validate amount
    const receiptAmount = parseFloat(amount)
    if (receiptAmount <= 0) {
      alert('Amount must be greater than 0')
      return
    }

    setSubmitting(true)

    try {
      if (paymentFlow === 'multi') {
        if (!selectedPartyName) {
          alert('Please select a party')
          return
        }
        if (selectedPartyBills.length === 0 || multiBillSelection.length === 0) {
          alert('Select at least one unpaid bill for the selected party')
          return
        }
        if (receiptAmount > selectedMultiPendingTotal) {
          alert(`Amount cannot exceed selected bills total: ₹${selectedMultiPendingTotal.toFixed(2)}`)
          return
        }

        const sortedBills = selectedMultiBills
          .slice()
          .sort((a, b) => new Date(a.billDate).getTime() - new Date(b.billDate).getTime())

        let remaining = receiptAmount
        let processed = 0

        for (const bill of sortedBills) {
          if (remaining <= 0) break
          const allocation = Math.min(remaining, Number(bill.balanceAmount || 0))
          if (allocation <= 0) continue

          const result = await submitReceipt(bill.id, allocation)
          if (!result.ok) {
            throw new Error(
              `Failed while recording bill ${bill.billNo}: ${result.error || 'Unknown error'}`
            )
          }

          processed += 1
          remaining -= allocation
        }

        alert(`Receipt recorded across ${processed} selected bill(s) for "${selectedPartyName}".`)
      } else {
        if (!selectedBill) {
          alert('Please select a bill')
          return
        }
        const bill = salesBills.find((b) => b.id === selectedBill)
        if (!bill) return
        if (receiptAmount > bill.balanceAmount) {
          alert(`Amount cannot exceed balance: ₹${bill.balanceAmount.toFixed(2)}`)
          return
        }

        const result = await submitReceipt(selectedBill, receiptAmount)
        if (!result.ok) {
          throw new Error(result.error || 'Unknown error')
        }
        alert('Sales receipt recorded successfully!')
      }

      // Reset form
      setAmount('')
      setSelectedPaymentMode('')
      setSelectedBank('')
      setCashAmount('')
      setCashPaymentDate(new Date().toISOString().split('T')[0])
      setOnlinePayAmount('')
      setOnlinePaymentDate(new Date().toISOString().split('T')[0])
      setIfscCode('')
      setBeneficiaryBankAccount('')
      setBankNameSnapshot('')
      setBankBranchSnapshot('')
      setAsFlag('A')
      setTxnRef('')
      setNote('')
      setPaymentFlow('single')
      setMultiBillSelection([])
      setMultiBillFilter('')

      // Refresh bills to update balances
      await fetchSalesBills(companyId)
    } catch (error) {
      console.error('Error:', error)
      alert('Error recording receipt: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setSubmitting(false)
    }
  }

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
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-4">
              <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <h1 className="text-3xl font-bold">Record Sales Receipt</h1>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Receipt Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5" />
                  Receipt Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="partySearch">Select Party</Label>
                    <div className="relative">
                      <Input
                        id="partySearch"
                        value={partySearch}
                        onChange={(e) => setPartySearch(e.target.value)}
                        placeholder="Search party..."
                        className="pr-9"
                      />
                      <Search className="h-4 w-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-40 overflow-y-auto border rounded-md p-2 bg-gray-50">
                      {filteredPartyGroups.length === 0 ? (
                        <p className="text-sm text-gray-500 col-span-full">No party found.</p>
                      ) : (
                        filteredPartyGroups.map((group) => (
                          <button
                            type="button"
                            key={group.partyName}
                            onClick={() => setSelectedPartyName(group.partyName)}
                            className={`rounded-md border px-3 py-2 text-left transition ${
                              selectedPartyName === group.partyName
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                            }`}
                          >
                            <p className="text-sm font-medium truncate">{group.partyName}</p>
                            <p className="text-xs text-gray-500">
                              {group.bills.length} bill(s) • ₹{group.totalPending.toFixed(2)}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Receipt Flow</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={paymentFlow === 'single' ? 'default' : 'outline'}
                        onClick={() => setPaymentFlow('single')}
                        size="sm"
                      >
                        Single bill
                      </Button>
                      <Button
                        type="button"
                        variant={paymentFlow === 'multi' ? 'default' : 'outline'}
                        onClick={() => setPaymentFlow('multi')}
                        size="sm"
                      >
                        Multi-bill merge
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500">
                      {paymentFlow === 'multi'
                        ? 'Select multiple unpaid invoices for the party and split one receipt across them (oldest first).'
                        : 'Apply receipt to a single invoice.'}
                    </p>
                  </div>

                  {paymentFlow === 'single' ? (
                    <div>
                      <Label htmlFor="bill">Select Bill</Label>
                      <Select value={selectedBill} onValueChange={setSelectedBill}>
                        <SelectTrigger>
                          <SelectValue placeholder={selectedPartyName ? 'Select unpaid bill' : 'Select party first'} />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedPartyBills.map((bill) => (
                            <SelectItem key={bill.id} value={bill.id}>
                              {bill.billNo} - {bill.party.name} (Balance: ₹{bill.balanceAmount.toFixed(2)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedPartyName && (
                        <p className="text-xs text-gray-500 mt-1">
                          Pending for {selectedPartyName}: ₹{selectedPartyPendingTotal.toFixed(2)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="multiBillFilter">Select Invoices to Merge</Label>
                      <Input
                        id="multiBillFilter"
                        value={multiBillFilter}
                        onChange={(e) => setMultiBillFilter(e.target.value)}
                        placeholder="Filter by invoice number..."
                        className="pr-9"
                      />
                      <div className="rounded-md border p-2 bg-gray-50 max-h-48 overflow-y-auto space-y-2">
                        {selectedPartyBills.length === 0 ? (
                          <p className="text-sm text-gray-500">Select a party to view unpaid bills.</p>
                        ) : (
                          selectedPartyBills
                            .filter((bill) => {
                              const query = multiBillFilter.trim().toLowerCase()
                              if (!query) return true
                              return (
                                bill.billNo.toLowerCase().includes(query) ||
                                (bill.party?.name || '').toLowerCase().includes(query)
                              )
                            })
                            .map((bill) => {
                              const checked = multiBillSelection.includes(bill.id)
                              return (
                                <label
                                  key={bill.id}
                                  className={`flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer transition ${
                                    checked ? 'border-blue-500 bg-white' : 'border-gray-200 bg-white hover:bg-gray-100'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="mt-1"
                                    checked={checked}
                                    onChange={() => toggleMultiBill(bill.id)}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{bill.billNo}</p>
                                    <p className="text-xs text-gray-500">Balance: ₹{bill.balanceAmount.toFixed(2)} • {formatDateSafe(bill.billDate)}</p>
                                  </div>
                                </label>
                              )
                            })
                        )}
                      </div>
                      <div className="text-xs text-gray-600">
                        Selected {selectedMultiBills.length} bill(s) • Combined balance: ₹{selectedMultiPendingTotal.toFixed(2)}
                      </div>
                    </div>
                  )}

                  <div>
                    <Label htmlFor="receiptDate">Receipt Date</Label>
                    <Input
                      id="receiptDate"
                      type="date"
                      value={receiptDate}
                      onChange={(e) => setReceiptDate(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="amount">Receipt Amount</Label>
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
                    {paymentFlow === 'single' && selectedBillData && (
                      <p className="text-sm text-gray-500 mt-1">
                        Max receivable: ₹{selectedBillData.balanceAmount.toFixed(2)}
                      </p>
                    )}
                    {paymentFlow === 'multi' && selectedMultiBills.length > 0 && (
                      <p className="text-sm text-gray-500 mt-1">
                        Combined balance across selected invoices: ₹{selectedMultiPendingTotal.toFixed(2)}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="paymentMode">Payment Mode</Label>
                    <Select value={selectedPaymentMode} onValueChange={setSelectedPaymentMode}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select payment mode" />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentModes.map((pm) => (
                          <SelectItem key={pm.id} value={pm.code}>
                            {pm.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedPaymentMode && (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-3">
                      <p className="text-sm font-semibold text-slate-700">Payment Attributes (Sales Report)</p>
                      {isCashMode ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor="cashAmount">Cash Amount</Label>
                            <Input
                              id="cashAmount"
                              type="number"
                              min="0"
                              step="0.01"
                              value={cashAmount}
                              onChange={(e) => setCashAmount(toNonNegative(e.target.value))}
                              placeholder="Enter cash amount"
                            />
                          </div>
                          <div>
                            <Label htmlFor="cashPaymentDate">Cash Payment Date</Label>
                            <Input
                              id="cashPaymentDate"
                              type="date"
                              value={cashPaymentDate}
                              onChange={(e) => setCashPaymentDate(e.target.value)}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor="bank">Bank</Label>
                            <Select value={selectedBank} onValueChange={setSelectedBank}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select bank for online receipt" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No Bank</SelectItem>
                                {banks.map((bank) => (
                                  <SelectItem key={bank.id} value={bank.id}>
                                    {bank.name} ({bank.branch})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor="onlinePayAmount">Online Payment Amount</Label>
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
                            <Label htmlFor="ifscCode">IFSC Code</Label>
                            <Input
                              id="ifscCode"
                              value={ifscCode}
                              onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                              placeholder="Bank IFSC"
                            />
                          </div>
                          <div>
                            <Label htmlFor="beneficiaryBankAccount">Bank Account</Label>
                            <Input
                              id="beneficiaryBankAccount"
                              value={beneficiaryBankAccount}
                              onChange={(e) => setBeneficiaryBankAccount(e.target.value)}
                              placeholder="Beneficiary bank account"
                            />
                          </div>
                          <div>
                            <Label htmlFor="txnRef">UTR / Transaction Reference</Label>
                            <Input
                              id="txnRef"
                              value={txnRef}
                              onChange={(e) => setTxnRef(e.target.value)}
                              placeholder="Enter UTR / transaction ref"
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
                      )}
                    </div>
                  )}

                  <div>
                    <Label htmlFor="note">Note</Label>
                    <Input
                      id="note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Enter note (optional)"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? 'Recording...' : 'Record Receipt'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => router.back()}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Bill Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Bill Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedBillData ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Party Name</Label>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{selectedBillData.party.name}</p>
                          <Button type="button" size="sm" variant="outline" onClick={handleWhatsappReminder}>
                            <MessageCircle className="mr-2 h-4 w-4" />
                            WhatsApp Reminder
                          </Button>
                        </div>
                      </div>
                      <div>
                        <Label>Party Contact</Label>
                        <p className="font-semibold">{selectedBillData.party.phone1 || 'N/A'}</p>
                      </div>
                    </div>

                    <div className="border-t pt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <h3 className="font-semibold mb-3">Receipt Summary</h3>
                        {receiptSummary.billCount > 1 && (
                          <p className="text-xs text-gray-500 mb-2">
                            Combined summary of {receiptSummary.billCount} unpaid bill(s) for {selectedPartyName || selectedBillData.party.name}.
                          </p>
                        )}
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span>Total Amount:</span>
                            <span className="font-medium">₹{receiptSummary.totalAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Already Received:</span>
                            <span className="font-medium text-green-600">₹{receiptSummary.receivedAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Balance Amount:</span>
                            <span className="font-medium text-red-600">₹{receiptSummary.balanceAmount.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Total Bills:</span>
                            <span className="font-medium">{receiptSummary.billCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Status:</span>
                            <span className={`font-medium px-2 py-1 rounded text-xs ${
                              receiptSummary.status === 'paid' ? 'bg-green-100 text-green-800' :
                              receiptSummary.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {receiptSummary.status}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-md border p-3 bg-gray-50">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-semibold">All Unpaid Bills</h3>
                          <span className="text-xs font-medium px-2 py-1 rounded bg-red-100 text-red-700">
                            {pendingBills.length}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mb-2">
                          Total pending: ₹{totalPendingAmount.toFixed(2)}
                        </p>
                        {selectedPartyName && (
                          <p className="text-xs text-gray-500 mb-2">
                            Selected party: <span className="font-medium">{selectedPartyName}</span>
                          </p>
                        )}
                        {pendingBills.length === 0 ? (
                          <p className="text-sm text-gray-500">No unpaid bills found.</p>
                        ) : (
                          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                            {(selectedPartyName ? selectedPartyBills : pendingBills).map((bill) => (
                              <button
                                key={bill.id}
                                type="button"
                                onClick={() => setSelectedBill(bill.id)}
                                className={`w-full rounded-md border p-2 text-left transition ${
                                  selectedBill === bill.id
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'border-gray-200 hover:bg-white'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">
                                      {bill.billNo} - {bill.party.name}
                                    </p>
                                    <p className="text-xs text-gray-500">{formatDateSafe(bill.billDate)}</p>
                                  </div>
                                  <span className="text-sm font-semibold text-red-600 whitespace-nowrap">
                                    ₹{bill.balanceAmount.toFixed(2)}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {selectedPartyBills.length > 1 && (
                          <div className="mt-3 pt-2 border-t">
                            <p className="text-xs text-gray-600">
                              Same party pending bills: <span className="font-semibold">{selectedPartyBills.length}</span>
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 py-2">
                    <div className="text-center text-gray-500">
                      <p>Select a party/bill to view details</p>
                    </div>
                    <div className="rounded-md border p-3 bg-gray-50">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold">All Unpaid Bills</h3>
                        <span className="text-xs font-medium px-2 py-1 rounded bg-red-100 text-red-700">
                          {pendingBills.length}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">
                        Total pending: ₹{totalPendingAmount.toFixed(2)}
                      </p>
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {pendingBills.map((bill) => (
                          <button
                            key={bill.id}
                            type="button"
                            onClick={() => {
                              setSelectedPartyName(bill.party?.name || 'Unknown')
                              setSelectedBill(bill.id)
                            }}
                            className="w-full rounded-md border p-2 text-left transition border-gray-200 hover:bg-white"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {bill.billNo} - {bill.party.name}
                                </p>
                                <p className="text-xs text-gray-500">{formatDateSafe(bill.billDate)}</p>
                              </div>
                              <span className="text-sm font-semibold text-red-600 whitespace-nowrap">
                                ₹{bill.balanceAmount.toFixed(2)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
