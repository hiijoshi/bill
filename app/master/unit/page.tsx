'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Plus, Edit, Trash2, Ruler } from 'lucide-react'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { isAbortError } from '@/lib/http'

interface Unit {
  id: string
  name: string
  symbol: string
  kgEquivalent: number
  isUniversal: boolean
  description?: string
  createdAt: string
  updatedAt: string
}

type UnitResponsePayload = {
  units?: Unit[]
  companyId?: string
  error?: string
  timedOut?: boolean
  aborted?: boolean
}

const UNIT_MASTER_CACHE_KEY = 'master-units:active'
const UNIT_MASTER_CACHE_AGE_MS = 60_000

export default function UnitMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    kgEquivalent: '1',
    description: ''
  })

  const applyUnits = useCallback((rows: Unit[], resolvedCompanyId: string) => {
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
    const cached = getClientCache<{ companyId?: string; units?: Unit[] }>(UNIT_MASTER_CACHE_KEY, UNIT_MASTER_CACHE_AGE_MS)
    if (cached && Array.isArray(cached.units) && cached.units.length > 0) {
      applyUnits(cached.units, typeof cached.companyId === 'string' ? cached.companyId : '')
      setLoading(false)
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
          const resolvedCompanyId =
            typeof (payload as UnitResponsePayload)?.companyId === 'string'
              ? (payload as UnitResponsePayload).companyId || ''
              : ''

          if (response.ok) {
            applyUnits(rows, resolvedCompanyId)
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
    } finally {
      setLoading(false)
    }
  }, [applyUnits])

  useEffect(() => {
    void fetchUnits()
  }, [fetchUnits])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.symbol.trim()) {
      alert('Unit name and symbol are required')
      return
    }
    const reservedSymbol = formData.symbol.trim().toLowerCase()
    if (!editingUnit && (reservedSymbol === 'kg' || reservedSymbol === 'qt')) {
      alert('kg and qt are universal system units and cannot be created manually.')
      return
    }

    try {
      const url = editingUnit 
        ? `/api/units?id=${editingUnit.id}`
        : `/api/units`
      
      const method = editingUnit ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        alert(editingUnit ? 'Unit updated successfully!' : 'Unit created successfully!')
        resetForm()
        fetchUnits()
      } else {
        const errorText = await response.text()
        console.error('Error Response:', errorText)
        let error
        try {
          error = JSON.parse(errorText)
        } catch {
          error = { error: errorText }
        }
        alert(error.error || 'Operation failed')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleEdit = (unit: Unit) => {
    if (unit.isUniversal) {
      alert('Universal units are locked and cannot be edited.')
      return
    }
    setEditingUnit(unit)
    setFormData({
      name: unit.name,
      symbol: unit.symbol,
      kgEquivalent: unit.kgEquivalent?.toString() || '1',
      description: unit.description || ''
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    const unit = units.find((item) => item.id === id)
    if (unit?.isUniversal) {
      alert('Universal units cannot be deleted.')
      return
    }
    if (!confirm('Are you sure you want to delete this unit? This may affect existing products.')) return

    try {
      const response = await fetch(`/api/units?id=${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        alert('Unit deleted successfully!')
        fetchUnits()
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
    if (!confirm('Delete all user units for this company? Universal units (kg, qt) will be kept.')) return
    const response = await fetch(`/api/units?all=true`, { method: 'DELETE' })
    const result = await response.json().catch(() => ({}))
    alert(result.message || result.error || 'Operation completed')
    if (response.ok) fetchUnits()
  }

  const handleExportCsv = () => {
    if (units.length === 0) return alert('No unit data to export')
    const headers = ['Name', 'Symbol', 'KGEquivalent', 'Universal', 'Description', 'CreatedAt']
    const rows = units.map((u) => [u.name, u.symbol, u.kgEquivalent, u.isUniversal ? 'Yes' : 'No', u.description || '', u.createdAt])
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `units_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const resetForm = () => {
    setFormData({ name: '', symbol: '', kgEquivalent: '1', description: '' })
    setEditingUnit(null)
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
              <Ruler className="h-8 w-8 text-orange-600" />
              <h1 className="text-3xl font-bold">Unit Master</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportCsv}>Export CSV</Button>
              <Button variant="destructive" onClick={handleDeleteAll}>Delete All</Button>
              <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Unit
              </Button>
            </div>
          </div>

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingUnit ? 'Edit Unit' : 'Add New Unit'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <Label htmlFor="name">Unit Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Enter unit name"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="symbol">Symbol *</Label>
                      <Input
                        id="symbol"
                        value={formData.symbol}
                        onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                        placeholder="Enter symbol (not kg/qt)"
                        required
                        disabled={!!editingUnit && editingUnit.isUniversal}
                      />
                    </div>
                    <div>
                      <Label htmlFor="kgEquivalent">KG Equivalent *</Label>
                      <Input
                        id="kgEquivalent"
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        value={formData.kgEquivalent}
                        onChange={(e) => setFormData({ ...formData, kgEquivalent: e.target.value })}
                        placeholder="1 unit = ? KG"
                        required
                        disabled={!!editingUnit && editingUnit.isUniversal}
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
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingUnit ? 'Update' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle>Unit List</CardTitle>
            </CardHeader>
            <CardContent>
              {units.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No units found. Add your first unit to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit Name</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>KG Equivalent</TableHead>
                      <TableHead>Universal</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Created Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {units.map((unit) => (
                      <TableRow key={unit.id}>
                        <TableCell className="font-medium">{unit.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{unit.symbol}</Badge>
                        </TableCell>
                        <TableCell>{Number(unit.kgEquivalent || 0).toFixed(4)}</TableCell>
                        <TableCell>
                          <Badge variant={unit.isUniversal ? 'default' : 'secondary'}>
                            {unit.isUniversal ? 'Yes' : 'No'}
                          </Badge>
                        </TableCell>
                        <TableCell>{unit.description || '-'}</TableCell>
                        <TableCell>
                          {new Date(unit.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(unit)}
                              disabled={unit.isUniversal}
                              title={unit.isUniversal ? 'Universal units are locked' : 'Edit unit'}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(unit.id)}
                              disabled={unit.isUniversal}
                              title={unit.isUniversal ? 'Universal units are locked' : 'Delete unit'}
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
