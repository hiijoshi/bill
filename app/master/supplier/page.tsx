'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Plus, Edit, Trash2, Truck } from 'lucide-react'
import { getCompanyIdFromSearch } from '@/lib/company-context'

interface Supplier {
  id: string
  name: string
  address?: string | null
  phone1?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type Message = {
  type: 'success' | 'error'
  text: string
}

export default function SupplierMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [canReadSupplier, setCanReadSupplier] = useState(false)
  const [canWriteSupplier, setCanWriteSupplier] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [message, setMessage] = useState<Message | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone1: ''
  })

  const fetchSupplierPermissions = useCallback(async (id: string) => {
    const denied = { canRead: false, canWrite: false }
    try {
      const response = await fetch(`/api/auth/permissions?companyId=${encodeURIComponent(id)}&includeMeta=true`, {
        cache: 'no-store'
      })
      if (!response.ok) {
        setCanReadSupplier(false)
        setCanWriteSupplier(false)
        return denied
      }
      const payload = await response.json().catch(() => ({}))
      const permissions = Array.isArray(payload?.permissions) ? payload.permissions : []
      const supplierPermission = permissions.find((row: { module?: string }) => row.module === 'MASTER_PARTIES')
      const canRead = Boolean(supplierPermission?.canRead || supplierPermission?.canWrite)
      const canWrite = Boolean(supplierPermission?.canWrite)
      setCanReadSupplier(canRead)
      setCanWriteSupplier(canWrite)
      return { canRead, canWrite }
    } catch {
      setCanReadSupplier(false)
      setCanWriteSupplier(false)
      return denied
    }
  }, [])

  const fetchSuppliers = useCallback(async (id = companyId) => {
    if (!id) return
    try {
      const response = await fetch(`/api/suppliers?companyId=${id}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        setMessage({ type: 'error', text: error.error || 'Failed to load suppliers' })
        setSuppliers([])
        return
      }

      const payload = await response.json().catch(() => [])
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []
      const normalizedRows = rows.map((row: Supplier) => ({
        ...row,
        createdAt: row?.createdAt ?? row?.updatedAt ?? null
      }))
      setSuppliers(normalizedRows)
    } catch (error) {
      console.error('Error fetching suppliers:', error)
      setMessage({ type: 'error', text: 'Failed to load suppliers' })
      setSuppliers([])
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    ;(async () => {
      const resolvedCompanyId = getCompanyIdFromSearch(window.location.search)
      if (!resolvedCompanyId) {
        setLoading(false)
        setMessage({ type: 'error', text: 'Company not selected. Please select company once.' })
        return
      }
      setCompanyId(resolvedCompanyId)
      const permission = await fetchSupplierPermissions(resolvedCompanyId)
      if (!permission.canRead) {
        setLoading(false)
        setSuppliers([])
        setMessage({ type: 'error', text: 'No access to supplier master for this user.' })
        return
      }
      await fetchSuppliers(resolvedCompanyId)
    })()
  }, [fetchSupplierPermissions, fetchSuppliers])

  const filteredSuppliers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return suppliers

    return suppliers.filter((supplier) =>
      [
        supplier.name || '',
        supplier.address || '',
        supplier.phone1 || ''
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    )
  }, [suppliers, searchTerm])

  const formatDate = (value?: string | null, fallback?: string | null) => {
    const date = new Date(value || fallback || '')
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleDateString()
  }

  const resetForm = () => {
    setFormData({
      name: '',
      address: '',
      phone1: ''
    })
    setEditingSupplier(null)
    setIsFormOpen(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return
    if (!canWriteSupplier) {
      setMessage({ type: 'error', text: 'You do not have write access for supplier master' })
      return
    }
    if (!formData.name.trim()) {
      setMessage({ type: 'error', text: 'Supplier name is required' })
      return
    }

    try {
      const url = editingSupplier
        ? `/api/suppliers?id=${editingSupplier.id}&companyId=${companyId}`
        : `/api/suppliers?companyId=${companyId}`

      const method = editingSupplier ? 'PUT' : 'POST'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          name: formData.name.trim(),
          address: formData.address.trim(),
          phone1: formData.phone1.trim()
        })
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        setMessage({ type: 'error', text: error.error || 'Failed to save supplier' })
        return
      }

      setMessage({
        type: 'success',
        text: editingSupplier ? 'Supplier updated successfully' : 'Supplier data stored successfully'
      })
      resetForm()
      await fetchSuppliers()
    } catch (error) {
      console.error('Error saving supplier:', error)
      setMessage({ type: 'error', text: 'Failed to save supplier' })
    }
  }

  const handleEdit = (supplier: Supplier) => {
    if (!canWriteSupplier) {
      setMessage({ type: 'error', text: 'You do not have write access for supplier master' })
      return
    }
    setEditingSupplier(supplier)
    setFormData({
      name: supplier.name || '',
      address: supplier.address || '',
      phone1: supplier.phone1 || ''
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!companyId) return
    if (!canWriteSupplier) {
      setMessage({ type: 'error', text: 'You do not have write access for supplier master' })
      return
    }
    if (!confirm('Are you sure you want to delete this supplier?')) return

    try {
      const response = await fetch(`/api/suppliers?id=${id}&companyId=${companyId}`, { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage({ type: 'error', text: result.error || 'Failed to delete supplier' })
        return
      }

      setMessage({ type: 'success', text: result.message || 'Supplier deleted successfully' })
      await fetchSuppliers()
    } catch (error) {
      console.error('Error deleting supplier:', error)
      setMessage({ type: 'error', text: 'Failed to delete supplier' })
    }
  }

  const handleDeleteAll = async () => {
    if (!companyId) return
    if (!canWriteSupplier) {
      setMessage({ type: 'error', text: 'You do not have write access for supplier master' })
      return
    }
    if (!confirm('Delete all suppliers for this company?')) return

    try {
      const response = await fetch(`/api/suppliers?companyId=${companyId}&all=true`, { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage({ type: 'error', text: result.error || 'Failed to delete suppliers' })
        return
      }

      setMessage({ type: 'success', text: result.message || 'All suppliers deleted successfully' })
      await fetchSuppliers()
    } catch (error) {
      console.error('Error deleting all suppliers:', error)
      setMessage({ type: 'error', text: 'Failed to delete suppliers' })
    }
  }

  const handleExportCsv = () => {
    if (filteredSuppliers.length === 0) {
      setMessage({ type: 'error', text: 'No supplier data available to export' })
      return
    }

    const headers = ['Name', 'Address', 'Phone1', 'CreatedAt']
    const rows = filteredSuppliers.map((supplier) => [
      supplier.name || '',
      supplier.address || '',
      supplier.phone1 || '',
      supplier.createdAt || ''
    ])

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.href = url
    link.download = `suppliers_${companyId}_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setMessage({ type: 'success', text: 'Supplier data exported successfully' })
  }

  if (loading) {
    return (
      <DashboardLayout companyId="">
        <div className="flex h-screen items-center justify-center">Loading...</div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Truck className="h-8 w-8 text-cyan-600" />
              <h1 className="text-3xl font-bold">Supplier Master</h1>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleExportCsv} variant="outline">Export CSV</Button>
              {canWriteSupplier ? (
                <Button onClick={handleDeleteAll} variant="destructive">Delete All</Button>
              ) : null}
              {canWriteSupplier ? (
                <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Supplier
                </Button>
              ) : null}
            </div>
          </div>

          <Card className="mb-4">
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  placeholder="Search by name, phone, address"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="flex items-center text-sm text-muted-foreground md:justify-end">
                  Showing {filteredSuppliers.length} of {suppliers.length} suppliers
                </div>
              </div>
            </CardContent>
          </Card>

          {message && (
            <div
              className={`mb-4 rounded-md border px-4 py-3 text-sm ${
                message.type === 'success'
                  ? 'border-green-300 bg-green-50 text-green-800'
                  : 'border-red-300 bg-red-50 text-red-800'
              }`}
            >
              {message.text}
            </div>
          )}

          {canReadSupplier && !canWriteSupplier ? (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Read-only access: you can view suppliers but cannot add, edit, or delete.
            </div>
          ) : null}

          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <Label htmlFor="name">Supplier Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="Enter supplier name"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="address">Supplier Address</Label>
                      <Input
                        id="address"
                        value={formData.address}
                        onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                        placeholder="Enter supplier address"
                      />
                    </div>
                    <div>
                      <Label htmlFor="phone1">Supplier Contact No.</Label>
                      <Input
                        id="phone1"
                        value={formData.phone1}
                        onChange={(e) => setFormData((prev) => ({ ...prev, phone1: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                        placeholder="Enter 10 digit contact"
                        inputMode="numeric"
                        maxLength={10}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
                    <Button type="submit">{editingSupplier ? 'Update' : 'Save'}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Supplier List</CardTitle>
            </CardHeader>
            <CardContent>
              {!canReadSupplier ? (
                <div className="py-8 text-center text-gray-500">No access to view supplier data.</div>
              ) : filteredSuppliers.length === 0 ? (
                <div className="py-8 text-center text-gray-500">No suppliers found. Add your first supplier to get started.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Created Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSuppliers.map((supplier) => (
                      <TableRow key={supplier.id}>
                        <TableCell className="font-medium">{supplier.name}</TableCell>
                        <TableCell>{supplier.phone1 || '-'}</TableCell>
                        <TableCell>{supplier.address || '-'}</TableCell>
                        <TableCell>{formatDate(supplier.createdAt, supplier.updatedAt)}</TableCell>
                        <TableCell>
                          {canWriteSupplier ? (
                            <div className="flex space-x-2">
                              <Button size="sm" variant="outline" onClick={() => handleEdit(supplier)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleDelete(supplier.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">Read only</span>
                          )}
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
