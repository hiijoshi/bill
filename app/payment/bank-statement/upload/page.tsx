'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Landmark, ScanSearch, Upload } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type {
  StatementDocumentMeta,
  StatementPreviewRow,
  StatementSummary,
  StatementTargetSelection
} from '@/lib/bank-statement-types'
import { invalidateAppDataCaches, notifyAppDataChanged } from '@/lib/app-live-data'
import { loadClientCachedValue } from '@/lib/client-cached-value'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

type BankRecord = {
  id: string
  name: string
  branch?: string | null
  accountNumber?: string | null
  ifscCode?: string | null
}

type AccountingHeadRecord = {
  id: string
  name: string
  category: string
}

type PartyRecord = {
  id: string
  name: string
  type: string
  address: string
  phone1: string
  bankName: string
  accountNo: string
  ifscCode: string
}

type SupplierRecord = {
  id: string
  name: string
  address: string
  phone1: string
  gstNumber: string
  bankName: string
  accountNo: string
  ifscCode: string
}

type StatementPayload = {
  success?: boolean
  bank?: BankRecord
  document?: StatementDocumentMeta
  summary?: StatementSummary
  entries?: StatementPreviewRow[]
  error?: string
}

type CollectionPayload<T> =
  | T[]
  | {
      data?: T[]
    }

const BANK_STATEMENT_REFERENCE_CACHE_AGE_MS = 30_000

function normalizeCollection<T>(payload: CollectionPayload<T>): T[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
    return payload.data
  }
  return []
}

function formatCurrency(value: number): string {
  return `₹${Number(value || 0).toFixed(2)}`
}

function formatStatementDate(value: string): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-IN')
}

function getStatusVariant(status: StatementPreviewRow['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'settled' || status === 'imported') return 'default'
  if (status === 'unsettled') return 'secondary'
  if (status === 'invalid') return 'destructive'
  return 'outline'
}

function encodeTargetSelection(target: StatementTargetSelection | null | undefined): string {
  if (!target) return ''
  return `${target.targetType}:${target.targetId}`
}

function buildAutoSelectionMap(
  entries: StatementPreviewRow[],
  currentSelections: Record<string, string>
): Record<string, string> {
  const nextSelections: Record<string, string> = {}

  for (const entry of entries) {
    if (!entry.externalId || entry.status !== 'unsettled') continue

    const existingValue = currentSelections[entry.externalId]
    if (existingValue) {
      nextSelections[entry.externalId] = existingValue
      continue
    }

    if (entry.selectedTarget) {
      nextSelections[entry.externalId] = encodeTargetSelection(entry.selectedTarget)
      continue
    }

    if (
      entry.suggestedTarget &&
      (entry.suggestedTarget.confidence === 'high' || entry.suggestedTarget.confidence === 'medium')
    ) {
      nextSelections[entry.externalId] = encodeTargetSelection(entry.suggestedTarget)
    }
  }

  return nextSelections
}

export default function BankStatementUploadPage() {
  return (
    <Suspense fallback={<AppLoaderShell kind="bank" fullscreen />}>
      <BankStatementUploadPageContent />
    </Suspense>
  )
}

function BankStatementUploadPageContent() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [verifyingStatement, setVerifyingStatement] = useState(false)
  const [uploadingStatement, setUploadingStatement] = useState(false)

  const [banks, setBanks] = useState<BankRecord[]>([])
  const [accountingHeads, setAccountingHeads] = useState<AccountingHeadRecord[]>([])
  const [parties, setParties] = useState<PartyRecord[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([])

  const [selectedBankId, setSelectedBankId] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [result, setResult] = useState<StatementPayload | null>(null)
  const [manualTargets, setManualTargets] = useState<Record<string, string>>({})
  const [statusMessage, setStatusMessage] = useState('')
  const [statusTone, setStatusTone] = useState<'success' | 'error' | null>(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return

      if (!resolvedCompanyId) {
        setLoading(false)
        router.push('/company/select')
        return
      }

      setCompanyId(resolvedCompanyId)
      stripCompanyParamsFromUrl()
    })()

    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    if (!companyId) return

    let cancelled = false
    setLoading(true)

    ;(async () => {
      try {
        const payload = await loadClientCachedValue<{
          banks: BankRecord[]
          accountingHeads: AccountingHeadRecord[]
          parties: PartyRecord[]
          suppliers: SupplierRecord[]
        }>(
          `bank-statement-entry:${companyId}`,
          async () => {
            const [banksResponse, accountingHeadsResponse, partiesResponse, suppliersResponse] = await Promise.all([
              fetch(`/api/banks?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
              fetch(`/api/accounting-heads?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
              fetch(`/api/parties?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
              fetch(`/api/suppliers?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
            ])

            const [banksPayload, accountingHeadsPayload, partiesPayload, suppliersPayload] = await Promise.all([
              banksResponse.json().catch(() => [] as CollectionPayload<BankRecord>),
              accountingHeadsResponse.json().catch(() => [] as CollectionPayload<AccountingHeadRecord>),
              partiesResponse.json().catch(() => [] as CollectionPayload<PartyRecord>),
              suppliersResponse.json().catch(() => [] as CollectionPayload<SupplierRecord>)
            ])

            return {
              banks: normalizeCollection<BankRecord>(banksPayload)
                .map((bank) => ({
                  id: String(bank.id || ''),
                  name: String(bank.name || '').trim(),
                  branch: String(bank.branch || '').trim(),
                  accountNumber: String(bank.accountNumber || '').trim(),
                  ifscCode: String(bank.ifscCode || '').trim().toUpperCase()
                }))
                .filter((bank) => bank.id && bank.name),
              accountingHeads: normalizeCollection<AccountingHeadRecord>(accountingHeadsPayload)
                .map((row) => ({
                  id: String(row.id || ''),
                  name: String(row.name || '').trim(),
                  category: String(row.category || '').trim()
                }))
                .filter((row) => row.id && row.name),
              parties: normalizeCollection<PartyRecord>(partiesPayload)
                .map((row) => ({
                  id: String(row.id || ''),
                  name: String(row.name || '').trim(),
                  type: String(row.type || '').trim(),
                  address: String(row.address || '').trim(),
                  phone1: String(row.phone1 || '').trim(),
                  bankName: String(row.bankName || '').trim(),
                  accountNo: String(row.accountNo || '').trim(),
                  ifscCode: String(row.ifscCode || '').trim().toUpperCase()
                }))
                .filter((row) => row.id && row.name),
              suppliers: normalizeCollection<SupplierRecord>(suppliersPayload)
                .map((row) => ({
                  id: String(row.id || ''),
                  name: String(row.name || '').trim(),
                  address: String(row.address || '').trim(),
                  phone1: String(row.phone1 || '').trim(),
                  gstNumber: String(row.gstNumber || '').trim(),
                  bankName: String(row.bankName || '').trim(),
                  accountNo: String(row.accountNo || '').trim(),
                  ifscCode: String(row.ifscCode || '').trim().toUpperCase()
                }))
                .filter((row) => row.id && row.name)
            }
          },
          { maxAgeMs: BANK_STATEMENT_REFERENCE_CACHE_AGE_MS }
        )

        if (cancelled) return

        setBanks(payload.banks)
        setSelectedBankId((current) => current || payload.banks[0]?.id || '')
        setAccountingHeads(payload.accountingHeads)
        setParties(payload.parties)
        setSuppliers(payload.suppliers)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [companyId])

  useEffect(() => {
    const onCompanyChanged = (event: Event) => {
      const nextCompanyId = (event as CustomEvent<{ companyId?: string }>).detail?.companyId?.trim() || ''
      if (!nextCompanyId || nextCompanyId === companyId) return
      setCompanyId(nextCompanyId)
    }

    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    return () => {
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [companyId])

  const selectedBank = useMemo(
    () => banks.find((bank) => bank.id === selectedBankId) || null,
    [banks, selectedBankId]
  )

  const statementTargetOptions = useMemo<SearchableSelectOption[]>(() => {
    const accountHeadOptions = accountingHeads.map((head) => ({
      value: `accounting-head:${head.id}`,
      label: `Accounting Head • ${head.name}`,
      description: head.category ? `Category: ${head.category}` : 'Accounting head',
      keywords: [head.name, head.category]
    }))

    const partyOptions = parties.map((party) => ({
      value: `party:${party.id}`,
      label: `Party • ${party.name}`,
      description: [party.type, party.address, party.phone1].filter(Boolean).join(' • ') || 'Party',
      keywords: [party.name, party.type, party.address, party.phone1, party.bankName, party.accountNo, party.ifscCode]
    }))

    const supplierOptions = suppliers.map((supplier) => ({
      value: `supplier:${supplier.id}`,
      label: `Supplier • ${supplier.name}`,
      description: [supplier.address, supplier.phone1, supplier.gstNumber].filter(Boolean).join(' • ') || 'Supplier',
      keywords: [supplier.name, supplier.address, supplier.phone1, supplier.gstNumber, supplier.bankName, supplier.accountNo, supplier.ifscCode]
    }))

    return [...accountHeadOptions, ...partyOptions, ...supplierOptions]
      .sort((left, right) => left.label.localeCompare(right.label))
  }, [accountingHeads, parties, suppliers])

  const statementTargetMap = useMemo(
    () => new Map(statementTargetOptions.map((option) => [option.value, option] as const)),
    [statementTargetOptions]
  )

  const summary = useMemo<StatementSummary>(() => {
    const entries = result?.entries || []
    if (entries.length === 0) {
      return result?.summary || {
        total: 0,
        settled: 0,
        unsettled: 0,
        imported: 0,
        errors: 0
      }
    }

    return {
      total: entries.length,
      settled: entries.filter((entry) => entry.status === 'settled').length,
      unsettled: entries.filter((entry) => entry.status === 'unsettled').length,
      imported: entries.filter((entry) => entry.status === 'imported').length,
      errors: entries.filter((entry) => entry.status === 'invalid').length
    }
  }, [result])

  const entries = result?.entries || []
  const unsettledEntries = useMemo(
    () => entries.filter((entry) => entry.status === 'unsettled' && entry.externalId),
    [entries]
  )

  const readyToImportCount = useMemo(
    () => unsettledEntries.filter((entry) => Boolean(manualTargets[entry.externalId])).length,
    [manualTargets, unsettledEntries]
  )

  const hasPreview = entries.length > 0
  const canUpload =
    hasPreview &&
    readyToImportCount > 0 &&
    !uploadingStatement &&
    !verifyingStatement

  const stepCards = [
    {
      title: 'Select Bank',
      value: selectedBank ? selectedBank.name : 'Pending',
      description: selectedBank ? 'Using this bank for statement verification.' : 'Choose the bank account first.'
    },
    {
      title: 'Upload Document',
      value: selectedFile ? selectedFile.name : 'Pending',
      description: selectedFile ? 'Statement file attached and ready for verification.' : 'CSV, Excel, PDF, image, or text file.'
    },
    {
      title: 'System Verification',
      value: hasPreview ? `${summary.settled} settled / ${summary.unsettled} not settled` : 'Pending',
      description: hasPreview ? 'The system checked every row against recorded payments.' : 'Verification starts after upload.'
    },
    {
      title: 'Ready Settlement',
      value: readyToImportCount > 0 ? `${readyToImportCount} selected` : 'Pending',
      description: readyToImportCount > 0 ? 'Only selected unmatched rows will import.' : 'Map unmatched rows to party, supplier, or account head.'
    }
  ]

  const submitStatement = async (action: 'preview' | 'import') => {
    if (!companyId) {
      alert('Company not selected.')
      return
    }

    if (!selectedBankId) {
      alert('Select bank first.')
      return
    }

    if (!selectedFile) {
      alert('Choose a bank statement file first.')
      return
    }

    if (action === 'preview') {
      setVerifyingStatement(true)
    } else {
      setUploadingStatement(true)
    }

    setStatusMessage('')
    setStatusTone(null)

    try {
      const formData = new FormData()
      formData.set('companyId', companyId)
      formData.set('bankId', selectedBankId)
      formData.set('action', action)
      formData.set('file', selectedFile)
      formData.set('manualTargets', JSON.stringify(manualTargets))

      const response = await fetch('/api/payments/bank-statement/import', {
        method: 'POST',
        body: formData
      })
      const payload = (await response.json().catch(() => ({}))) as StatementPayload
      if (!response.ok) {
        throw new Error(payload.error || `Failed to ${action === 'preview' ? 'verify' : 'import'} bank statement`)
      }

      setResult(payload)
      const nextSelections = buildAutoSelectionMap(payload.entries || [], manualTargets)
      setManualTargets(nextSelections)

      if (action === 'preview') {
        setStatusTone('success')
        setStatusMessage('Statement verified. Review matched settlements and map only the rows that are still not settled.')
      } else {
        const importedCount = Number(payload.summary?.imported || 0)
        const remainingUnsettled = Number(payload.summary?.unsettled || 0)
        if (importedCount > 0) {
          invalidateAppDataCaches(companyId, ['payments'])
          notifyAppDataChanged({ companyId, scopes: ['payments'] })
        }
        setStatusTone('success')
        setStatusMessage(
          importedCount > 0
            ? `${importedCount} settlement row${importedCount === 1 ? '' : 's'} imported successfully. ${remainingUnsettled} row${remainingUnsettled === 1 ? '' : 's'} still not settled.`
            : 'No mapped settlements were imported.'
        )
      }
    } catch (error) {
      const fallback = action === 'preview' ? 'Failed to verify bank statement' : 'Failed to import bank statement'
      const message = error instanceof Error ? error.message : fallback
      setStatusTone('error')
      setStatusMessage(message)
      alert(message)
    } finally {
      if (action === 'preview') {
        setVerifyingStatement(false)
      } else {
        setUploadingStatement(false)
      }
    }
  }

  if (loading) {
    return (
      <AppLoaderShell
        kind="bank"
        companyId={companyId}
        title="Preparing statement verification"
        message="Loading banks, account heads, parties, suppliers, and verified settlement tools."
      />
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Bank Statement Verification</h1>
              <p className="mt-1 text-sm text-slate-600">
                Upload PDF, CSV, Excel, text, or statement image. The system verifies rows against saved payments, shows settled and not settled rows, then lets you map remaining rows in one combined dropdown.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => router.push('/payment/dashboard')}>
                View Payment History
              </Button>
              <Button variant="outline" onClick={() => router.push('/payment/cash-bank/entry')}>
                Record Cash / Bank Payment
              </Button>
              <Button variant="outline" onClick={() => router.push('/main/dashboard')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Dashboard
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {stepCards.map((card) => (
              <Card key={card.title}>
                <CardContent className="pt-6">
                  <p className="text-sm font-medium text-slate-500">{card.title}</p>
                  <p className="mt-2 text-xl font-semibold text-slate-900 break-all">{card.value}</p>
                  <p className="mt-2 text-sm text-slate-600">{card.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Landmark className="h-5 w-5" />
                Statement Details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              {banks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <p className="text-sm text-slate-700">No bank master found for this company.</p>
                  <Button className="mt-4" onClick={() => router.push('/master/bank')}>
                    Add Bank Master
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="bankId">Select Bank</Label>
                      <Select
                        value={selectedBankId}
                        onValueChange={(value) => {
                          setSelectedBankId(value)
                          setResult(null)
                          setManualTargets({})
                          setStatusMessage('')
                          setStatusTone(null)
                        }}
                      >
                        <SelectTrigger id="bankId">
                          <SelectValue placeholder="Select bank" />
                        </SelectTrigger>
                        <SelectContent>
                          {banks.map((bank) => (
                            <SelectItem key={bank.id} value={bank.id}>
                              {bank.branch ? `${bank.name} (${bank.branch})` : bank.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="statementFile">Upload Statement / Proof Document</Label>
                      <Input
                        id="statementFile"
                        type="file"
                        accept=".csv,.txt,.xls,.xlsx,.pdf,image/*"
                        onChange={(event) => {
                          setSelectedFile(event.target.files?.[0] || null)
                          setResult(null)
                          setManualTargets({})
                          setStatusMessage('')
                          setStatusTone(null)
                        }}
                      />
                      <p className="text-xs text-slate-500">
                        Supported files: CSV, TXT, XLS, XLSX, PDF, JPG, PNG, WEBP and other common statement images.
                      </p>
                    </div>
                  </div>

                  {selectedBank ? (
                    <div className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-700">
                      <p className="font-medium text-slate-900">{selectedBank.name}</p>
                      <p className="mt-1">
                        Branch: {selectedBank.branch || 'N/A'} | Account No: {selectedBank.accountNumber || 'N/A'} | IFSC: {selectedBank.ifscCode || 'N/A'}
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => void submitStatement('preview')}
                      disabled={!selectedBankId || !selectedFile || verifyingStatement || uploadingStatement}
                    >
                      <ScanSearch className="mr-2 h-4 w-4" />
                      {verifyingStatement ? 'Verifying Statement...' : 'Verify Statement'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void submitStatement('import')}
                      disabled={!canUpload}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {uploadingStatement ? 'Importing Settlements...' : 'Import Selected Settlements'}
                    </Button>
                  </div>

                  {statusMessage ? (
                    <div
                      className={`rounded-lg border px-4 py-3 text-sm ${
                        statusTone === 'error'
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      }`}
                    >
                      {statusMessage}
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                Verification Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Total Rows</p>
                  <p className="mt-2 text-2xl font-semibold">{summary.total}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Settled</p>
                  <p className="mt-2 text-2xl font-semibold text-emerald-700">{summary.settled}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Ready to Import</p>
                  <p className="mt-2 text-2xl font-semibold text-blue-700">{readyToImportCount}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Not Settled</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-700">{summary.unsettled}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Imported / Errors</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {summary.imported} / {summary.errors}
                  </p>
                </div>
              </div>

              {result?.document ? (
                <div className="rounded-lg border bg-white p-4 text-sm text-slate-700">
                  <p className="font-medium text-slate-900">{result.document.fileName}</p>
                  <p className="mt-1">
                    Document Type: <span className="font-medium uppercase">{result.document.kind}</span> | Parser: {result.document.parser}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Statement Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Remark</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>System Match</TableHead>
                      <TableHead>Suggested / Selected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => {
                      const selectedValue = entry.externalId ? manualTargets[entry.externalId] || '' : ''
                      const selectedLabel = selectedValue ? statementTargetMap.get(selectedValue)?.label || selectedValue : ''

                      return (
                        <TableRow key={`${entry.externalId || 'row'}-${entry.rowNo}`}>
                          <TableCell>{entry.rowNo}</TableCell>
                          <TableCell>{formatStatementDate(entry.postedAt)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{entry.direction === 'in' ? 'Credit' : 'Debit'}</Badge>
                          </TableCell>
                          <TableCell>{formatCurrency(entry.amount)}</TableCell>
                          <TableCell>{entry.reference || '-'}</TableCell>
                          <TableCell className="max-w-[260px] truncate">{entry.description || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={getStatusVariant(entry.status)}>{entry.status}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-sm">
                              <div>{entry.matchedTypeLabel || entry.reason || '-'}</div>
                              {entry.matchedTargetLabel ? (
                                <div className="text-xs text-slate-500">{entry.matchedTargetLabel}</div>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-sm">
                              <div>{selectedLabel || entry.suggestedTarget?.targetLabel || '-'}</div>
                              {entry.suggestedTarget?.confidence ? (
                                <div className="text-xs text-slate-500">Suggestion: {entry.suggestedTarget.confidence}</div>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {!entries.length ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-slate-500">
                          Upload a statement and run verification to preview settled and not settled rows.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Settlement Mapping</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {unsettledEntries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
                  All verified rows are already settled, or there are no unmatched rows to map.
                </div>
              ) : (
                unsettledEntries.map((entry) => (
                  <div key={entry.externalId} className="rounded-2xl border bg-slate-50/70 p-4">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">Row {entry.rowNo}</Badge>
                          <Badge variant="outline">{entry.direction === 'in' ? 'Credit' : 'Debit'}</Badge>
                          <span className="text-sm font-medium text-slate-900">{formatCurrency(entry.amount)}</span>
                          <span className="text-sm text-slate-500">{formatStatementDate(entry.postedAt)}</span>
                        </div>
                        <p className="text-sm text-slate-700">{entry.description || 'No narration found.'}</p>
                        <p className="text-xs text-slate-500">Reference: {entry.reference || 'N/A'}</p>
                        <p className="text-xs text-slate-500">
                          {entry.suggestedTarget
                            ? `${entry.suggestedTarget.reason || 'System found a likely settlement match.'} ${entry.suggestedTarget.confidence ? `Confidence: ${entry.suggestedTarget.confidence}.` : ''}`
                            : 'No automatic settlement suggestion was found for this row.'}
                        </p>
                      </div>

                      <div className="space-y-3">
                        <div className="grid gap-2">
                          <Label htmlFor={`settlement-${entry.externalId}`}>Settlement Target</Label>
                          <SearchableSelect
                            id={`settlement-${entry.externalId}`}
                            value={manualTargets[entry.externalId] || ''}
                            onValueChange={(value) => {
                              setManualTargets((current) => ({
                                ...current,
                                [entry.externalId]: value
                              }))
                            }}
                            options={statementTargetOptions}
                            placeholder="Search account head, party, or supplier"
                            searchPlaceholder="Search target..."
                            emptyText="No settlement targets found."
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {manualTargets[entry.externalId] ? (
                            <Badge variant="default">Ready to import</Badge>
                          ) : (
                            <Badge variant="secondary">Not settled yet</Badge>
                          )}
                          {entry.suggestedTarget ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setManualTargets((current) => ({
                                  ...current,
                                  [entry.externalId]: encodeTargetSelection(entry.suggestedTarget)
                                }))
                              }}
                            >
                              Use Suggestion
                            </Button>
                          ) : null}
                          {manualTargets[entry.externalId] ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setManualTargets((current) => {
                                  const next = { ...current }
                                  delete next[entry.externalId]
                                  return next
                                })
                              }}
                            >
                              Clear
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
