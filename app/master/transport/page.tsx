'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Plus, Edit, Trash2, Truck } from 'lucide-react'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Transport {
  id: string
  vehicleNumber: string
  transporterName?: string
  driverName?: string
  driverPhone?: string
  vehicleType?: string
  capacity?: string
  description?: string
  isActive?: boolean
  createdAt: string
  updatedAt: string
}

export default function TransportMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [transports, setTransports] = useState<Transport[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTransport, setEditingTransport] = useState<Transport | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    vehicleNumber: '',
    transporterName: '',
    driverName: '',
    driverPhone: '',
    vehicleType: '',
    capacity: '',
    description: '',
    isActive: true
  })
  const fetchTransports = useCallback(async (targetCompanyId = companyId) => {
    if (!targetCompanyId) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`/api/transports?companyId=${encodeURIComponent(targetCompanyId)}`)
      if (response.ok) {
        const data = await response.json()
        setTransports(
          (Array.isArray(data) ? data : []).map((item) => ({
            ...item,
            isActive: item?.isActive ?? true
          }))
        )
      } else {
        setTransports([])
      }
    } catch (error) {
      console.error('Error fetching transports:', error)
      setTransports([])
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
      await fetchTransports(resolvedCompanyId)
    })()
  }, [fetchTransports])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }
    
    if (!formData.transporterName.trim()) {
      alert('Transporter name is required')
      return
    }

    // Check for duplicate transporter name (excluding current one if editing)
    const isDuplicate = transports.some(transport => 
      transport.transporterName?.toLowerCase() === formData.transporterName.toLowerCase() && 
      transport.id !== editingTransport?.id
    )

    if (isDuplicate) {
      alert('This transporter name already exists')
      return
    }

    try {
      const url = editingTransport 
        ? `/api/transports?id=${editingTransport.id}&companyId=${companyId}`
        : `/api/transports?companyId=${companyId}`
      
      const method = editingTransport ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          companyId,
          vehicleNumber: formData.vehicleNumber.trim() || null,
          transporterName: formData.transporterName.trim(),
          driverPhone: formData.driverPhone.trim() || null,
          capacity: formData.capacity === '' ? null : Number(formData.capacity),
          isActive: !!formData.isActive
        }),
      })

      if (response.ok) {
        alert(editingTransport ? 'Transport updated successfully!' : 'Transport created successfully!')
        resetForm()
        fetchTransports()
      } else {
        const error = await response.json()
        alert(error.error || 'Operation failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Operation failed')
    }
  }

  const handleEdit = (transport: Transport) => {
    setEditingTransport(transport)
    setFormData({
      transporterName: transport.transporterName || '',
      vehicleNumber: transport.vehicleNumber || '',
      driverName: transport.driverName || '',
      driverPhone: transport.driverPhone || '',
      vehicleType: transport.vehicleType || '',
      capacity: transport.capacity || '',
      description: transport.description || '',
      isActive: transport.isActive ?? true
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this transport? This may affect existing transactions.')) return
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }

    try {
      const response = await fetch(`/api/transports?id=${id}&companyId=${companyId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        alert('Transport deleted successfully!')
        fetchTransports()
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
    if (!confirm('Delete all transports for this company?')) return
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }
    const response = await fetch(`/api/transports?companyId=${companyId}&all=true`, { method: 'DELETE' })
    const result = await response.json().catch(() => ({}))
    alert(result.message || result.error || 'Operation completed')
    if (response.ok) fetchTransports()
  }

  const handleExportCsv = () => {
    if (transports.length === 0) return alert('No transport data to export')
    const headers = ['Transporter', 'VehicleNumber', 'DriverName', 'DriverPhone', 'Capacity', 'CreatedAt']
    const rows = transports.map((t) => [t.transporterName || '', t.vehicleNumber || '', t.driverName || '', t.driverPhone || '', t.capacity || '', t.createdAt])
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `transports_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const resetForm = () => {
    setFormData({ 
      vehicleNumber: '', 
      transporterName: '',
      driverName: '', 
      driverPhone: '', 
      vehicleType: '', 
      capacity: '', 
      description: '', 
      isActive: true 
    })
    setEditingTransport(null)
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
              <Truck className="h-8 w-8 text-yellow-600" />
              <h1 className="text-3xl font-bold">Transport Master</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportCsv}>Export CSV</Button>
              <Button variant="destructive" onClick={handleDeleteAll}>Delete All</Button>
              <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Transport
              </Button>
            </div>
          </div>

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingTransport ? 'Edit Transport' : 'Add New Transport'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="transporterName">Transporter Name *</Label>
                      <Input
                        id="transporterName"
                        value={formData.transporterName}
                        onChange={(e) => setFormData({ ...formData, transporterName: e.target.value })}
                        placeholder="Enter transporter name"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="vehicleNumber">Vehicle Number</Label>
                      <Input
                        id="vehicleNumber"
                        value={formData.vehicleNumber}
                        onChange={(e) => setFormData({ ...formData, vehicleNumber: e.target.value })}
                        placeholder="Enter vehicle number"
                      />
                    </div>
                    <div>
                      <Label htmlFor="driverName">Driver Name</Label>
                      <Input
                        id="driverName"
                        value={formData.driverName}
                        onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
                        placeholder="Enter driver name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="driverPhone">Driver Phone</Label>
                      <Input
                        id="driverPhone"
                        value={formData.driverPhone}
                        onChange={(e) => setFormData({ ...formData, driverPhone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                        placeholder="Enter 10-digit driver phone"
                        inputMode="numeric"
                        maxLength={10}
                      />
                    </div>
                    <div>
                      <Label htmlFor="vehicleType">Vehicle Type</Label>
                      <Input
                        id="vehicleType"
                        value={formData.vehicleType}
                        onChange={(e) => setFormData({ ...formData, vehicleType: e.target.value })}
                        placeholder="Enter vehicle type"
                      />
                    </div>
                    <div>
                      <Label htmlFor="capacity">Capacity</Label>
                      <Input
                        id="capacity"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.capacity}
                        onChange={(e) => setFormData({ ...formData, capacity: e.target.value === '' ? '' : String(Math.max(0, Number(e.target.value) || 0)) })}
                        placeholder="Enter capacity"
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
                        checked={!!formData.isActive}
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
                      {editingTransport ? 'Update' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle>Transport List</CardTitle>
            </CardHeader>
            <CardContent>
              {transports.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No transport vehicles found. Add your first transport to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehicle Number</TableHead>
                      <TableHead>Transporter Name</TableHead>
                      <TableHead>Driver Name</TableHead>
                      <TableHead>Driver Phone</TableHead>
                      <TableHead>Vehicle Type</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transports.map((transport) => (
                      <TableRow key={transport.id}>
                        <TableCell className="font-medium">
                          <Badge variant="outline" className="font-mono">
                            {transport.vehicleNumber}
                          </Badge>
                        </TableCell>
                        <TableCell>{transport.transporterName || '-'}</TableCell>
                        <TableCell>{transport.driverName || '-'}</TableCell>
                        <TableCell>{transport.driverPhone || '-'}</TableCell>
                        <TableCell>{transport.vehicleType || '-'}</TableCell>
                        <TableCell>{transport.capacity || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={transport.isActive ? 'default' : 'secondary'}>
                            {(transport.isActive ?? true) ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(transport)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(transport.id)}
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
