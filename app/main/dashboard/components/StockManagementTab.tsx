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
import { Plus, Eye, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react'

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
}

interface StockSummary {
  productId: string
  productName: string
  productUnit: string
  totalIn: number
  totalOut: number
  closingStock: number
}

interface StockManagementTabProps {
  companyId: string
  initialProducts?: Product[]
  initialStockLedger?: StockLedger[]
}

export default function StockManagementTab({
  companyId,
  initialProducts,
  initialStockLedger
}: StockManagementTabProps) {
  const router = useRouter()
  const hasInitialData = Array.isArray(initialProducts) && Array.isArray(initialStockLedger)
  const [loading, setLoading] = useState(!hasInitialData)

  const [products, setProducts] = useState<Product[]>([])
  const [stockLedger, setStockLedger] = useState<StockLedger[]>([])

  // Filter states
  const [filterProduct, setFilterProduct] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const buildStockSummary = (ledger: StockLedger[], productList: Product[]): StockSummary[] => {
    const summary: { [key: string]: StockSummary } = {}
    
    // Initialize summary for all products
    productList.forEach((product) => {
      summary[product.id] = {
        productId: product.id,
        productName: product.name,
        productUnit: product.unit,
        totalIn: 0,
        totalOut: 0,
        closingStock: 0
      }
    })
    
    // Calculate totals from ledger
    ledger.forEach((entry) => {
      if (summary[entry.product.id]) {
        summary[entry.product.id].totalIn += entry.qtyIn
        summary[entry.product.id].totalOut += entry.qtyOut
      }
    })
    
    // Calculate closing stock
    Object.keys(summary).forEach((productId) => {
      summary[productId].closingStock = Math.max(0, summary[productId].totalIn - summary[productId].totalOut)
    })
    
    return Object.values(summary)
  }

  const fetchStockData = useCallback(async () => {
    try {
      setLoading(true)
      
      // Fetch products and stock ledger
      const [productsRes, ledgerRes] = await Promise.all([
        fetch(`/api/products?companyId=${companyId}`),
        fetch(`/api/stock-ledger?companyId=${companyId}`)
      ])
      
      const productsData = await productsRes.json()
      const ledgerData = await ledgerRes.json()
      
      setProducts(productsData)
      setStockLedger(ledgerData)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching stock data:', error)
      setLoading(false)
    }
  }, [companyId])

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

  const productsData = useMemo(
    () => (hasInitialData ? initialProducts || [] : products),
    [hasInitialData, initialProducts, products]
  )
  const stockLedgerData = useMemo(
    () => (hasInitialData ? initialStockLedger || [] : stockLedger),
    [hasInitialData, initialStockLedger, stockLedger]
  )
  const stockSummary = useMemo(() => buildStockSummary(stockLedgerData, productsData), [productsData, stockLedgerData])
  const isLoading = hasInitialData ? false : loading

  const getFilteredLedger = () => {
    let filtered = stockLedgerData

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
  }

  const getTotalStockValue = () => {
    return stockSummary.reduce((sum, stock) => sum + Math.max(0, stock.closingStock), 0)
  }

  const getLowStockProducts = () => {
    return stockSummary.filter(stock => stock.closingStock <= 0).length
  }

  const handleStockAdjustment = () => {
    router.push('/stock/dashboard')
  }

  const handleViewHistory = (productId: string) => {
    router.push(`/stock/dashboard?productId=${productId}`)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-lg">Loading...</div>
      </div>
    )
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
              <p className="text-2xl font-bold text-green-600">{getTotalStockValue().toFixed(2)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600 mr-2" />
              <div>
                <p className="text-sm text-gray-600">Low Stock</p>
                <p className="text-2xl font-bold text-red-600">{getLowStockProducts()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-sm text-gray-600">Transactions</p>
              <p className="text-2xl font-bold text-purple-600">{stockLedgerData.length}</p>
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
                {stockSummary.map((stock) => (
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
                {getFilteredLedger().map((entry) => (
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
