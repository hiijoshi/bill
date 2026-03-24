'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Plus, Edit, Trash2, Package } from 'lucide-react'

interface SalesItem {
  id: string
  productId: string
  salesItemName: string
  product: {
    id: string
    name: string
    unit: {
      id: string
      name: string
      symbol: string
    }
  }
  hsnCode?: string
  gstRate?: number
  sellingPrice?: number
  description?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface ProductOption {
  id: string
  name: string
  unit?: {
    symbol?: string
  }
}

export default function SalesItemMasterPage() {
  const [salesItems, setSalesItems] = useState<SalesItem[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingSalesItem, setEditingSalesItem] = useState<SalesItem | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    productId: '',
    salesItemName: '',
    hsnCode: '',
    gstRate: '',
    sellingPrice: '',
    description: '',
    isActive: true
  })

  const [products, setProducts] = useState<ProductOption[]>([])
  const gstRates = ['5', '12', '18', '28']
  const fetchProducts = useCallback(async () => {
    try {
      const response = await fetch('/api/products')
      if (response.ok) {
        const data = await response.json().catch(() => ({}))
        const rows = Array.isArray(data?.products) ? data.products : Array.isArray(data) ? data : []
        setProducts(rows)
      } else {
        setProducts([])
      }
    } catch (error) {
      console.error('Error fetching products:', error)
      setProducts([])
    }
  }, [])

  const fetchSalesItems = useCallback(async () => {
    try {
      const response = await fetch('/api/sales-item-masters')
      if (response.ok) {
        const data = await response.json()
        setSalesItems(data)
      } else {
        setSalesItems([])
      }
    } catch (error) {
      console.error('Error fetching sales items:', error)
      setSalesItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.all([fetchSalesItems(), fetchProducts()])
  }, [fetchProducts, fetchSalesItems])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.productId.trim() || !formData.salesItemName.trim()) {
      alert('Product selection and Sales Item Name are required')
      return
    }
    try {
      const url = editingSalesItem 
        ? `/api/sales-item-masters?id=${editingSalesItem.id}`
        : `/api/sales-item-masters`
      
      const method = editingSalesItem ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          gstRate: formData.gstRate ? parseFloat(formData.gstRate) : null,
          sellingPrice: formData.sellingPrice ? parseFloat(formData.sellingPrice) : null,
        }),
      })

      if (response.ok) {
        alert(editingSalesItem ? 'Sales item updated successfully!' : 'Sales item created successfully!')
        resetForm()
        fetchSalesItems()
      } else {
        const error = await response.json()
        alert(error.error || 'Operation failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Operation failed')
    }
  }

  const handleEdit = (salesItem: SalesItem) => {
    setEditingSalesItem(salesItem)
    setFormData({
      productId: salesItem.productId,
      salesItemName: salesItem.salesItemName,
      hsnCode: salesItem.hsnCode || '',
      gstRate: salesItem.gstRate?.toString() || '',
      sellingPrice: salesItem.sellingPrice?.toString() || '',
      description: salesItem.description || '',
      isActive: salesItem.isActive
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this sales item? This may affect existing transactions.')) return

    try {
      const response = await fetch(`/api/sales-item-masters?id=${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        alert('Sales item deleted successfully!')
        fetchSalesItems()
      } else {
        const error = await response.json()
        alert(error.error || 'Delete failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Delete failed')
    }
  }

  const resetForm = () => {
    setFormData({ 
      productId: '', 
      salesItemName: '', 
      hsnCode: '', 
      gstRate: '', 
      sellingPrice: '', 
      description: '', 
      isActive: true 
    })
    setEditingSalesItem(null)
    setIsFormOpen(false)
  }

  if (loading) {
    return (
      <DashboardLayout companyId="">
        <div className="flex justify-center items-center h-screen">Loading...</div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId="">
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          {errorMessage && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-teal-600" />
              <h1 className="text-3xl font-bold">Sales Item Master</h1>
            </div>
            <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Sales Item
            </Button>
          </div>

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingSalesItem ? 'Edit Sales Item' : 'Add New Sales Item'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="product">Product *</Label>
                      <Select value={formData.productId} onValueChange={(value) => setFormData({ ...formData, productId: value })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          {products && products.length > 0 ? (
                            products
                              .filter((product, index, self) => 
                                product && product.id && index === self.findIndex((p) => p.id === product.id)
                              )
                              .map((product, index) => (
                                <SelectItem key={`product-${product.id || 'no-id'}-${index}`} value={product.id}>
                                  {product.name || 'Unnamed Product'} ({product.unit?.symbol || 'No unit'})
                                </SelectItem>
                              ))
                          ) : (
                            <SelectItem value="no-products" disabled>
                              No products available
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="salesItemName">Sales Item Name *</Label>
                      <Input
                        id="salesItemName"
                        value={formData.salesItemName}
                        onChange={(e) => setFormData({ ...formData, salesItemName: e.target.value })}
                        placeholder="Enter sales item name"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="hsnCode">HSN Code</Label>
                      <Input
                        id="hsnCode"
                        value={formData.hsnCode}
                        onChange={(e) => setFormData({ ...formData, hsnCode: e.target.value })}
                        placeholder="Enter HSN code"
                      />
                    </div>
                    <div>
                      <Label htmlFor="gstRate">GST Rate (%)</Label>
                      <Select value={formData.gstRate} onValueChange={(value) => setFormData({ ...formData, gstRate: value })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select GST rate" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">No GST</SelectItem>
                          {gstRates.map((rate, index) => (
                            <SelectItem key={`gst-rate-${rate}-${index}`} value={rate}>
                              {rate}%
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="sellingPrice">Selling Price</Label>
                      <Input
                        id="sellingPrice"
                        type="number"
                        step="0.01"
                        value={formData.sellingPrice}
                        onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value })}
                        placeholder="Enter selling price"
                      />
                    </div>
                    <div>
                      <Label htmlFor="description">Description</Label>
                      <Input
                        id="description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Enter description"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="isActive"
                        checked={formData.isActive}
                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                        className="h-4 w-4"
                      />
                      <Label htmlFor="isActive">Active</Label>
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingSalesItem ? 'Update' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle>Sales Item List</CardTitle>
            </CardHeader>
            <CardContent>
              {salesItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No sales items found. Add your first sales item to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sales Item Name</TableHead>
                      <TableHead>Product Name</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>HSN Code</TableHead>
                      <TableHead>GST Rate</TableHead>
                      <TableHead>Selling Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salesItems.map((salesItem) => (
                      <TableRow key={salesItem.id}>
                        <TableCell className="font-medium">{salesItem.salesItemName}</TableCell>
                        <TableCell>{salesItem.product.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{salesItem.product.unit?.symbol || '-'}</Badge>
                        </TableCell>
                        <TableCell>{salesItem.hsnCode || '-'}</TableCell>
                        <TableCell>
                          {salesItem.gstRate ? (
                            <Badge variant="secondary">{salesItem.gstRate}%</Badge>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {salesItem.sellingPrice ? (
                            <span>₹{salesItem.sellingPrice.toFixed(2)}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={salesItem.isActive ? 'default' : 'secondary'}>
                            {salesItem.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(salesItem)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(salesItem.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
