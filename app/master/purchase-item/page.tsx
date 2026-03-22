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
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Product {
  id: string
  name: string
  unit: string
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

export default function PurchaseItemMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    unit: ''
  })
  const fetchUnits = useCallback(async (targetCompanyId = companyId) => {
    if (!targetCompanyId) return
    try {
      const response = await fetch(`/api/units?companyId=${encodeURIComponent(targetCompanyId)}`)
      if (response.ok) {
        const data = await response.json()
        setUnits(data)
      } else {
        setUnits([])
      }
    } catch (error) {
      console.error('Error fetching units:', error)
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
        setProducts(data)
      } else {
        setProducts([])
      }
    } catch (error) {
      console.error('Error fetching products:', error)
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
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
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
      unit: product.unit
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product? This may affect existing transactions.')) return
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }

    try {
      const response = await fetch(`/api/products?id=${id}&companyId=${companyId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
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

  const resetForm = () => {
    setFormData({ name: '', unit: '' })
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
              <Package className="h-8 w-8 text-green-600" />
              <h1 className="text-3xl font-bold">Purchase Item Master</h1>
            </div>
            <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Product
            </Button>
          </div>

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingProduct ? 'Edit Product' : 'Add New Product'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        <SelectTrigger>
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
              {products.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No products found. Add your first product to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Current Stock</TableHead>
                      <TableHead>Created Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{product.unit.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={product.currentStock > 0 ? "default" : "destructive"}>
                            {product.currentStock} {product.unit}
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
