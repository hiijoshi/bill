'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Edit, Eye, Plus } from 'lucide-react'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { isAbortError } from '@/lib/http'

interface PurchaseBill {
  id: string
  billNo: string
  billDate: string
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  supplier?: {
    name: string
  } | null
  farmer: {
    name: string
    address: string
    krashakAnubandhNumber: string
  } | null
}

interface SalesBill {
  id: string
  billNo: string
  billDate: string
  totalAmount: number
  receivedAmount: number
  balanceAmount: number
  status: string
  party: {
    name: string
    address: string
    phone1: string
  }
}

interface Payment {
  id: string
  billType: 'purchase' | 'sales'
  billId: string
  billNo: string
  partyName: string
  payDate: string
  amount: number
  mode: 'cash' | 'online' | 'bank'
  status: 'pending' | 'paid'
  txnRef?: string
  note?: string
  createdAt: string
}

const clampNonNegative = (value: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

const formatDateSafe = (value: string): string => {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '-'
  return parsed.toLocaleDateString()
}

const toDateInputValue = (value: string): string => {
  const parsed = new Date(value)
  const fallback = new Date()
  const base = Number.isFinite(parsed.getTime()) ? parsed : fallback
  const year = base.getFullYear()
  const month = String(base.getMonth() + 1).padStart(2, '0')
  const day = String(base.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function PaymentDashboardPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'purchase' | 'sales'>('purchase')
  const [purchaseBills, setPurchaseBills] = useState<PurchaseBill[]>([])
  const [salesBills, setSalesBills] = useState<SalesBill[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState('')
  const [partyFilter, setPartyFilter] = useState('all')
  const [modeFilter, setModeFilter] = useState<'all' | 'cash' | 'online' | 'bank'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [isEditPaymentOpen, setIsEditPaymentOpen] = useState(false)
  const [editingPaymentId, setEditingPaymentId] = useState('')
  const [paymentDraft, setPaymentDraft] = useState({
    payDate: '',
    amount: '',
    mode: 'cash' as 'cash' | 'online' | 'bank',
    status: 'paid' as 'pending' | 'paid',
    txnRef: '',
    note: ''
  })
  const [savingPayment, setSavingPayment] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const companyIdParam = await resolveCompanyId(window.location.search)

      if (!companyIdParam) {
        alert('Company not selected')
        router.push('/company/select')
        return
      }

      setCompanyId(companyIdParam)
      stripCompanyParamsFromUrl()

      const cacheKey = `payments-dashboard:${companyIdParam}:${activeTab}`
      const cached = getClientCache<{
        purchaseBills: PurchaseBill[]
        salesBills: SalesBill[]
        payments: Payment[]
      }>(cacheKey, 10_000)
      if (cached) {
        setPurchaseBills(cached.purchaseBills)
        setSalesBills(cached.salesBills)
        setPayments(cached.payments)
        setLoading(false)
      }

      // Fetch bills based on active tab
      const billsEndpoint = activeTab === 'purchase' ? 'purchase-bills' : 'sales-bills'
      const [billsResponse, paymentsResponse] = await Promise.all([
        fetch(`/api/${billsEndpoint}?companyId=${companyIdParam}`),
        fetch(`/api/payments?companyId=${companyIdParam}&billType=${activeTab}`)
      ])
      if (billsResponse.status === 401 || paymentsResponse.status === 401) {
        setLoading(false)
        router.push('/login')
        return
      }
      if (billsResponse.status === 403 || paymentsResponse.status === 403) {
        setPurchaseBills([])
        setSalesBills([])
        setPayments([])
        setLoading(false)
        return
      }

      const billsRaw = await billsResponse.json().catch(() => [])
      const billsData = Array.isArray(billsRaw) ? billsRaw : []
      const normalizedBills = billsData.map((bill: PurchaseBill | SalesBill) => ({
        ...bill,
        totalAmount: clampNonNegative(bill.totalAmount),
        balanceAmount: clampNonNegative(bill.balanceAmount),
        ...(activeTab === 'purchase'
          ? { paidAmount: clampNonNegative((bill as PurchaseBill).paidAmount) }
          : { receivedAmount: clampNonNegative((bill as SalesBill).receivedAmount) })
      }))

      const nextPurchaseBills = activeTab === 'purchase' ? (normalizedBills as PurchaseBill[]) : []
      const nextSalesBills = activeTab === 'sales' ? (normalizedBills as SalesBill[]) : []
      setPurchaseBills(nextPurchaseBills)
      setSalesBills(nextSalesBills)

      const paymentsRaw = await paymentsResponse.json().catch(() => [])
      const paymentsData = Array.isArray(paymentsRaw) ? paymentsRaw : []
      const normalizedPayments: Payment[] = paymentsData.map((payment: Payment) => ({
        ...payment,
        amount: clampNonNegative(payment.amount),
        status: payment.status === 'pending' ? 'pending' : 'paid'
      }))
      setPayments(normalizedPayments)
      setClientCache(cacheKey, {
        purchaseBills: nextPurchaseBills,
        salesBills: nextSalesBills,
        payments: normalizedPayments
      })

      setLoading(false)
    } catch (error) {
      if (isAbortError(error)) return
      console.error('Error fetching data:', error)
      setPurchaseBills([])
      setSalesBills([])
      setPayments([])
      setLoading(false)
    }
  }, [activeTab, router])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await fetchData()
    })()
    return () => {
      cancelled = true
    }
  }, [fetchData])

  const handleMakePayment = (billId: string) => {
    const route = activeTab === 'purchase' ? '/payment/purchase/entry' : '/payment/sales/entry'
    router.push(`${route}?billId=${billId}`)
  }

  const handleEditBill = (billId: string, billType: 'purchase' | 'sales' = activeTab) => {
    const route = billType === 'purchase' ? '/purchase/edit' : '/sales/entry'
    const query = companyId
      ? `billId=${billId}&companyId=${encodeURIComponent(companyId)}`
      : `billId=${billId}`
    router.push(`${route}?${query}`)
  }

  const openPaymentEditor = (payment: Payment) => {
    setEditingPaymentId(payment.id)
    setPaymentDraft({
      payDate: toDateInputValue(payment.payDate),
      amount: String(clampNonNegative(payment.amount)),
      mode: payment.mode === 'bank' ? 'bank' : payment.mode === 'online' ? 'online' : 'cash',
      status: payment.status === 'pending' ? 'pending' : 'paid',
      txnRef: payment.txnRef || '',
      note: payment.note || ''
    })
    setIsEditPaymentOpen(true)
  }

  const handleUpdatePayment = async () => {
    if (!editingPaymentId) return
    const amount = Number(paymentDraft.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Enter a valid payment amount.')
      return
    }
    if (!paymentDraft.payDate) {
      alert('Payment date is required.')
      return
    }

    setSavingPayment(true)
    try {
      const response = await fetch(`/api/payments/${editingPaymentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payDate: paymentDraft.payDate,
          amount,
          mode: paymentDraft.mode,
          status: paymentDraft.status,
          txnRef: paymentDraft.txnRef.trim() || null,
          note: paymentDraft.note.trim() || null
        })
      })
      const payload = await response.json().catch(() => ({} as { error?: string }))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update payment')
      }
      await fetchData()
      setIsEditPaymentOpen(false)
      setEditingPaymentId('')
      alert('Payment entry updated successfully.')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update payment')
    } finally {
      setSavingPayment(false)
    }
  }

  const currentBills = useMemo(
    () => (activeTab === 'purchase' ? purchaseBills : salesBills),
    [activeTab, purchaseBills, salesBills]
  )

  const pendingCurrentBills = useMemo(
    () => currentBills.filter((bill) => clampNonNegative(bill.balanceAmount) > 0),
    [currentBills]
  )

  const totalPending = useMemo(
    () => currentBills.reduce((sum, bill) => sum + clampNonNegative(bill.balanceAmount), 0),
    [currentBills]
  )

  const totalPaid = useMemo(() => {
    return currentBills.reduce((sum, bill) => {
      if (activeTab === 'purchase') {
        return sum + clampNonNegative((bill as PurchaseBill).paidAmount)
      } else {
        return sum + clampNonNegative((bill as SalesBill).receivedAmount)
      }
    }, 0)
  }, [activeTab, currentBills])

  const getBillName = (bill: PurchaseBill | SalesBill) => {
    if (activeTab === 'purchase') {
      return (bill as PurchaseBill).supplier?.name || (bill as PurchaseBill).farmer?.name || '-'
    } else {
      return (bill as SalesBill).party?.name || '-'
    }
  }

  const paymentPartyOptions = useMemo(() => {
    const unique = Array.from(new Set(payments.map((payment) => payment.partyName || '').filter(Boolean)))
    return unique.sort((a, b) => a.localeCompare(b))
  }, [payments])

  const filteredPayments = useMemo(() => {
    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null
    const toDate = dateTo ? new Date(`${dateTo}T23:59:59`) : null

    return payments
      .filter((payment) => {
        if (partyFilter !== 'all' && payment.partyName !== partyFilter) return false
        if (modeFilter !== 'all' && payment.mode !== modeFilter) return false

        const paymentDate = new Date(payment.payDate)
        if (fromDate && paymentDate < fromDate) return false
        if (toDate && paymentDate > toDate) return false
        return true
      })
      .sort((a, b) => {
        const aTime = new Date(a.payDate).getTime()
        const bTime = new Date(b.payDate).getTime()
        return bTime - aTime
      })
  }, [payments, partyFilter, modeFilter, dateFrom, dateTo])

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
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">Payment Management</h1>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => router.push('/main/dashboard')}>
                Back to Dashboard
              </Button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Total {activeTab === 'purchase' ? 'Purchase' : 'Sales'} Amount</p>
                  <p className="text-2xl font-bold text-blue-600">
                    ₹{currentBills.reduce((sum, bill) => sum + clampNonNegative(bill.totalAmount), 0).toFixed(2)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Total {activeTab === 'purchase' ? 'Paid' : 'Received'}</p>
                  <p className="text-2xl font-bold text-green-600">
                    ₹{totalPaid.toFixed(2)}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Total Pending</p>
                  <p className="text-2xl font-bold text-red-600">
                    ₹{totalPending.toFixed(2)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tab Navigation */}
          <div className="flex space-x-1 mb-6 border-b">
            <button
              onClick={() => setActiveTab('purchase')}
              className={`px-4 py-2 font-medium text-sm ${
                activeTab === 'purchase'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Purchase Payments
            </button>
            <button
              onClick={() => setActiveTab('sales')}
              className={`px-4 py-2 font-medium text-sm ${
                activeTab === 'sales'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sales Receipts
            </button>
          </div>

          {/* Bills Table */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>
                {activeTab === 'purchase' ? 'Purchase Bills' : 'Sales Bills'} - Pending Payments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill No</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>{activeTab === 'purchase' ? 'Supplier' : 'Party'}</TableHead>
                      <TableHead>Total Amount</TableHead>
                      <TableHead>{activeTab === 'purchase' ? 'Paid' : 'Received'}</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingCurrentBills.map((bill) => (
                      <TableRow key={bill.id}>
                        <TableCell>{bill.billNo}</TableCell>
                        <TableCell>{formatDateSafe(bill.billDate)}</TableCell>
                        <TableCell>{getBillName(bill)}</TableCell>
                        <TableCell>₹{clampNonNegative(bill.totalAmount).toFixed(2)}</TableCell>
                        <TableCell>
                          ₹{(activeTab === 'purchase'
                            ? clampNonNegative((bill as PurchaseBill).paidAmount)
                            : clampNonNegative((bill as SalesBill).receivedAmount)).toFixed(2)}
                        </TableCell>
                        <TableCell>₹{clampNonNegative(bill.balanceAmount).toFixed(2)}</TableCell>
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
                              onClick={() => handleMakePayment(bill.id)}
                              disabled={clampNonNegative(bill.balanceAmount) === 0}
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              Pay
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => router.push(`/${activeTab}/view?billId=${bill.id}`)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditBill(bill.id)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {pendingCurrentBills.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-gray-500">
                          No pending bills found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Payment History */}
          <Card>
            <CardHeader>
              <CardTitle>Payment History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-5">
                <div>
                  <Label htmlFor="partyFilter">Party</Label>
                  <Select value={partyFilter} onValueChange={setPartyFilter}>
                    <SelectTrigger id="partyFilter">
                      <SelectValue placeholder="All parties" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Parties</SelectItem>
                      {paymentPartyOptions.map((partyName) => (
                        <SelectItem key={partyName} value={partyName}>
                          {partyName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="modeFilter">Bank/Mode</Label>
                  <Select
                    value={modeFilter}
                    onValueChange={(value: 'all' | 'cash' | 'online' | 'bank') => setModeFilter(value)}
                  >
                    <SelectTrigger id="modeFilter">
                      <SelectValue placeholder="All modes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Modes</SelectItem>
                      <SelectItem value="bank">Bank Transfer</SelectItem>
                      <SelectItem value="online">Online</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="dateFrom">Date From</Label>
                  <Input id="dateFrom" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="dateTo">Date To</Label>
                  <Input id="dateTo" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setPartyFilter('all')
                      setModeFilter('all')
                      setDateFrom('')
                      setDateTo('')
                    }}
                  >
                    Clear Filters
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill No</TableHead>
                      <TableHead>{activeTab === 'purchase' ? 'Supplier' : 'Party'}</TableHead>
                      <TableHead>Payment Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Transaction Ref</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{payment.billNo}</TableCell>
                        <TableCell>{payment.partyName}</TableCell>
                        <TableCell>{formatDateSafe(payment.payDate)}</TableCell>
                        <TableCell>₹{clampNonNegative(payment.amount).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{payment.mode}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={payment.status === 'paid' ? 'default' : 'secondary'}>
                            {payment.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{payment.txnRef || '-'}</TableCell>
                        <TableCell>{payment.note || '-'}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => openPaymentEditor(payment)}>
                              <Edit className="mr-1 h-4 w-4" />
                              Edit Entry
                            </Button>
                            {payment.billType === 'sales' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEditBill(payment.billId, payment.billType)}
                              >
                                Edit Bill
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredPayments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-gray-500">
                          No payment history found for selected filters
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Dialog
            open={isEditPaymentOpen}
            onOpenChange={(open) => {
              if (savingPayment) return
              setIsEditPaymentOpen(open)
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Payment Entry</DialogTitle>
              </DialogHeader>

              <div className="grid gap-4 py-1">
                <div className="grid gap-2">
                  <Label htmlFor="editPayDate">Payment Date</Label>
                  <Input
                    id="editPayDate"
                    type="date"
                    value={paymentDraft.payDate}
                    onChange={(e) => setPaymentDraft((prev) => ({ ...prev, payDate: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="editAmount">Amount</Label>
                  <Input
                    id="editAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={paymentDraft.amount}
                    onChange={(e) => setPaymentDraft((prev) => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="editMode">Mode</Label>
                    <Select
                      value={paymentDraft.mode}
                      onValueChange={(value: 'cash' | 'online' | 'bank') =>
                        setPaymentDraft((prev) => ({ ...prev, mode: value }))
                      }
                    >
                      <SelectTrigger id="editMode">
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="bank">Bank Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="editStatus">Status</Label>
                    <Select
                      value={paymentDraft.status}
                      onValueChange={(value: 'pending' | 'paid') =>
                        setPaymentDraft((prev) => ({ ...prev, status: value }))
                      }
                    >
                      <SelectTrigger id="editStatus">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="editTxnRef">Transaction Ref</Label>
                  <Input
                    id="editTxnRef"
                    value={paymentDraft.txnRef}
                    onChange={(e) => setPaymentDraft((prev) => ({ ...prev, txnRef: e.target.value }))}
                    placeholder="Optional reference"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="editNote">Note</Label>
                  <Input
                    id="editNote"
                    value={paymentDraft.note}
                    onChange={(e) => setPaymentDraft((prev) => ({ ...prev, note: e.target.value }))}
                    placeholder="Optional note"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsEditPaymentOpen(false)}
                  disabled={savingPayment}
                >
                  Cancel
                </Button>
                <Button onClick={handleUpdatePayment} disabled={savingPayment}>
                  {savingPayment ? 'Updating...' : 'Update Entry'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </DashboardLayout>
  )
}
