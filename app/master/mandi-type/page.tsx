'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Edit, Plus, Tags, Trash2 } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId } from '@/lib/company-context'

type MandiTypeRow = {
  id: string
  name: string
  description?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export default function MandiTypeMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [rows, setRows] = useState<MandiTypeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [canRead, setCanRead] = useState(false)
  const [canWrite, setCanWrite] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<MandiTypeRow | null>(null)
  const [search, setSearch] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isActive: true
  })

  const fetchPermissions = useCallback(async (resolvedCompanyId: string) => {
    const denied = { canRead: false, canWrite: false }
    try {
      const response = await fetch(`/api/auth/permissions?companyId=${encodeURIComponent(resolvedCompanyId)}&includeMeta=true`, {
        cache: 'no-store'
      })
      if (!response.ok) {
        setCanRead(false)
        setCanWrite(false)
        return denied
      }

      const payload = await response.json().catch(() => ({}))
      const permissions = Array.isArray(payload?.permissions) ? payload.permissions : []
      const permission = permissions.find((row: { module?: string }) => row.module === 'MASTER_ACCOUNTING_HEAD')
      const nextRead = Boolean(permission?.canRead || permission?.canWrite)
      const nextWrite = Boolean(permission?.canWrite)
      setCanRead(nextRead)
      setCanWrite(nextWrite)
      return { canRead: nextRead, canWrite: nextWrite }
    } catch {
      setCanRead(false)
      setCanWrite(false)
      return denied
    }
  }, [])

  const fetchRows = useCallback(async (targetCompanyId = companyId) => {
    if (!targetCompanyId) return
    try {
      const response = await fetch(`/api/mandi-types?companyId=${encodeURIComponent(targetCompanyId)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => [] as MandiTypeRow[])
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'Failed to load mandi types')
      }
      setRows(Array.isArray(payload) ? payload : [])
      setErrorMessage('')
    } catch (error) {
      setRows([])
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load mandi types')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    let cancelled = false

    const loadScope = async () => {
      setLoading(true)
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return

      if (!resolvedCompanyId) {
        setCompanyId('')
        setRows([])
        setCanRead(false)
        setCanWrite(false)
        setErrorMessage('Company not selected. Please select company once.')
        setLoading(false)
        return
      }

      setCompanyId(resolvedCompanyId)
      const permission = await fetchPermissions(resolvedCompanyId)
      if (cancelled) return

      if (!permission.canRead) {
        setRows([])
        setErrorMessage('No access to mandi type master for this user.')
        setLoading(false)
        return
      }

      await fetchRows(resolvedCompanyId)
    }

    void loadScope()

    const onCompanyChanged = () => {
      void loadScope()
    }

    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    return () => {
      cancelled = true
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [fetchPermissions, fetchRows])

  const resetForm = () => {
    setFormData({ name: '', description: '', isActive: true })
    setEditingRow(null)
    setIsFormOpen(false)
  }

  const openCreate = () => {
    setFormData({ name: '', description: '', isActive: true })
    setEditingRow(null)
    setIsFormOpen(true)
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) => [row.name, row.description || '', row.isActive ? 'active' : 'inactive'].join(' ').toLowerCase().includes(query))
  }, [rows, search])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!formData.name.trim()) {
      alert('Mandi type name is required')
      return
    }

    if (!companyId) {
      alert('Company not selected. Please select company once.')
      return
    }

    if (!canWrite) {
      alert('You do not have write access for Mandi Type master')
      return
    }

    try {
      const url = editingRow
        ? `/api/mandi-types?id=${editingRow.id}&companyId=${encodeURIComponent(companyId)}`
        : `/api/mandi-types?companyId=${encodeURIComponent(companyId)}`
      const method = editingRow ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      })

      const payload = await response.json().catch(() => ({} as { error?: string }))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save mandi type')
      }

      alert(editingRow ? 'Mandi type updated successfully!' : 'Mandi type created successfully!')
      resetForm()
      await fetchRows()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save mandi type')
    }
  }

  const handleEdit = (row: MandiTypeRow) => {
    if (!canWrite) {
      alert('You do not have write access for Mandi Type master')
      return
    }

    setEditingRow(row)
    setFormData({
      name: row.name,
      description: row.description || '',
      isActive: row.isActive !== false
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!companyId) {
      alert('Company not selected. Please select company once.')
      return
    }

    if (!canWrite) {
      alert('You do not have write access for Mandi Type master')
      return
    }

    if (!confirm('Are you sure you want to delete this mandi type?')) return

    try {
      const response = await fetch(`/api/mandi-types?id=${id}&companyId=${encodeURIComponent(companyId)}`, {
        method: 'DELETE'
      })
      const payload = await response.json().catch(() => ({} as { error?: string }))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete mandi type')
      }
      alert('Mandi type deleted successfully!')
      await fetchRows()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete mandi type')
    }
  }

  if (loading) {
    return (
      <DashboardLayout companyId={companyId}>
        <div className="flex h-screen items-center justify-center">Loading...</div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto max-w-5xl">
          {errorMessage ? (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : null}

          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Tags className="h-8 w-8 text-emerald-600" />
              <div>
                <h1 className="text-3xl font-bold">Mandi Type Master</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Define mandi rule groups used by party, farmer, and accounting head charge settings.
                </p>
              </div>
            </div>
            {canWrite ? (
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Add Mandi Type
              </Button>
            ) : null}
          </div>

          {canRead && !canWrite ? (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Read-only access: you can view mandi types but cannot add, edit, or delete.
            </div>
          ) : null}

          {isFormOpen ? (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingRow ? 'Edit Mandi Type' : 'Add New Mandi Type'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <Label htmlFor="mandiTypeName">Name *</Label>
                      <Input
                        id="mandiTypeName"
                        value={formData.name}
                        onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                        placeholder="e.g. Soyabean Mandi"
                        required
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor="mandiTypeDescription">Description</Label>
                      <Input
                        id="mandiTypeDescription"
                        value={formData.description}
                        onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                        placeholder="Optional notes about this mandi rule group"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700" htmlFor="mandiTypeIsActive">
                    <input
                      id="mandiTypeIsActive"
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(event) => setFormData((current) => ({ ...current, isActive: event.target.checked }))}
                    />
                    Active mandi type
                  </label>

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingRow ? 'Update Mandi Type' : 'Save Mandi Type'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <span>Mandi Types</span>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name or description"
                  className="md:max-w-sm"
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!canRead ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-slate-500">
                          No access to view mandi types.
                        </TableCell>
                      </TableRow>
                    ) : filteredRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-slate-500">
                          No mandi types found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.name}</TableCell>
                          <TableCell>{row.description || '-'}</TableCell>
                          <TableCell>{row.isActive ? 'Active' : 'Inactive'}</TableCell>
                          <TableCell>{new Date(row.updatedAt).toLocaleDateString()}</TableCell>
                          <TableCell>
                            {canWrite ? (
                              <div className="flex gap-2">
                                <Button size="sm" variant="outline" onClick={() => handleEdit(row)}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => handleDelete(row.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">Read only</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
