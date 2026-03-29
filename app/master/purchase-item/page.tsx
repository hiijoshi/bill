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
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { isAbortError } from '@/lib/http'

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

type ProductResponsePayload = {
  products?: Product[]
  data?: Product[]
  companyId?: string
  error?: string
  timedOut?: boolean
  aborted?: boolean
}

type UnitResponsePayload = {
  units?: Unit[]
  companyId?: string
  error?: string
  timedOut?: boolean
  aborted?: boolean
}

const PRODUCT_MASTER_CACHE_KEY = 'master-products:active'
const PRODUCT_MASTER_CACHE_AGE_MS = 30_000
const UNIT_MASTER_CACHE_KEY = 'master-units:active'
const UNIT_MASTER_CACHE_AGE_MS = 60_000

export default function PurchaseItemMasterPage() {
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

  const applyUnits = useCallback((rows: Unit[]) => {
    setUnits(rows)
    setClientCache(UNIT_MASTER_CACHE_KEY, { units: rows })
  }, [])

  const fetchUnits = useCallback(async () => {
    const cached = getClientCache<{ units?: Unit[] }>(UNIT_MASTER_CACHE_KEY, UNIT_MASTER_CACHE_AGE_MS)
    if (cached && Array.isArray(cached.units) && cached.units.length > 0) {
      applyUnits(cached.units)
    }

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch('/api/units', { cache: 'no-store' })
          const payload = (await response.json().catch(() => ({}))) as UnitResponsePayload | Unit[]
          const rows = (Array.isArray((payload as UnitResponsePayload)?.units)
            ? (payload as UnitResponsePayload).units
            : Array.isArray(payload)
              ? payload
              : []) as Unit[]

          if (response.ok) {
            applyUnits(rows)
            return
          }

          const body = Array.isArray(payload) ? {} : payload
          const timedOut =
            response.status === 499 ||
            response.status === 504 ||
            body.timedOut === true ||
            body.aborted === true

          if (timedOut && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }

          setErrorMessage(
            cached?.units?.length
              ? 'Unit list is taking longer than expected. Showing the last loaded data.'
              : 'Unable to load units right now. Please refresh and try again.'
          )
          if (!cached?.units?.length) {
            setUnits([])
          }
          return
        } catch (error) {
          if (isAbortError(error) && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }
          if (isAbortError(error)) {
            setErrorMessage(
              cached?.units?.length
                ? 'Unit list is taking longer than expected. Showing the last loaded data.'
                : 'Unit list took too long to load. Please refresh once.'
            )
            if (!cached?.units?.length) {
              setUnits([])
            }
            return
          }
          throw error
        }
      }
    } catch (error) {
      if (isAbortError(error)) return
      console.error('Error fetching units:', error)
      setErrorMessage('Unable to load units right now. Please refresh and try again.')
      if (!cached?.units?.length) {
        setUnits([])
      }
    }
  }, [applyUnits])

  const applyProducts = useCallback((rows: Product[]) => {
    setProducts(rows)
    setClientCache(PRODUCT_MASTER_CACHE_KEY, { products: rows })
    setErrorMessage('')
  }, [])

  const fetchProducts = useCallback(async () => {
    const cached = getClientCache<{ products?: Product[] }>(PRODUCT_MASTER_CACHE_KEY, PRODUCT_MASTER_CACHE_AGE_MS)
    if (cached && Array.isArray(cached.products) && cached.products.length > 0) {
      applyProducts(cached.products)
      setLoading(false)
    }

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch('/api/products', { cache: 'no-store' })
          const payload = (await response.json().catch(() => ({}))) as ProductResponsePayload | Product[]
          const rows = (Array.isArray((payload as ProductResponsePayload)?.products)
            ? (payload as ProductResponsePayload).products
            : Array.isArray((payload as ProductResponsePayload)?.data)
              ? (payload as ProductResponsePayload).data || []
              : Array.isArray(payload)
                ? payload
                : []) as Product[]

          if (response.ok) {
            applyProducts(rows)
            return
          }

          const body = Array.isArray(payload) ? {} : payload
          const timedOut =
            response.status === 499 ||
            response.status === 504 ||
            body.timedOut === true ||
            body.aborted === true

          if (timedOut && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }

          setErrorMessage(
            cached?.products?.length
              ? 'Product list is taking longer than expected. Showing the last loaded data.'
              : 'Unable to load products right now. Please refresh and try again.'
          )
          if (!cached?.products?.length) {
            setProducts([])
          }
          return
        } catch (error) {
          if (isAbortError(error) && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }
          if (isAbortError(error)) {
            setErrorMessage(
              cached?.products?.length
                ? 'Product list is taking longer than expected. Showing the last loaded data.'
                : 'Product list took too long to load. Please refresh once.'
            )
            if (!cached?.products?.length) {
              setProducts([])
            }
            return
          }
          throw error
        }
      }
    } catch (error) {
      if (isAbortError(error)) return
      console.error('Error fetching products:', error)
      setErrorMessage('Unable to load products right now. Please refresh and try again.')
      if (!cached?.products?.length) {
        setProducts([])
      }
    } finally {
      setLoading(false)
    }
  }, [applyProducts])

  useEffect(() => {
    void Promise.all([fetchProducts(), fetchUnits()])
  }, [fetchProducts, fetchUnits])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.unit) {
      alert('Product name and unit are required')
      return
    }
    try {
      const url = editingProduct 
        ? `/api/products?id=${editingProduct.id}`
        : `/api/products`
      
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

    try {
      const response = await fetch(`/api/products?id=${id}`, {
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
