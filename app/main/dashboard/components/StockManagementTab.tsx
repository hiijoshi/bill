'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TaskLoader } from '@/components/loaders/task-loader'
import { Plus, Eye, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { matchesAppDataChange, subscribeAppDataChanged } from '@/lib/app-live-data'

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
  lastMovementDate?: string | Date | null
}

interface StockManagementTabProps {
  companyId: string
  initialProducts?: Product[]
  initialStockLedger?: StockLedger[]
  initialStockSummary?: StockSummary[]
  initialTotalTransactions?: number
}

type StockCachePayload = {
  products: Product[]
  stockSummary: StockSummary[]
  totalTransactions: number
}

type StockLedgerCachePayload = {
  stockLedger: StockLedger[]
}

const STOCK_CACHE_AGE_MS = 30_000

function buildStockLedgerCacheKey(
  companyId: string,
  productId: string,
  type: string,
  dateFrom: string,
  dateTo: string
) {
  return `dashboard-stock-ledger:${companyId}:${productId}:${type}:${dateFrom}:${dateTo}`
}

export default function StockManagementTab({
  companyId,
  initialProducts,
  initialStockLedger,
  initialStockSummary,
  initialTotalTransactions
}: StockManagementTabProps) {
  const router = useRouter()
  const hasInitialData = Array.isArray(initialProducts) && Array.isArray(initialStockLedger)
  const stockCacheKey = `dashboard-stock:${companyId}`
  const cachedStockData = getClientCache<StockCachePayload>(stockCacheKey, STOCK_CACHE_AGE_MS)
  const [loading, setLoading] = useState(!hasInitialData && !cachedStockData)
  const [ledgerLoading, setLedgerLoading] = useState(false)

  const [products, setProducts] = useState<Product[]>(initialProducts || cachedStockData?.products || [])
  const [stockSummary, setStockSummary] = useState<StockSummary[]>(initialStockSummary || cachedStockData?.stockSummary || [])
  const [stockLedger, setStockLedger] = useState<StockLedger[]>(initialStockLedger || [])
  const [totalTransactions, setTotalTransactions] = useState(initialTotalTransactions || cachedStockData?.totalTransactions || 0)

  // Filter states
  const [filterProduct, setFilterProduct] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchStockData = useCallback(async (force = false) => {
    try {
      setLoading(true)

      const cached = force ? null : getClientCache<StockCachePayload>(stockCacheKey, STOCK_CACHE_AGE_MS)
      if (cached) {
        setProducts(cached.products)
        setStockSummary(cached.stockSummary)
        setTotalTransactions(cached.totalTransactions)
        setLoading(false)
        return
      }

      const workspace = await fetch(`/api/dashboard/stock-workspace?companyId=${encodeURIComponent(companyId)}`, {
        cache: 'no-store'
      })
      if (!workspace.ok) {
        throw new Error('Failed to load stock overview')
      }
      const overviewData = await workspace.json().catch(() => ({} as {
        products?: Product[]
        stockSummary?: StockSummary[]
        totalTransactions?: number
      }))

      const safeProducts = Array.isArray(overviewData.products) ? overviewData.products : []
      const safeSummary = Array.isArray(overviewData.stockSummary) ? overviewData.stockSummary : []
      const safeTotalTransactions = Number(overviewData.totalTransactions || 0)

      setProducts(safeProducts)
      setStockSummary(safeSummary)
      setTotalTransactions(safeTotalTransactions)
      setClientCache(stockCacheKey, {
        products: safeProducts,
        stockSummary: safeSummary,
        totalTransactions: safeTotalTransactions
      })
      setLoading(false)
    } catch (error) {
      console.error('Error fetching stock data:', error)
      setLoading(false)
    }
  }, [companyId, stockCacheKey])

  useEffect(() => {
    if (!hasInitialData) return

    setProducts(initialProducts || [])
    setStockLedger(initialStockLedger || [])
    setStockSummary(initialStockSummary || [])
    setTotalTransactions(Number(initialTotalTransactions || 0))
    setClientCache(stockCacheKey, {
      products: initialProducts || [],
      stockSummary: initialStockSummary || [],
      totalTransactions: Number(initialTotalTransactions || 0)
    })
    setClientCache(
      buildStockLedgerCacheKey(companyId, '', '', '', ''),
      { stockLedger: initialStockLedger || [] }
    )
    setLoading(false)
  }, [
    companyId,
    hasInitialData,
    initialProducts,
    initialStockLedger,
    initialStockSummary,
    initialTotalTransactions,
    stockCacheKey
  ])

  const fetchLedgerData = useCallback(async (force = false) => {
    if (!companyId) return

    const normalizedProductId = filterProduct !== 'all' ? filterProduct : ''
    const normalizedType = filterType !== 'all' ? filterType : ''
    const ledgerCacheKey = buildStockLedgerCacheKey(companyId, normalizedProductId, normalizedType, dateFrom, dateTo)
    const cached = force ? null : getClientCache<StockLedgerCachePayload>(ledgerCacheKey, 15_000)
    if (cached) {
      setStockLedger(cached.stockLedger)
      setLedgerLoading(false)
      return
    }

    setLedgerLoading(true)
    try {
      const params = new URLSearchParams({
        companyId,
        page: '1',
        pageSize: '60',
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
      const payload = await response.json().catch(() => ({ data: [] as StockLedger[] }))
      const safeLedger = Array.isArray(payload.data) ? payload.data : []
      setStockLedger(safeLedger)
      setClientCache(ledgerCacheKey, { stockLedger: safeLedger })
    } catch (error) {
      console.error('Error fetching stock ledger:', error)
      setStockLedger([])
    } finally {
      setLedgerLoading(false)
    }
  }, [companyId, dateFrom, dateTo, filterProduct, filterType])

  useEffect(() => {
    if (hasInitialData) return undefined
    if (companyId) {
      const timer = window.setTimeout(() => {
        void fetchStockData()
      }, 0)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [companyId, fetchStockData, hasInitialData])

  useEffect(() => {
    if (!companyId) return undefined
    const timer = window.setTimeout(() => {
      void fetchLedgerData()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [companyId, dateFrom, dateTo, fetchLedgerData, filterProduct, filterType])

  useEffect(() => {
    if (!companyId) return undefined

    const unsubscribe = subscribeAppDataChanged((detail) => {
      if (!matchesAppDataChange(detail, companyId, ['purchase-bills', 'sales-bills', 'products', 'all'])) {
        return
      }

      void fetchStockData(true)
      void fetchLedgerData(true)
    })

    return unsubscribe
  }, [companyId, fetchLedgerData, fetchStockData])

  const productsData = useMemo(() => products, [products])
  const stockLedgerData = useMemo(() => stockLedger, [stockLedger])
  const stockSummaryData = useMemo(() => stockSummary, [stockSummary])
  const filteredLedger = useMemo(() => {
    return [...stockLedgerData].sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
  }, [stockLedgerData])
  const totalStockValue = useMemo(
    () => stockSummaryData.reduce((sum, stock) => sum + Math.max(0, stock.closingStock), 0),
    [stockSummaryData]
  )
  const lowStockProducts = useMemo(
    () => stockSummaryData.filter((stock) => stock.closingStock <= 0).length,
    [stockSummaryData]
  )
  const isLoading = loading

  const buildStockAdjustmentPath = useCallback((productId?: string) => {
    const params = new URLSearchParams()
    if (companyId) {
      params.set('companyId', companyId)
    }
    if (productId) {
      params.set('productId', productId)
    }
    const query = params.toString()
    return query ? `/stock/adjustment?${query}` : '/stock/adjustment'
  }, [companyId])

  const handleStockAdjustment = () => {
    router.push(buildStockAdjustmentPath())
  }

  const handleViewHistory = (productId: string) => {
    router.push(buildStockAdjustmentPath(productId))
  }

  if (isLoading) {
    return <TaskLoader kind="stock" compact />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Stock Management</h2>
        <div className="flex gap-2">
          <Button onClick={handleStockAdjustment}>
            <Plus className="w-4 h-4 mr-2" />
            Stock Adjustment
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-gray-600">Total Products</p>
              <p className="text-2xl font-bold text-blue-600">{productsData.length}</p>
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
            <div className="text-center flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600 mr-2" />
              <div>
                <p className="text-sm text-gray-600">Low Stock</p>
                <p className="text-2xl font-bold text-red-600">{lowStockProducts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-gray-600">Transactions</p>
              <p className="text-2xl font-bold text-purple-600">{hasInitialData ? initialStockLedger?.length || 0 : totalTransactions}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stock Summary */}
      <Card>
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
                {stockSummaryData.map((stock) => (
                  <TableRow key={stock.productId}>
                    <TableCell className="font-medium">{stock.productName}</TableCell>
                    <TableCell>{stock.productUnit}</TableCell>
                    <TableCell className="text-green-600">
                      <TrendingUp className="inline w-4 h-4 mr-1" />
                      {stock.totalIn.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-red-600">
                      <TrendingDown className="inline w-4 h-4 mr-1" />
                      {stock.totalOut.toFixed(2)}
                    </TableCell>
                    <TableCell className="font-bold">
                      {Math.max(0, stock.closingStock).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={Math.max(0, stock.closingStock) > 0 ? 'default' : 'destructive'}>
                        {Math.max(0, stock.closingStock) > 0 ? 'In Stock' : 'Out of Stock'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleViewHistory(stock.productId)}
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
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <Label htmlFor="filterProduct">Product</Label>
              <Select value={filterProduct} onValueChange={setFilterProduct}>
                <SelectTrigger id="filterProduct">
                  <SelectValue placeholder="All Products" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Products</SelectItem>
                  {productsData.map((product) => (
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
                <SelectTrigger id="filterType">
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
    </div>
  )
}
