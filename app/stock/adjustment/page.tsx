'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardLayout from '@/app/components/DashboardLayout'
import { AlertTriangle } from 'lucide-react'

interface Product {
  id: string
  name: string
  unit: string
  currentStock: number
}

export default function StockAdjustmentPage() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().split('T')[0])
  const [shortageWeight, setShortageWeight] = useState('')
  const [remark, setRemark] = useState('')
  const [loading, setLoading] = useState(false)
  const [searchParams, setSearchParams] = useState<URLSearchParams>()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setSearchParams(params)
    const companyId = params.get('companyId')
    
    if (companyId) {
      fetchProducts(companyId)
    }
  }, [])

  const fetchProducts = async (companyId: string) => {
    try {
      const response = await fetch(`/api/products?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setProducts(data)
      }
    } catch (error) {
      console.error('Error fetching products:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedProduct || !shortageWeight || !searchParams?.get('companyId')) {
      alert('Please fill all required fields')
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/stock/adjustment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyId: searchParams.get('companyId'),
          productId: selectedProduct,
          adjustmentDate,
          shortageWeight: parseFloat(shortageWeight),
          remark,
          type: 'shortage'
        }),
      })

      if (response.ok) {
        alert('Stock adjustment recorded successfully')
        // Reset form
        setSelectedProduct('')
        setShortageWeight('')
        setRemark('')
        setAdjustmentDate(new Date().toISOString().split('T')[0])
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to record adjustment')
      }
    } catch (error) {
      console.error('Error recording adjustment:', error)
      alert('Failed to record adjustment')
    } finally {
      setLoading(false)
    }
  }

  const selectedProductData = products.find(p => p.id === selectedProduct)

  return (
    <DashboardLayout companyId={searchParams?.get('companyId') || ''}>
      <div className="container mx-auto py-8">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Stock Shortage Adjustment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <Label htmlFor="product">Product</Label>
                  <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name} (Current Stock: {product.currentStock} {product.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                  <Label htmlFor="shortageWeight">
                    Shortage Weight ({selectedProductData?.unit || 'kg'})
                  </Label>
                  <Input
                    id="shortageWeight"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={shortageWeight}
                    onChange={(e) => setShortageWeight(e.target.value)}
                    placeholder="Enter shortage weight"
                    required
                  />
                  {selectedProductData && (
                    <p className="text-sm text-gray-500 mt-1">
                      Current stock: {selectedProductData.currentStock} {selectedProductData.unit}
                    </p>
                  )}
                </div>

                <div>
                  <Label htmlFor="remark">Remark</Label>
                  <textarea
                    id="remark"
                    className="w-full min-h-[100px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    placeholder="Enter reason for shortage (e.g., damage, theft, measurement error, etc.)"
                  />
                </div>

                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={loading}
                >
                  {loading ? 'Recording Adjustment...' : 'Record Shortage Adjustment'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
