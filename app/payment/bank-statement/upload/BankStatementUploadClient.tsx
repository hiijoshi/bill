'use client'

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState } from 'react'
import {
  CheckCircle2,
  FileSpreadsheet,
  HelpCircle,
  Landmark,
  Loader2,
  PanelRightOpen,
  RefreshCw,
  Search,
  Upload,
  XCircle
} from 'lucide-react'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { DashboardLayoutInitialData } from '@/lib/app-shell-types'
import type {
  BankStatementCreateBatchResponse,
  BankStatementLookupResponse,
  BankStatementQuickCreateTargetResponse,
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

type QuickCreateType = 'auto' | 'accounting_head' | 'party' | 'supplier'

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

function hasMappedTarget(draft: DraftState) {
  return Boolean(draft.accountingHeadId || draft.partyId || draft.supplierId)
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
  const [quickCreateTypes, setQuickCreateTypes] = useState<Record<string, QuickCreateType>>({})
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [running, setRunning] = useState(false)
  const [stageMessage, setStageMessage] = useState('')
  const [stageProgress, setStageProgress] = useState(0)
  const [search, setSearch] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [detailRowId, setDetailRowId] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [matchedSearch, setMatchedSearch] = useState('')
  const [unmatchedSearch, setUnmatchedSearch] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const deferredSearch = useDeferredValue(search)
  const deferredMatchedSearch = useDeferredValue(matchedSearch)
  const deferredUnmatchedSearch = useDeferredValue(unmatchedSearch)
  const fileInputId = useId()

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
    setQuickCreateTypes(
      response.data.rows.reduce<Record<string, QuickCreateType>>((acc, row) => {
        acc[row.id] = 'auto'
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

  useEffect(() => {
    const recentBatches = workspace?.recentBatches || []
    if (recentBatches.length === 0) {
      if (activeBatchId) {
        setActiveBatchId('')
        setBatchDetail(null)
      }
      return
    }

    if (!activeBatchId || !recentBatches.some((batch) => batch.id === activeBatchId)) {
      setActiveBatchId(recentBatches[0].id)
    }
  }, [activeBatchId, workspace?.recentBatches])

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
      const formData = new FormData()
      formData.append('companyId', companyId)
      formData.append('file', selectedFile)
      await apiClient.postForm(`/api/bank-statements/batches/${createResponse.data.batch.id}/file`, formData)
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

  const quickCreateTarget = async (rowId: string) => {
    const selectedType = quickCreateTypes[rowId] || 'auto'
    await runStage('Auto creating missing target for unsettled row', async () => {
      await apiClient.postJson<BankStatementQuickCreateTargetResponse>(`/api/bank-statements/rows/${rowId}/quick-create`, {
        companyId,
        targetType: selectedType
      })
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
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

  const matchedRows = useMemo(() => {
    const query = deferredMatchedSearch.trim().toLowerCase()
    if (!query) return settledRows
    return settledRows.filter((row) =>
      `${row.description} ${row.referenceNumber || ''} ${row.matchReason || ''} ${row.draftRemarks || ''}`
        .toLowerCase()
        .includes(query)
    )
  }, [deferredMatchedSearch, settledRows])

  const unresolvedRows = useMemo(() => {
    const query = deferredUnmatchedSearch.trim().toLowerCase()
    if (!query) return unsettledRows
    return unsettledRows.filter((row) =>
      `${row.description} ${row.referenceNumber || ''} ${row.matchReason || ''} ${row.suggestedReason || ''} ${row.draftRemarks || ''}`
        .toLowerCase()
        .includes(query)
    )
  }, [deferredUnmatchedSearch, unsettledRows])

  const totals = useMemo(() => {
    const debit = rows.reduce((sum, row) => sum + Number(row.debit || 0), 0)
    const credit = rows.reduce((sum, row) => sum + Number(row.credit || 0), 0)
    const matchedAmount = rows
      .filter((row) => row.matchStatus === 'settled')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const unmatchedAmount = rows
      .filter((row) => row.matchStatus !== 'settled' && row.matchStatus !== 'ignored')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const completionPercentage = rows.length ? Math.round((rows.filter((row) => row.matchStatus === 'settled').length / rows.length) * 100) : 0
    return {
      total: rows.length,
      settled: rows.filter((row) => row.matchStatus === 'settled').length,
      unsettled: rows.filter((row) => row.matchStatus !== 'settled' && row.matchStatus !== 'ignored').length,
      debit,
      credit,
      net: credit - debit,
      matchedAmount,
      unmatchedAmount,
      completionPercentage
    }
  }, [rows])

  const selectedDetailRow = rows.find((row) => row.id === detailRowId) || null
  const selectedPostRows = unresolvedRows.filter((row) => selectedRows[row.id]).map((row) => row.id)
  const selectedBank = useMemo(
    () => (workspace?.banks || []).find((bank) => bank.id === selectedBankId) || null,
    [selectedBankId, workspace?.banks]
  )
  const statementPeriodLabel = useMemo(() => {
    const from = batchDetail?.batch.metadata.statementDateFrom
    const to = batchDetail?.batch.metadata.statementDateTo
    if (from && to) return `${dateText(from)} to ${dateText(to)}`
    return 'Statement period pending'
  }, [batchDetail?.batch.metadata.statementDateFrom, batchDetail?.batch.metadata.statementDateTo])
  const varianceAmount = useMemo(() => Math.abs(totals.net), [totals.net])
  const handleFileSelection = useCallback((file: File | null) => {
    setSelectedFile(file)
    setIsDragOver(false)
  }, [])

  return (
    <DashboardLayout companyId={companyId} initialData={initialLayoutData}>
      <div
        className="space-y-6 [--color-text-primary:theme(colors.slate.950)] [--color-text-secondary:theme(colors.slate.600)] [--color-text-tertiary:theme(colors.slate.400)] [--color-text-success:theme(colors.emerald.700)] [--color-background-success:theme(colors.emerald.50)] [--color-text-danger:theme(colors.rose.700)] [--color-background-danger:theme(colors.rose.50)] [--color-text-info:theme(colors.sky.700)] [--color-background-info:theme(colors.sky.50)] [--color-background-primary:theme(colors.white)] [--color-background-secondary:theme(colors.slate.50)] [--color-border-tertiary:theme(colors.slate.200)] [--color-border-secondary:theme(colors.slate.300)]"
      >
        <section className="rounded-xl border border-[color:var(--color-border-tertiary)] bg-[color:var(--color-background-primary)] shadow-sm">
          <div className="flex flex-col gap-4 border-b border-[color:var(--color-border-tertiary)] px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-[color:var(--color-text-secondary)]">Financial controls</p>
              <h1 className="text-[22px] font-medium text-[color:var(--color-text-primary)]">Bank Statement Reconciliation</h1>
              <div className="flex flex-wrap gap-2 text-[13px] text-[color:var(--color-text-secondary)]">
                <span className="rounded-full bg-[color:var(--color-background-secondary)] px-3 py-1">
                  Bank: {batchDetail?.batch.bankId ? selectedBank?.name || 'Selected bank' : selectedBank?.name || 'Not selected'}
                </span>
                <span className="rounded-full bg-[color:var(--color-background-secondary)] px-3 py-1">
                  Statement period: {statementPeriodLabel}
                </span>
                <span className="rounded-full bg-[color:var(--color-background-secondary)] px-3 py-1">
                  Batch: {batchDetail?.batch.fileName || 'No batch selected'}
                </span>
                <span className="rounded-full bg-[color:var(--color-background-secondary)] px-3 py-1">
                  Status: {batchDetail?.batch.batchStatus?.replace(/_/g, ' ') || 'Ready for upload'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" className="h-9 rounded-lg px-3 text-[13px]" onClick={() => setHelpOpen(true)}>
                <HelpCircle className="mr-2 h-4 w-4" />
                Help
              </Button>
              <Button variant="ghost" size="sm" className="h-9 rounded-lg px-3 text-[13px]" onClick={() => void refreshWorkspace()} disabled={loadingWorkspace || running}>
                {loadingWorkspace ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
              <Button variant="ghost" size="sm" className="h-9 rounded-lg px-3 text-[13px]" onClick={handleParse} disabled={!activeBatchId || running}>
                Parse
              </Button>
              <Button variant="outline" size="sm" className="h-9 rounded-lg px-3 text-[13px]" onClick={handleExport} disabled={!activeBatchId}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Export Report
              </Button>
              <Button size="sm" className="h-9 rounded-lg px-3 text-[13px]" onClick={() => void postRows(selectedPostRows)} disabled={selectedPostRows.length === 0 || running}>
                <PanelRightOpen className="mr-2 h-4 w-4" />
                Post to Ledger
              </Button>
              <Button variant="outline" size="sm" className="h-9 rounded-lg px-3 text-[13px]" onClick={handleFinalize} disabled={!activeBatchId || running}>
                Finalize
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            {
              label: 'Total Transactions',
              value: String(totals.total),
              sublabel: `Total amount ${currency(totals.debit + totals.credit)}`,
              valueClass: 'text-[color:var(--color-text-primary)]'
            },
            {
              label: 'Matched Entries',
              value: String(totals.settled),
              sublabel: `Matched amount ${currency(totals.matchedAmount)}`,
              valueClass: 'text-[color:var(--color-text-success)]'
            },
            {
              label: 'Unmatched Entries',
              value: String(totals.unsettled),
              sublabel: `Unmatched amount ${currency(totals.unmatchedAmount)}`,
              valueClass: 'text-[color:var(--color-text-danger)]'
            },
            {
              label: 'Balance Variance',
              value: currency(varianceAmount),
              sublabel: 'Net difference',
              valueClass: varianceAmount === 0 ? 'text-[color:var(--color-text-success)]' : 'text-[color:var(--color-text-danger)]'
            },
            {
              label: 'Completion',
              value: `${totals.completionPercentage}%`,
              sublabel: `${totals.settled} of ${Math.max(totals.total, 0)} matched`,
              valueClass: 'text-[color:var(--color-text-primary)]'
            }
          ].map((card) => (
            <Card key={card.label} className="rounded-lg border border-[color:var(--color-border-tertiary)] bg-[color:var(--color-background-secondary)] shadow-none">
              <CardContent className="p-4">
                <div className="text-[13px] text-[color:var(--color-text-secondary)]">{card.label}</div>
                <div className={`mt-2 text-[24px] font-medium ${card.valueClass}`}>{card.value}</div>
                <div className="mt-1 text-[13px] text-[color:var(--color-text-tertiary)]">{card.sublabel}</div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="rounded-xl border border-[color:var(--color-border-tertiary)] bg-[color:var(--color-background-primary)] p-4 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <div className="text-[13px] font-medium text-[color:var(--color-text-secondary)]">Bank account</div>
              <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                <SelectTrigger className="h-10 rounded-lg border-[color:var(--color-border-secondary)] bg-white text-[13px]">
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

            <div className="space-y-2">
              <div className="text-[13px] font-medium text-[color:var(--color-text-secondary)]">Statement upload</div>
              <label
                htmlFor={fileInputId}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDragOver(true)
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  handleFileSelection(event.dataTransfer.files?.[0] || null)
                }}
                className={`flex min-h-[88px] cursor-pointer items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition-colors ${
                  isDragOver
                    ? 'border-sky-400 bg-sky-50'
                    : 'border-[color:var(--color-border-secondary)] bg-[color:var(--color-background-secondary)] hover:border-sky-300 hover:bg-sky-50/60'
                }`}
              >
                <div className="space-y-1">
                  <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-white text-[color:var(--color-text-info)] shadow-sm">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div className="text-[14px] font-medium text-[color:var(--color-text-primary)]">
                    {selectedFile ? selectedFile.name : 'Drop PDF, CSV, Excel or image statement here'}
                  </div>
                  <div className="text-[13px] text-[color:var(--color-text-secondary)]">Click to browse or drag and drop file</div>
                </div>
                <Input
                  id={fileInputId}
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf,.csv,.xls,.xlsx"
                  onChange={(event) => handleFileSelection(event.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex flex-col justify-end gap-2">
              <Button onClick={() => void handleCreateAndUpload()} disabled={!selectedBankId || !selectedFile || running} className="h-10 rounded-lg px-4">
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Process Statement
              </Button>
              <Button variant="outline" size="sm" className="h-10 rounded-lg px-4" onClick={handleMatch} disabled={!activeBatchId || running}>
                Auto Match
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-[color:var(--color-text-secondary)]">
            <span className="rounded-full bg-[color:var(--color-background-secondary)] px-3 py-1">Formats: PDF, CSV, Excel, image</span>
            <span className="rounded-full bg-[color:var(--color-background-secondary)] px-3 py-1">System parses rows, runs matching, and suggests ERP targets</span>
          </div>

          {stageMessage ? (
            <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50 px-4 py-3">
              <div className="flex items-center justify-between text-[13px] text-[color:var(--color-text-info)]">
                <span>{stageMessage}</span>
                <span>{stageProgress}%</span>
              </div>
              <Progress value={stageProgress} className="mt-2" />
            </div>
          ) : null}
        </section>

        <section className="flex justify-end">
          <div className="relative w-full xl:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-text-tertiary)]" />
            <Input
              className="h-10 rounded-lg border-[color:var(--color-border-secondary)] pl-9"
              placeholder="Search narration, reference, reason"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </section>

        {errorMessage ? (
          <div className="rounded-lg border border-[color:var(--color-text-danger)]/20 bg-[color:var(--color-background-danger)] px-4 py-3 text-sm text-[color:var(--color-text-danger)]">
            {errorMessage}
          </div>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-xl border border-emerald-200 bg-[color:var(--color-background-primary)] shadow-sm">
            <div className="border-b border-[color:var(--color-border-tertiary)] px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-medium text-[color:var(--color-text-primary)]">Matched entries</h2>
                    <Badge className="rounded-md border-0 bg-[color:var(--color-background-success)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-text-success)]">
                      {matchedRows.length}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[13px] text-[color:var(--color-text-secondary)]">Auto and manually resolved rows already linked with ERP.</p>
                </div>
                <div className="relative w-full lg:w-72">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-text-tertiary)]" />
                  <Input
                    className="h-9 rounded-lg border-[color:var(--color-border-secondary)] pl-9 text-[13px]"
                    placeholder="Search matched entries"
                    value={matchedSearch}
                    onChange={(event) => setMatchedSearch(event.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="max-h-[760px] overflow-auto p-3">
              <div className="space-y-3">
                {matchedRows.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[color:var(--color-border-tertiary)] bg-[color:var(--color-background-secondary)] px-4 py-10 text-center text-[13px] text-[color:var(--color-text-secondary)]">
                    No matched entries in the current scope.
                  </div>
                ) : matchedRows.map((row) => (
                  <article key={row.id} className="rounded-lg border border-[color:var(--color-border-tertiary)] bg-white p-4 transition-colors hover:bg-[color:var(--color-background-secondary)]">
                    <div className="grid gap-3 xl:grid-cols-[80px_minmax(0,2fr)_1fr_1fr_auto_auto] xl:items-center">
                      <div className="text-[13px] text-[color:var(--color-text-secondary)]">{dateText(row.transactionDate)}</div>
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-medium text-[color:var(--color-text-primary)]">{row.description}</div>
                        <div className="mt-1 text-[13px] text-[color:var(--color-text-tertiary)]">{row.referenceNumber || 'No reference'}</div>
                      </div>
                      <div className="text-right text-[14px] font-medium text-[color:var(--color-text-danger)]">
                        {row.debit ? currency(row.debit) : '-'}
                      </div>
                      <div className="text-right text-[14px] font-medium text-[color:var(--color-text-success)]">
                        {row.credit ? currency(row.credit) : '-'}
                      </div>
                      <div className="flex justify-start xl:justify-center">
                        <Badge className="rounded-md border-0 bg-[color:var(--color-background-success)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-text-success)]">
                          {row.postedPaymentId || row.postedLedgerEntryId ? 'Manual match' : 'Auto-matched'}
                        </Badge>
                      </div>
                      <div className="flex justify-start xl:justify-end">
                        <Button variant="outline" size="sm" className="h-8 rounded-lg text-[13px]" onClick={() => setDetailRowId(row.id)}>
                          View
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-rose-200 bg-[color:var(--color-background-primary)] shadow-sm">
            <div className="border-b border-[color:var(--color-border-tertiary)] px-4 py-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-medium text-[color:var(--color-text-primary)]">Unmatched entries</h2>
                      <Badge className="rounded-md border-0 bg-[color:var(--color-background-danger)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-text-danger)]">
                        {unresolvedRows.length}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[13px] text-[color:var(--color-text-secondary)]">Resolve with ERP mapping, quick create, or manual review before posting.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="h-9 rounded-lg text-[13px]" onClick={() => void Promise.all(unresolvedRows.map((row) => saveDraft(row.id)))} disabled={running || unresolvedRows.length === 0}>
                      Save Reconciliation
                    </Button>
                    <Button size="sm" className="h-9 rounded-lg text-[13px]" onClick={() => void postRows(selectedPostRows)} disabled={running || selectedPostRows.length === 0}>
                      Post Selected
                    </Button>
                  </div>
                </div>
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--color-text-tertiary)]" />
                  <Input
                    className="h-9 rounded-lg border-[color:var(--color-border-secondary)] pl-9 text-[13px]"
                    placeholder="Search unmatched entries"
                    value={unmatchedSearch}
                    onChange={(event) => setUnmatchedSearch(event.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="max-h-[760px] overflow-auto p-3">
              <div className="space-y-3">
                {unresolvedRows.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[color:var(--color-border-tertiary)] bg-[color:var(--color-background-secondary)] px-4 py-10 text-center text-[13px] text-[color:var(--color-text-secondary)]">
                    No unmatched entries. Reconciliation looks complete.
                  </div>
                ) : unresolvedRows.map((row) => {
                  const draft = drafts[row.id] || buildDraft(row)
                  const mapped = hasMappedTarget(draft)
                  return (
                    <article key={row.id} className="rounded-lg border border-[color:var(--color-border-tertiary)] bg-white p-4">
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedRows[row.id])}
                              onChange={(event) => setSelectedRows((current) => ({ ...current, [row.id]: event.target.checked }))}
                              className="mt-1 h-4 w-4 rounded border-[color:var(--color-border-secondary)]"
                            />
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-[13px] text-[color:var(--color-text-secondary)]">{dateText(row.transactionDate)}</div>
                                <Badge className={`rounded-md border-0 px-2.5 py-1 text-[12px] font-medium ${row.matchStatus === 'ambiguous' ? 'bg-amber-50 text-amber-700' : 'bg-[color:var(--color-background-danger)] text-[color:var(--color-text-danger)]'}`}>
                                  {mapped ? 'Ready to post' : row.matchStatus === 'ambiguous' ? 'Suggested match' : 'Unmatched'}
                                </Badge>
                              </div>
                              <button type="button" className="mt-1 text-left text-[14px] font-medium text-[color:var(--color-text-primary)] hover:underline" onClick={() => setDetailRowId(row.id)}>
                                {row.description}
                              </button>
                              <div className="mt-1 text-[13px] text-[color:var(--color-text-tertiary)]">{row.referenceNumber || 'No reference number'}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-[16px] font-medium ${row.direction === 'debit' ? 'text-[color:var(--color-text-danger)]' : 'text-[color:var(--color-text-success)]'}`}>
                              {currency(row.amount)}
                            </div>
                            <div className="mt-1 text-[12px] text-[color:var(--color-text-tertiary)]">{row.direction === 'debit' ? 'Debit' : 'Credit'}</div>
                          </div>
                        </div>

                        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_180px]">
                          <div className="space-y-2">
                            <SearchableSelect
                              id={`head-${row.id}`}
                              value={draft.accountingHeadId}
                              onValueChange={(value) => setDrafts((current) => ({
                                ...current,
                                [row.id]: { ...draft, accountingHeadId: value }
                              }))}
                              options={accountingHeadOptions}
                              placeholder="Account / Head"
                              searchPlaceholder="Search account heads"
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
                          </div>

                          <div className="space-y-2">
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
                            <Input
                              value={draft.remarks}
                              onChange={(event) => setDrafts((current) => ({
                                ...current,
                                [row.id]: { ...draft, remarks: event.target.value }
                              }))}
                              placeholder="Remarks"
                              className="h-9 rounded-lg border-[color:var(--color-border-secondary)] text-[13px]"
                            />
                          </div>

                          <div className="space-y-2">
                            <SearchableSelect
                              id={`voucher-${row.id}`}
                              value={draft.voucherType}
                              onValueChange={(value) => setDrafts((current) => ({
                                ...current,
                                [row.id]: { ...draft, voucherType: value as BankStatementVoucherType }
                              }))}
                              options={voucherTypeOptions}
                              placeholder="Voucher Type"
                              searchPlaceholder="Search voucher type"
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
                              searchPlaceholder="Search payment mode"
                            />
                          </div>

                          <div className="space-y-2">
                            <Button variant="outline" size="sm" className="h-9 w-full rounded-lg text-[13px]" onClick={() => void saveDraft(row.id)}>
                              Save
                            </Button>
                            {!mapped ? (
                              <>
                                <Select
                                  value={quickCreateTypes[row.id] || 'auto'}
                                  onValueChange={(value) => setQuickCreateTypes((current) => ({
                                    ...current,
                                    [row.id]: value as QuickCreateType
                                  }))}
                                >
                                  <SelectTrigger className="h-9 rounded-lg border-[color:var(--color-border-secondary)] text-[13px]">
                                    <SelectValue placeholder="Create as" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="auto">Auto create</SelectItem>
                                    <SelectItem value="accounting_head">Accounting head</SelectItem>
                                    <SelectItem value="party">Party</SelectItem>
                                    <SelectItem value="supplier">Supplier</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button variant="outline" size="sm" className="h-9 w-full rounded-lg text-[13px]" onClick={() => void quickCreateTarget(row.id)} disabled={running}>
                                  Create
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" className="h-9 w-full rounded-lg text-[13px]" onClick={() => void postRows([row.id])}>
                                Create / Post
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" className="h-9 w-full rounded-lg text-[13px]" onClick={() => setDetailRowId(row.id)}>
                              Match / Review
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-lg bg-[color:var(--color-background-secondary)] px-3 py-2 text-[13px] text-[color:var(--color-text-secondary)]">
                          {row.suggestedReason || row.matchReason || 'No direct ERP match found. Select account or party mapping, then save and post.'}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          </section>
        </section>

        {selectedDetailRow ? (
          <Dialog open={Boolean(selectedDetailRow)} onOpenChange={(open) => !open && setDetailRowId(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Transaction Details</DialogTitle>
                <DialogDescription>System check result and suggested ERP mapping.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Date', dateText(selectedDetailRow.transactionDate)],
                  ['Reference', selectedDetailRow.referenceNumber || '-'],
                  ['Amount', currency(selectedDetailRow.amount)],
                  ['Status', selectedDetailRow.matchStatus],
                  ['System Reason', selectedDetailRow.matchReason || 'No direct match found.'],
                  ['Suggestion', selectedDetailRow.suggestedReason || 'No automatic mapping suggestion.']
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-[color:var(--color-border-tertiary)] bg-[color:var(--color-background-secondary)] px-3 py-3 text-sm">
                    <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-text-tertiary)]">{label}</div>
                    <div className="mt-1 text-[14px] text-[color:var(--color-text-primary)]">{value}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-[color:var(--color-border-tertiary)] px-3 py-3 text-sm">
                <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-text-tertiary)]">Description</div>
                <div className="mt-1 text-[14px] text-[color:var(--color-text-primary)]">{selectedDetailRow.description}</div>
              </div>
              <div className="space-y-3 text-sm">
                {selectedDetailRow.matchCandidates.length ? (
                  <div>
                    <strong>Candidates:</strong>
                    <div className="mt-2 space-y-2">
                      {selectedDetailRow.matchCandidates.map((candidate) => (
                        <div key={candidate.id} className="rounded-md border border-slate-200 p-3 text-xs text-slate-600">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="border-0 bg-amber-50 text-amber-700">Rank {candidate.candidateRank}</Badge>
                            <Badge className="border-0 bg-slate-100 text-slate-700">Score {candidate.totalScore.toFixed(0)}</Badge>
                            <Badge className="border-0 bg-sky-50 text-sky-700">{candidate.decision}</Badge>
                          </div>
                          <div className="mt-2">{candidate.reason || 'No reason'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
        ) : null}

        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Reconciliation help</DialogTitle>
              <DialogDescription>Quick guide for resolving bank statement rows.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm text-[color:var(--color-text-secondary)]">
              <div className="flex items-start gap-3 rounded-lg bg-[color:var(--color-background-secondary)] px-3 py-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-[color:var(--color-text-success)]" />
                <div>Matched entries are already linked with ERP. Use <strong>View</strong> to verify candidates, remarks, and linked payment references.</div>
              </div>
              <div className="flex items-start gap-3 rounded-lg bg-[color:var(--color-background-secondary)] px-3 py-3">
                <XCircle className="mt-0.5 h-4 w-4 text-[color:var(--color-text-danger)]" />
                <div>For unmatched rows, select an accounting head, party, or supplier, save the mapping, then post the selected rows to ledger.</div>
              </div>
              <div className="flex items-start gap-3 rounded-lg bg-[color:var(--color-background-secondary)] px-3 py-3">
                <Landmark className="mt-0.5 h-4 w-4 text-[color:var(--color-text-info)]" />
                <div>Use <strong>Auto Match</strong> after upload to refresh suggestions. Use <strong>Export Report</strong> for audit evidence before final posting.</div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  )
}
