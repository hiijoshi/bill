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
import {
  clearDefaultPurchaseProductId,
  getDefaultPurchaseProductId,
  setDefaultPurchaseProductId
} from '@/lib/default-product'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Product {
  id: string
  name: string
  unit: string
  hsnCode?: string
  gstRate?: number
  sellingPrice?: number
  description?: string
  isActive: boolean
  currentStock: number
  createdAt: string
  updatedAt: string
}

interface Unit {
  id: string
  name: string
  symbol: string
  description?: string
}

export default function ProductMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [defaultPurchaseProductId, setDefaultPurchaseProductIdState] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    unit: '',
    hsnCode: '',
    gstRate: '',
    sellingPrice: '',
    description: '',
    isActive: true,
    setAsDefaultPurchaseProduct: false
  })

  const gstRates = ['0', '5', '12', '18', '28']
  const fetchUnits = useCallback(async (targetCompanyId = companyId) => {
    if (!targetCompanyId) return
    try {
      const response = await fetch(`/api/units?companyId=${encodeURIComponent(targetCompanyId)}`)
      if (response.ok) {
        const data = await response.json()
        setUnits(data)
      } else {
        const payload = await response.json().catch(() => ({}))
        if (typeof payload?.error === 'string' && payload.error.trim()) {
          setErrorMessage(payload.error.trim())
        }
        setUnits([])
      }
    } catch (error) {
      console.error('Error fetching units:', error)
      setErrorMessage('Unable to load units right now. Please refresh and try again.')
      setUnits([])
    }
  }, [companyId])

  const fetchProducts = useCallback(async (targetCompanyId = companyId) => {
    if (!targetCompanyId) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`/api/products?companyId=${encodeURIComponent(targetCompanyId)}`)
      if (response.ok) {
        const data = await response.json()
        const rows = Array.isArray(data) ? data : []
        setProducts(rows)
        setErrorMessage('')

        const rememberedDefault = getDefaultPurchaseProductId(targetCompanyId)
        if (!rememberedDefault) {
          setDefaultPurchaseProductIdState('')
        } else if (rows.some((product) => product.id === rememberedDefault)) {
          setDefaultPurchaseProductIdState(rememberedDefault)
        } else {
          clearDefaultPurchaseProductId(targetCompanyId)
          setDefaultPurchaseProductIdState('')
        }
      } else {
        const payload = await response.json().catch(() => ({}))
        setErrorMessage(
          typeof payload?.error === 'string' && payload.error.trim()
            ? payload.error.trim()
            : 'Unable to load products right now. Please refresh and try again.'
        )
        setProducts([])
      }
    } catch (error) {
      console.error('Error fetching products:', error)
      setErrorMessage('Unable to load products right now. Please refresh and try again.')
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    ;(async () => {
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (!resolvedCompanyId) {
        setErrorMessage('Failed to resolve active company. Please re-login.')
        setLoading(false)
        return
      }

      setCompanyId(resolvedCompanyId)
      setDefaultPurchaseProductIdState(getDefaultPurchaseProductId(resolvedCompanyId))
      stripCompanyParamsFromUrl()
      await Promise.all([fetchProducts(resolvedCompanyId), fetchUnits(resolvedCompanyId)])
    })()
  }, [fetchProducts, fetchUnits])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.unit) {
      alert('Product name and unit are required')
      return
    }
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }

    try {
      const url = editingProduct 
        ? `/api/products?id=${editingProduct.id}&companyId=${companyId}`
        : `/api/products?companyId=${companyId}`
      
      const method = editingProduct ? 'PUT' : 'POST'
      const payload = {
        name: formData.name,
        unit: formData.unit,
        hsnCode: formData.hsnCode,
        gstRate: formData.gstRate,
        sellingPrice: formData.sellingPrice,
        description: formData.description,
        isActive: formData.isActive
      }
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        const responseData = await response.json().catch(() => ({}))
        const savedProductId = responseData?.product?.id || editingProduct?.id || ''
        if (companyId && formData.setAsDefaultPurchaseProduct && savedProductId) {
          setDefaultPurchaseProductId(companyId, savedProductId)
          setDefaultPurchaseProductIdState(savedProductId)
        }

        alert(editingProduct ? 'Product updated successfully!' : 'Product created successfully!')
        resetForm()
        fetchProducts()
      } else {
        const error = await response.json()
        alert(error.error || 'Operation failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Operation failed')
    }
  }

  const handleEdit = (product: Product) => {
    setEditingProduct(product)
    setFormData({
      name: product.name,
      unit: product.unit,
      hsnCode: product.hsnCode || '',
      gstRate: product.gstRate?.toString() || '',
      sellingPrice: product.sellingPrice?.toString() || '',
      description: product.description || '',
      isActive: product.isActive,
      setAsDefaultPurchaseProduct: defaultPurchaseProductId === product.id
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product? This may affect existing transactions.')) return

    try {
      if (!companyId) {
        alert('Active company not found. Please re-login.')
        return
      }
      
      const response = await fetch(`/api/products?id=${id}&companyId=${companyId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        if (companyId && defaultPurchaseProductId === id) {
          clearDefaultPurchaseProductId(companyId)
          setDefaultPurchaseProductIdState('')
        }
        alert('Product deleted successfully!')
        fetchProducts()
      } else {
        const error = await response.json()
        alert(error.error || 'Delete failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Delete failed')
    }
  }

  const handleDeleteAll = async () => {
    if (!confirm('Delete all products for this company?')) return
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }
    const response = await fetch(`/api/products?companyId=${companyId}&all=true`, { method: 'DELETE' })
    const result = await response.json().catch(() => ({}))
    alert(result.message || result.error || 'Operation completed')
    if (response.ok) {
      clearDefaultPurchaseProductId(companyId)
      setDefaultPurchaseProductIdState('')
      fetchProducts()
    }
  }

  const handleSetDefaultPurchaseProduct = (productId: string) => {
    if (!companyId) return

    setDefaultPurchaseProductId(companyId, productId)
    setDefaultPurchaseProductIdState(productId)
    alert('Default purchase product updated successfully')
  }

  const handleExportCsv = () => {
    if (products.length === 0) return alert('No product data to export')
    const headers = ['Name', 'Unit', 'HSN', 'GST', 'SellingPrice', 'Description', 'Active', 'Stock', 'CreatedAt']
    const rows = products.map((p) => [p.name, p.unit, p.hsnCode || '', p.gstRate ?? '', p.sellingPrice ?? '', p.description || '', p.isActive ? 'Yes' : 'No', p.currentStock, p.createdAt])
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `products_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const resetForm = () => {
    setFormData({ 
      name: '', 
      unit: '', 
      hsnCode: '', 
      gstRate: '', 
      sellingPrice: '', 
      description: '', 
      isActive: true,
      setAsDefaultPurchaseProduct: false
    })
    setEditingProduct(null)
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
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          {errorMessage && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold">Product Master</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportCsv}>Export CSV</Button>
              <Button variant="destructive" onClick={handleDeleteAll}>Delete All</Button>
              <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Product
              </Button>
            </div>
          </div>

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingProduct ? 'Edit Product' : 'Add New Product'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="name">Product Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Enter product name"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="unit">Unit *</Label>
                      <Select value={formData.unit} onValueChange={(value) => setFormData({ ...formData, unit: value })}>
                        <SelectTrigger id="unit">
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {units.map((unit) => (
                            <SelectItem key={unit.id} value={unit.symbol}>
                              {unit.symbol.toUpperCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                          {gstRates.map((rate, index) => (
                            <SelectItem key={`gst-${rate}-${index}`} value={rate}>
                              {rate === '0' ? 'No GST' : `${rate}%`}
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
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="setAsDefaultPurchaseProduct"
                        checked={formData.setAsDefaultPurchaseProduct}
                        onChange={(e) =>
                          setFormData({ ...formData, setAsDefaultPurchaseProduct: e.target.checked })
                        }
                        className="h-4 w-4"
                      />
                      <Label htmlFor="setAsDefaultPurchaseProduct">Set as default purchase product</Label>
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingProduct ? 'Update' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle>Product List</CardTitle>
            </CardHeader>
            <CardContent>
              {products.length === 0 && errorMessage ? (
                <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {errorMessage}
                </div>
              ) : products.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No products found. Add your first product to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead>Default Purchase</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Current Stock</TableHead>
                      <TableHead>HSN Code</TableHead>
                      <TableHead>GST Rate</TableHead>
                      <TableHead>Selling Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell>
                          {defaultPurchaseProductId === product.id ? (
                            <Badge className="bg-green-600 hover:bg-green-600">Default</Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSetDefaultPurchaseProduct(product.id)}
                            >
                              Set Default
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{product.unit.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={product.currentStock > 0 ? "default" : "destructive"}>
                            {product.currentStock} {product.unit}
                          </Badge>
                        </TableCell>
                        <TableCell>{product.hsnCode || '-'}</TableCell>
                        <TableCell>
                          {product.gstRate ? (
                            <Badge variant="secondary">{product.gstRate}%</Badge>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {product.sellingPrice ? (
                            <span>₹{product.sellingPrice.toFixed(2)}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={product.isActive ? 'default' : 'secondary'}>
                            {product.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(product.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(product)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(product.id)}
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
