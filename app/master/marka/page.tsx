'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Plus, Edit, Trash2, Hash } from 'lucide-react'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

interface Marka {
  id: string
  markaNumber: string
  description?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export default function MarkaMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [markas, setMarkas] = useState<Marka[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingMarka, setEditingMarka] = useState<Marka | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    markaNumber: '',
    description: '',
    isActive: true
  })
  const fetchMarkas = useCallback(async (targetCompanyId = companyId) => {
    if (!targetCompanyId) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`/api/markas?companyId=${encodeURIComponent(targetCompanyId)}`)
      if (response.ok) {
        const data = await response.json()
        setMarkas(data)
      } else {
        setMarkas([])
      }
    } catch (error) {
      console.error('Error fetching markas:', error)
      setMarkas([])
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
      await fetchMarkas(resolvedCompanyId)
    })()
  }, [fetchMarkas])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.markaNumber.trim()) {
      alert('Marka number is required')
      return
    }
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }

    // Check for duplicate marka number (excluding current one if editing)
    const isDuplicate = markas.some(marka => 
      marka.markaNumber === formData.markaNumber && 
      marka.id !== editingMarka?.id
    )

    if (isDuplicate) {
      alert('This marka number already exists')
      return
    }

    try {
      const url = editingMarka 
        ? `/api/markas?id=${editingMarka.id}&companyId=${companyId}`
        : `/api/markas?companyId=${companyId}`
      
      const method = editingMarka ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        alert(editingMarka ? 'Marka updated successfully!' : 'Marka created successfully!')
        resetForm()
        fetchMarkas()
      } else {
        const error = await response.json()
        alert(error.error || 'Operation failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Operation failed')
    }
  }

  const handleEdit = (marka: Marka) => {
    setEditingMarka(marka)
    setFormData({
      markaNumber: marka.markaNumber,
      description: marka.description || '',
      isActive: marka.isActive
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this marka? This may affect existing transactions.')) return
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }

    try {
      const response = await fetch(`/api/markas?id=${id}&companyId=${companyId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        alert('Marka deleted successfully!')
        fetchMarkas()
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
    if (!confirm('Delete all markas for this company?')) return
    if (!companyId) {
      alert('Active company not found. Please re-login.')
      return
    }
    const response = await fetch(`/api/markas?companyId=${companyId}&all=true`, { method: 'DELETE' })
    const result = await response.json().catch(() => ({}))
    alert(result.message || result.error || 'Operation completed')
    if (response.ok) fetchMarkas()
  }

  const handleExportCsv = () => {
    if (markas.length === 0) return alert('No marka data to export')
    const headers = ['MarkaNumber', 'Description', 'Status', 'CreatedAt']
    const rows = markas.map((m) => [m.markaNumber, m.description || '', m.isActive ? 'Active' : 'Inactive', m.createdAt])
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `markas_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const resetForm = () => {
    setFormData({ markaNumber: '', description: '', isActive: true })
    setEditingMarka(null)
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
              <Hash className="h-8 w-8 text-indigo-600" />
              <h1 className="text-3xl font-bold">Marka Master</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportCsv}>Export CSV</Button>
              <Button variant="destructive" onClick={handleDeleteAll}>Delete All</Button>
              <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Marka
              </Button>
            </div>
          </div>

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingMarka ? 'Edit Marka' : 'Add New Marka'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="markaNumber">Marka Number *</Label>
                      <Input
                        id="markaNumber"
                        value={formData.markaNumber}
                        onChange={(e) => setFormData({ ...formData, markaNumber: e.target.value.toUpperCase() })}
                        placeholder="Enter marka number"
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
                      {editingMarka ? 'Update' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle>Marka List</CardTitle>
            </CardHeader>
            <CardContent>
              {markas.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No markas found. Add your first marka to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Marka Number</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {markas.map((marka) => (
                      <TableRow key={marka.id}>
                        <TableCell className="font-medium">
                          <Badge variant="outline" className="font-mono">
                            {marka.markaNumber}
                          </Badge>
                        </TableCell>
                        <TableCell>{marka.description || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={marka.isActive ? 'default' : 'secondary'}>
                            {marka.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(marka.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(marka)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(marka.id)}
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
