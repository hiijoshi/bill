'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpenText, Edit, Plus, Trash2 } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ACCOUNT_GROUP_OPTIONS,
  getAccountGroupLabel,
  getCalculationBasisLabel,
  MANDI_CALCULATION_BASIS_OPTIONS
} from '@/lib/mandi-charge-engine'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId } from '@/lib/company-context'
import { getClientModulePermission, loadClientPermissions } from '@/lib/client-permissions'

type AccountingHead = {
  id: string
  name: string
  category: string
  amount: number
  value: number
  mandiTypeId?: string | null
  mandiTypeName?: string | null
  isMandiCharge: boolean
  calculationBasis?: string | null
  defaultValue: number
  accountGroup?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type MandiType = {
  id: string
  name: string
  isActive?: boolean
}

function getVisibleMandiTypes(allRows: MandiType[], selectedId: string): MandiType[] {
  const activeRows = allRows.filter((row) => row.isActive !== false)
  if (!selectedId) return activeRows
  const selectedRow = allRows.find((row) => row.id === selectedId)
  if (!selectedRow || selectedRow.isActive !== false || activeRows.some((row) => row.id === selectedId)) {
    return activeRows
  }
  return [...activeRows, selectedRow]
}

function getMandiTypeOptionLabel(row: MandiType): string {
  return row.isActive === false ? `${row.name} (Inactive)` : row.name
}

const DEFAULT_FORM = {
  name: '',
  category: '',
  amount: '0',
  defaultValue: '0',
  mandiTypeId: '',
  isMandiCharge: true,
  calculationBasis: 'PERCENT_TOTAL',
  accountGroup: 'DIRECT_EXPENSE',
  isActive: true
}

export default function AccountingHeadMasterPage() {
  const [companyId, setCompanyId] = useState('')
  const [rows, setRows] = useState<AccountingHead[]>([])
  const [mandiTypes, setMandiTypes] = useState<MandiType[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [canReadAccountingHead, setCanReadAccountingHead] = useState(false)
  const [canWriteAccountingHead, setCanWriteAccountingHead] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<AccountingHead | null>(null)
  const [search, setSearch] = useState('')
  const [formData, setFormData] = useState(DEFAULT_FORM)

  const visibleMandiTypes = useMemo(
    () => getVisibleMandiTypes(mandiTypes, formData.mandiTypeId),
    [formData.mandiTypeId, mandiTypes]
  )

  const fetchAccountingHeadPermissions = useCallback(async (resolvedCompanyId: string) => {
    const denied = { canRead: false, canWrite: false }
    try {
      const payload = await loadClientPermissions(resolvedCompanyId)
      const { canRead, canWrite } = getClientModulePermission(payload.permissions, 'MASTER_ACCOUNTING_HEAD')

      setCanReadAccountingHead(canRead)
      setCanWriteAccountingHead(canWrite)
      return { canRead, canWrite }
    } catch {
      setCanReadAccountingHead(false)
      setCanWriteAccountingHead(false)
      return denied
    }
  }, [])

  const fetchMasterData = useCallback(async (targetCompanyId: string) => {
    if (!targetCompanyId) return
    try {
      const [headsResponse, mandiTypesResponse] = await Promise.all([
        fetch(`/api/accounting-heads?companyId=${encodeURIComponent(targetCompanyId)}`, { cache: 'no-store' }),
        fetch(`/api/mandi-types?companyId=${encodeURIComponent(targetCompanyId)}`, { cache: 'no-store' })
      ])

      const [headsPayload, mandiTypesPayload] = await Promise.all([
        headsResponse.json().catch(() => [] as AccountingHead[]),
        mandiTypesResponse.json().catch(() => [] as MandiType[])
      ])

      if (!headsResponse.ok) {
        throw new Error((headsPayload as { error?: string }).error || 'Failed to load accounting heads')
      }
      if (!mandiTypesResponse.ok) {
        throw new Error((mandiTypesPayload as { error?: string }).error || 'Failed to load mandi types')
      }

      setRows(Array.isArray(headsPayload) ? headsPayload : [])
      setMandiTypes(Array.isArray(mandiTypesPayload) ? mandiTypesPayload : [])
      setErrorMessage('')
    } catch (error) {
      setRows([])
      setMandiTypes([])
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load accounting head master')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadAccountingHeadScope = async () => {
      setLoading(true)
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return

      if (!resolvedCompanyId) {
        setCompanyId('')
        setRows([])
        setMandiTypes([])
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
        setMandiTypes([])
        setErrorMessage('No access to accounting head master for this user.')
        setLoading(false)
        return
      }

      await fetchMasterData(resolvedCompanyId)
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
  }, [fetchAccountingHeadPermissions, fetchMasterData])

  const resetForm = () => {
    setFormData(DEFAULT_FORM)
    setEditingRow(null)
    setIsFormOpen(false)
  }

  const openCreate = () => {
    setFormData(DEFAULT_FORM)
    setEditingRow(null)
    setIsFormOpen(true)
  }

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows

    return rows.filter((row) =>
      [
        row.name,
        row.category,
        row.mandiTypeName || '',
        row.calculationBasis || '',
        row.accountGroup || '',
        String(row.amount),
        String(row.defaultValue)
      ]
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
    const defaultValue = Number(formData.defaultValue)
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(defaultValue) || defaultValue < 0) {
      alert('Amount and default value must be valid non-negative numbers')
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
          value: defaultValue,
          defaultValue,
          mandiTypeId: formData.mandiTypeId || null,
          isMandiCharge: formData.isMandiCharge,
          calculationBasis: formData.calculationBasis,
          accountGroup: formData.accountGroup,
          isActive: formData.isActive
        })
      })

      const payload = await response.json().catch(() => ({} as { error?: string }))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save accounting head')
      }

      alert(editingRow ? 'Accounting head updated successfully!' : 'Accounting head created successfully!')
      resetForm()
      await fetchMasterData(companyId)
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
      defaultValue: String(Number(row.defaultValue ?? row.value ?? 0)),
      mandiTypeId: row.mandiTypeId || '',
      isMandiCharge: Boolean(row.isMandiCharge),
      calculationBasis: row.calculationBasis || 'PERCENT_TOTAL',
      accountGroup: row.accountGroup || 'DIRECT_EXPENSE',
      isActive: row.isActive !== false
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
      await fetchMasterData(companyId)
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
      await fetchMasterData(companyId)
    }
  }

  const handleExportCsv = () => {
    if (rows.length === 0) {
      alert('No accounting head data to export')
      return
    }

    const headers = ['Name', 'Category', 'MandiType', 'IsMandiCharge', 'CalculationBasis', 'DefaultValue', 'Amount', 'AccountGroup', 'CreatedAt']
    const csvRows = rows.map((row) => [
      row.name,
      row.category,
      row.mandiTypeName || '',
      row.isMandiCharge ? 'Yes' : 'No',
      row.calculationBasis || '',
      row.defaultValue,
      row.amount,
      row.accountGroup || '',
      row.createdAt
    ])
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
      <AppLoaderShell
        kind="master"
        companyId={companyId}
        fullscreen
        title="Loading accounting heads"
        message="Syncing accounting head defaults, mandi linkage, and ledger group settings."
      />
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto max-w-7xl">
          {errorMessage ? (
            <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : null}

          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <BookOpenText className="h-8 w-8 text-amber-600" />
              <div>
                <h1 className="text-3xl font-bold">Accounting Head Master</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Configure mandi charges, calculation rules, and ledger grouping from one master.
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

          {isFormOpen ? (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingRow ? 'Edit Accounting Head' : 'Add New Accounting Head'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <Label htmlFor="accountingHeadName">Name *</Label>
                      <Input
                        id="accountingHeadName"
                        value={formData.name}
                        onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                        placeholder="e.g. Mandi Fee"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="accountingHeadCategory">Category *</Label>
                      <Input
                        id="accountingHeadCategory"
                        value={formData.category}
                        onChange={(event) => setFormData((current) => ({ ...current, category: event.target.value }))}
                        placeholder="e.g. Statutory Charges"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="accountingHeadAmount">Amount</Label>
                      <Input
                        id="accountingHeadAmount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.amount}
                        onChange={(event) => setFormData((current) => ({ ...current, amount: event.target.value }))}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <Label htmlFor="accountingHeadDefaultValue">Default Value</Label>
                      <Input
                        id="accountingHeadDefaultValue"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.defaultValue}
                        onChange={(event) => setFormData((current) => ({ ...current, defaultValue: event.target.value }))}
                        placeholder="e.g. 1.50 or 5.00"
                      />
                    </div>
                    <div>
                      <Label htmlFor="accountingHeadMandiType">Mandi Type</Label>
                      <Select
                        value={formData.mandiTypeId || '__all__'}
                        onValueChange={(value) => setFormData((current) => ({ ...current, mandiTypeId: value === '__all__' ? '' : value }))}
                      >
                        <SelectTrigger id="accountingHeadMandiType">
                          <SelectValue placeholder="Select mandi type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All Mandi Types</SelectItem>
                          {visibleMandiTypes.map((mandiType) => (
                            <SelectItem key={mandiType.id} value={mandiType.id}>
                              {getMandiTypeOptionLabel(mandiType)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {formData.mandiTypeId && mandiTypes.find((row) => row.id === formData.mandiTypeId)?.isActive === false ? (
                        <p className="mt-1 text-xs text-amber-700">This accounting head is linked to an inactive mandi type.</p>
                      ) : null}
                    </div>
                    <div>
                      <Label htmlFor="accountingHeadCalculationBasis">Calculation Basis</Label>
                      <Select
                        value={formData.calculationBasis}
                        onValueChange={(value) => setFormData((current) => ({ ...current, calculationBasis: value }))}
                      >
                        <SelectTrigger id="accountingHeadCalculationBasis">
                          <SelectValue placeholder="Select basis" />
                        </SelectTrigger>
                        <SelectContent>
                          {MANDI_CALCULATION_BASIS_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="accountingHeadAccountGroup">Account Group</Label>
                      <Select
                        value={formData.accountGroup}
                        onValueChange={(value) => setFormData((current) => ({ ...current, accountGroup: value }))}
                      >
                        <SelectTrigger id="accountingHeadAccountGroup">
                          <SelectValue placeholder="Select group" />
                        </SelectTrigger>
                        <SelectContent>
                          {ACCOUNT_GROUP_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-3 pt-6">
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-700" htmlFor="accountingHeadIsMandiCharge">
                        <input
                          id="accountingHeadIsMandiCharge"
                          type="checkbox"
                          checked={formData.isMandiCharge}
                          onChange={(event) => setFormData((current) => ({ ...current, isMandiCharge: event.target.checked }))}
                        />
                        Use in mandi bill charge auto-calculation
                      </label>
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-700" htmlFor="accountingHeadIsActive">
                        <input
                          id="accountingHeadIsActive"
                          type="checkbox"
                          checked={formData.isActive}
                          onChange={(event) => setFormData((current) => ({ ...current, isActive: event.target.checked }))}
                        />
                        Active accounting head
                      </label>
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    Billing automation uses the selected mandi type and calculation basis:
                    `% of Total`, `Per Weight`, or `Per Bag`.
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
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <span>Accounting Heads</span>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, mandi type, basis, group"
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
                      <TableHead>Mandi Type</TableHead>
                      <TableHead>Basis</TableHead>
                      <TableHead className="text-right">Default Value</TableHead>
                      <TableHead>Account Group</TableHead>
                      <TableHead>Charge</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!canReadAccountingHead ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-slate-500">
                          No access to view accounting heads.
                        </TableCell>
                      </TableRow>
                    ) : filteredRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-slate-500">
                          No accounting heads found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.name}</TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell>{row.mandiTypeName || 'All Mandi Types'}</TableCell>
                          <TableCell>{getCalculationBasisLabel(row.calculationBasis)}</TableCell>
                          <TableCell className="text-right">{Number(row.defaultValue || 0).toFixed(2)}</TableCell>
                          <TableCell>{getAccountGroupLabel(row.accountGroup)}</TableCell>
                          <TableCell>{row.isMandiCharge ? 'Enabled' : 'No'}</TableCell>
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
