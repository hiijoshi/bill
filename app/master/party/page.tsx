'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import MasterCsvTemplateHint from '@/components/master/MasterCsvTemplateHint'
import { Plus, Edit, Trash2, Upload, Users } from 'lucide-react'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId } from '@/lib/company-context'
import { useRouter } from 'next/navigation'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { isAbortError } from '@/lib/http'

interface Party {
  id: string
  type: 'farmer' | 'buyer'
  name: string
  address?: string
  phone1?: string
  phone2?: string
  openingBalance?: number
  openingBalanceType?: 'receivable'
  openingBalanceDate?: string | null
  openingOutstandingAmount?: number
  currentBalanceAmount?: number
  creditLimit?: number | null
  creditDays?: number | null
  ifscCode?: string
  bankName?: string
  accountNo?: string
  mandiTypeId?: string | null
  mandiTypeName?: string | null
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

type PartyResponsePayload = Party[] | {
  data?: Party[]
  error?: string
  timedOut?: boolean
  aborted?: boolean
}

const getFinancialYearStartValue = (date = new Date()): string => {
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
  return `${year}-04-01`
}

const formatDateLabel = (value: string | null | undefined): string => {
  if (!value) return '-'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('en-GB')
}

const formatCurrency = (value: number | null | undefined): string => `₹${Number(value || 0).toFixed(2)}`

export default function PartyMasterPage() {
  const router = useRouter()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [parties, setParties] = useState<Party[]>([])
  const [filteredParties, setFilteredParties] = useState<Party[]>([])
  const [loading, setLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingParty, setEditingParty] = useState<Party | null>(null)
  const [companyId, setCompanyId] = useState('')
  const [mandiTypes, setMandiTypes] = useState<MandiType[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    type: 'buyer' as 'farmer' | 'buyer',
    name: '',
    address: '',
    phone1: '',
    phone2: '',
    openingBalance: '',
    openingBalanceDate: getFinancialYearStartValue(),
    creditLimit: '',
    creditDays: '',
    ifscCode: '',
    bankName: '',
    accountNo: '',
    mandiTypeId: ''
  })

  const applyParties = useCallback((rows: Party[], cacheKey: string) => {
    setParties(rows)
    setClientCache(cacheKey, { data: rows })
  }, [])

  const visibleMandiTypes = useMemo(
    () => getVisibleMandiTypes(mandiTypes, formData.mandiTypeId),
    [formData.mandiTypeId, mandiTypes]
  )

  useEffect(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) {
      setFilteredParties(parties)
      return
    }

    const filtered = parties.filter((party) =>
      [party.name, party.type, party.phone1 || '', party.bankName || '', party.address || '', party.mandiTypeName || '']
        .join(' ')
        .toLowerCase()
        .includes(term)
    )
    setFilteredParties(filtered)
  }, [parties, searchTerm])

  const fetchParties = useCallback(async (id = companyId) => {
    if (!id) return
    const cacheKey = `master-parties:${id}`
    const cached = getClientCache<{ data?: Party[] }>(cacheKey, 30_000)
    if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
      const buyerParties = cached.data.filter((party) => party?.type === 'buyer')
      applyParties(buyerParties, cacheKey)
      setLoading(false)
    }

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(`/api/parties?companyId=${id}`, { cache: 'no-store' })
          const payload = (await response.json().catch(() => ({}))) as PartyResponsePayload
          const rows = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.data)
              ? payload.data
              : []

          if (response.ok) {
            const buyerParties = rows.filter((party) => party?.type === 'buyer')
            applyParties(buyerParties, cacheKey)
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

          setMessage({
            type: 'error',
            text:
              typeof body.error === 'string' && body.error.trim()
                ? body.error
                : cached?.data?.length
                  ? 'Party list is taking longer than expected. Showing the last loaded data.'
                  : 'Failed to load parties'
          })
          if (!cached?.data?.length) {
            setParties([])
          }
          return
        } catch (error) {
          if (isAbortError(error) && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }
          if (isAbortError(error)) {
            setMessage({
              type: 'error',
              text: cached?.data?.length
                ? 'Party list is taking longer than expected. Showing the last loaded data.'
                : 'Party list took too long to load. Please refresh once.'
            })
            if (!cached?.data?.length) {
              setParties([])
            }
            return
          }
          throw error
        }
      }
    } catch (error) {
      if (isAbortError(error)) return
      console.error('Error fetching parties:', error)
      setMessage({ type: 'error', text: 'Failed to load parties' })
      if (!cached?.data?.length) {
        setParties([])
      }
    } finally {
      setLoading(false)
    }
  }, [applyParties, companyId])

  const fetchMandiTypes = useCallback(async (id = companyId) => {
    if (!id) return
    try {
      const response = await fetch(`/api/mandi-types?companyId=${id}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => [] as MandiType[])
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'Failed to load mandi types')
      }
      setMandiTypes(Array.isArray(payload) ? payload : [])
    } catch (error) {
      console.error('Error fetching mandi types:', error)
      setMandiTypes([])
    }
  }, [companyId])

  useEffect(() => {
    let cancelled = false

    const loadPartyScope = async () => {
      setLoading(true)
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return

      if (!resolvedCompanyId) {
        setCompanyId('')
        setParties([])
        setFilteredParties([])
        setLoading(false)
        setMessage({ type: 'error', text: 'Company not selected. Please select company once.' })
        router.push('/company/select')
        return
      }

      setCompanyId(resolvedCompanyId)
      setMessage(null)
      await Promise.all([fetchParties(resolvedCompanyId), fetchMandiTypes(resolvedCompanyId)])
    }

    void loadPartyScope()

    const onCompanyChanged = () => {
      void loadPartyScope()
    }

    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)

    return () => {
      cancelled = true
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [fetchMandiTypes, fetchParties, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.type) {
      setMessage({ type: 'error', text: 'Party name and type are required' })
      return
    }
    if (!companyId) {
      setMessage({ type: 'error', text: 'Company ID missing. Cannot save.' })
      return
    }

    try {
      const url = editingParty 
        ? `/api/parties?id=${editingParty.id}&companyId=${companyId}`
        : `/api/parties?companyId=${companyId}`
      
      const method = editingParty ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          mandiTypeId: formData.mandiTypeId || null,
          type: 'buyer'
        }),
      })

      if (response.ok) {
        const result = await response.json()
        setMessage({
          type: 'success',
          text: result.message || (editingParty ? 'Party updated successfully' : 'Party data stored successfully')
        })
        resetForm()
        fetchParties()
      } else {
        const error = await response.json()
        setMessage({ type: 'error', text: error.error || 'Operation failed' })
      }
    } catch (error) {
      console.error('Error:', error)
      setMessage({ type: 'error', text: 'Operation failed' })
    }
  }

  const handleEdit = (party: Party) => {
    setEditingParty(party)
    setFormData({
      type: party.type,
      name: party.name,
      address: party.address || '',
      phone1: party.phone1 || '',
      phone2: party.phone2 || '',
      openingBalance: party.openingBalance != null ? String(party.openingBalance) : '',
      openingBalanceDate: party.openingBalanceDate ? String(party.openingBalanceDate).slice(0, 10) : getFinancialYearStartValue(),
      creditLimit: party.creditLimit != null ? String(party.creditLimit) : '',
      creditDays: party.creditDays != null ? String(party.creditDays) : '',
      ifscCode: party.ifscCode || '',
      bankName: party.bankName || '',
      accountNo: party.accountNo || '',
      mandiTypeId: party.mandiTypeId || ''
    })
    setIsFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this party? This may affect existing transactions.')) return
    if (!companyId) return

    try {
      const response = await fetch(`/api/parties?id=${id}&companyId=${companyId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        const result = await response.json()
        setMessage({ type: 'success', text: result.message || 'Party deleted successfully' })
        fetchParties()
      } else {
        const error = await response.json()
        setMessage({ type: 'error', text: error.error || 'Delete failed' })
      }
    } catch (error) {
      console.error('Error:', error)
      setMessage({ type: 'error', text: 'Delete failed' })
    }
  }

  const handleDeleteAll = async () => {
    if (!companyId) return
    if (!confirm('Delete all parties for this company?')) return

    try {
      const response = await fetch(`/api/parties?companyId=${companyId}&all=true`, {
        method: 'DELETE'
      })
      const result = await response.json()
      if (!response.ok) {
        setMessage({ type: 'error', text: result.error || 'Failed to delete all parties' })
        return
      }
      setMessage({ type: 'success', text: result.message || 'All parties deleted successfully' })
      fetchParties()
    } catch (error) {
      console.error('Delete all failed:', error)
      setMessage({ type: 'error', text: 'Failed to delete all parties' })
    }
  }

  const handleExportCsv = () => {
    if (filteredParties.length === 0) {
      setMessage({ type: 'error', text: 'No party data available to export' })
      return
    }

    const headers = [
      'Name',
      'Type',
      'Address',
      'Phone1',
      'Phone2',
      'OpeningBalance',
      'OpeningBalanceType',
      'OpeningBalanceDate',
      'CreditLimit',
      'CreditDays',
      'MandiType',
      'BankName',
      'AccountNo',
      'IFSCCode',
      'CreatedAt'
    ]
    const rows = filteredParties.map((party) => [
      party.name,
      party.type,
      party.address || '',
      party.phone1 || '',
      party.phone2 || '',
      party.openingBalance ?? '',
      'receivable',
      party.openingBalanceDate ? String(party.openingBalanceDate).slice(0, 10) : '',
      party.creditLimit ?? '',
      party.creditDays ?? '',
      party.mandiTypeName || '',
      party.bankName || '',
      party.accountNo || '',
      party.ifscCode || '',
      new Date(party.createdAt).toISOString()
    ])

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.href = url
    link.download = `parties_${companyId}_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setMessage({ type: 'success', text: 'Party data exported successfully' })
  }

  const handleImportCsv = async (file: File) => {
    if (!companyId) {
      setMessage({ type: 'error', text: 'Company ID missing. Cannot import.' })
      return
    }

    const trimmedName = file.name.trim().toLowerCase()
    if (!trimmedName.endsWith('.csv')) {
      setMessage({ type: 'error', text: 'Please upload a CSV file exported from Party Master.' })
      return
    }

    const payload = new FormData()
    payload.append('file', file)

    try {
      const response = await fetch(`/api/parties/import?companyId=${companyId}`, {
        method: 'POST',
        body: payload
      })
      const result = await response.json().catch(() => ({} as {
        error?: string
        imported?: number
        updated?: number
        skipped?: number
      }))

      if (!response.ok) {
        setMessage({ type: 'error', text: result.error || 'Party import failed' })
        return
      }

      setMessage({
        type: 'success',
        text: `Party import completed. Added ${result.imported || 0}, updated ${result.updated || 0}, skipped ${result.skipped || 0}.`
      })
      await fetchParties()
    } catch (error) {
      console.error('Party import failed:', error)
      setMessage({ type: 'error', text: 'Party import failed' })
    }
  }

  const resetForm = () => {
    setFormData({
      type: 'buyer',
      name: '',
      address: '',
      phone1: '',
      phone2: '',
      openingBalance: '',
      openingBalanceDate: getFinancialYearStartValue(),
      creditLimit: '',
      creditDays: '',
      ifscCode: '',
      bankName: '',
      accountNo: '',
      mandiTypeId: ''
    })
    setEditingParty(null)
    setIsFormOpen(false)
  }

  if (loading) {
    return (
      <AppLoaderShell
        kind="master"
        companyId={companyId}
        fullscreen
        title="Loading party master"
        message="Preparing parties, balances, mandi linkage, and company-specific setup."
      />
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-purple-600" />
              <h1 className="text-3xl font-bold">Party Master</h1>
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
                    if (!file) return
                    await handleImportCsv(file)
                    event.target.value = ''
                  }}
                />
                <Button
                  onClick={() => importInputRef.current?.click()}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Import CSV
                </Button>
                <Button onClick={handleExportCsv} variant="outline">Export CSV</Button>
                <Button onClick={handleDeleteAll} variant="destructive">Delete All</Button>
                <Button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Party
                </Button>
              </div>
              <MasterCsvTemplateHint templateKey="party" />
            </div>
          </div>

          <Card className="mb-4">
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  placeholder="Search by name, phone, bank, address"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="text-sm text-muted-foreground flex items-center md:justify-end">
                  Showing {filteredParties.length} of {parties.length} buyers
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

          {/* Form */}
          {isFormOpen && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>{editingParty ? 'Edit Party' : 'Add New Party'}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="type">Party Type</Label>
                      <Input id="type" value="Buyer" readOnly className="bg-muted" />
                    </div>
                    <div>
                      <Label htmlFor="name">Party Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Enter party name"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="address">Address</Label>
                      <Input
                        id="address"
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        placeholder="Enter address"
                      />
                    </div>
                    <div>
                      <Label htmlFor="partyMandiType">Mandi Type</Label>
                      <Select
                        value={formData.mandiTypeId || '__none__'}
                        onValueChange={(value) => setFormData({ ...formData, mandiTypeId: value === '__none__' ? '' : value })}
                      >
                        <SelectTrigger id="partyMandiType">
                          <SelectValue placeholder="Select mandi type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No Mandi Type</SelectItem>
                          {visibleMandiTypes.map((mandiType) => (
                            <SelectItem key={mandiType.id} value={mandiType.id}>
                              {getMandiTypeOptionLabel(mandiType)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {formData.mandiTypeId && mandiTypes.find((row) => row.id === formData.mandiTypeId)?.isActive === false ? (
                        <p className="mt-1 text-xs text-amber-700">This party is linked to an inactive mandi type.</p>
                      ) : null}
                    </div>
                    <div>
                      <Label htmlFor="phone1">Primary Phone</Label>
                      <Input
                        id="phone1"
                        value={formData.phone1}
                        onChange={(e) => setFormData({ ...formData, phone1: e.target.value })}
                        placeholder="Enter primary phone"
                      />
                    </div>
                    <div>
                      <Label htmlFor="phone2">Secondary Phone</Label>
                      <Input
                        id="phone2"
                        value={formData.phone2}
                        onChange={(e) => setFormData({ ...formData, phone2: e.target.value })}
                        placeholder="Enter secondary phone"
                      />
                    </div>
                    <div>
                      <Label htmlFor="openingBalance">Opening Receivable</Label>
                      <Input
                        id="openingBalance"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.openingBalance}
                        onChange={(e) => setFormData({ ...formData, openingBalance: e.target.value })}
                        placeholder="Amount pending from previous year"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        This is the receivable brought forward from old books on the first day of the financial year.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="openingBalanceDate">Opening Date</Label>
                      <Input
                        id="openingBalanceDate"
                        type="date"
                        value={formData.openingBalanceDate}
                        onChange={(e) => setFormData({ ...formData, openingBalanceDate: e.target.value })}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Use the start of the financial year, usually 01-04.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="creditLimit">Credit Limit</Label>
                      <Input
                        id="creditLimit"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.creditLimit}
                        onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
                        placeholder="Enter buyer credit limit"
                      />
                    </div>
                    <div>
                      <Label htmlFor="creditDays">Credit Days</Label>
                      <Input
                        id="creditDays"
                        type="number"
                        min="0"
                        step="1"
                        value={formData.creditDays}
                        onChange={(e) => setFormData({ ...formData, creditDays: e.target.value })}
                        placeholder="Enter overdue days"
                      />
                    </div>
                    <div>
                      <Label htmlFor="bankName">Bank Name</Label>
                      <Input
                        id="bankName"
                        value={formData.bankName}
                        onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                        placeholder="Enter bank name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="accountNo">Account Number</Label>
                      <Input
                        id="accountNo"
                        value={formData.accountNo}
                        onChange={(e) => setFormData({ ...formData, accountNo: e.target.value })}
                        placeholder="Enter account number"
                      />
                    </div>
                    <div>
                      <Label htmlFor="ifscCode">IFSC Code</Label>
                      <Input
                        id="ifscCode"
                        value={formData.ifscCode}
                        onChange={(e) => setFormData({ ...formData, ifscCode: e.target.value.toUpperCase() })}
                        placeholder="Enter IFSC code"
                        maxLength={11}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingParty ? 'Update' : 'Save'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle>Buyer List</CardTitle>
            </CardHeader>
            <CardContent>
              {filteredParties.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No buyers found. Add your first buyer to get started.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Party Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Mandi Type</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Opening Receivable</TableHead>
                      <TableHead>Closing Receivable</TableHead>
                      <TableHead>Credit Control</TableHead>
                      <TableHead>Bank Details</TableHead>
                      <TableHead>Created Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredParties.map((party) => (
                      <TableRow key={party.id}>
                        <TableCell className="font-medium">{party.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            🛒 Buyer
                          </Badge>
                        </TableCell>
                        <TableCell>{party.mandiTypeName || '-'}</TableCell>
                        <TableCell>{party.address || '-'}</TableCell>
                        <TableCell>
                          <div>
                            {party.phone1 && <div>{party.phone1}</div>}
                            {party.phone2 && <div className="text-sm text-gray-500">{party.phone2}</div>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div className="font-medium">{formatCurrency(party.openingBalance)}</div>
                            <div className="text-gray-500">
                              {formatDateLabel(party.openingBalanceDate)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div className="font-medium">{formatCurrency(party.currentBalanceAmount)}</div>
                            <div className="text-gray-500">
                              Opening pending: {formatCurrency(party.openingOutstandingAmount)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>Limit: {party.creditLimit != null ? `₹${party.creditLimit.toFixed(2)}` : '-'}</div>
                            <div className="text-gray-500">Days: {party.creditDays ?? '-'}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {party.bankName ? (
                            <div className="text-sm">
                              <div className="font-medium">{party.bankName}</div>
                              {party.accountNo && <div className="text-gray-500">{party.accountNo}</div>}
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {new Date(party.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(party)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(party.id)}
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
