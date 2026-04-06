'use client'

import { useState, useEffect, useCallback, Suspense, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { PaymentWorkspaceSkeleton } from '@/components/performance/page-placeholders'
import { RefreshOverlay } from '@/components/performance/refresh-overlay'
import { Plus, Eye } from 'lucide-react'
import { matchesAppDataChange, subscribeAppDataChanged } from '@/lib/app-live-data'
import { isAbortError } from '@/lib/http'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { loadClientPaymentWorkspace } from '@/lib/client-payment-workspace'
import { getFinancialYearDateRangeInput } from '@/lib/client-financial-years'
import { useClientFinancialYear } from '@/lib/use-client-financial-year'

interface PurchaseBill {
  id: string
  billNo: string
  billDate: string
  totalAmount: number
  paidAmount: number
  balanceAmount: number
  status: string
  farmer?: {
    name: string
    address: string
    krashakAnubandhNumber: string
  } | null
  supplier?: {
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
  billType: string
  billId: string
  billNo: string
  partyName: string
  payDate: string
  amount: number
  mode: 'cash' | 'online' | 'bank'
  txnRef?: string
  note?: string
  createdAt: string
}

const clampNonNegative = (value: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

export default function PaymentPage() {
  return (
    <Suspense fallback={<AppLoaderShell kind="payment" fullscreen />}>
      <PaymentPageContent />
    </Suspense>
  )
}

function PaymentPageContent() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { financialYear } = useClientFinancialYear()
  const hasVisibleDataRef = useRef(false)

  const [activeTab, setActiveTab] = useState<'purchase' | 'sales'>('purchase')
  const [purchaseBills, setPurchaseBills] = useState<PurchaseBill[]>([])
  const [salesBills, setSalesBills] = useState<SalesBill[]>([])
  const [payments, setPayments] = useState<Payment[]>([])

  // Filter states
  const [filterBillType, setFilterBillType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const cacheKey = companyId ? `payment-page:${companyId}` : ''

  useEffect(() => {
    hasVisibleDataRef.current = purchaseBills.length > 0 || salesBills.length > 0 || payments.length > 0
  }, [payments.length, purchaseBills.length, salesBills.length])

  useEffect(() => {
    const range = getFinancialYearDateRangeInput(financialYear)
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
  }, [financialYear?.id])

  const fetchPaymentData = useCallback(async (
    isCancelled: () => boolean = () => false,
    options: { background?: boolean } = {}
  ) => {
    let hydratedFromCache = false
    try {
      if (isCancelled()) return
      setErrorMessage(null)

      if (cacheKey) {
        const cached = getClientCache<{
          purchaseBills: PurchaseBill[]
          salesBills: SalesBill[]
          payments: Payment[]
        }>(cacheKey, 15_000)
        if (cached) {
          hydratedFromCache = true
          setPurchaseBills(cached.purchaseBills)
          setSalesBills(cached.salesBills)
          setPayments(cached.payments)
          setLoading(false)
        }
      }

      const shouldUseBlockingLoader = !options.background && !hasVisibleDataRef.current && !hydratedFromCache
      if (shouldUseBlockingLoader) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      if (isCancelled()) return

      const workspace = await loadClientPaymentWorkspace(companyId, {
        force: options.background ? true : false
      })
      if (isCancelled()) return

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
            amount: clampNonNegative(payment.amount)
          }))
        : []
      
      setPurchaseBills(safePurchaseBills)
      setSalesBills(safeSalesBills)
      setPayments(safePayments)
      if (cacheKey) {
        setClientCache(cacheKey, {
          purchaseBills: safePurchaseBills,
          salesBills: safeSalesBills,
          payments: safePayments
        })
      }

      setLoading(false)
      setRefreshing(false)
    } catch (error) {
      if (isCancelled() || isAbortError(error)) return
      console.error('Error fetching payment data:', error)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh payment workspace.')
      setLoading(false)
      setRefreshing(false)
    }
  }, [cacheKey, companyId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return
      if (!resolvedCompanyId) {
        setLoading(false)
        router.push('/main/profile')
        return
      }
      setCompanyId(resolvedCompanyId)
      stripCompanyParamsFromUrl()
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    ;(async () => {
      await fetchPaymentData(() => cancelled)
    })()
    return () => {
      cancelled = true
    }
  }, [companyId, fetchPaymentData])

  useEffect(() => {
    const unsubscribe = subscribeAppDataChanged((detail) => {
      if (matchesAppDataChange(detail, companyId, ['purchase-bills', 'sales-bills', 'payments'])) {
        void fetchPaymentData(() => false, { background: true })
      }
    })

    const onCompanyChanged = (event: Event) => {
      const nextCompanyId = (event as CustomEvent<{ companyId?: string }>).detail?.companyId?.trim() || ''
      if (!nextCompanyId || nextCompanyId === companyId) return
      setCompanyId(nextCompanyId)
    }

    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)

    return () => {
      unsubscribe()
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [companyId, fetchPaymentData])

  const getPurchasePartyName = (bill: PurchaseBill) => {
    return bill.supplier?.name || bill.farmer?.name || 'Unknown'
  }

  const getFilteredPayments = () => {
    let filtered = payments

    if (filterBillType && filterBillType !== 'all') {
      filtered = filtered.filter(payment => payment.billType === filterBillType)
    }

    if (dateFrom) {
      filtered = filtered.filter(payment => new Date(payment.payDate) >= new Date(dateFrom))
    }

    if (dateTo) {
      filtered = filtered.filter(payment => new Date(payment.payDate) <= new Date(dateTo))
    }

    return filtered.sort((a, b) => new Date(b.payDate).getTime() - new Date(a.payDate).getTime())
  }

  const getPaymentStats = () => ({
    totalPayments: payments.reduce((sum, payment) => sum + clampNonNegative(payment.amount), 0),
    purchasePayments: payments.filter(p => p.billType === 'purchase').reduce((sum, p) => sum + clampNonNegative(p.amount), 0),
    salesReceipts: payments.filter(p => p.billType === 'sales').reduce((sum, p) => sum + clampNonNegative(p.amount), 0),
    count: payments.length
  })

  const handleMakePayment = (billId: string, billType: 'purchase' | 'sales') => {
    const route = billType === 'purchase' ? '/payment/purchase/entry' : '/payment/sales/entry'
    router.push(`${route}?billId=${billId}`)
  }

  const handleViewBill = (billId: string, billType: 'purchase' | 'sales') => {
    router.push(`/${billType}/view?billId=${billId}`)
  }

  const hasPaymentData = purchaseBills.length > 0 || salesBills.length > 0 || payments.length > 0

  if (loading && !companyId && !hasPaymentData) {
    return <AppLoaderShell kind="payment" companyId={companyId} />
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          {errorMessage ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {errorMessage}
            </div>
          ) : null}

          {loading && !hasPaymentData ? (
            <PaymentWorkspaceSkeleton />
          ) : (
            <>
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">Payment Management</h1>
            <div className="flex gap-2">
              <Button onClick={() => router.push('/payment/dashboard')}>
                <Plus className="w-4 h-4 mr-2" />
                Record Payment
              </Button>
              <Button variant="outline" onClick={() => router.push('/payment/journal-voucher/entry')}>
                <Plus className="w-4 h-4 mr-2" />
                Journal Voucher
              </Button>
              <Button variant="outline" onClick={() => router.push('/main/dashboard')}>
                Back to Dashboard
              </Button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="relative mb-6">
            <RefreshOverlay refreshing={refreshing} label="Refreshing payment totals" />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Total Payments</p>
                  <p className="text-2xl font-bold text-blue-600">₹{getPaymentStats().totalPayments.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Purchase Payments</p>
                  <p className="text-2xl font-bold text-red-600">₹{getPaymentStats().purchasePayments.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Sales Receipts</p>
                  <p className="text-2xl font-bold text-green-600">₹{getPaymentStats().salesReceipts.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Transactions</p>
                  <p className="text-2xl font-bold text-purple-600">{getPaymentStats().count}</p>
                </div>
              </CardContent>
            </Card>
            </div>
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
          <Card className="relative mb-6">
            <RefreshOverlay refreshing={refreshing} label="Refreshing pending bills" />
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
                    {(activeTab === 'purchase' ? purchaseBills : salesBills)
                      .filter((bill) => clampNonNegative(bill.balanceAmount) > 0)
                      .map((bill) => (
                      <TableRow key={bill.id}>
                        <TableCell>{bill.billNo}</TableCell>
                        <TableCell>{new Date(bill.billDate).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {activeTab === 'purchase' 
                            ? getPurchasePartyName(bill as PurchaseBill)
                            : (bill as SalesBill).party.name
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
          <Card className="relative">
            <RefreshOverlay refreshing={refreshing} label="Refreshing payment history" />
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
                    {getFilteredPayments().map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{new Date(payment.payDate).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {payment.billType === 'purchase' ? 'Purchase' : 'Sales'}
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
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
