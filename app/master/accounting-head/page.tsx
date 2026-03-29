'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpenText, Edit, Plus, Trash2 } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId } from '@/lib/company-context'

type AccountingHead = {
  id: string
  name: string
  category: string
  amount: number
  value: number
  createdAt: string
  updatedAt: string
}

export default function AccountingHeadMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [rows, setRows] = useState<AccountingHead[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [canReadAccountingHead, setCanReadAccountingHead] = useState(false)
  const [canWriteAccountingHead, setCanWriteAccountingHead] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<AccountingHead | null>(null)
  const [search, setSearch] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    amount: '0',
    value: '0'
  })

  const fetchAccountingHeadPermissions = useCallback(async (resolvedCompanyId: string) => {
    const denied = { canRead: false, canWrite: false }
    try {
      const response = await fetch(`/api/auth/permissions?companyId=${encodeURIComponent(resolvedCompanyId)}&includeMeta=true`, {
        cache: 'no-store'
      })
      if (!response.ok) {
        setCanReadAccountingHead(false)
        setCanWriteAccountingHead(false)
        return denied
      }

      const payload = await response.json().catch(() => ({}))
      const permissions = Array.isArray(payload?.permissions) ? payload.permissions : []
      const accountingHeadPermission = permissions.find((row: { module?: string }) => row.module === 'MASTER_ACCOUNTING_HEAD')
      const canRead = Boolean(accountingHeadPermission?.canRead || accountingHeadPermission?.canWrite)
      const canWrite = Boolean(accountingHeadPermission?.canWrite)

      setCanReadAccountingHead(canRead)
      setCanWriteAccountingHead(canWrite)
      return { canRead, canWrite }
    } catch {
      setCanReadAccountingHead(false)
      setCanWriteAccountingHead(false)
      return denied
    }
  }, [])

  const fetchAccountingHeads = useCallback(async (targetCompanyId = companyId) => {
    if (!targetCompanyId) return
    try {
      const response = await fetch(`/api/accounting-heads?companyId=${encodeURIComponent(targetCompanyId)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => [] as AccountingHead[])
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'Failed to load accounting heads')
      }
      setRows(Array.isArray(payload) ? payload : [])
      setErrorMessage('')
    } catch (error) {
      setRows([])
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load accounting heads')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    let cancelled = false

    const loadAccountingHeadScope = async () => {
      setLoading(true)
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return

      if (!resolvedCompanyId) {
        setCompanyId('')
        setRows([])
        setCanReadAccountingHead(false)
        setCanWriteAccountingHead(false)
        setErrorMessage('Company not selected. Please select company once.')
        setLoading(false)
        return
      }

      setCompanyId(resolvedCompanyId)
      const permission = await fetchAccountingHeadPermissions(resolvedCompanyId)
      if (cancelled) return

      if (!permission.canRead) {
        setRows([])
        setErrorMessage('No access to accounting head master for this user.')
        setLoading(false)
        return
      }

      await fetchAccountingHeads(resolvedCompanyId)
    }

    void loadAccountingHeadScope()

    const onCompanyChanged = () => {
      void loadAccountingHeadScope()
    }

    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)

    return () => {
      cancelled = true
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [fetchAccountingHeadPermissions, fetchAccountingHeads])

  const resetForm = () => {
    setFormData({
      name: '',
      category: '',
      amount: '0',
      value: '0'
    })
    setEditingRow(null)
    setIsFormOpen(false)
  }

  const openCreate = () => {
    setFormData({
      name: '',
      category: '',
      amount: '0',
      value: '0'
    })
    setEditingRow(null)
    setIsFormOpen(true)
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows

    return rows.filter((row) =>
      [row.name, row.category, String(row.amount), String(row.value)]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  }, [rows, search])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!formData.name.trim() || !formData.category.trim()) {
      alert('Name and category are required')
      return
    }

    const amount = Number(formData.amount)
    const value = Number(formData.value)
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(value) || value < 0) {
      alert('Amount and value must be valid non-negative numbers')
      return
    }

    if (!companyId) {
      alert('Company not selected. Please select company once.')
      return
    }

    if (!canWriteAccountingHead) {
      alert('You do not have write access for Accounting Head master')
      return
    }

    try {
      const url = editingRow
        ? `/api/accounting-heads?id=${editingRow.id}&companyId=${encodeURIComponent(companyId)}`
        : `/api/accounting-heads?companyId=${encodeURIComponent(companyId)}`
      const method = editingRow ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          category: formData.category,
          amount,
          value
        })
      })

      const payload = await response.json().catch(() => ({} as { error?: string }))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save accounting head')
      }

      alert(editingRow ? 'Accounting head updated successfully!' : 'Accounting head created successfully!')
      resetForm()
      await fetchAccountingHeads()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save accounting head')
    }
  }

  const handleEdit = (row: AccountingHead) => {
    if (!canWriteAccountingHead) {
      alert('You do not have write access for Accounting Head master')
      return
    }

    setEditingRow(row)
    setFormData({
      name: row.name,
      category: row.category,
      amount: String(Number(row.amount || 0)),
      value: String(Number(row.value || 0))
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!companyId) {
      alert('Company not selected. Please select company once.')
      return
    }

    if (!canWriteAccountingHead) {
      alert('You do not have write access for Accounting Head master')
      return
    }

    if (!confirm('Are you sure you want to delete this accounting head?')) return

    try {
      const response = await fetch(`/api/accounting-heads?id=${id}&companyId=${encodeURIComponent(companyId)}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({} as { error?: string }))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete accounting head')
      }

      alert('Accounting head deleted successfully!')
      await fetchAccountingHeads()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete accounting head')
    }
  }

  const handleDeleteAll = async () => {
    if (!companyId) {
      alert('Company not selected. Please select company once.')
      return
    }

    if (!canWriteAccountingHead) {
      alert('You do not have write access for Accounting Head master')
      return
    }

    if (!confirm('Delete all accounting heads for this company?')) return

    const response = await fetch(`/api/accounting-heads?companyId=${encodeURIComponent(companyId)}&all=true`, { method: 'DELETE' })
    const payload = await response.json().catch(() => ({} as { error?: string; message?: string }))
    alert(payload.message || payload.error || 'Operation completed')
    if (response.ok) {
      await fetchAccountingHeads()
    }
  }

  const handleExportCsv = () => {
    if (rows.length === 0) {
      alert('No accounting head data to export')
      return
    }

    const headers = ['Name', 'Category', 'Amount', 'Value', 'CreatedAt']
    const csvRows = rows.map((row) => [row.name, row.category, row.amount, row.value, row.createdAt])
    const csv = [headers.join(','), ...csvRows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `accounting_heads_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
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
        <div className="mx-auto max-w-6xl">
          {errorMessage && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <BookOpenText className="h-8 w-8 text-amber-600" />
              <div>
                <h1 className="text-3xl font-bold">Accounting Head Master</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Manage mandi accounting heads with exact fields used in cash and bank payment entry.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <Button variant="outline" onClick={handleExportCsv}>Export CSV</Button>
              {canWriteAccountingHead ? (
                <Button variant="destructive" onClick={handleDeleteAll}>Delete All</Button>
              ) : null}
              {canWriteAccountingHead ? (
                <Button onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Accounting Head
                </Button>
              ) : null}
            </div>
          </div>

          {canReadAccountingHead && !canWriteAccountingHead ? (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Read-only access: you can view accounting heads but cannot add, edit, or delete.
            </div>
          ) : null}

          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingRow ? 'Edit Accounting Head' : 'Add New Accounting Head'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <Label htmlFor="name">Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Enter accounting head name"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="category">Category *</Label>
                      <Input
                        id="category"
                        value={formData.category}
                        onChange={(event) => setFormData((current) => ({ ...current, category: event.target.value }))}
                        placeholder="Enter category"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="amount">Amount</Label>
                      <Input
                        id="amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.amount}
                        onChange={(event) => setFormData((current) => ({ ...current, amount: event.target.value }))}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <Label htmlFor="value">Value</Label>
                      <Input
                        id="value"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.value}
                        onChange={(event) => setFormData((current) => ({ ...current, value: event.target.value }))}
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingRow ? 'Update Accounting Head' : 'Save Accounting Head'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <span>Accounting Heads</span>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, category, amount, value"
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
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!canReadAccountingHead ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-500">
                          No access to view accounting heads.
                        </TableCell>
                      </TableRow>
                    ) : filteredRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-500">
                          No accounting heads found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.name}</TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell className="text-right">{Number(row.amount || 0).toFixed(2)}</TableCell>
                          <TableCell className="text-right">{Number(row.value || 0).toFixed(2)}</TableCell>
                          <TableCell>{new Date(row.updatedAt).toLocaleDateString()}</TableCell>
                          <TableCell>
                            {canWriteAccountingHead ? (
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
