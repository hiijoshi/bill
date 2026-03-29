'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DashboardLayout from '@/app/components/DashboardLayout'
import MasterCsvTemplateHint from '@/components/master/MasterCsvTemplateHint'
import { Plus, Edit, Trash2, Package, Upload } from 'lucide-react'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import {
  clearDefaultPurchaseProductId,
  getDefaultPurchaseProductId,
  setDefaultPurchaseProductId
} from '@/lib/default-product'
import { isAbortError } from '@/lib/http'
import { formatMasterImportSummary, uploadMasterCsv } from '@/lib/master-import-client'

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

export default function ProductMasterPage() {
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [companyId, setCompanyId] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [defaultPurchaseProductId, setDefaultPurchaseProductIdState] = useState('')

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

  const applyProductRows = useCallback((rows: Product[], resolvedCompanyId: string) => {
    setProducts(rows)
    setErrorMessage('')

    if (resolvedCompanyId) {
      setCompanyId(resolvedCompanyId)
      const rememberedDefault = getDefaultPurchaseProductId(resolvedCompanyId)
      if (!rememberedDefault) {
        setDefaultPurchaseProductIdState('')
      } else if (rows.some((product) => product.id === rememberedDefault)) {
        setDefaultPurchaseProductIdState(rememberedDefault)
      } else {
        clearDefaultPurchaseProductId(resolvedCompanyId)
        setDefaultPurchaseProductIdState('')
      }
      setClientCache(PRODUCT_MASTER_CACHE_KEY, {
        companyId: resolvedCompanyId,
        products: rows
      })
      return
    }

    setDefaultPurchaseProductIdState('')
    setClientCache(PRODUCT_MASTER_CACHE_KEY, {
      companyId: '',
      products: rows
    })
  }, [])

  const applyUnitRows = useCallback((rows: Unit[], resolvedCompanyId: string) => {
    setUnits(rows)
    if (resolvedCompanyId) {
      setCompanyId((prev) => prev || resolvedCompanyId)
    }
    setClientCache(UNIT_MASTER_CACHE_KEY, {
      companyId: resolvedCompanyId,
      units: rows
    })
  }, [])

  const fetchUnits = useCallback(async () => {
    const cached = getClientCache<{ companyId?: string; units?: Unit[] }>(
      UNIT_MASTER_CACHE_KEY,
      UNIT_MASTER_CACHE_AGE_MS
    )

    if (cached && Array.isArray(cached.units) && cached.units.length > 0) {
      applyUnitRows(
        cached.units,
        typeof cached.companyId === 'string' ? cached.companyId : ''
      )
    }

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch('/api/units', { cache: 'no-store' })
          const data = (await response.json().catch(() => ({}))) as UnitResponsePayload | Unit[]
          const rows = (Array.isArray((data as UnitResponsePayload)?.units)
            ? (data as UnitResponsePayload).units
            : Array.isArray(data)
              ? data
              : []) as Unit[]
          const resolvedCompanyId =
            typeof (data as UnitResponsePayload)?.companyId === 'string'
              ? (data as UnitResponsePayload).companyId || ''
              : ''

          if (response.ok) {
            applyUnitRows(rows, resolvedCompanyId)
            return
          }

          const payload = Array.isArray(data) ? {} : data
          const isTimeoutResponse =
            response.status === 499 ||
            response.status === 504 ||
            payload.timedOut === true ||
            payload.aborted === true

          if (isTimeoutResponse && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }

          if (typeof payload.error === 'string' && payload.error.trim()) {
            setErrorMessage(payload.error.trim())
          } else if (cached?.units?.length) {
            setErrorMessage('Unit list is taking longer than expected. Showing the last loaded data.')
          } else {
            setErrorMessage('Unable to load units right now. Please refresh and try again.')
          }

          if (!cached?.units?.length) {
            setUnits([])
          }
          return
        }
        catch (error) {
          const timeoutLikeError = isAbortError(error)
          if (timeoutLikeError && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }
          if (timeoutLikeError) {
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
      console.error('Error fetching units:', error)
      setErrorMessage('Unable to load units right now. Please refresh and try again.')
      if (!cached?.units?.length) {
        setUnits([])
      }
    }
  }, [applyUnitRows])

  const fetchProducts = useCallback(async () => {
    const cached = getClientCache<{ companyId?: string; products?: Product[] }>(
      PRODUCT_MASTER_CACHE_KEY,
      PRODUCT_MASTER_CACHE_AGE_MS
    )

    if (cached && Array.isArray(cached.products) && cached.products.length > 0) {
      applyProductRows(
        cached.products,
        typeof cached.companyId === 'string' ? cached.companyId : ''
      )
      setLoading(false)
    }

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch('/api/products', { cache: 'no-store' })
          const data = (await response.json().catch(() => ({}))) as ProductResponsePayload | Product[]
          const rows = (Array.isArray((data as ProductResponsePayload)?.products)
            ? (data as ProductResponsePayload).products
            : Array.isArray((data as ProductResponsePayload)?.data)
              ? ((data as ProductResponsePayload).data ?? [])
              : Array.isArray(data)
                ? data
                : []) as Product[]
          const resolvedCompanyId =
            typeof (data as ProductResponsePayload)?.companyId === 'string'
              ? (data as ProductResponsePayload).companyId || ''
              : ''

          if (response.ok) {
            applyProductRows(rows, resolvedCompanyId)
            return
          }

          const payload = Array.isArray(data) ? {} : data
          const isTimeoutResponse =
            response.status === 499 ||
            response.status === 504 ||
            payload.timedOut === true ||
            payload.aborted === true

          if (isTimeoutResponse && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }

          setErrorMessage(
            typeof payload.error === 'string' && payload.error.trim()
              ? payload.error.trim()
              : 'Unable to load products right now. Please refresh and try again.'
          )
          if (!cached?.products?.length) {
            setProducts([])
          }
          return
        }
        catch (error) {
          const timeoutLikeError = isAbortError(error)
          if (timeoutLikeError && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }
          if (timeoutLikeError) {
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
      console.error('Error fetching products:', error)
      setErrorMessage('Unable to load products right now. Please refresh and try again.')
      if (!cached?.products?.length) {
        setProducts([])
      }
    } finally {
      setLoading(false)
    }
  }, [applyProductRows])

  useEffect(() => {
    ;(async () => {
      await Promise.all([fetchProducts(), fetchUnits()])
    })()
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
        : '/api/products'

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
        const resolvedCompanyId =
          typeof responseData?.companyId === 'string'
            ? responseData.companyId
            : companyId

        if (resolvedCompanyId) {
          setCompanyId((prev) => prev || resolvedCompanyId)
        }

        if (resolvedCompanyId && formData.setAsDefaultPurchaseProduct && savedProductId) {
          setDefaultPurchaseProductId(resolvedCompanyId, savedProductId)
          setDefaultPurchaseProductIdState(savedProductId)
        }

        alert(editingProduct ? 'Product updated successfully!' : 'Product created successfully!')
        resetForm()
        fetchProducts()
      } else {
        const error = await response.json().catch(() => ({}))
        alert(error?.error || 'Operation failed')
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
    if (!confirm('Are you sure you want to delete this product? This may affect existing transactions.')) {
      return
    }

    try {
      const response = await fetch(`/api/products?id=${id}`, {
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
        const error = await response.json().catch(() => ({}))
        alert(error?.error || 'Delete failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Delete failed')
    }
  }

  const handleDeleteAll = async () => {
    if (!confirm('Delete all products for this company?')) return

    try {
      const response = await fetch('/api/products?all=true', { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))

      alert(result.message || result.error || 'Operation completed')

      if (response.ok) {
        if (companyId) {
          clearDefaultPurchaseProductId(companyId)
        }
        setDefaultPurchaseProductIdState('')
        fetchProducts()
      }
    } catch (error) {
      console.error('Error deleting all products:', error)
      alert('Delete failed')
    }
  }

  const handleSetDefaultPurchaseProduct = (productId: string) => {
    if (!companyId) {
      alert('Company context is not loaded yet. Please refresh once.')
      return
    }

    setDefaultPurchaseProductId(companyId, productId)
    setDefaultPurchaseProductIdState(productId)
    alert('Default purchase product updated successfully')
  }

  const handleExportCsv = () => {
    if (products.length === 0) return alert('No product data to export')

    const headers = ['Name', 'Unit', 'HSN', 'GST', 'SellingPrice', 'Description', 'Active', 'Stock', 'CreatedAt']
    const rows = products.map((p) => [
      p.name,
      p.unit,
      p.hsnCode || '',
      p.gstRate ?? '',
      p.sellingPrice ?? '',
      p.description || '',
      p.isActive ? 'Yes' : 'No',
      p.currentStock,
      p.createdAt
    ])

    const csv = [
      headers.join(','),
      ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `products_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleImportCsv = async (file: File) => {
    const { ok, result } = await uploadMasterCsv('/api/products/import', file, companyId || undefined)

    if (!ok) {
      alert(result.error || 'Product import failed')
      return
    }

    alert(formatMasterImportSummary('Product', result))
    await fetchProducts()
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
      <DashboardLayout companyId={companyId}>
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

          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Package className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold">Product Master</h1>
            </div>
            <div className="flex flex-col gap-2 md:items-end">
              <div className="flex flex-wrap gap-2 md:justify-end">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (!file) return
                    await handleImportCsv(file)
                  }}
                />
                <Button variant="outline" onClick={() => importInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  Import CSV
                </Button>
                <Button variant="outline" onClick={handleExportCsv}>
                  Export CSV
                </Button>
                <Button variant="destructive" onClick={handleDeleteAll}>
                  Delete All
                </Button>
                <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Product
                </Button>
              </div>
              <MasterCsvTemplateHint templateKey="product" />
            </div>
          </div>

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
                      <Select
                        value={formData.unit}
                        onValueChange={(value) => setFormData({ ...formData, unit: value })}
                      >
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
                      <Select
                        value={formData.gstRate}
                        onValueChange={(value) => setFormData({ ...formData, gstRate: value })}
                      >
                        <SelectTrigger id="gstRate">
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
                          setFormData({
                            ...formData,
                            setAsDefaultPurchaseProduct: e.target.checked
                          })
                        }
                        className="h-4 w-4"
                      />
                      <Label htmlFor="setAsDefaultPurchaseProduct">
                        Set as default purchase product
                      </Label>
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
                          <Badge variant={product.currentStock > 0 ? 'default' : 'destructive'}>
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

                        <TableCell>{new Date(product.createdAt).toLocaleDateString()}</TableCell>

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
