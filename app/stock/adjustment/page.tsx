'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, ArrowLeft, BarChart3, Package, Scale } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Product {
  id: string
  name: string
  unit: string
  currentStock: number
}

interface StockLedgerEntry {
  id: string
  entryDate: string
  type: 'purchase' | 'sales' | 'adjustment'
  qtyIn: number
  qtyOut: number
  refTable: string
  refId: string
  product: {
    id: string
    name: string
  }
}

interface ProductMetrics {
  productId: string
  productName: string
  unit: string
  currentStock: number
  totalIn: number
  totalOut: number
  adjustmentEntries: number
  movementCount: number
  lastMovementDate: string | null
}

type AdjustmentType = 'in' | 'out'

function normalizeProducts(payload: unknown): Product[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: Product[] }).data
      : []

  return rows
    .map((product) => ({
      id: String(product?.id || ''),
      name: String(product?.name || ''),
      unit: String(product?.unit || ''),
      currentStock: Number(product?.currentStock || 0)
    }))
    .filter((product) => product.id && product.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeLedger(payload: unknown): StockLedgerEntry[] {
  const rows = Array.isArray(payload) ? payload : []

  return rows
    .map((entry) => ({
      id: String(entry?.id || ''),
      entryDate: String(entry?.entryDate || ''),
      type: entry?.type === 'purchase' || entry?.type === 'sales' || entry?.type === 'adjustment' ? entry.type : 'adjustment',
      qtyIn: Number(entry?.qtyIn || 0),
      qtyOut: Number(entry?.qtyOut || 0),
      refTable: String(entry?.refTable || ''),
      refId: String(entry?.refId || ''),
      product: {
        id: String(entry?.product?.id || ''),
        name: String(entry?.product?.name || '')
      }
    }))
    .filter((entry) => entry.id && entry.product.id)
}

function toNonNegative(value: string): string {
  if (value === '') return ''
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return ''
  return String(Math.max(0, parsed))
}

function formatDate(value: string | null): string {
  if (!value) return 'No movement yet'
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString() : 'No movement yet'
}

function formatQuantity(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

function formatReference(value: string): string {
  return value.replace(/_/g, ' ')
}

export default function StockAdjustmentPage() {
  const router = useRouter()

  const [companyId, setCompanyId] = useState('')
  const [pageLoading, setPageLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [stockLedger, setStockLedger] = useState<StockLedgerEntry[]>([])

  const [selectedProduct, setSelectedProduct] = useState('')
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().split('T')[0])
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('in')
  const [quantity, setQuantity] = useState('')
  const [remark, setRemark] = useState('')

  const fetchStockContext = useCallback(async (targetCompanyId: string, isCancelled: () => boolean = () => false) => {
    try {
      const [productsResponse, ledgerResponse] = await Promise.all([
        fetch(`/api/products?companyId=${encodeURIComponent(targetCompanyId)}`, { cache: 'no-store' }),
        fetch(`/api/stock-ledger?companyId=${encodeURIComponent(targetCompanyId)}`, { cache: 'no-store' })
      ])

      if (!productsResponse.ok || !ledgerResponse.ok) {
        throw new Error('Failed to load stock data')
      }

      const [productsPayload, ledgerPayload] = await Promise.all([
        productsResponse.json().catch(() => []),
        ledgerResponse.json().catch(() => [])
      ])

      if (isCancelled()) return

      const nextProducts = normalizeProducts(productsPayload)
      const nextLedger = normalizeLedger(ledgerPayload)

      setProducts(nextProducts)
      setStockLedger(nextLedger)
      setSelectedProduct((current) => {
        if (current && nextProducts.some((product) => product.id === current)) {
          return current
        }
        return nextProducts.find((product) => product.currentStock > 0)?.id || nextProducts[0]?.id || ''
      })
    } catch (error) {
      if (isCancelled()) return
      console.error('Error fetching stock data:', error)
      setProducts([])
      setStockLedger([])
    } finally {
      if (!isCancelled()) {
        setPageLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return

      if (!resolvedCompanyId) {
        setPageLoading(false)
        alert('Company not selected')
        router.push('/company/select')
        return
      }

      setCompanyId(resolvedCompanyId)
      stripCompanyParamsFromUrl()
      await fetchStockContext(resolvedCompanyId, () => cancelled)
    })()

    return () => {
      cancelled = true
    }
  }, [fetchStockContext, router])

  const productMetrics = useMemo(() => {
    const summary = new Map<string, ProductMetrics>()

    products.forEach((product) => {
      summary.set(product.id, {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        currentStock: Number(product.currentStock || 0),
        totalIn: 0,
        totalOut: 0,
        adjustmentEntries: 0,
        movementCount: 0,
        lastMovementDate: null
      })
    })

    stockLedger.forEach((entry) => {
      const metric = summary.get(entry.product.id)
      if (!metric) return

      metric.totalIn += Number(entry.qtyIn || 0)
      metric.totalOut += Number(entry.qtyOut || 0)
      metric.movementCount += 1
      if (entry.type === 'adjustment') {
        metric.adjustmentEntries += 1
      }
      if (!metric.lastMovementDate || new Date(entry.entryDate).getTime() > new Date(metric.lastMovementDate).getTime()) {
        metric.lastMovementDate = entry.entryDate
      }
    })

    return summary
  }, [products, stockLedger])

  const selectedProductData = products.find((product) => product.id === selectedProduct) || null
  const selectedProductMetrics = selectedProduct ? productMetrics.get(selectedProduct) || null : null

  const selectedProductMovements = useMemo(
    () =>
      stockLedger
        .filter((entry) => !selectedProduct || entry.product.id === selectedProduct)
        .sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
        .slice(0, 6),
    [selectedProduct, stockLedger]
  )

  const recentAdjustments = useMemo(
    () =>
      stockLedger
        .filter((entry) => entry.type === 'adjustment')
        .sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
        .slice(0, 8),
    [stockLedger]
  )

  const stockWatchlist = useMemo(
    () =>
      Array.from(productMetrics.values())
        .sort((a, b) => a.currentStock - b.currentStock || b.totalOut - a.totalOut || b.movementCount - a.movementCount)
        .slice(0, 6),
    [productMetrics]
  )

  const adjustmentQuantity = Number(quantity || 0)
  const projectedStock = selectedProductMetrics
    ? selectedProductMetrics.currentStock + (adjustmentType === 'in' ? adjustmentQuantity : -adjustmentQuantity)
    : 0
  const canRecordOut = !selectedProductMetrics || adjustmentQuantity <= selectedProductMetrics.currentStock
  const lowStockCount = Array.from(productMetrics.values()).filter((product) => product.currentStock <= 0).length
  const totalStock = Array.from(productMetrics.values()).reduce((sum, product) => sum + product.currentStock, 0)
  const totalAdjustmentEntries = stockLedger.filter((entry) => entry.type === 'adjustment').length

  const resetForm = () => {
    setAdjustmentType('in')
    setQuantity('')
    setRemark('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!companyId) {
      alert('Company not selected')
      return
    }

    if (!selectedProduct) {
      alert('Please select a product')
      return
    }

    if (!quantity) {
      alert('Please enter adjustment quantity')
      return
    }

    if (!Number.isFinite(adjustmentQuantity) || adjustmentQuantity <= 0) {
      alert('Adjustment quantity must be greater than 0')
      return
    }

    if (adjustmentType === 'out' && selectedProductMetrics && adjustmentQuantity > selectedProductMetrics.currentStock) {
      alert(`Stock out cannot exceed current stock (${formatQuantity(selectedProductMetrics.currentStock)} ${selectedProductMetrics.unit})`)
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/stock/adjustment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          companyId,
          productId: selectedProduct,
          adjustmentDate,
          adjustmentType,
          quantity: adjustmentQuantity,
          remark: remark.trim() || null
        })
      })

      const payload = await response.json().catch(() => ({} as { error?: string; currentStockAfter?: number; unit?: string }))

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to record stock adjustment')
      }

      await fetchStockContext(companyId)
      setQuantity('')
      setRemark('')

      const nextStock =
        typeof payload.currentStockAfter === 'number'
          ? ` Updated stock: ${formatQuantity(payload.currentStockAfter)} ${payload.unit || selectedProductData?.unit || ''}`
          : ''

      alert(`Stock ${adjustmentType === 'in' ? 'in' : 'out'} recorded successfully.${nextStock}`)
    } catch (error) {
      console.error('Error recording adjustment:', error)
      alert(error instanceof Error ? error.message : 'Failed to record stock adjustment')
    } finally {
      setSubmitting(false)
    }
  }

  if (pageLoading) {
    return (
      <DashboardLayout companyId={companyId}>
        <div className="flex h-64 items-center justify-center text-lg">Loading...</div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={() => router.push('/stock/dashboard')}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Badge variant="outline" className="rounded-full px-3 py-1 text-xs uppercase tracking-[0.16em]">
                  Stock Control
                </Badge>
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Stock Adjustment Center</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">
                  Record both stock in and stock out with impact preview, live stock context, and recent movement visibility.
                </p>
              </div>
            </div>
            <div className="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-4 lg:w-auto lg:min-w-[560px]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Total Products</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{products.length}</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-emerald-700">Current Stock</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-700">{formatQuantity(totalStock)}</p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-amber-700">Attention Needed</p>
                <p className="mt-2 text-2xl font-semibold text-amber-700">{lowStockCount}</p>
              </div>
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-sky-700">Adjustments Logged</p>
                <p className="mt-2 text-2xl font-semibold text-sky-700">{totalAdjustmentEntries}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-2xl tracking-tight">
                  <Activity className="h-5 w-5 text-slate-500" />
                  Record Adjustment
                </CardTitle>
                <p className="text-sm text-slate-600">
                  Use this page for official stock corrections. Stock out is blocked beyond available balance, while stock in is open for inward correction.
                </p>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="product">Product</Label>
                      <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                        <SelectTrigger id="product">
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.length === 0 ? (
                            <SelectItem value="no-products" disabled>
                              No products found
                            </SelectItem>
                          ) : (
                            products.map((product) => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.name} ({formatQuantity(product.currentStock)} {product.unit})
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="adjustmentDate">Date</Label>
                      <Input
                        id="adjustmentDate"
                        type="date"
                        value={adjustmentDate}
                        onChange={(e) => setAdjustmentDate(e.target.value)}
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="adjustmentType">Adjustment Type</Label>
                      <Select value={adjustmentType} onValueChange={(value: AdjustmentType) => setAdjustmentType(value)}>
                        <SelectTrigger id="adjustmentType">
                          <SelectValue placeholder="Select adjustment type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in">Stock In</SelectItem>
                          <SelectItem value="out">Stock Out</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="quantity">Quantity ({selectedProductData?.unit || 'qty'})</Label>
                      <Input
                        id="quantity"
                        type="number"
                        min="0"
                        step="0.01"
                        value={quantity}
                        onChange={(e) => setQuantity(toNonNegative(e.target.value))}
                        placeholder="Enter quantity"
                        required
                      />
                      {adjustmentType === 'out' && selectedProductMetrics ? (
                        <p className="text-xs text-slate-500">
                          Maximum allowed stock out: {formatQuantity(selectedProductMetrics.currentStock)} {selectedProductMetrics.unit}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="remark">Reason / Remark</Label>
                    <textarea
                      id="remark"
                      className="min-h-[120px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      placeholder={
                        adjustmentType === 'in'
                          ? 'Enter inward reason (manual correction, return, counted stock received, etc.)'
                          : 'Enter outward reason (damage, wastage, stock loss, physical correction, etc.)'
                      }
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-4 flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-slate-500" />
                      <p className="text-sm font-medium text-slate-900">Adjustment Impact Preview</p>
                    </div>
                    {selectedProductMetrics ? (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Current Stock</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-950">
                            {formatQuantity(selectedProductMetrics.currentStock)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{selectedProductMetrics.unit}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">This Adjustment</p>
                          <p className={`mt-2 text-2xl font-semibold ${adjustmentType === 'in' ? 'text-emerald-700' : 'text-rose-600'}`}>
                            {adjustmentType === 'in' ? '+' : '-'}
                            {formatQuantity(adjustmentQuantity)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{adjustmentType === 'in' ? 'Stock coming in' : 'Stock going out'}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Projected Stock</p>
                          <p className={`mt-2 text-2xl font-semibold ${projectedStock >= 0 ? 'text-slate-950' : 'text-rose-600'}`}>
                            {formatQuantity(projectedStock)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{projectedStock < 0 ? 'Will be blocked on save' : 'Expected closing stock'}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">Select a product to preview the impact before saving.</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Reset
                    </Button>
                    <Button type="submit" disabled={submitting || !selectedProduct || (adjustmentType === 'out' && !canRecordOut)}>
                      {submitting ? 'Saving...' : adjustmentType === 'in' ? 'Record Stock In' : 'Record Stock Out'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-2xl tracking-tight">
                  <Package className="h-5 w-5 text-slate-500" />
                  Product Insight
                </CardTitle>
                <p className="text-sm text-slate-600">Live movement context for the selected product so users can adjust with confidence.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedProductMetrics ? (
                  <>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold text-slate-950">{selectedProductMetrics.productName}</p>
                          <p className="mt-1 text-sm text-slate-500">Last movement: {formatDate(selectedProductMetrics.lastMovementDate)}</p>
                        </div>
                        <Badge variant={selectedProductMetrics.currentStock > 0 ? 'default' : 'destructive'}>
                          {selectedProductMetrics.currentStock > 0 ? 'Available' : 'Needs stock'}
                        </Badge>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Total In</p>
                        <p className="mt-2 text-2xl font-semibold text-emerald-700">{formatQuantity(selectedProductMetrics.totalIn)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Total Out</p>
                        <p className="mt-2 text-2xl font-semibold text-rose-600">{formatQuantity(selectedProductMetrics.totalOut)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Current Balance</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">{formatQuantity(selectedProductMetrics.currentStock)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Adjustment Entries</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">{selectedProductMetrics.adjustmentEntries}</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Scale className="h-4 w-4 text-slate-500" />
                        <p className="text-sm font-medium text-slate-900">Recent Movement</p>
                      </div>
                      {selectedProductMovements.length > 0 ? (
                        <div className="space-y-3">
                          {selectedProductMovements.map((entry) => (
                            <div key={entry.id} className="flex items-center justify-between rounded-2xl border border-slate-200 px-3 py-3">
                              <div>
                                <p className="text-sm font-medium text-slate-900">{formatReference(entry.refTable)}</p>
                                <p className="text-xs text-slate-500">{formatDate(entry.entryDate)}</p>
                              </div>
                              <div className="text-right">
                                <p className={`text-sm font-semibold ${entry.qtyIn > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                                  {entry.qtyIn > 0 ? `+${formatQuantity(entry.qtyIn)}` : `-${formatQuantity(entry.qtyOut)}`}
                                </p>
                                <p className="text-xs text-slate-500">{entry.type}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">No movement found for this product yet.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    Select a product to view movement trend, total in/out, and recent adjustment behavior.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-2xl tracking-tight">
                  <Activity className="h-5 w-5 text-slate-500" />
                  Recent Adjustments
                </CardTitle>
                <p className="text-sm text-slate-600">Latest stock corrections across the company, useful for quick audit and review.</p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Direction</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead>Reference</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentAdjustments.length > 0 ? (
                        recentAdjustments.map((entry) => {
                          const isIn = entry.qtyIn > 0
                          return (
                            <TableRow key={entry.id}>
                              <TableCell>{formatDate(entry.entryDate)}</TableCell>
                              <TableCell className="font-medium">{entry.product.name}</TableCell>
                              <TableCell>
                                <Badge variant={isIn ? 'default' : 'secondary'}>
                                  {isIn ? 'Stock In' : 'Stock Out'}
                                </Badge>
                              </TableCell>
                              <TableCell className={`text-right font-medium ${isIn ? 'text-emerald-700' : 'text-rose-600'}`}>
                                {isIn ? formatQuantity(entry.qtyIn) : formatQuantity(entry.qtyOut)}
                              </TableCell>
                              <TableCell>{formatReference(entry.refTable)}</TableCell>
                            </TableRow>
                          )
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                            No adjustment history found yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-2xl tracking-tight">
                  <Package className="h-5 w-5 text-slate-500" />
                  Stock Watchlist
                </CardTitle>
                <p className="text-sm text-slate-600">Products that need attention first based on current balance and outward movement pressure.</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {stockWatchlist.length > 0 ? (
                  stockWatchlist.map((product) => (
                    <div key={product.productId} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">{product.productName}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            In {formatQuantity(product.totalIn)} / Out {formatQuantity(product.totalOut)} / Moves {product.movementCount}
                          </p>
                        </div>
                        <Badge variant={product.currentStock > 0 ? 'outline' : 'destructive'}>
                          {product.currentStock > 0 ? 'Monitor' : 'Low / Zero'}
                        </Badge>
                      </div>
                      <div className="mt-4 flex items-center justify-between text-sm">
                        <span className="text-slate-500">Current stock</span>
                        <span className={`font-semibold ${product.currentStock > 0 ? 'text-slate-950' : 'text-rose-600'}`}>
                          {formatQuantity(product.currentStock)} {product.unit}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No products available to analyse yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
