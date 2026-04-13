'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Upload
} from 'lucide-react'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DashboardLayoutInitialData } from '@/lib/app-shell-types'
import type {
  BankStatementCreateBatchResponse,
  BankStatementLookupResponse,
  BankStatementWorkspaceResponse
} from '@/lib/bank-statements/contracts'
import type {
  BankStatementLookupPayload,
  BankStatementVoucherType,
  BankStatementWorkspacePayload,
  NormalizedStatementTransaction
} from '@/lib/bank-statements/types'
import { apiClient } from '@/lib/http/api-client'

type BatchDetailRow = NormalizedStatementTransaction & {
  matchCandidates: Array<{
    id: string
    paymentId: string
    ledgerEntryId: string
    candidateRank: number
    totalScore: number
    reason: string | null
    decision: string
  }>
}

type BatchDetailResponse = {
  ok: true
  data: {
    batch: BankStatementWorkspacePayload['recentBatches'][number]
    rows: BatchDetailRow[]
  }
}

type Props = {
  initialCompanyId: string
  initialWorkspace: BankStatementWorkspacePayload | null
  initialLayoutData: DashboardLayoutInitialData | null
}

type DraftState = {
  accountingHeadId: string
  partyId: string
  supplierId: string
  voucherType: BankStatementVoucherType | ''
  paymentMode: string
  remarks: string
}

function currency(value: number | null | undefined) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0))
}

function dateText(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }).format(date)
    : value
}

function statusTone(status: string) {
  if (status === 'settled') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'ambiguous') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

function buildDraft(row: BatchDetailRow): DraftState {
  return {
    accountingHeadId: row.draftAccountingHeadId || row.suggestedAccountingHeadId || '',
    partyId: row.draftPartyId || row.suggestedPartyId || '',
    supplierId: row.draftSupplierId || row.suggestedSupplierId || '',
    voucherType: row.draftVoucherType || row.suggestedVoucherType || '',
    paymentMode: row.draftPaymentMode || '',
    remarks: row.draftRemarks || ''
  }
}

function labelForOption(options: SearchableSelectOption[], value: string | null | undefined) {
  if (!value) return '-'
  return options.find((option) => option.value === value)?.label || value
}

export default function BankStatementUploadClient({
  initialCompanyId,
  initialWorkspace,
  initialLayoutData
}: Props) {
  const [companyId] = useState(initialCompanyId)
  const [workspace, setWorkspace] = useState<BankStatementWorkspacePayload | null>(initialWorkspace)
  const [lookups, setLookups] = useState<BankStatementLookupPayload | null>(null)
  const [selectedBankId, setSelectedBankId] = useState(initialWorkspace?.banks[0]?.id || '')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [activeBatchId, setActiveBatchId] = useState(initialWorkspace?.recentBatches[0]?.id || '')
  const [batchDetail, setBatchDetail] = useState<BatchDetailResponse['data'] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [running, setRunning] = useState(false)
  const [stageMessage, setStageMessage] = useState('')
  const [stageProgress, setStageProgress] = useState(0)
  const [search, setSearch] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [detailRowId, setDetailRowId] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search)

  const refreshWorkspace = useCallback(async () => {
    if (!companyId) return
    setLoadingWorkspace(true)
    try {
      const [workspaceResponse, lookupResponse] = await Promise.all([
        apiClient.getJson<BankStatementWorkspaceResponse>(`/api/bank-statements/workspace?companyId=${encodeURIComponent(companyId)}`),
        apiClient.getJson<BankStatementLookupResponse>(`/api/bank-statements/lookups?companyId=${encodeURIComponent(companyId)}`)
      ])
      setWorkspace(workspaceResponse.data)
      setLookups(lookupResponse.data)
      if (!selectedBankId && workspaceResponse.data.banks[0]?.id) {
        setSelectedBankId(workspaceResponse.data.banks[0].id)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load reconciliation workspace.')
    } finally {
      setLoadingWorkspace(false)
    }
  }, [companyId, selectedBankId])

  const loadBatchDetail = useCallback(async (batchId: string) => {
    if (!companyId || !batchId) return
    const response = await apiClient.getJson<BatchDetailResponse>(`/api/bank-statements/batches/${batchId}?companyId=${encodeURIComponent(companyId)}`)
    setBatchDetail(response.data)
    setActiveBatchId(batchId)
    setDrafts(
      response.data.rows.reduce<Record<string, DraftState>>((acc, row) => {
        acc[row.id] = buildDraft(row)
        return acc
      }, {})
    )
  }, [companyId])

  useEffect(() => {
    void refreshWorkspace()
  }, [refreshWorkspace])

  useEffect(() => {
    if (activeBatchId) {
      void loadBatchDetail(activeBatchId)
    }
  }, [activeBatchId, loadBatchDetail])

  const runStage = async (label: string, action: () => Promise<void>) => {
    setRunning(true)
    setErrorMessage(null)
    setStageMessage(label)
    setStageProgress(20)
    try {
      await action()
      setStageProgress(100)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Action failed.')
      setStageProgress(0)
    } finally {
      setRunning(false)
      window.setTimeout(() => {
        setStageMessage('')
        setStageProgress(0)
      }, 900)
    }
  }

  const handleCreateAndUpload = async () => {
    if (!selectedBankId || !selectedFile) {
      setErrorMessage('Bank account aur statement file dono select karo.')
      return
    }

    await runStage('Uploading, parsing, and reconciling statement', async () => {
      const createResponse = await apiClient.postJson<BankStatementCreateBatchResponse>('/api/bank-statements/batches', {
        companyId,
        bankId: selectedBankId,
        fileName: selectedFile.name,
        fileMimeType: selectedFile.type || 'application/octet-stream',
        fileSizeBytes: selectedFile.size
      })
      setStageProgress(45)
      const fileBuffer = await selectedFile.arrayBuffer()
      const bytes = new Uint8Array(fileBuffer)
      let binary = ''
      const chunkSize = 0x8000

      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
      }

      await apiClient.postJson(`/api/bank-statements/batches/${createResponse.data.batch.id}/file`, {
        companyId,
        fileName: selectedFile.name,
        fileMimeType: selectedFile.type || 'application/octet-stream',
        fileSizeBytes: selectedFile.size,
        fileBase64: btoa(binary)
      })
      setStageProgress(60)
      await apiClient.postJson(`/api/bank-statements/batches/${createResponse.data.batch.id}/parse`, { companyId })
      setStageProgress(82)
      await apiClient.postJson(`/api/bank-statements/batches/${createResponse.data.batch.id}/match`, { companyId })
      setStageProgress(94)
      await loadBatchDetail(createResponse.data.batch.id)
      await refreshWorkspace()
      setSelectedFile(null)
    })
  }

  const handleParse = async () => {
    if (!activeBatchId) return
    await runStage('Parsing uploaded statement', async () => {
      await apiClient.postJson(`/api/bank-statements/batches/${activeBatchId}/parse`, { companyId })
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
    })
  }

  const handleMatch = async () => {
    if (!activeBatchId) return
    await runStage('Matching rows one by one with ERP', async () => {
      await apiClient.postJson(`/api/bank-statements/batches/${activeBatchId}/match`, { companyId })
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
    })
  }

  const handleFinalize = async () => {
    if (!activeBatchId) return
    await runStage('Finalizing settled links', async () => {
      await apiClient.postJson(`/api/bank-statements/batches/${activeBatchId}/finalize`, {
        companyId,
        confirm: true
      })
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
    })
  }

  const handleExport = async () => {
    if (!activeBatchId) return
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/bank-statements/batches/${activeBatchId}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': (await apiClient.getJson<{ ok: true; data: { csrfToken: string } }>('/api/security/csrf')).data.csrfToken
        },
        body: JSON.stringify({ companyId })
      })
      if (!response.ok) {
        throw new Error('Failed to export reconciliation file.')
      }
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = 'bank-reconciliation.csv'
      anchor.click()
      URL.revokeObjectURL(href)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to export reconciliation file.')
    }
  }

  const saveDraft = async (rowId: string) => {
    const draft = drafts[rowId]
    if (!draft) return
    await runStage('Saving reconciliation draft', async () => {
      await apiClient.patchJson(`/api/bank-statements/rows/${rowId}/draft`, {
        companyId,
        accountingHeadId: draft.accountingHeadId || null,
        partyId: draft.partyId || null,
        supplierId: draft.supplierId || null,
        voucherType: draft.voucherType || null,
        paymentMode: draft.paymentMode || null,
        remarks: draft.remarks || null
      })
      await loadBatchDetail(activeBatchId)
    })
  }

  const postRows = async (rowIds: string[]) => {
    if (!activeBatchId || rowIds.length === 0) return
    await runStage('Posting unsettled entries to ERP', async () => {
      await apiClient.postJson(`/api/bank-statements/batches/${activeBatchId}/post`, {
        companyId,
        rowIds
      })
      setSelectedRows({})
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
    })
  }

  const rows = useMemo(() => batchDetail?.rows || [], [batchDetail?.rows])

  const accountingHeadOptions = useMemo<SearchableSelectOption[]>(
    () => (lookups?.accountingHeads || []).map((item) => ({ value: item.id, label: item.label, description: item.meta || undefined })),
    [lookups?.accountingHeads]
  )
  const partyOptions = useMemo<SearchableSelectOption[]>(
    () => (lookups?.parties || []).map((item) => ({ value: item.id, label: item.label, description: item.meta || undefined })),
    [lookups?.parties]
  )
  const supplierOptions = useMemo<SearchableSelectOption[]>(
    () => (lookups?.suppliers || []).map((item) => ({ value: item.id, label: item.label, description: item.meta || undefined })),
    [lookups?.suppliers]
  )
  const paymentModeOptions = useMemo<SearchableSelectOption[]>(
    () => (lookups?.paymentModes || []).map((item) => ({ value: item.id, label: item.label, description: item.meta || undefined })),
    [lookups?.paymentModes]
  )
  const voucherTypeOptions = useMemo<SearchableSelectOption[]>(
    () => (lookups?.voucherTypes || []).map((item) => ({ value: item.value, label: item.label, description: `Direction: ${item.direction}` })),
    [lookups?.voucherTypes]
  )

  const filteredRows = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) =>
      `${row.description} ${row.referenceNumber || ''} ${row.matchReason || ''} ${row.suggestedReason || ''}`
        .toLowerCase()
        .includes(query)
    )
  }, [rows, deferredSearch])

  const settledRows = useMemo(() => filteredRows.filter((row) => row.matchStatus === 'settled'), [filteredRows])
  const unsettledRows = useMemo(
    () => filteredRows.filter((row) => row.matchStatus !== 'settled' && row.matchStatus !== 'ignored'),
    [filteredRows]
  )

  const totals = useMemo(() => {
    const debit = rows.reduce((sum, row) => sum + Number(row.debit || 0), 0)
    const credit = rows.reduce((sum, row) => sum + Number(row.credit || 0), 0)
    return {
      total: rows.length,
      settled: rows.filter((row) => row.matchStatus === 'settled').length,
      unsettled: rows.filter((row) => row.matchStatus !== 'settled' && row.matchStatus !== 'ignored').length,
      debit,
      credit,
      net: credit - debit
    }
  }, [rows])

  const selectedDetailRow = rows.find((row) => row.id === detailRowId) || null
  const selectedPostRows = unsettledRows.filter((row) => selectedRows[row.id]).map((row) => row.id)

  return (
    <DashboardLayout companyId={companyId} initialData={initialLayoutData}>
      <div className="space-y-6">
        <Card className="border-slate-200">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">Bank Statement Reconciliation</div>
                <h1 className="mt-2 text-2xl font-bold text-slate-950">
                  {batchDetail?.batch.fileName || 'Reconciliation Workspace'}
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Status: {batchDetail?.batch.batchStatus?.replace(/_/g, ' ') || 'No batch selected'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void refreshWorkspace()} disabled={loadingWorkspace || running}>
                  {loadingWorkspace ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Refresh
                </Button>
                <Button variant="outline" size="sm" onClick={handleParse} disabled={!activeBatchId || running}>Parse</Button>
                <Button variant="outline" size="sm" onClick={handleMatch} disabled={!activeBatchId || running}>Auto Match</Button>
                <Button variant="outline" size="sm" onClick={handleExport} disabled={!activeBatchId}>Export</Button>
                <Button size="sm" onClick={() => void postRows(selectedPostRows)} disabled={selectedPostRows.length === 0 || running}>
                  Post Selected
                </Button>
                <Button size="sm" variant="secondary" onClick={handleFinalize} disabled={!activeBatchId || running}>Finalize</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Statement Intake</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-[0.1em] text-slate-500">Bank</div>
                <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select bank account" />
                  </SelectTrigger>
                  <SelectContent>
                    {(workspace?.banks || []).map((bank) => (
                      <SelectItem key={bank.id} value={bank.id}>
                        {[bank.name, bank.accountNumber ? `A/C ${bank.accountNumber}` : '', bank.branch || ''].filter(Boolean).join(' • ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-[0.1em] text-slate-500">Statement File</div>
                <Input
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf,.csv,.xls,.xlsx"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
              </div>

              <Button onClick={() => void handleCreateAndUpload()} disabled={!selectedBankId || !selectedFile || running} className="w-full">
                <Upload className="mr-2 h-4 w-4" />
                Upload Statement
              </Button>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                System har bank statement row ko ERP entries ke against check karega. Match mila to settled, nahi mila to unsettled with suggestions.
              </div>

              {stageMessage ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{stageMessage}</span>
                    <span>{stageProgress}%</span>
                  </div>
                  <Progress value={stageProgress} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Card><CardContent className="p-4"><div className="text-sm text-slate-500">Total Transactions</div><div className="mt-2 text-3xl font-bold text-slate-950">{totals.total}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-sm text-emerald-600">Settled Entries</div><div className="mt-2 text-3xl font-bold text-emerald-600">{totals.settled}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-sm text-rose-600">Unsettled Entries</div><div className="mt-2 text-3xl font-bold text-rose-600">{totals.unsettled}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-sm text-slate-500">Total Debit</div><div className="mt-2 text-xl font-bold text-slate-950">{currency(totals.debit)}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-sm text-slate-500">Total Credit / Net</div><div className="mt-2 text-xl font-bold text-slate-950">{currency(totals.credit)}</div><div className="mt-1 text-xs text-slate-500">Net {currency(totals.net)}</div></CardContent></Card>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {(workspace?.recentBatches || []).slice(0, 10).map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => setActiveBatchId(batch.id)}
                className={`rounded-md border px-3 py-2 text-left text-xs ${
                  activeBatchId === batch.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                <div className="max-w-[180px] truncate font-semibold">{batch.fileName}</div>
                <div className={activeBatchId === batch.id ? 'text-slate-300' : 'text-slate-500'}>{dateText(batch.createdAt)}</div>
              </button>
            ))}
          </div>

          <div className="relative w-full xl:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search narration, reference, reason" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-emerald-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Settled Entries (Matched with ERP Ledger)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[620px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>ERP Entry</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settledRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-slate-500">No settled entries.</TableCell>
                      </TableRow>
                    ) : settledRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs">{dateText(row.transactionDate)}</TableCell>
                        <TableCell className="max-w-[180px] truncate text-xs font-medium text-slate-900">{row.description}</TableCell>
                        <TableCell className="text-xs">{row.referenceNumber || '-'}</TableCell>
                        <TableCell className="text-right text-xs">{row.debit ? currency(row.debit) : '-'}</TableCell>
                        <TableCell className="text-right text-xs">{row.credit ? currency(row.credit) : '-'}</TableCell>
                        <TableCell><Badge className={statusTone(row.matchStatus)}>Matched</Badge></TableCell>
                        <TableCell className="text-xs">
                          {row.postedPaymentId
                            ? `Posted Payment ${row.postedPaymentId.slice(-6)}`
                            : row.matchedPaymentId
                              ? `Payment ${row.matchedPaymentId.slice(-6)}`
                              : row.matchedLedgerId
                                ? `Ledger ${row.matchedLedgerId.slice(-6)}`
                                : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">{row.draftRemarks || row.matchReason || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="border-rose-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-lg">Unsettled Entries (No ERP Match)</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void Promise.all(unsettledRows.map((row) => saveDraft(row.id)))} disabled={running || unsettledRows.length === 0}>
                    Save Reconciliation
                  </Button>
                  <Button size="sm" onClick={() => void postRows(selectedPostRows.length ? selectedPostRows : unsettledRows.map((row) => row.id))} disabled={running || unsettledRows.length === 0}>
                    Post to Ledger
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[620px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>ERP Mapping</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unsettledRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-10 text-center text-slate-500">No unsettled entries.</TableCell>
                      </TableRow>
                    ) : unsettledRows.map((row) => {
                      const draft = drafts[row.id] || buildDraft(row)
                      return (
                        <TableRow key={row.id} className="align-top">
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={Boolean(selectedRows[row.id])}
                              onChange={(event) => setSelectedRows((current) => ({ ...current, [row.id]: event.target.checked }))}
                            />
                          </TableCell>
                          <TableCell className="text-xs">{dateText(row.transactionDate)}</TableCell>
                          <TableCell className="max-w-[170px] text-xs">
                            <button type="button" className="truncate text-left font-medium text-slate-900" onClick={() => setDetailRowId(row.id)}>
                              {row.description}
                            </button>
                            {row.suggestedReason ? (
                              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                <Sparkles className="h-3 w-3" />
                                suggested
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-xs">{row.referenceNumber || '-'}</TableCell>
                          <TableCell className="text-right text-xs">{currency(row.amount)}</TableCell>
                          <TableCell><Badge className={statusTone(row.matchStatus)}>{row.matchStatus === 'ambiguous' ? 'Review' : 'Unsettled'}</Badge></TableCell>
                          <TableCell className="min-w-[260px] space-y-2">
                            <SearchableSelect
                              id={`head-${row.id}`}
                              value={draft.accountingHeadId}
                              onValueChange={(value) => setDrafts((current) => ({
                                ...current,
                                [row.id]: { ...draft, accountingHeadId: value }
                              }))}
                              options={accountingHeadOptions}
                              placeholder="Accounting Head"
                              searchPlaceholder="Search heads"
                            />
                            <SearchableSelect
                              id={`party-${row.id}`}
                              value={draft.partyId}
                              onValueChange={(value) => setDrafts((current) => ({
                                ...current,
                                [row.id]: { ...draft, partyId: value, supplierId: '' }
                              }))}
                              options={partyOptions}
                              placeholder="Party"
                              searchPlaceholder="Search parties"
                            />
                            <SearchableSelect
                              id={`supplier-${row.id}`}
                              value={draft.supplierId}
                              onValueChange={(value) => setDrafts((current) => ({
                                ...current,
                                [row.id]: { ...draft, supplierId: value, partyId: '' }
                              }))}
                              options={supplierOptions}
                              placeholder="Supplier"
                              searchPlaceholder="Search suppliers"
                            />
                            <div className="grid gap-2 sm:grid-cols-2">
                              <SearchableSelect
                                id={`voucher-${row.id}`}
                                value={draft.voucherType}
                                onValueChange={(value) => setDrafts((current) => ({
                                  ...current,
                                  [row.id]: { ...draft, voucherType: value as BankStatementVoucherType }
                                }))}
                                options={voucherTypeOptions}
                                placeholder="Voucher Type"
                                searchPlaceholder="Search voucher"
                              />
                              <SearchableSelect
                                id={`paymentMode-${row.id}`}
                                value={draft.paymentMode}
                                onValueChange={(value) => setDrafts((current) => ({
                                  ...current,
                                  [row.id]: { ...draft, paymentMode: value }
                                }))}
                                options={paymentModeOptions}
                                placeholder="Payment Mode"
                                searchPlaceholder="Search mode"
                              />
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[180px]">
                            <Input
                              value={draft.remarks}
                              onChange={(event) => setDrafts((current) => ({
                                ...current,
                                [row.id]: { ...draft, remarks: event.target.value }
                              }))}
                              placeholder="Remarks"
                              className="h-9 text-xs"
                            />
                            <div className="mt-2 text-[11px] text-slate-500">
                              {row.suggestedReason || row.matchReason || 'No direct ERP match. Select correct target and post.'}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-2">
                              <Button variant="outline" size="sm" onClick={() => void saveDraft(row.id)}>Save</Button>
                              <Button size="sm" onClick={() => void postRows([row.id])}>Post</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {selectedDetailRow ? (
          <Dialog open={Boolean(selectedDetailRow)} onOpenChange={(open) => !open && setDetailRowId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transaction Details</DialogTitle>
                <DialogDescription>System check result and suggested ERP mapping.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div><strong>Date:</strong> {dateText(selectedDetailRow.transactionDate)}</div>
                <div><strong>Description:</strong> {selectedDetailRow.description}</div>
                <div><strong>Reference:</strong> {selectedDetailRow.referenceNumber || '-'}</div>
                <div><strong>Amount:</strong> {currency(selectedDetailRow.amount)}</div>
                <div><strong>Status:</strong> {selectedDetailRow.matchStatus}</div>
                <div><strong>System Reason:</strong> {selectedDetailRow.matchReason || 'No direct match found.'}</div>
                <div><strong>Suggestion:</strong> {selectedDetailRow.suggestedReason || 'No automatic mapping suggestion.'}</div>
                {selectedDetailRow.matchCandidates.length ? (
                  <div>
                    <strong>Candidates:</strong>
                    <div className="mt-2 space-y-2">
                      {selectedDetailRow.matchCandidates.map((candidate) => (
                        <div key={candidate.id} className="rounded-md border border-slate-200 p-2 text-xs text-slate-600">
                          Rank {candidate.candidateRank} • Score {candidate.totalScore.toFixed(0)} • {candidate.reason || 'No reason'}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </DashboardLayout>
  )
}
