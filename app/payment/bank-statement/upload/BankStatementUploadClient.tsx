'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  XCircle
} from 'lucide-react'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DashboardLayoutInitialData } from '@/lib/app-shell-types'
import { apiClient } from '@/lib/http/api-client'
import type { BankStatementWorkspacePayload, NormalizedStatementTransaction } from '@/lib/bank-statements/types'
import type { BankStatementWorkspaceResponse, BankStatementCreateBatchResponse } from '@/lib/bank-statements/contracts'

type BatchDetailResponse = {
  ok: true
  data: {
    batch: BankStatementWorkspacePayload['recentBatches'][number]
    rows: Array<NormalizedStatementTransaction & {
      matchCandidates: Array<{
        id: string
        paymentId: string
        candidateRank: number
        totalScore: number
        reason: string | null
        decision: string
      }>
    }>
  }
}

type Props = {
  initialCompanyId: string
  initialWorkspace: BankStatementWorkspacePayload | null
  initialLayoutData: DashboardLayoutInitialData | null
}

type ReviewTab = 'all' | 'settled' | 'unsettled' | 'ambiguous'

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
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date)
    : value
}

function statusTone(status: string) {
  if (status === 'settled') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'ambiguous') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'ignored') return 'border-slate-200 bg-slate-100 text-slate-600'
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

export default function BankStatementUploadClient({
  initialCompanyId,
  initialWorkspace,
  initialLayoutData
}: Props) {
  const [companyId] = useState(initialCompanyId)
  const [workspace, setWorkspace] = useState<BankStatementWorkspacePayload | null>(initialWorkspace)
  const [selectedBankId, setSelectedBankId] = useState(initialWorkspace?.banks[0]?.id || '')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [activeBatchId, setActiveBatchId] = useState<string>(initialWorkspace?.recentBatches[0]?.id || '')
  const [batchDetail, setBatchDetail] = useState<BatchDetailResponse['data'] | null>(null)
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [stageMessage, setStageMessage] = useState('')
  const [stageProgress, setStageProgress] = useState(0)
  const [running, setRunning] = useState(false)
  const [search, setSearch] = useState('')
  const [reviewTab, setReviewTab] = useState<ReviewTab>('all')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [detailRowId, setDetailRowId] = useState<string | null>(null)
  const [manualPaymentId, setManualPaymentId] = useState('')
  const deferredSearch = useDeferredValue(search)

  const refreshWorkspace = async () => {
    if (!companyId) return
    setLoadingWorkspace(true)
    try {
      const response = await apiClient.getJson<BankStatementWorkspaceResponse>(`/api/bank-statements/workspace?companyId=${encodeURIComponent(companyId)}`)
      setWorkspace(response.data)
      if (!selectedBankId && response.data.banks[0]?.id) {
        setSelectedBankId(response.data.banks[0].id)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load bank statement workspace.')
    } finally {
      setLoadingWorkspace(false)
    }
  }

  const loadBatchDetail = useCallback(async (batchId: string) => {
    if (!companyId || !batchId) return
    const response = await apiClient.getJson<BatchDetailResponse>(`/api/bank-statements/batches/${batchId}?companyId=${encodeURIComponent(companyId)}`)
    setBatchDetail(response.data)
    setActiveBatchId(batchId)
  }, [companyId])

  useEffect(() => {
    if (activeBatchId) {
      void loadBatchDetail(activeBatchId)
    }
  }, [activeBatchId, loadBatchDetail])

  const runStage = async (label: string, action: () => Promise<void>) => {
    setRunning(true)
    setErrorMessage(null)
    setStageMessage(label)
    setStageProgress(18)
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
      }, 700)
    }
  }

  const handleCreateAndUpload = async () => {
    if (!companyId || !selectedBankId || !selectedFile) {
      setErrorMessage('Choose company bank account and statement file before uploading.')
      return
    }

    const selectedBank = workspace?.banks.find((bank) => bank.id === selectedBankId)
    if (!selectedBank) {
      setErrorMessage('Selected bank account is no longer available in the active company workspace. Refresh and select again.')
      return
    }

    await runStage('Creating secure batch', async () => {
      const createResponse = await apiClient.postJson<BankStatementCreateBatchResponse>('/api/bank-statements/batches', {
        companyId,
        bankId: selectedBank.id,
        fileName: selectedFile.name,
        fileMimeType: selectedFile.type || 'application/octet-stream',
        fileSizeBytes: selectedFile.size
      })

      setStageProgress(40)
      const batchId = createResponse.data.batch.id
      const formData = new FormData()
      formData.set('companyId', companyId)
      formData.set('file', selectedFile)
      await apiClient.postForm(`/api/bank-statements/batches/${batchId}/file`, formData)
      setStageProgress(70)
      await loadBatchDetail(batchId)
      await refreshWorkspace()
      setSelectedFile(null)
    })
  }

  const handleParse = async () => {
    if (!activeBatchId) return
    await runStage('Parsing uploaded statement', async () => {
      await apiClient.postJson(`/api/bank-statements/batches/${activeBatchId}/parse`, {
        companyId
      })
      setStageProgress(70)
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
    })
  }

  const handleMatch = async () => {
    if (!activeBatchId) return
    await runStage('Matching against same-company bank ledger', async () => {
      await apiClient.postJson(`/api/bank-statements/batches/${activeBatchId}/match`, {
        companyId
      })
      setStageProgress(78)
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
    })
  }

  const handleFinalize = async () => {
    if (!activeBatchId) return
    await runStage('Finalizing reconciliation links', async () => {
      await apiClient.postJson(`/api/bank-statements/batches/${activeBatchId}/finalize`, {
        companyId,
        confirm: true
      })
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
    })
  }

  const handleReprocess = async () => {
    if (!activeBatchId) return
    await runStage('Resetting review state for reprocess', async () => {
      await apiClient.postJson(`/api/bank-statements/batches/${activeBatchId}/reprocess`, {
        companyId
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
        throw new Error('Failed to export reconciliation result.')
      }
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = 'bank-reconciliation.csv'
      anchor.click()
      URL.revokeObjectURL(href)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to export reconciliation result.')
    }
  }

  const reviewRow = async (rowId: string, action: Record<string, unknown>) => {
    await runStage('Saving review action', async () => {
      await apiClient.patchJson(`/api/bank-statements/rows/${rowId}/review`, {
        companyId,
        ...action
      })
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
    })
  }

  const rows = useMemo(() => batchDetail?.rows || [], [batchDetail?.rows])
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesTab =
        reviewTab === 'all' ? true : row.matchStatus === reviewTab
      const haystack = `${row.description} ${row.referenceNumber || ''} ${row.matchReason || ''}`.toLowerCase()
      const matchesSearch = deferredSearch.trim()
        ? haystack.includes(deferredSearch.trim().toLowerCase())
        : true
      return matchesTab && matchesSearch
    })
  }, [rows, reviewTab, deferredSearch])

  const selectedRow = rows.find((row) => row.id === detailRowId) || null

  return (
    <DashboardLayout companyId={companyId} initialData={initialLayoutData}>
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Bank Statement Reconciliation
                </div>
                <CardTitle className="mt-3 text-3xl">Secure upload to settlement workflow</CardTitle>
                <CardDescription className="mt-2 max-w-3xl text-sm leading-6">
                  Upload statements in image, PDF, CSV, or Excel format, normalize transactions, compare only with the selected company bank ledger, and review settled, unsettled, and ambiguous rows before finalization.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void refreshWorkspace()} disabled={loadingWorkspace || running}>
                  {loadingWorkspace ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Refresh
                </Button>
                <Button variant="outline" onClick={handleExport} disabled={!activeBatchId}>
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <Card className="premium-panel-subtle rounded-[1.35rem]">
                <CardHeader>
                  <CardTitle className="text-xl">Upload Intake</CardTitle>
                  <CardDescription>Supported formats: JPG, JPEG, PNG, PDF, CSV, XLS, XLSX. Statements are stored securely, parsed, and matched in separate stages.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">Bank account</label>
                      <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                        <SelectTrigger className="h-11">
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
                      <label className="text-sm font-medium text-slate-700">Statement file</label>
                      <Input
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf,.csv,.xls,.xlsx"
                        onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                      />
                    </div>
                  </div>
                  <div className="rounded-[1.15rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-base font-semibold text-slate-900">{selectedFile ? selectedFile.name : 'Choose a statement file to start'}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {selectedFile
                            ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`
                            : 'Fastest results come from CSV and Excel. PDF and image files go through document extraction.'}
                        </p>
                      </div>
                      <Button onClick={() => void handleCreateAndUpload()} disabled={!selectedFile || !selectedBankId || running}>
                        {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                        Create Batch + Upload
                      </Button>
                    </div>
                  </div>
                  {stageMessage ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm text-slate-600">
                        <span>{stageMessage}</span>
                        <span>{stageProgress}%</span>
                      </div>
                      <Progress value={stageProgress} />
                    </div>
                  ) : null}
                  {errorMessage ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {errorMessage}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="premium-panel-subtle rounded-[1.35rem]">
                <CardHeader>
                  <CardTitle className="text-xl">Batch Stage Timeline</CardTitle>
                  <CardDescription>Each batch moves through upload, parse, matching, review, and finalize stages with resumable server state.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {['uploaded', 'parsed', 'ready_for_review', 'finalized'].map((stage) => {
                    const reached = batchDetail?.batch.batchStatus === stage ||
                      (stage === 'uploaded' && !!activeBatchId) ||
                      (stage === 'parsed' && ['parsed', 'matching', 'ready_for_review', 'finalized'].includes(batchDetail?.batch.batchStatus || '')) ||
                      (stage === 'ready_for_review' && ['ready_for_review', 'finalized'].includes(batchDetail?.batch.batchStatus || ''))
                    return (
                      <div key={stage} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-3 py-3">
                        {reached ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Sparkles className="h-5 w-5 text-slate-400" />}
                        <div>
                          <div className="text-sm font-semibold capitalize text-slate-900">{stage.replace(/_/g, ' ')}</div>
                          <div className="text-xs text-slate-500">
                            {stage === 'uploaded' ? 'Secure file intake and checksum persistence.' :
                              stage === 'parsed' ? 'Structured extraction and normalized row creation.' :
                                stage === 'ready_for_review' ? 'Same-company matching with settled/unsettled/review queues.' :
                                  'Final reconciliation links committed transactionally.'}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </div>

            {workspace?.recentBatches?.length ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-950">Recent Batches</h3>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => void handleParse()} disabled={!activeBatchId || running}>Parse</Button>
                    <Button variant="outline" size="sm" onClick={() => void handleMatch()} disabled={!activeBatchId || running}>Match</Button>
                    <Button variant="outline" size="sm" onClick={() => void handleReprocess()} disabled={!activeBatchId || running}>Reprocess</Button>
                    <Button size="sm" onClick={() => void handleFinalize()} disabled={!activeBatchId || running}>Finalize</Button>
                  </div>
                </div>
                <div className="grid gap-3 xl:grid-cols-3">
                  {workspace.recentBatches.map((batch) => (
                    <button
                      key={batch.id}
                      type="button"
                      onClick={() => setActiveBatchId(batch.id)}
                      className={`rounded-[1.25rem] border px-4 py-4 text-left transition ${activeBatchId === batch.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{batch.fileName}</p>
                          <p className={`mt-1 text-xs ${activeBatchId === batch.id ? 'text-slate-300' : 'text-slate-500'}`}>{dateText(batch.createdAt)}</p>
                        </div>
                        <Badge className={activeBatchId === batch.id ? 'bg-white/15 text-white border-white/20' : statusTone(batch.batchStatus)}>{batch.batchStatus.replace(/_/g, ' ')}</Badge>
                      </div>
                      <div className={`mt-4 grid grid-cols-3 gap-2 text-xs ${activeBatchId === batch.id ? 'text-slate-200' : 'text-slate-600'}`}>
                        <div>
                          <div className="font-semibold">{batch.summary.totalRows}</div>
                          <div>Total</div>
                        </div>
                        <div>
                          <div className="font-semibold">{batch.summary.settledRows}</div>
                          <div>Settled</div>
                        </div>
                        <div>
                          <div className="font-semibold">{batch.summary.ambiguousRows + batch.summary.unsettledRows}</div>
                          <div>Review</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {batchDetail ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {[
                    { label: 'Total Rows', value: batchDetail.batch.summary.totalRows, tone: 'text-slate-950' },
                    { label: 'Settled', value: batchDetail.batch.summary.settledRows, tone: 'text-emerald-600' },
                    { label: 'Unsettled', value: batchDetail.batch.summary.unsettledRows, tone: 'text-rose-600' },
                    { label: 'Ambiguous', value: batchDetail.batch.summary.ambiguousRows, tone: 'text-amber-600' },
                    { label: 'Warnings', value: batchDetail.batch.summary.warningCount, tone: 'text-sky-600' }
                  ].map((item) => (
                    <Card key={item.label}>
                      <CardContent className="py-5">
                        <div className="text-sm text-slate-500">{item.label}</div>
                        <div className={`mt-2 text-3xl font-semibold ${item.tone}`}>{item.value}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <CardTitle className="text-xl">Reconciliation Review</CardTitle>
                        <CardDescription>
                          Compare parsed statement rows with same-company bank ledger candidates. Settled rows are confident matches, unsettled rows need attention, and ambiguous rows require review.
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-full sm:w-72">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <Input className="pl-9" placeholder="Search narration or reference" value={search} onChange={(event) => setSearch(event.target.value)} />
                        </div>
                        {(['all', 'settled', 'unsettled', 'ambiguous'] as ReviewTab[]).map((tab) => (
                          <Button key={tab} size="sm" variant={reviewTab === tab ? 'default' : 'outline'} onClick={() => setReviewTab(tab)}>
                            {tab}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="hidden xl:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Match</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="py-10 text-center text-slate-500">No rows match the current filters.</TableCell>
                            </TableRow>
                          ) : filteredRows.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell>{dateText(row.transactionDate)}</TableCell>
                              <TableCell className="max-w-[320px] truncate">{row.description}</TableCell>
                              <TableCell>{row.referenceNumber || '-'}</TableCell>
                              <TableCell className="text-right font-medium">{currency(row.amount)}</TableCell>
                              <TableCell>
                                <Badge className={statusTone(row.matchStatus)}>{row.matchStatus}</Badge>
                              </TableCell>
                              <TableCell className="max-w-[280px]">
                                <div className="space-y-1">
                                  <div className="text-sm font-medium text-slate-900">{row.matchReason || 'No match yet'}</div>
                                  <div className="text-xs text-slate-500">
                                    {row.matchedPaymentId ? `Payment ${row.matchedPaymentId}` : `${row.matchCandidates.length} candidates`}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-2">
                                  <Button size="sm" variant="outline" onClick={() => { setDetailRowId(row.id); setManualPaymentId(row.matchCandidates[0]?.paymentId || '') }}>
                                    Review
                                  </Button>
                                  {row.matchStatus === 'settled' ? (
                                    <Button size="sm" variant="outline" onClick={() => void reviewRow(row.id, { action: 'accept_match' })}>Accept</Button>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="grid gap-3 xl:hidden">
                      {filteredRows.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                          No rows match the current filters.
                        </div>
                      ) : filteredRows.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => { setDetailRowId(row.id); setManualPaymentId(row.matchCandidates[0]?.paymentId || '') }}
                          className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-4 text-left"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-950">{dateText(row.transactionDate)}</div>
                              <div className="mt-1 line-clamp-2 text-sm text-slate-600">{row.description}</div>
                            </div>
                            <Badge className={statusTone(row.matchStatus)}>{row.matchStatus}</Badge>
                          </div>
                          <div className="mt-3 text-sm font-medium text-slate-900">{currency(row.amount)}</div>
                          <div className="mt-1 text-xs text-slate-500">{row.matchReason || 'No match yet'}</div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                  <FileUp className="h-10 w-10 text-slate-400" />
                  <div className="mt-4 text-lg font-semibold text-slate-900">No active reconciliation batch</div>
                  <div className="mt-2 max-w-xl text-sm text-slate-500">
                    Start by creating a secure batch and uploading a bank statement file. The system will then parse, normalize, match, and classify rows into settled, unsettled, and ambiguous review queues.
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(selectedRow)} onOpenChange={(open) => { if (!open) setDetailRowId(null) }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review statement row</DialogTitle>
          </DialogHeader>
          {selectedRow ? (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardContent className="space-y-2 py-5">
                    <div className="text-sm text-slate-500">Transaction Date</div>
                    <div className="font-semibold text-slate-950">{dateText(selectedRow.transactionDate)}</div>
                    <div className="text-sm text-slate-500">Amount</div>
                    <div className="font-semibold text-slate-950">{currency(selectedRow.amount)}</div>
                    <div className="text-sm text-slate-500">Direction</div>
                    <div className="font-semibold capitalize text-slate-950">{selectedRow.direction}</div>
                    <div className="text-sm text-slate-500">Reference</div>
                    <div className="font-semibold text-slate-950">{selectedRow.referenceNumber || '-'}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-2 py-5">
                    <div className="text-sm text-slate-500">Current Status</div>
                    <Badge className={statusTone(selectedRow.matchStatus)}>{selectedRow.matchStatus}</Badge>
                    <div className="text-sm text-slate-500">Reason</div>
                    <div className="text-sm text-slate-700">{selectedRow.matchReason || 'No reason captured yet.'}</div>
                    <div className="text-sm text-slate-500">Description</div>
                    <div className="text-sm text-slate-900">{selectedRow.description}</div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Candidate bank movements</CardTitle>
                  <CardDescription>Only same-company bank movement candidates are listed here.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedRow.matchCandidates.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                      No candidate matches were found for this row.
                    </div>
                  ) : selectedRow.matchCandidates.map((candidate) => (
                    <div key={candidate.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-950">Candidate #{candidate.candidateRank}</div>
                          <div className="mt-1 text-xs text-slate-500">{candidate.reason || 'No candidate reason captured.'}</div>
                        </div>
                        <Badge variant="outline" className="rounded-full">{candidate.totalScore.toFixed(0)} score</Badge>
                      </div>
                      <div className="mt-3 text-xs text-slate-500">Payment ID: {candidate.paymentId || '-'}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Manual review actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Manual payment link</label>
                    <Select value={manualPaymentId || '__none__'} onValueChange={(value) => setManualPaymentId(value === '__none__' ? '' : value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose candidate payment" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No selection</SelectItem>
                        {selectedRow.matchCandidates.map((candidate) => (
                          <SelectItem key={candidate.id} value={candidate.paymentId}>
                            Payment {candidate.paymentId} • Score {candidate.totalScore.toFixed(0)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        if (!manualPaymentId) {
                          setErrorMessage('Choose a candidate payment before linking manually.')
                          return
                        }
                        void reviewRow(selectedRow.id, { action: 'manual_link', paymentId: manualPaymentId })
                        setDetailRowId(null)
                      }}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Manual Link
                    </Button>
                    <Button variant="outline" onClick={() => { void reviewRow(selectedRow.id, { action: 'accept_match' }); setDetailRowId(null) }}>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Accept Match
                    </Button>
                    <Button variant="outline" onClick={() => { void reviewRow(selectedRow.id, { action: 'mark_unsettled' }); setDetailRowId(null) }}>
                      <AlertTriangle className="mr-2 h-4 w-4" />
                      Mark Unsettled
                    </Button>
                    <Button variant="outline" onClick={() => { void reviewRow(selectedRow.id, { action: 'ignore' }); setDetailRowId(null) }}>
                      <XCircle className="mr-2 h-4 w-4" />
                      Ignore
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}
