'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, Landmark, ScanSearch, Upload } from 'lucide-react'

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
  StatementDocumentKind,
  StatementDocumentMeta,
  StatementPreviewRow,
  StatementSummary,
  StatementTargetSelection
} from '@/lib/bank-statement-types'
import { invalidateAppDataCaches, notifyAppDataChanged } from '@/lib/app-live-data'
import { getClientCachedValue, loadClientCachedValue } from '@/lib/client-cached-value'
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

const BANK_STATEMENT_REFERENCE_CACHE_AGE_MS = 5 * 60_000

function normalizeCollection<T>(payload: CollectionPayload<T>): T[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
    return payload.data
  }
  return []
}

function formatCurrency(value: number): string {
  const normalizedValue = Number(value || 0)
  return `₹${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(normalizedValue) ? normalizedValue : 0)}`
}

function formatCompactStatementDate(value: string): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  const month = parsed.toLocaleDateString('en-IN', { month: 'short' })
  const day = parsed.toLocaleDateString('en-IN', { day: '2-digit' })
  const year = parsed.toLocaleDateString('en-IN', { year: '2-digit' })
  return `${month} ${day}-${year}`
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

function detectSelectedFileKind(file: File | null): StatementDocumentKind | null {
  if (!file) return null

  const extension = String(file.name || '').trim().toLowerCase().split('.').at(-1) || ''
  const mimeType = String(file.type || '').trim().toLowerCase()

  if (extension === 'csv' || mimeType.includes('csv')) return 'csv'
  if (extension === 'xls' || extension === 'xlsx' || mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'excel'
  if (extension === 'pdf' || mimeType.includes('pdf')) return 'pdf'
  if (extension === 'txt' || mimeType.startsWith('text/')) return 'text'
  if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'].includes(extension) || mimeType.startsWith('image/')) {
    return 'image'
  }

  return null
}

function getDocumentKindLabel(kind: StatementDocumentKind | null): string {
  switch (kind) {
    case 'csv':
      return 'CSV statement'
    case 'excel':
      return 'Excel statement'
    case 'pdf':
      return 'PDF statement'
    case 'image':
      return 'Statement image'
    case 'text':
      return 'Text statement'
    default:
      return 'Unknown file'
  }
}

function getDocumentKindGuidance(kind: StatementDocumentKind | null): string {
  switch (kind) {
    case 'csv':
      return 'Fastest option. Structured rows will be read directly from the CSV file.'
    case 'excel':
      return 'Structured rows will be read directly from the worksheet for the most reliable result.'
    case 'pdf':
      return 'The system will first try readable PDF text, then automatically use OCR if the PDF is scanned.'
    case 'image':
      return 'OCR scan will read the image and detect transaction rows. Clear images work best.'
    case 'text':
      return 'Plain text rows will be scanned for dates, debit/credit amounts, narration, and references.'
    default:
      return 'Select a supported statement file to verify transactions.'
  }
}

function getProcessingMessage(kind: StatementDocumentKind | null, action: 'preview' | 'import'): string {
  if (action === 'import') {
    return 'Importing mapped bank statement rows into payment history.'
  }

  switch (kind) {
    case 'csv':
    case 'excel':
      return 'Reading structured statement rows and matching them with saved payments.'
    case 'pdf':
      return 'Scanning PDF statement. Searchable text will be used first, with OCR fallback when needed.'
    case 'image':
      return 'Running OCR on the statement image and matching recognized rows with saved payments.'
    case 'text':
      return 'Reading text statement rows and checking each line against saved payments.'
    default:
      return 'Verifying uploaded statement against saved payments.'
  }
}

function getDocumentStatusMeta(
  document: StatementDocumentMeta | null | undefined,
  fallbackKind: StatementDocumentKind | null
): { label: string; className: string } {
  if (document?.recognitionMode === 'ocr') {
    return {
      label: 'Scanned',
      className: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
    }
  }

  if (document?.recognitionMode === 'structured') {
    return {
      label: 'Mapped',
      className: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
    }
  }

  if (document?.recognitionMode === 'text') {
    return {
      label: 'Recognized',
      className: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200'
    }
  }

  if (fallbackKind === 'pdf' || fallbackKind === 'image') {
    return {
      label: 'Ready for Scan',
      className: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    }
  }

  if (fallbackKind) {
    return {
      label: 'Ready for Review',
      className: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    }
  }

  return {
    label: 'Waiting for File',
    className: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
  }
}

function getEntryDebitAmount(entry: StatementPreviewRow): string {
  return entry.direction === 'out' ? formatCurrency(entry.amount) : '₹0.00'
}

function getEntryCreditAmount(entry: StatementPreviewRow): string {
  return entry.direction === 'in' ? formatCurrency(entry.amount) : '₹0.00'
}

function getEntryTargetLabel(
  entry: StatementPreviewRow,
  selectedTargetOption?: SearchableSelectOption | null
): string {
  return (
    entry.matchedTargetLabel ||
    entry.selectedTarget?.targetLabel ||
    selectedTargetOption?.label ||
    entry.suggestedTarget?.targetLabel ||
    '-'
  )
}

function getEntryRemark(
  entry: StatementPreviewRow,
  selectedTargetOption?: SearchableSelectOption | null
): string {
  if (entry.status === 'imported') {
    return entry.reason || 'Posted to the ledger.'
  }

  if (entry.status === 'settled') {
    return entry.reason || 'Auto-matched with an existing ERP entry.'
  }

  if (selectedTargetOption?.label) {
    return `Ready to post as ${selectedTargetOption.label}.`
  }

  if (entry.selectedTarget?.targetLabel) {
    return `Ready to post as ${entry.selectedTarget.targetLabel}.`
  }

  if (entry.suggestedTarget?.reason) {
    return entry.suggestedTarget.reason
  }

  return entry.reason || 'Awaiting ERP account or supplier selection.'
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
  const [statusTone, setStatusTone] = useState<'success' | 'error' | 'info' | null>(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const resolvedCompanyId = await resolveCompanyId(window.location.search)
      if (cancelled) return

      if (!resolvedCompanyId) {
        setLoading(false)
        router.push('/main/profile')
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
    const cacheKey = `bank-statement-entry:${companyId}`
    const cachedPayload = getClientCachedValue<{
      banks: BankRecord[]
      accountingHeads: AccountingHeadRecord[]
      parties: PartyRecord[]
      suppliers: SupplierRecord[]
    }>(cacheKey, BANK_STATEMENT_REFERENCE_CACHE_AGE_MS)

    if (cachedPayload) {
      setBanks(cachedPayload.banks)
      setSelectedBankId((current) => current || cachedPayload.banks[0]?.id || '')
      setAccountingHeads(cachedPayload.accountingHeads)
      setParties(cachedPayload.parties)
      setSuppliers(cachedPayload.suppliers)
      setLoading(false)
    } else {
      setLoading(true)
    }

    ;(async () => {
      try {
        const payload = await loadClientCachedValue<{
          banks: BankRecord[]
          accountingHeads: AccountingHeadRecord[]
          parties: PartyRecord[]
          suppliers: SupplierRecord[]
        }>(
          cacheKey,
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
  const selectedFileKind = useMemo(
    () => detectSelectedFileKind(selectedFile),
    [selectedFile]
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
  const settledEntries = useMemo(
    () => entries.filter((entry) => entry.status === 'settled' || entry.status === 'imported'),
    [entries]
  )
  const unsettledEntries = useMemo(
    () => entries.filter((entry) => entry.status === 'unsettled' && entry.externalId),
    [entries]
  )
  const invalidEntries = useMemo(
    () => entries.filter((entry) => entry.status === 'invalid'),
    [entries]
  )

  const amountSummary = useMemo(() => {
    const totalAmount = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    const settledAmount = settledEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    const unsettledAmount = unsettledEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    const importedAmount = entries
      .filter((entry) => entry.status === 'imported')
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)

    return {
      totalAmount,
      settledAmount,
      unsettledAmount,
      importedAmount
    }
  }, [entries, settledEntries, unsettledEntries])

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

  const activeDocumentName = result?.document?.fileName || selectedFile?.name || 'No document selected'
  const activeBank = result?.bank || selectedBank
  const documentStatus = getDocumentStatusMeta(result?.document, selectedFileKind)
  const recognizedEntriesCount = settledEntries.length + unsettledEntries.length
  const sortedInvalidEntries = useMemo(
    () => [...invalidEntries].sort((left, right) => left.rowNo - right.rowNo),
    [invalidEntries]
  )

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

    setStatusTone('info')
    setStatusMessage(getProcessingMessage(selectedFileKind, action))

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
      const rawMessage = error instanceof Error ? error.message : fallback
      const message = /timed out/i.test(rawMessage)
        ? `${rawMessage} Large scanned PDFs and statement images can take longer; CSV or Excel imports finish fastest.`
        : rawMessage
      setStatusTone('error')
      setStatusMessage(message)
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
      <div className="min-h-full bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.08),_transparent_26%),linear-gradient(180deg,#f8fafc_0%,#eff6ff_100%)] p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-700">ERP Bank Workspace</p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Bank Statement Reconciliation</h1>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                    <FileText className="h-4 w-4 text-slate-500" />
                    <span>Document:</span>
                    <span className="max-w-[320px] truncate text-slate-900">{activeDocumentName}</span>
                  </span>
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium ${documentStatus.className}`}>
                    <span>Status:</span>
                    <span>{documentStatus.label}</span>
                  </span>
                  {activeBank ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      <span>Bank:</span>
                      <span className="text-emerald-900">{activeBank.name}</span>
                    </span>
                  ) : null}
                </div>
                <p className="mt-4 max-w-3xl text-sm text-slate-600">
                  Upload CSV, Excel, PDF, text, or a statement image. The system scans each row, separates matched and unmatched entries, and lists any unread rows below exactly as part of the reconciliation review.
                </p>
                {result?.document?.note ? (
                  <p className="mt-3 text-xs text-slate-500">{result.document.note}</p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 xl:justify-end">
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
          </div>

          <Card className="gap-0 overflow-hidden border-slate-200/80 bg-white/95 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
            <CardHeader className="border-b border-slate-100 bg-slate-50/80">
              <CardTitle className="flex items-center gap-2 text-base text-slate-900">
                <Landmark className="h-5 w-5 text-blue-700" />
                Statement Details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 pt-6">
              {banks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <p className="text-sm text-slate-700">No bank master found for this company.</p>
                  <Button className="mt-4" onClick={() => router.push('/master/bank')}>
                    Add Bank Master
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
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
                        <SelectTrigger id="bankId" className="bg-white">
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
                        accept=".csv,.txt,.xls,.xlsx,.pdf,.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff,image/*"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0] || null
                          const nextKind = detectSelectedFileKind(nextFile)
                          setSelectedFile(nextFile)
                          setResult(null)
                          setManualTargets({})
                          if (nextFile) {
                            setStatusTone('info')
                            setStatusMessage(
                              `${getDocumentKindLabel(nextKind)} selected. ${getDocumentKindGuidance(nextKind)}`
                            )
                          } else {
                            setStatusMessage('')
                            setStatusTone(null)
                          }
                        }}
                      />
                      <p className="text-xs text-slate-500">
                        Supported files: CSV, TXT, XLS, XLSX, PDF, JPG, PNG, WEBP, BMP, GIF, TIF, TIFF and other common statement images.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                    {selectedFile ? (
                      <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-900">
                        <p className="font-semibold">{getDocumentKindLabel(selectedFileKind)}</p>
                        <p className="mt-1">{getDocumentKindGuidance(selectedFileKind)}</p>
                        <p className="mt-2 text-xs text-blue-700">
                          File: {selectedFile.name} | Size: {formatFileSize(selectedFile.size)}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                        Attach a statement file to begin reconciliation.
                      </div>
                    )}

                    {activeBank ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                        <p className="font-semibold text-slate-900">{activeBank.name}</p>
                        <p className="mt-1">
                          Branch: {activeBank.branch || 'N/A'} | Account No: {activeBank.accountNumber || 'N/A'} | IFSC: {activeBank.ifscCode || 'N/A'}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => void submitStatement('preview')}
                      disabled={!selectedBankId || !selectedFile || verifyingStatement || uploadingStatement}
                    >
                      <ScanSearch className="mr-2 h-4 w-4" />
                      {verifyingStatement
                        ? selectedFileKind === 'pdf' || selectedFileKind === 'image'
                          ? 'Scanning Statement...'
                          : 'Verifying Statement...'
                        : 'Verify Statement'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void submitStatement('import')}
                      disabled={!canUpload}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {uploadingStatement ? 'Posting to Ledger...' : 'Post to Ledger'}
                    </Button>
                  </div>

                  {statusMessage ? (
                    <div
                      className={`rounded-2xl border px-4 py-3 text-sm ${
                        statusTone === 'error'
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : statusTone === 'info'
                            ? 'border-blue-200 bg-blue-50 text-blue-800'
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

          {hasPreview ? (
            <>
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="rounded-[24px] border border-amber-200 bg-[linear-gradient(135deg,rgba(255,255,255,1)_0%,rgba(255,247,237,0.95)_100%)] p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Total Transactions</p>
                      <p className="mt-3 text-4xl font-bold text-slate-950">{recognizedEntriesCount}</p>
                      <p className="mt-2 text-sm font-medium text-emerald-700">{formatCurrency(amountSummary.totalAmount)}</p>
                    </div>
                    <div className="rounded-full bg-amber-100 p-3 text-amber-700 ring-1 ring-inset ring-amber-200">
                      <FileText className="h-5 w-5" />
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-emerald-200 bg-[linear-gradient(135deg,rgba(255,255,255,1)_0%,rgba(236,253,245,0.95)_100%)] p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Settled Entries</p>
                      <p className="mt-3 text-4xl font-bold text-slate-950">{settledEntries.length}</p>
                      <p className="mt-2 text-sm font-medium text-emerald-700">{formatCurrency(amountSummary.settledAmount)}</p>
                    </div>
                    <div className="rounded-full bg-emerald-100 p-3 text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-rose-200 bg-[linear-gradient(135deg,rgba(255,255,255,1)_0%,rgba(255,241,242,0.95)_100%)] p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-700">Unsettled Entries</p>
                      <p className="mt-3 text-4xl font-bold text-slate-950">{unsettledEntries.length}</p>
                      <p className="mt-2 text-sm font-medium text-rose-700">{formatCurrency(amountSummary.unsettledAmount)}</p>
                    </div>
                    <div className="rounded-full bg-rose-100 p-3 text-rose-700 ring-1 ring-inset ring-rose-200">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge className="bg-slate-900 px-3 py-1 text-white hover:bg-slate-900">Parser: {result?.document?.parser || 'N/A'}</Badge>
                <Badge variant="outline" className="border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 hover:bg-blue-50">
                  Ready to Post: {readyToImportCount}
                </Badge>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 hover:bg-emerald-50">
                  Imported: {summary.imported}
                </Badge>
                <Badge variant="outline" className="border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 hover:bg-amber-50">
                  Rows Not Read: {summary.errors}
                </Badge>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
                <Card className="gap-0 overflow-hidden border-slate-200/80 bg-white/95 shadow-sm">
                  <CardHeader className="border-b border-emerald-100 bg-emerald-50/70">
                    <CardTitle className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-900">
                      Settled Entries (Matched with ERP Ledger)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-slate-50/85">
                        <TableRow>
                          <TableHead className="h-12 px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Date</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Description</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Reference</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Debit (-₹)</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Credit (+₹)</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Match Status</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">ERP Account / Supplier</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Remarks</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {settledEntries.map((entry) => (
                          <TableRow key={`${entry.externalId || 'row'}-${entry.rowNo}`} className="bg-white">
                            <TableCell className="px-4 py-3 align-top">
                              <div className="space-y-1 whitespace-normal">
                                <div className="font-medium text-slate-900">{formatCompactStatementDate(entry.postedAt)}</div>
                                <div className="text-xs text-slate-500">Row {entry.rowNo}</div>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[220px] px-4 py-3 align-top whitespace-normal text-sm text-slate-700">
                              {entry.description || '-'}
                            </TableCell>
                            <TableCell className="max-w-[140px] px-4 py-3 align-top whitespace-normal text-sm text-slate-600">
                              {entry.reference || '-'}
                            </TableCell>
                            <TableCell className="px-4 py-3 align-top text-sm font-medium text-slate-700">
                              {getEntryDebitAmount(entry)}
                            </TableCell>
                            <TableCell className="px-4 py-3 align-top text-sm font-medium text-slate-700">
                              {getEntryCreditAmount(entry)}
                            </TableCell>
                            <TableCell className="px-4 py-3 align-top">
                              <Badge
                                className={
                                  entry.status === 'imported'
                                    ? 'bg-blue-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700 hover:bg-blue-100'
                                    : 'bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 hover:bg-emerald-100'
                                }
                              >
                                {entry.status === 'imported' ? 'Posted' : 'Matched'}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[220px] px-4 py-3 align-top whitespace-normal text-sm text-slate-700">
                              <div className="space-y-1">
                                <div>{getEntryTargetLabel(entry)}</div>
                                {entry.matchedTypeLabel ? (
                                  <div className="text-xs text-slate-500">{entry.matchedTypeLabel}</div>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[240px] px-4 py-3 align-top whitespace-normal text-sm text-slate-600">
                              {getEntryRemark(entry)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {!settledEntries.length ? (
                          <TableRow>
                            <TableCell colSpan={8} className="px-4 py-8 text-center whitespace-normal text-slate-500">
                              Verified settled rows will appear here after statement recognition.
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card className="gap-0 overflow-hidden border-slate-200/80 bg-white/95 shadow-sm">
                  <CardHeader className="border-b border-rose-100 bg-rose-50/70">
                    <CardTitle className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-900">
                      Unsettled Entries (No ERP Match)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-slate-50/85">
                        <TableRow>
                          <TableHead className="h-12 px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Date</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Reference</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Debit (-₹)</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Credit (+₹)</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">ERP Account / Supplier</TableHead>
                          <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Remark</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unsettledEntries.map((entry) => {
                          const selectedTargetOption = statementTargetMap.get(manualTargets[entry.externalId] || '') || null

                          return (
                            <TableRow key={entry.externalId} className="bg-white">
                              <TableCell className="px-4 py-3 align-top">
                                <div className="space-y-1 whitespace-normal">
                                  <div className="font-medium text-slate-900">{formatCompactStatementDate(entry.postedAt)}</div>
                                  <div className="text-xs text-slate-500">Row {entry.rowNo}</div>
                                </div>
                              </TableCell>
                              <TableCell className="max-w-[220px] px-4 py-3 align-top whitespace-normal">
                                <div className="space-y-1">
                                  <div className="text-sm text-slate-700">{entry.description || 'Unrecognized statement row'}</div>
                                  <div className="text-xs text-slate-500">{entry.reference || 'No reference'}</div>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-3 align-top text-sm font-medium text-slate-700">
                                {getEntryDebitAmount(entry)}
                              </TableCell>
                              <TableCell className="px-4 py-3 align-top text-sm font-medium text-slate-700">
                                {getEntryCreditAmount(entry)}
                              </TableCell>
                              <TableCell className="min-w-[260px] px-4 py-3 align-top">
                                <div className="space-y-2">
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
                                    placeholder="Select ERP target"
                                    searchPlaceholder="Search account, party, or supplier..."
                                    emptyText="No settlement targets found."
                                    triggerClassName="h-9 rounded-lg border-slate-200 bg-white text-xs shadow-none"
                                  />
                                  <div className="flex flex-wrap items-center gap-2">
                                    {manualTargets[entry.externalId] ? (
                                      <Badge className="bg-blue-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700 hover:bg-blue-100">
                                        Ready to post
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700 hover:bg-rose-50">
                                        Unsettled
                                      </Badge>
                                    )}
                                    {entry.suggestedTarget ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 rounded-full border-slate-200 px-3 text-xs"
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
                                        className="h-8 rounded-full px-3 text-xs text-slate-600"
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
                              </TableCell>
                              <TableCell className="max-w-[240px] px-4 py-3 align-top whitespace-normal text-sm text-slate-600">
                                {getEntryRemark(entry, selectedTargetOption)}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                        {!unsettledEntries.length ? (
                          <TableRow>
                            <TableCell colSpan={6} className="px-4 py-8 text-center whitespace-normal text-slate-500">
                              All verified rows are already settled, or there are no unmatched rows to map.
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
                      <p className="text-xs text-slate-600">
                        Review unmatched rows, choose the ERP account or supplier, then post only the selected entries to the ledger.
                      </p>
                      <Button onClick={() => void submitStatement('import')} disabled={!canUpload}>
                        <Upload className="mr-2 h-4 w-4" />
                        {uploadingStatement ? 'Posting to Ledger...' : 'Post to Ledger'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}

          {sortedInvalidEntries.length > 0 ? (
            <Card className="gap-0 overflow-hidden border-amber-200/80 bg-white/95 shadow-sm">
              <CardHeader className="border-b border-amber-100 bg-amber-50/70">
                <CardTitle className="flex items-center gap-2 text-base text-amber-950">
                  <AlertTriangle className="h-5 w-5 text-amber-700" />
                  Rows That Could Not Be Read
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-50/85">
                    <TableRow>
                      <TableHead className="h-12 px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Row</TableHead>
                      <TableHead className="px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedInvalidEntries.map((entry) => (
                      <TableRow key={`invalid-${entry.rowNo}`} className="bg-white">
                        <TableCell className="px-4 py-3 font-medium text-slate-900">{entry.rowNo}</TableCell>
                        <TableCell className="px-4 py-3 whitespace-normal text-slate-600">
                          {entry.reason || 'Could not read this row.'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  )
}
