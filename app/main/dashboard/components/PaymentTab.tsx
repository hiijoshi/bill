'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TaskLoader } from '@/components/loaders/task-loader'
import { Plus, Eye, Upload } from 'lucide-react'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { matchesAppDataChange, subscribeAppDataChanged } from '@/lib/app-live-data'
import {
  getPaymentTypeLabel,
  isIncomingCashflowPaymentType,
  isOutgoingCashflowPaymentType,
  isPaymentEntryType
} from '@/lib/payment-entry-types'
import { loadClientPaymentWorkspace } from '@/lib/client-payment-workspace'

interface PurchaseBill {
  id: string
  billNo: string
  billDate: string
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  supplier?: {
    name?: string
  }
  farmer?: {
    name?: string
  }
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
    name?: string
  }
}

interface Payment {
  id: string
  billType: string
  billTypeLabel?: string
  billId: string
  billNo: string
  partyName: string
  payDate: string
  amount: number
  mode: string
  txnRef?: string
  note?: string
  createdAt: string
}

interface PaymentTabProps {
  companyId: string
  initialPurchaseBills?: PurchaseBill[]
  initialSalesBills?: SalesBill[]
  initialPayments?: Payment[]
}

type PaymentCachePayload = {
  purchaseBills: PurchaseBill[]
  salesBills: SalesBill[]
  payments: Payment[]
}

const PAYMENT_CACHE_AGE_MS = 30_000

const clampNonNegative = (value: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

export default function PaymentTab({
  companyId,
  initialPurchaseBills,
  initialSalesBills,
  initialPayments
}: PaymentTabProps) {
  const router = useRouter()
  const hasInitialData =
    Array.isArray(initialPurchaseBills) &&
    Array.isArray(initialSalesBills) &&
    Array.isArray(initialPayments)
  const paymentCacheKey = `dashboard-payment:${companyId}`
  const cachedPaymentData = getClientCache<PaymentCachePayload>(paymentCacheKey, PAYMENT_CACHE_AGE_MS)
  const [loading, setLoading] = useState(!hasInitialData && !cachedPaymentData)

  const [activeTab, setActiveTab] = useState<'purchase' | 'sales'>('purchase')
  const [purchaseBills, setPurchaseBills] = useState<PurchaseBill[]>(initialPurchaseBills || cachedPaymentData?.purchaseBills || [])
  const [salesBills, setSalesBills] = useState<SalesBill[]>(initialSalesBills || cachedPaymentData?.salesBills || [])
  const [payments, setPayments] = useState<Payment[]>(initialPayments || cachedPaymentData?.payments || [])

  // Filter states
  const [filterBillType, setFilterBillType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchPaymentData = useCallback(async (force = false) => {
    try {
      setLoading(true)

      const cached = force ? null : getClientCache<PaymentCachePayload>(paymentCacheKey, PAYMENT_CACHE_AGE_MS)
      if (cached) {
        setPurchaseBills(cached.purchaseBills)
        setSalesBills(cached.salesBills)
        setPayments(cached.payments)
        setLoading(false)
        return
      }

      const workspace = await loadClientPaymentWorkspace(companyId, {
        force
      })
      const purchaseData = Array.isArray((workspace as { purchaseBills?: PurchaseBill[] }).purchaseBills)
        ? (workspace as { purchaseBills: PurchaseBill[] }).purchaseBills
        : []
      const salesData = Array.isArray((workspace as { salesBills?: SalesBill[] }).salesBills)
        ? (workspace as { salesBills: SalesBill[] }).salesBills
        : []
      const paymentsData = Array.isArray((workspace as { payments?: Payment[] }).payments)
        ? (workspace as { payments: Payment[] }).payments
        : []
      
      const safePurchaseBills = Array.isArray(purchaseData)
        ? purchaseData.map((bill: PurchaseBill) => ({
            ...bill,
            totalAmount: clampNonNegative(bill.totalAmount),
            paidAmount: clampNonNegative(bill.paidAmount),
            balanceAmount: clampNonNegative(bill.balanceAmount)
          }))
        : []
      const safeSalesBills = Array.isArray(salesData)
        ? salesData.map((bill: SalesBill) => ({
            ...bill,
            totalAmount: clampNonNegative(bill.totalAmount),
            receivedAmount: clampNonNegative(bill.receivedAmount),
            balanceAmount: clampNonNegative(bill.balanceAmount)
          }))
        : []
      const safePayments = Array.isArray(paymentsData)
        ? paymentsData.map((payment: Payment) => ({
            ...payment,
            billType: isPaymentEntryType(payment.billType) ? payment.billType : String(payment.billType || '').trim(),
            billTypeLabel: payment.billTypeLabel || getPaymentTypeLabel(payment.billType),
            amount: clampNonNegative(payment.amount)
          }))
        : []

      setPurchaseBills(safePurchaseBills)
      setSalesBills(safeSalesBills)
      setPayments(safePayments)
      setClientCache(paymentCacheKey, {
        purchaseBills: safePurchaseBills,
        salesBills: safeSalesBills,
        payments: safePayments
      })
      
      setLoading(false)
    } catch (error) {
      console.error('Error fetching payment data:', error)
      setLoading(false)
    }
  }, [companyId, paymentCacheKey])

  useEffect(() => {
    if (!hasInitialData) return

    const safePurchaseBills = (initialPurchaseBills || []).map((bill) => ({
      ...bill,
      totalAmount: clampNonNegative(bill.totalAmount),
      paidAmount: clampNonNegative(bill.paidAmount),
      balanceAmount: clampNonNegative(bill.balanceAmount)
    }))
    const safeSalesBills = (initialSalesBills || []).map((bill) => ({
      ...bill,
      totalAmount: clampNonNegative(bill.totalAmount),
      receivedAmount: clampNonNegative(bill.receivedAmount),
      balanceAmount: clampNonNegative(bill.balanceAmount)
    }))
    const safePayments = (initialPayments || []).map((payment) => ({
      ...payment,
      billType: isPaymentEntryType(payment.billType) ? payment.billType : String(payment.billType || '').trim(),
      billTypeLabel: payment.billTypeLabel || getPaymentTypeLabel(payment.billType),
      amount: clampNonNegative(payment.amount)
    }))

    setPurchaseBills(safePurchaseBills)
    setSalesBills(safeSalesBills)
    setPayments(safePayments)
    setClientCache(paymentCacheKey, {
      purchaseBills: safePurchaseBills,
      salesBills: safeSalesBills,
      payments: safePayments
    })
    setLoading(false)
  }, [hasInitialData, initialPayments, initialPurchaseBills, initialSalesBills, paymentCacheKey])

  useEffect(() => {
    if (hasInitialData) return undefined
    if (companyId) {
      const timer = window.setTimeout(() => {
        void fetchPaymentData()
      }, 0)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [companyId, fetchPaymentData, hasInitialData])

  useEffect(() => {
    if (!companyId) return undefined

    const unsubscribe = subscribeAppDataChanged((detail) => {
      if (!matchesAppDataChange(detail, companyId, ['purchase-bills', 'sales-bills', 'payments', 'all'])) {
        return
      }

      void fetchPaymentData(true)
    })

    return unsubscribe
  }, [companyId, fetchPaymentData])

  const purchaseBillsData = useMemo(() => purchaseBills, [purchaseBills])
  const salesBillsData = useMemo(() => salesBills, [salesBills])
  const paymentsData = useMemo(() => payments, [payments])
  const isLoading = loading

  const filteredPayments = useMemo(() => {
    let filtered = paymentsData

    if (filterBillType && filterBillType !== 'all') {
      filtered = filtered.filter((payment) => payment.billType === filterBillType)
    }

    if (dateFrom) {
      filtered = filtered.filter((payment) => new Date(payment.payDate) >= new Date(dateFrom))
    }

    if (dateTo) {
      filtered = filtered.filter((payment) => new Date(payment.payDate) <= new Date(dateTo))
    }

    return filtered.sort((a, b) => new Date(b.payDate).getTime() - new Date(a.payDate).getTime())
  }, [dateFrom, dateTo, filterBillType, paymentsData])

  const paymentStats = useMemo(() => ({
    totalPayments: paymentsData.reduce((sum, payment) => sum + clampNonNegative(payment.amount), 0),
    outgoingPayments: paymentsData
      .filter((payment) => isOutgoingCashflowPaymentType(payment.billType))
      .reduce((sum, payment) => sum + clampNonNegative(payment.amount), 0),
    incomingReceipts: paymentsData
      .filter((payment) => isIncomingCashflowPaymentType(payment.billType))
      .reduce((sum, payment) => sum + clampNonNegative(payment.amount), 0),
    count: paymentsData.length
  }), [paymentsData])

  const handleMakePayment = (billId: string, billType: 'purchase' | 'sales') => {
    const route = billType === 'purchase' ? '/payment/purchase/entry' : '/payment/sales/entry'
    router.push(`${route}?billId=${billId}`)
  }

  const handleViewBill = (billId: string, billType: 'purchase' | 'sales') => {
    router.push(`/${billType}/view?billId=${billId}`)
  }

  if (isLoading) {
    return <TaskLoader kind="payment" compact />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-2xl font-bold">Payment Management</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => router.push('/payment/purchase/entry')}>
            <Plus className="w-4 h-4 mr-2" />
            Record Purchase Payment
          </Button>
          <Button onClick={() => router.push('/payment/sales/entry')}>
            <Plus className="w-4 h-4 mr-2" />
            Record Sales Receipt
          </Button>
          <Button onClick={() => router.push('/payment/cash-bank/entry')}>
            <Plus className="w-4 h-4 mr-2" />
            Cash / Bank Payment
          </Button>
          <Button onClick={() => router.push('/payment/journal-voucher/entry')}>
            <Plus className="w-4 h-4 mr-2" />
            Journal Voucher
          </Button>
          <Button onClick={() => router.push('/payment/bank-statement/upload')}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Bank Statement
          </Button>
          <Button onClick={() => router.push('/payment/cash-bank/entry?entry=self-transfer')}>
            <Plus className="w-4 h-4 mr-2" />
            Self Transfer
          </Button>
          <Button onClick={() => router.push('/payment/dashboard')}>
            <Eye className="w-4 h-4 mr-2" />
            View History
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-gray-600">Total Payments</p>
              <p className="text-2xl font-bold text-blue-600">₹{paymentStats.totalPayments.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-gray-600">Outgoing Payments</p>
              <p className="text-2xl font-bold text-red-600">₹{paymentStats.outgoingPayments.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-gray-600">Incoming Receipts</p>
              <p className="text-2xl font-bold text-green-600">₹{paymentStats.incomingReceipts.toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-gray-600">Transactions</p>
              <p className="text-2xl font-bold text-purple-600">{paymentStats.count}</p>
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

      {/* Bills Section */}
      <Card>
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
                {(activeTab === 'purchase' ? purchaseBillsData : salesBillsData).map((bill) => (
                  <TableRow key={bill.id}>
                    <TableCell>{bill.billNo}</TableCell>
                    <TableCell>{new Date(bill.billDate).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {activeTab === 'purchase' 
                        ? ((bill as PurchaseBill).supplier?.name || (bill as PurchaseBill).farmer?.name || '-')
                        : ((bill as SalesBill).party?.name || '-')
                      }
                    </TableCell>
                    <TableCell>₹{clampNonNegative(bill.totalAmount).toFixed(2)}</TableCell>
                    <TableCell>
                      ₹{(activeTab === 'purchase' 
                        ? clampNonNegative((bill as PurchaseBill).paidAmount)
                        : clampNonNegative((bill as SalesBill).receivedAmount)
                      ).toFixed(2)}
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
                          onClick={() => handleMakePayment(bill.id, activeTab)}
                          disabled={clampNonNegative(bill.balanceAmount) === 0}
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Pay
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewBill(bill.id, activeTab)}
                        >
                          <Eye className="w-4 h-4" />
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

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <Label htmlFor="filterBillType">Bill Type</Label>
              <Select value={filterBillType} onValueChange={setFilterBillType}>
                <SelectTrigger id="filterBillType">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="purchase">Purchase</SelectItem>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="cash_bank_payment">Cash / Bank Payment</SelectItem>
                  <SelectItem value="cash_bank_receipt">Cash / Bank Receipt</SelectItem>
                  <SelectItem value="self_transfer">Self Transfer</SelectItem>
                </SelectContent>
              </Select>
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
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Bill No</TableHead>
                  <TableHead>{activeTab === 'purchase' ? 'Supplier' : 'Party'}</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Transaction Ref</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{new Date(payment.payDate).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {payment.billTypeLabel || getPaymentTypeLabel(payment.billType)}
                      </Badge>
                    </TableCell>
                    <TableCell>{payment.billNo}</TableCell>
                    <TableCell>{payment.partyName}</TableCell>
                    <TableCell>₹{clampNonNegative(payment.amount).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{payment.mode}</Badge>
                    </TableCell>
                    <TableCell>{payment.txnRef || '-'}</TableCell>
                    <TableCell>{payment.note || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
