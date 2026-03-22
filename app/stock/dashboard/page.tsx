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
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Product {
  id: string
  name: string
  unit: string
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
  openingStock: number
  totalIn: number
  totalOut: number
  closingStock: number
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
  const [stockLedger, setStockLedger] = useState<StockLedger[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState('')

  // Stock adjustment form
  const [selectedProduct, setSelectedProduct] = useState('')
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().split('T')[0])
  const [adjustmentType, setAdjustmentType] = useState<'in' | 'out'>('in')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false)

  // Filter states
  const [filterProduct, setFilterProduct] = useState('')
  const [filterType, setFilterType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

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

      const cacheKey = `stock-dashboard:${companyIdParam}`
      const cached = getClientCache<{ products: Product[]; stockLedger: StockLedger[] }>(cacheKey, 15_000)
      if (cached) {
        setProducts(cached.products)
        setStockLedger(cached.stockLedger)
        setLoading(false)
      }

      // Fetch products
      const [productsResponse, ledgerResponse] = await Promise.all([
        fetch(`/api/products?companyId=${companyIdParam}`),
        fetch(`/api/stock-ledger?companyId=${companyIdParam}`)
      ])
      if (productsResponse.status === 401 || ledgerResponse.status === 401) {
        setLoading(false)
        router.push('/login')
        return
      }
      if (productsResponse.status === 403 || ledgerResponse.status === 403) {
        setProducts([])
        setStockLedger([])
        setLoading(false)
        return
      }
      const [productsRaw, ledgerRaw] = await Promise.all([
        productsResponse.json().catch(() => []),
        ledgerResponse.json().catch(() => [])
      ])
      const productsData = Array.isArray(productsRaw) ? productsRaw : []
      const ledgerData = Array.isArray(ledgerRaw) ? ledgerRaw : []
      setProducts(productsData)
      setStockLedger(ledgerData)
      setClientCache(cacheKey, { products: productsData, stockLedger: ledgerData })

      setLoading(false)
    } catch (error) {
      console.error('Error fetching data:', error)
      setProducts([])
      setStockLedger([])
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchData()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchData])

  const stockSummary = useMemo(() => {
    const summary: { [key: string]: StockSummary } = {}

    // Initialize summary for all products
    products.forEach(product => {
      summary[product.id] = {
        productId: product.id,
        productName: product.name,
        productUnit: product.unit,
        openingStock: 0,
        totalIn: 0,
        totalOut: 0,
        closingStock: 0
      }
    })

    // Calculate totals from ledger
    stockLedger.forEach(entry => {
      if (summary[entry.product.id]) {
        summary[entry.product.id].totalIn += entry.qtyIn
        summary[entry.product.id].totalOut += entry.qtyOut
      }
    })

    // Calculate closing stock
    Object.keys(summary).forEach(productId => {
      summary[productId].closingStock = clampNonNegative(summary[productId].totalIn - summary[productId].totalOut)
    })

    return Object.values(summary)
  }, [products, stockLedger])

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
    let filtered = stockLedger

    if (filterProduct && filterProduct !== 'all') {
      filtered = filtered.filter(entry => entry.product.id === filterProduct)
    }

    if (filterType && filterType !== 'all') {
      filtered = filtered.filter(entry => entry.type === filterType)
    }

    if (dateFrom) {
      filtered = filtered.filter(entry => new Date(entry.entryDate) >= new Date(dateFrom))
    }

    if (dateTo) {
      filtered = filtered.filter(entry => new Date(entry.entryDate) <= new Date(dateTo))
    }

    return filtered.sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
  }, [stockLedger, filterProduct, filterType, dateFrom, dateTo])

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
                  <p className="text-2xl font-bold text-purple-600">{stockLedger.length}</p>
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
              <CardTitle>Stock Movement History</CardTitle>
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
                    {filteredLedger.map((entry) => (
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
