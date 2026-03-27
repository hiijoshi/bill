'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Eye, Plus, TrendingUp, TrendingDown } from 'lucide-react'
import { deleteClientCacheByPrefix, getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { isAbortError } from '@/lib/http'

interface Product {
  id: string
  name: string
  unit: string
  currentStock?: number
}

interface StockLedger {
  id: string
  entryDate: string
  product: {
    id: string
    name: string
    unit: string
  }
  type: 'purchase' | 'sales' | 'adjustment'
  qtyIn: number
  qtyOut: number
  refTable: string
  refId: string
  createdAt: string
}

interface StockSummary {
  productId: string
  productName: string
  productUnit: string
  totalIn: number
  totalOut: number
  closingStock: number
  movementCount?: number
  adjustmentEntries?: number
  lastMovementDate?: string | null
}

type StockOverviewPayload = {
  products?: Product[]
  summary?: StockSummary[]
  recentEntries?: StockLedger[]
  meta?: {
    totalEntries?: number
    returnedEntries?: number
  }
}

type PaginatedLedgerPayload = {
  data?: StockLedger[]
  meta?: {
    total?: number
  }
}

const clampNonNegative = (value: number): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

const formatSignedQuantity = (value: number): string => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '0.00'
  return parsed.toFixed(2)
}

export default function StockDashboardPage() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [stockSummary, setStockSummary] = useState<StockSummary[]>([])
  const [stockLedger, setStockLedger] = useState<StockLedger[]>([])
  const [loading, setLoading] = useState(true)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [companyId, setCompanyId] = useState('')
  const [totalTransactions, setTotalTransactions] = useState(0)

  // Stock adjustment form
  const [selectedProduct, setSelectedProduct] = useState('')
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().split('T')[0])
  const [adjustmentType, setAdjustmentType] = useState<'in' | 'out'>('in')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false)

  // Filter states
  const [filterProduct, setFilterProduct] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchOverviewData = useCallback(async (targetCompanyId: string) => {
    const overviewCacheKey = `stock-overview:${targetCompanyId}`
    const cachedOverview = getClientCache<StockOverviewPayload>(overviewCacheKey, 30_000)
    if (cachedOverview) {
      setProducts(Array.isArray(cachedOverview.products) ? cachedOverview.products : [])
      setStockSummary(Array.isArray(cachedOverview.summary) ? cachedOverview.summary : [])
      setTotalTransactions(Number(cachedOverview.meta?.totalEntries || 0))
      return
    }

    const params = new URLSearchParams({
      companyId: targetCompanyId,
      mode: 'overview',
      includeRecent: 'false',
      recentLimit: '80'
    })
    const response = await fetch(`/api/stock-ledger?${params.toString()}`)
    if (response.status === 401) {
      router.push('/login')
      return
    }
    if (response.status === 403) {
      setProducts([])
      setStockSummary([])
      setTotalTransactions(0)
      return
    }

    const payload = (await response.json().catch(() => ({}))) as StockOverviewPayload
    const nextProducts = Array.isArray(payload.products) ? payload.products : []
    const nextSummary = Array.isArray(payload.summary) ? payload.summary : []

    setProducts(nextProducts)
    setStockSummary(nextSummary)
    setTotalTransactions(Number(payload.meta?.totalEntries || 0))
    setClientCache(overviewCacheKey, {
      products: nextProducts,
      summary: nextSummary,
      recentEntries: [],
      meta: {
        totalEntries: Number(payload.meta?.totalEntries || 0),
        returnedEntries: Number(payload.meta?.returnedEntries || 0)
      }
    })
  }, [router])

  const fetchLedgerData = useCallback(async (targetCompanyId: string) => {
    const normalizedProductId = filterProduct && filterProduct !== 'all' ? filterProduct : ''
    const normalizedType = filterType && filterType !== 'all' ? filterType : ''
    const ledgerCacheKey = `stock-ledger:${targetCompanyId}:${normalizedProductId}:${normalizedType}:${dateFrom}:${dateTo}`
    const cachedLedger = getClientCache<PaginatedLedgerPayload>(ledgerCacheKey, 15_000)
    if (cachedLedger) {
      setStockLedger(Array.isArray(cachedLedger.data) ? cachedLedger.data : [])
      setLedgerLoading(false)
      return
    }

    setLedgerLoading(true)
    try {
      const params = new URLSearchParams({
        companyId: targetCompanyId,
        page: '1',
        pageSize: '100',
        withMeta: 'true'
      })

      if (normalizedProductId) {
        params.set('productId', normalizedProductId)
      }
      if (normalizedType) {
        params.set('type', normalizedType)
      }
      if (dateFrom) {
        params.set('dateFrom', dateFrom)
      }
      if (dateTo) {
        params.set('dateTo', dateTo)
      }

      const response = await fetch(`/api/stock-ledger?${params.toString()}`)
      if (response.status === 401) {
        router.push('/login')
        return
      }
      if (response.status === 403) {
        setStockLedger([])
        return
      }

      const payload = (await response.json().catch(() => ({}))) as PaginatedLedgerPayload
      const nextLedger = Array.isArray(payload.data) ? payload.data : []
      setStockLedger(nextLedger)
      setClientCache(ledgerCacheKey, {
        data: nextLedger,
        meta: {
          total: Number(payload.meta?.total || 0)
        }
      })
    } finally {
      setLedgerLoading(false)
    }
  }, [dateFrom, dateTo, filterProduct, filterType, router])

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
      const productIdParam = new URLSearchParams(window.location.search).get('productId')?.trim() || ''
      if (productIdParam) {
        setFilterProduct(productIdParam)
      }
      await fetchOverviewData(companyIdParam)
      setLoading(false)
    } catch (error) {
      if (isAbortError(error)) return
      console.error('Error fetching data:', error)
      setProducts([])
      setStockSummary([])
      setStockLedger([])
      setTotalTransactions(0)
      setLoading(false)
    }
  }, [fetchOverviewData, router])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchData()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchData])

  useEffect(() => {
    if (!companyId) return
    const timer = window.setTimeout(() => {
      void fetchLedgerData(companyId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [companyId, dateFrom, dateTo, fetchLedgerData, filterProduct, filterType])

  const selectedStockSummary = useMemo(
    () => stockSummary.find((stock) => stock.productId === selectedProduct) || null,
    [selectedProduct, stockSummary]
  )

  const handleStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedProduct || !quantity) {
      alert('Please select product and enter quantity')
      return
    }

    const parsedQuantity = Number(quantity)
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      alert('Quantity must be greater than 0')
      return
    }

    if (adjustmentType === 'out' && selectedStockSummary && parsedQuantity > selectedStockSummary.closingStock) {
      alert(`Adjustment quantity cannot exceed current stock (${selectedStockSummary.closingStock.toFixed(2)} ${selectedStockSummary.productUnit})`)
      return
    }

    try {
      const response = await fetch('/api/stock/adjustment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyId,
          productId: selectedProduct,
          adjustmentDate,
          adjustmentType,
          quantity: parsedQuantity,
          remark: reason.trim() || null
        }),
      })

      const payload = await response.json().catch(() => ({} as { error?: string; currentStockAfter?: number; unit?: string }))

      if (response.ok) {
        const stockAfter =
          typeof payload.currentStockAfter === 'number' && selectedStockSummary
            ? ` Updated stock: ${payload.currentStockAfter.toFixed(2)} ${payload.unit || selectedStockSummary.productUnit}`
            : ''
        alert(`Stock ${adjustmentType === 'in' ? 'in' : 'out'} adjustment recorded successfully!${stockAfter}`)
        deleteClientCacheByPrefix(`stock-overview:${companyId}`)
        deleteClientCacheByPrefix(`stock-ledger:${companyId}:`)
        setShowAdjustmentForm(false)
        setSelectedProduct('')
        setAdjustmentType('in')
        setQuantity('')
        setReason('')
        void fetchData() // Refresh data
      } else {
        alert(payload.error || 'Error recording stock adjustment')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error recording stock adjustment')
    }
  }

  const filteredLedger = useMemo(() => {
    return [...stockLedger].sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
  }, [stockLedger])

  const totalStockValue = useMemo(
    () => stockSummary.reduce((sum, stock) => sum + Number(stock.closingStock || 0), 0),
    [stockSummary]
  )
  const lowStockProducts = useMemo(
    () => stockSummary.filter((stock) => stock.closingStock <= 0).length,
    [stockSummary]
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
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">Stock Management</h1>
            <div className="flex gap-2">
              <Button onClick={() => setShowAdjustmentForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Stock Adjustment
              </Button>
              <Button variant="outline" onClick={() => router.push('/main/dashboard')}>
                Back to Dashboard
              </Button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Total Products</p>
                  <p className="text-2xl font-bold text-blue-600">{products.length}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Total Stock</p>
                  <p className="text-2xl font-bold text-green-600">{totalStockValue.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Low Stock Items</p>
                  <p className="text-2xl font-bold text-red-600">{lowStockProducts}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Total Transactions</p>
                  <p className="text-2xl font-bold text-purple-600">{totalTransactions}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Stock Summary */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Current Stock Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Total In</TableHead>
                      <TableHead>Total Out</TableHead>
                      <TableHead>Current Stock</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockSummary.map((stock) => (
                      <TableRow key={stock.productId}>
                        <TableCell className="font-medium">{stock.productName}</TableCell>
                        <TableCell>{stock.productUnit}</TableCell>
                        <TableCell className="text-green-600">
                          <TrendingUp className="inline w-4 h-4 mr-1" />
                          {clampNonNegative(stock.totalIn).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-red-600">
                          <TrendingDown className="inline w-4 h-4 mr-1" />
                          {clampNonNegative(stock.totalOut).toFixed(2)}
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatSignedQuantity(stock.closingStock)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={stock.closingStock > 0 ? 'default' : 'destructive'}>
                            {stock.closingStock > 0 ? 'In Stock' : stock.closingStock < 0 ? 'Shortage' : 'Out of Stock'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/stock/dashboard?productId=${stock.productId}`)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Stock Ledger */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Stock Movement History</CardTitle>
              <p className="text-sm text-muted-foreground">
                Showing the latest important entries without loading the full ledger on first open.
              </p>
            </CardHeader>
            <CardContent>
              {/* Filters */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <Label htmlFor="filterProduct">Product</Label>
                  <Select value={filterProduct} onValueChange={setFilterProduct}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Products" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Products</SelectItem>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="filterType">Type</Label>
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="purchase">Purchase</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="adjustment">Adjustment</SelectItem>
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
                      <TableHead>Product</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>In</TableHead>
                      <TableHead>Out</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          Loading recent stock movements...
                        </TableCell>
                      </TableRow>
                    ) : filteredLedger.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No stock movements found for the selected filters.
                        </TableCell>
                      </TableRow>
                    ) : filteredLedger.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{new Date(entry.entryDate).toLocaleDateString()}</TableCell>
                        <TableCell>{entry.product.name}</TableCell>
                        <TableCell>
                          <Badge variant={
                            entry.type === 'purchase' ? 'default' :
                            entry.type === 'sales' ? 'destructive' : 'secondary'
                          }>
                            {entry.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-green-600">
                          {entry.qtyIn > 0 ? entry.qtyIn.toFixed(2) : '0.00'}
                        </TableCell>
                        <TableCell className="text-red-600">
                          {entry.qtyOut > 0 ? entry.qtyOut.toFixed(2) : '0.00'}
                        </TableCell>
                        <TableCell>{entry.refTable.replace('_', ' ')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Stock Adjustment Form Modal */}
          {showAdjustmentForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <Card className="w-full max-w-md">
                <CardHeader>
                  <CardTitle>Stock Adjustment</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleStockAdjustment} className="space-y-4">
                    <div>
                      <Label htmlFor="product">Product</Label>
                      <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select Product" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((product) => (
                            <SelectItem key={product.id} value={product.id}>
                              {product.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedStockSummary && (
                        <p className="mt-1 text-sm text-gray-500">
                          Current stock: {formatSignedQuantity(selectedStockSummary.closingStock)} {selectedStockSummary.productUnit}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="adjustmentDate">Date</Label>
                      <Input
                        id="adjustmentDate"
                        type="date"
                        value={adjustmentDate}
                        onChange={(e) => setAdjustmentDate(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="adjustmentType">Adjustment Type</Label>
                      <Select value={adjustmentType} onValueChange={(value: 'in' | 'out') => setAdjustmentType(value)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in">Stock In</SelectItem>
                          <SelectItem value="out">Stock Out</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="quantity">Quantity</Label>
                      <Input
                        id="quantity"
                        type="number"
                        step="0.01"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="Enter quantity"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="reason">Reason</Label>
                      <Input
                        id="reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Enter reason for adjustment"
                      />
                    </div>
                    <div className="flex justify-end space-x-2">
                      <Button type="button" variant="outline" onClick={() => setShowAdjustmentForm(false)}>
                        Cancel
                      </Button>
                      <Button type="submit">Record Adjustment</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
