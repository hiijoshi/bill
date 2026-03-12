'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Plus, Edit, Trash2, CreditCard } from 'lucide-react'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface PaymentMode {
  id: string
  name: string
  code: string
  description?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export default function PaymentModeMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingPaymentMode, setEditingPaymentMode] = useState<PaymentMode | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    isActive: true
  })
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
      await fetchPaymentModes(resolvedCompanyId)
    })()
  }, [])

  const fetchPaymentModes = async (targetCompanyId = companyId) => {
    if (!targetCompanyId) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`/api/payment-modes?companyId=${encodeURIComponent(targetCompanyId)}`)
      if (response.ok) {
        const data = await response.json()
        setPaymentModes(data)
      } else {
        setPaymentModes([])
      }
    } catch (error) {
      console.error('Error fetching payment modes:', error)
      setPaymentModes([])
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.code.trim()) {
      alert('Payment mode name and code are required')
      return
    }
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }

    try {
      const url = editingPaymentMode 
        ? `/api/payment-modes?id=${editingPaymentMode.id}&companyId=${companyId}`
        : `/api/payment-modes?companyId=${companyId}`
      
      const method = editingPaymentMode ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        alert(editingPaymentMode ? 'Payment mode updated successfully!' : 'Payment mode created successfully!')
        resetForm()
        fetchPaymentModes()
      } else {
        const error = await response.json()
        alert(error.error || 'Operation failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Operation failed')
    }
  }

  const handleEdit = (paymentMode: PaymentMode) => {
    setEditingPaymentMode(paymentMode)
    setFormData({
      name: paymentMode.name,
      code: paymentMode.code,
      description: paymentMode.description || '',
      isActive: paymentMode.isActive
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this payment mode? This may affect existing transactions.')) return
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }

    try {
      const response = await fetch(`/api/payment-modes?id=${id}&companyId=${companyId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        alert('Payment mode deleted successfully!')
        fetchPaymentModes()
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
    if (!confirm('Delete all payment modes for this company?')) return
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }
    const response = await fetch(`/api/payment-modes?companyId=${companyId}&all=true`, { method: 'DELETE' })
    const result = await response.json().catch(() => ({}))
    alert(result.message || result.error || 'Operation completed')
    if (response.ok) fetchPaymentModes()
  }

  const handleExportCsv = () => {
    if (paymentModes.length === 0) return alert('No payment mode data to export')
    const headers = ['Name', 'Code', 'Description', 'Status', 'CreatedAt']
    const rows = paymentModes.map((p) => [p.name, p.code, p.description || '', p.isActive ? 'Active' : 'Inactive', p.createdAt])
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `payment_modes_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const resetForm = () => {
    setFormData({ name: '', code: '', description: '', isActive: true })
    setEditingPaymentMode(null)
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
              <CreditCard className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold">Payment Mode Master</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportCsv}>Export CSV</Button>
              <Button variant="destructive" onClick={handleDeleteAll}>Delete All</Button>
              <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Payment Mode
              </Button>
            </div>
          </div>

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingPaymentMode ? 'Edit Payment Mode' : 'Add New Payment Mode'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <Label htmlFor="name">Payment Mode Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Enter payment mode name"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="code">Code *</Label>
                      <Input
                        id="code"
                        value={formData.code}
                        onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                        placeholder="Enter code"
                        required
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
                      {editingPaymentMode ? 'Update' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Mode List</CardTitle>
            </CardHeader>
            <CardContent>
              {paymentModes.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No payment modes found. Add your first payment mode to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment Mode</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentModes.map((paymentMode) => (
                      <TableRow key={paymentMode.id}>
                        <TableCell className="font-medium">{paymentMode.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{paymentMode.code}</Badge>
                        </TableCell>
                        <TableCell>{paymentMode.description || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={paymentMode.isActive ? 'default' : 'secondary'}>
                            {paymentMode.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(paymentMode.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(paymentMode)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(paymentMode.id)}
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
