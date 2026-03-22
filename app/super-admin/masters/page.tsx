'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  SUPER_ADMIN_MASTER_RESOURCES,
  getMasterResourceByKey,
  getNestedValue,
  type MasterFieldDefinition
} from '@/lib/super-admin-master-registry'

type CompanyOption = {
  id: string
  name: string
}

type FormState = Record<string, string | boolean>
type OptionMap = Record<string, Array<{ label: string; value: string }>>
type FormSection = {
  key: string
  title: string
  description: string
  fieldKeys: string[]
  gridClassName?: string
}

function normalizeRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: Record<string, unknown>[] }).data
  }
  return []
}

function toFormState(fields: MasterFieldDefinition[], row?: Record<string, unknown> | null): FormState {
  const next: FormState = {}
  for (const field of fields) {
    if (row) {
      const raw = getNestedValue(row, field.rowKey || field.key)
      next[field.key] = field.type === 'boolean' ? Boolean(raw) : raw == null ? '' : String(raw)
      continue
    }
    next[field.key] = field.defaultValue ?? (field.type === 'boolean' ? false : '')
  }
  return next
}

function normalizeFieldValue(field: MasterFieldDefinition, value: string | boolean): unknown {
  if (field.type === 'boolean') return Boolean(value)
  if (field.type === 'number') {
    if (value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const text = String(value || '').trim()
  if (!text && !field.required) return null
  return text
}

function getFormSections(resourceKey: string, fields: MasterFieldDefinition[]): FormSection[] {
  if (resourceKey === 'buyer-limits') {
    return [
      {
        key: 'buyer-details',
        title: 'Buyer Details',
        description: 'Basic buyer information used in sales and overdue tracking.',
        fieldKeys: ['name', 'phone1', 'address'],
        gridClassName: 'md:grid-cols-2'
      },
      {
        key: 'credit-rules',
        title: 'Credit Rules',
        description: 'Set how much credit is allowed and how many days are permitted.',
        fieldKeys: ['creditLimit', 'creditDays'],
        gridClassName: 'md:grid-cols-2'
      },
      {
        key: 'bank-details',
        title: 'Bank Details',
        description: 'Optional bank information for buyer reference.',
        fieldKeys: ['bankName', 'accountNo', 'ifscCode'],
        gridClassName: 'md:grid-cols-3'
      }
    ]
  }

  return [
    {
      key: 'details',
      title: `${fields.length > 3 ? 'Main' : 'Record'} Details`,
      description: 'Fill in the details below and save the record.',
      fieldKeys: fields.map((field) => field.key),
      gridClassName: 'md:grid-cols-2'
    }
  ]
}

export default function SuperAdminMastersPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">Loading master registry...</div>}>
      <SuperAdminMastersPageContent />
    </Suspense>
  )
}

function SuperAdminMastersPageContent() {
  const searchParams = useSearchParams()
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const initialResourceKey = searchParams.get('resource') || SUPER_ADMIN_MASTER_RESOURCES[0].key
  const [resourceKey, setResourceKey] = useState(initialResourceKey)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingRowId, setEditingRowId] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [formState, setFormState] = useState<FormState>({})
  const [optionMap, setOptionMap] = useState<OptionMap>({})
  const [message, setMessage] = useState('')

  const resource = useMemo(() => getMasterResourceByKey(resourceKey), [resourceKey])
  const selectedCompanyName = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId)?.name || 'No company selected',
    [companies, selectedCompanyId]
  )
  const formSections = useMemo(() => {
    const fieldMap = new Map(resource.fields.map((field) => [field.key, field]))
    return getFormSections(resource.key, resource.fields)
      .map((section) => ({
        ...section,
        fields: section.fieldKeys
          .map((fieldKey) => fieldMap.get(fieldKey))
          .filter((field): field is MasterFieldDefinition => Boolean(field))
      }))
      .filter((section) => section.fields.length > 0)
  }, [resource.fields, resource.key])

  const loadCompanies = useCallback(async () => {
    const response = await fetch('/api/companies', { cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to load companies')
    const payload = await response.json().catch(() => [])
    const nextCompanies = normalizeRows(payload)
      .map((row) => ({
        id: String(row.id || ''),
        name: String(row.name || '')
      }))
      .filter((row) => row.id && row.name)

    setCompanies(nextCompanies)
    setSelectedCompanyId((current) => current || nextCompanies[0]?.id || '')
  }, [])

  const loadRows = useCallback(async () => {
    if (!selectedCompanyId) return
    setRefreshing(true)
    try {
      const response = await fetch(`${resource.endpoint}?companyId=${encodeURIComponent(selectedCompanyId)}`, {
        cache: 'no-store'
      })
      const payload = await response.json().catch(() => [])
      if (!response.ok) throw new Error(String((payload as { error?: string }).error || 'Failed to load resource'))
      setRows(normalizeRows(payload))
      setMessage('')
    } catch (error) {
      setRows([])
      setMessage(error instanceof Error ? error.message : 'Failed to load resource')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [resource.endpoint, selectedCompanyId])

  const loadOptions = useCallback(async () => {
    if (!selectedCompanyId) return
    const nextOptions: OptionMap = {}
    for (const field of resource.fields) {
      if (!field.optionSource) {
        if (field.options) nextOptions[field.key] = field.options
        continue
      }
      const response = await fetch(
        `${field.optionSource.endpoint}?companyId=${encodeURIComponent(selectedCompanyId)}`,
        { cache: 'no-store' }
      )
      const payload = await response.json().catch(() => [])
      const rows = normalizeRows(payload)
      nextOptions[field.key] = rows
        .map((row) => ({
          label: String(getNestedValue(row, field.optionSource!.labelKey) || ''),
          value: String(getNestedValue(row, field.optionSource!.valueKey) || '')
        }))
        .filter((option) => option.label && option.value)
    }
    setOptionMap(nextOptions)
  }, [resource.fields, selectedCompanyId])

  useEffect(() => {
    const nextResourceKey = searchParams.get('resource')
    if (!nextResourceKey) return
    if (SUPER_ADMIN_MASTER_RESOURCES.some((item) => item.key === nextResourceKey)) {
      setResourceKey(nextResourceKey)
    }
  }, [searchParams])

  useEffect(() => {
    void loadCompanies()
  }, [loadCompanies])

  useEffect(() => {
    setFormState(toFormState(resource.fields))
    setEditingRowId('')
    setFormOpen(false)
  }, [resource.fields, resource.key])

  useEffect(() => {
    if (!selectedCompanyId) return
    void Promise.all([loadRows(), loadOptions()])
  }, [selectedCompanyId, resource.key, loadRows, loadOptions])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const companyScopedRows = resource.rowFilter
      ? rows.filter((row) => String(getNestedValue(row, resource.rowFilter!.key) || '') === resource.rowFilter!.value)
      : rows

    if (!query) return companyScopedRows
    return companyScopedRows.filter((row) =>
      resource.columns.some((column) =>
        String(getNestedValue(row, column.key) || '')
          .toLowerCase()
          .includes(query)
      )
    )
  }, [resource.columns, resource.rowFilter, rows, search])

  const openCreate = () => {
    setEditingRowId('')
    setFormState(toFormState(resource.fields))
    setFormOpen(true)
  }

  const openEdit = (row: Record<string, unknown>) => {
    setEditingRowId(String(row.id || ''))
    setFormState(toFormState(resource.fields, row))
    setFormOpen(true)
  }

  const saveRow = async () => {
    if (!selectedCompanyId) return
    setSaving(true)
    try {
      const query = new URLSearchParams({ companyId: selectedCompanyId })
      if (editingRowId) query.set('id', editingRowId)

      const payload: Record<string, unknown> = {}
      for (const field of resource.fields) {
        payload[field.key] = normalizeFieldValue(field, formState[field.key] ?? '')
      }
      for (const [key, value] of Object.entries(resource.fixedValues || {})) {
        payload[key] = value
      }
      if (!editingRowId && resource.createCompanyIdInBody) {
        payload.companyId = selectedCompanyId
      }

      const response = await fetch(`${resource.endpoint}?${query.toString()}`, {
        method: editingRowId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(result.error || 'Failed to save resource'))

      setFormOpen(false)
      setEditingRowId('')
      setFormState(toFormState(resource.fields))
      setMessage(`${resource.label} saved successfully`)
      await Promise.all([loadRows(), loadOptions()])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save resource')
    } finally {
      setSaving(false)
    }
  }

  const deleteRow = async (id: string) => {
    if (!selectedCompanyId || !window.confirm('Delete this record?')) return
    try {
      const query = new URLSearchParams({ companyId: selectedCompanyId, id })
      const response = await fetch(`${resource.endpoint}?${query.toString()}`, { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(result.error || 'Failed to delete resource'))
      setMessage(`${resource.label} deleted successfully`)
      await loadRows()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete resource')
    }
  }

  const renderField = (field: MasterFieldDefinition) => (
    <div key={field.key} className={field.type === 'textarea' ? 'space-y-2 md:col-span-2' : 'space-y-2'}>
      <Label className="text-sm font-medium text-slate-700">{field.label}</Label>
      {field.type === 'textarea' ? (
        <textarea
          className="min-h-28 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
          value={String(formState[field.key] ?? '')}
          onChange={(event) => setFormState((prev) => ({ ...prev, [field.key]: event.target.value }))}
          placeholder={field.placeholder || field.label}
        />
      ) : field.type === 'select' ? (
        <select
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
          value={String(formState[field.key] ?? '')}
          onChange={(event) => setFormState((prev) => ({ ...prev, [field.key]: event.target.value }))}
        >
          <option value="">Select {field.label}</option>
          {(optionMap[field.key] || field.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === 'boolean' ? (
        <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm">
          <input
            type="checkbox"
            checked={Boolean(formState[field.key])}
            onChange={(event) => setFormState((prev) => ({ ...prev, [field.key]: event.target.checked }))}
          />
          Active
        </label>
      ) : (
        <Input
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(formState[field.key] ?? '')}
          onChange={(event) => setFormState((prev) => ({ ...prev, [field.key]: event.target.value }))}
          placeholder={field.placeholder || field.label}
          className="h-11 rounded-xl border-slate-200 shadow-sm"
        />
      )}
    </div>
  )

  return (
    <SuperAdminShell title="Master Registry" subtitle="Generic company-scoped master management for super admin">
      <div className="space-y-5">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Registry Workspace</p>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{resource.label}</h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                Manage {resource.label.toLowerCase()} for <span className="font-medium text-slate-900">{selectedCompanyName}</span> in a cleaner, company-wise format.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[420px]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Company</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{selectedCompanyName}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Records</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{filteredRows.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Mode</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{editingRowId ? 'Editing' : formOpen ? 'Adding New' : 'Ready'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {message ? <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">{message}</div> : null}
        {resource.helperText ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800 shadow-sm">
            {resource.helperText}
          </div>
        ) : null}

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl tracking-tight text-slate-950">Registry Controls</CardTitle>
            <CardDescription>Select the company, choose the master type, search records, or add a new one.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1fr_1fr_1.1fr_auto] lg:items-end">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Company</Label>
              <select
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                value={selectedCompanyId}
                onChange={(event) => setSelectedCompanyId(event.target.value)}
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Resource</Label>
              <select
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
                value={resourceKey}
                onChange={(event) => setResourceKey(event.target.value)}
              >
                {SUPER_ADMIN_MASTER_RESOURCES.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Search</Label>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${resource.label.toLowerCase()}...`}
                className="h-11 rounded-xl border-slate-200 shadow-sm"
              />
            </div>
            <div className="flex flex-wrap items-end gap-2 lg:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => void Promise.all([loadRows(), loadOptions()])}
                disabled={refreshing}
                className="h-11 rounded-xl border-slate-200 px-4"
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
              <Button type="button" onClick={openCreate} className="h-11 rounded-xl px-4">
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {formOpen ? (
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl tracking-tight text-slate-950">{editingRowId ? `Edit ${resource.label}` : `Add ${resource.label}`}</CardTitle>
              <CardDescription>
                {editingRowId ? 'Update the selected record and save your changes.' : `Create a new ${resource.label.toLowerCase()} record for the selected company.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {formSections.map((section) => (
                <div key={section.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{section.description}</p>
                  </div>
                  <div className={`grid gap-4 ${section.gridClassName || 'md:grid-cols-2'}`}>
                    {section.fields.map((field) => renderField(field))}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                <Button type="button" variant="outline" className="h-11 rounded-xl border-slate-200 px-4" onClick={() => {
                  setFormOpen(false)
                  setEditingRowId('')
                  setFormState(toFormState(resource.fields))
                }}>
                  Cancel
                </Button>
                <Button type="button" onClick={saveRow} disabled={saving} className="h-11 rounded-xl px-5">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl tracking-tight text-slate-950">{resource.label} Table</CardTitle>
            <CardDescription>
              {filteredRows.length} {filteredRows.length === 1 ? 'record' : 'records'} found for {selectedCompanyName}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {resource.columns.map((column) => (
                        <TableHead key={column.key}>{column.label}</TableHead>
                      ))}
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow key={String(row.id || '')} className="hover:bg-slate-50/80">
                        {resource.columns.map((column) => {
                          const value = getNestedValue(row, column.key)
                          return (
                            <TableCell key={column.key} className="align-top">
                              {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? '-')}
                            </TableCell>
                          )
                        })}
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="outline" className="rounded-lg border-slate-200" onClick={() => openEdit(row)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="rounded-lg border-slate-200" onClick={() => void deleteRow(String(row.id || ''))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!filteredRows.length ? (
                      <TableRow>
                        <TableCell colSpan={resource.columns.length + 1} className="py-10 text-center text-sm text-slate-500">
                          No records found.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SuperAdminShell>
  )
}
