'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import DashboardLayout from '@/app/components/DashboardLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DashboardLayoutInitialData } from '@/lib/app-shell-types'
import type {
  BankStatementLookupResponse,
  BankStatementWorkspaceResponse
} from '@/lib/bank-statements/contracts'
import type {
  BankStatementLookupPayload,
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

function buildDraft(row: BatchDetailRow): DraftState {
  return {
    accountingHeadId: row.draftAccountingHeadId || '',
    partyId: row.draftPartyId || '',
    supplierId: row.draftSupplierId || '',
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
  const [activeBatchId, setActiveBatchId] = useState(initialWorkspace?.recentBatches[0]?.id || '')
  const [batchDetail, setBatchDetail] = useState<BatchDetailResponse['data'] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [running, setRunning] = useState(false)
  const [search, setSearch] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [detailRowId, setDetailRowId] = useState<string | null>(null)

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
      if (!activeBatchId && workspaceResponse.data.recentBatches[0]?.id) {
        setActiveBatchId(workspaceResponse.data.recentBatches[0].id)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load reconciliation workspace.')
    } finally {
      setLoadingWorkspace(false)
    }
  }, [companyId, activeBatchId])

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

  const saveDraft = async (rowId: string) => {
    const draft = drafts[rowId]
    if (!draft) return
    setRunning(true)
    setErrorMessage(null)
    try {
      await apiClient.patchJson(`/api/bank-statements/rows/${rowId}/draft`, {
        companyId,
        accountingHeadId: draft.accountingHeadId || null,
        partyId: draft.partyId || null,
        supplierId: draft.supplierId || null,
        remarks: draft.remarks || null
      })
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save reconciliation draft.')
    } finally {
      setRunning(false)
    }
  }

  const postRows = async (rowIds: string[]) => {
    if (!activeBatchId || rowIds.length === 0) return
    setRunning(true)
    setErrorMessage(null)
    try {
      await apiClient.postJson(`/api/bank-statements/batches/${activeBatchId}/post`, {
        companyId,
        rowIds
      })
      await loadBatchDetail(activeBatchId)
      await refreshWorkspace()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to post rows to ledger.')
    } finally {
      setRunning(false)
    }
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

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) =>
      `${row.description} ${row.referenceNumber || ''} ${row.matchReason || ''} ${row.draftRemarks || ''}`
        .toLowerCase()
        .includes(query)
    )
  }, [rows, search])

  const settledRows = useMemo(
    () => filteredRows.filter((row) => row.matchStatus === 'settled'),
    [filteredRows]
  )

  const unsettledRows = useMemo(
    () => filteredRows.filter((row) => row.matchStatus !== 'settled' && row.matchStatus !== 'ignored'),
    [filteredRows]
  )

  const totals = useMemo(() => ({
    total: rows.length,
    settled: settledRows.length,
    unsettled: unsettledRows.length
  }), [rows.length, settledRows.length, unsettledRows.length])

  const selectedDetailRow = rows.find((row) => row.id === detailRowId) || null

  return (
    <DashboardLayout companyId={companyId} initialData={initialLayoutData}>
      <div className="space-y-6">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">Bank Statement Reconciliation</h1>
            <p className="text-sm text-slate-600">
              Document: {batchDetail?.batch.fileName || 'No document selected'} | Status: {batchDetail?.batch.batchStatus?.replace(/_/g, ' ') || 'No batch selected'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refreshWorkspace()} disabled={loadingWorkspace || running}>
            {loadingWorkspace ? 'Loading...' : 'Refresh'}
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-medium text-slate-500">Total Transactions</div>
              <div className="text-2xl font-bold text-slate-950">{totals.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-medium text-green-600">Settled Entries</div>
              <div className="text-2xl font-bold text-green-600">{totals.settled}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm font-medium text-red-600">Unsettled Entries</div>
              <div className="text-2xl font-bold text-red-600">{totals.unsettled}</div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search narration, reference, remarks" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {/* Tables */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Settled Entries */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Settled Entries (Matched with ERP Ledger)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead>Match Status</TableHead>
                      <TableHead>ERP Account / Supplier</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settledRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-slate-500">
                          No settled entries.
                        </TableCell>
                      </TableRow>
                    ) : (
                      settledRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-sm">{dateText(row.transactionDate)}</TableCell>
                          <TableCell className="max-w-48 truncate text-sm">{row.description}</TableCell>
                          <TableCell className="text-sm">{row.referenceNumber || '-'}</TableCell>
                          <TableCell className="text-right text-sm">{row.debit ? currency(row.debit) : '-'}</TableCell>
                          <TableCell className="text-right text-sm">{row.credit ? currency(row.credit) : '-'}</TableCell>
                          <TableCell>
                            <Badge className="bg-green-100 text-green-800">Matched</Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.postedPaymentId
                              ? `Posted Payment ${row.postedPaymentId.slice(-6)}`
                              : row.matchedPaymentId
                                ? `Payment ${row.matchedPaymentId.slice(-6)}`
                                : row.matchedLedgerId
                                  ? `Ledger ${row.matchedLedgerId.slice(-6)}`
                                  : '-'}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">{row.draftRemarks || row.matchReason || '-'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Unsettled Entries */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Unsettled Entries (No ERP Match)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>ERP Account / Supplier</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unsettledRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-10 text-center text-slate-500">
                          No unsettled entries.
                        </TableCell>
                      </TableRow>
                    ) : (
                      unsettledRows.map((row) => {
                        const draft = drafts[row.id] || buildDraft(row)
                        return (
                          <TableRow key={row.id}>
                            <TableCell className="text-sm">{dateText(row.transactionDate)}</TableCell>
                            <TableCell className="max-w-48 truncate text-sm">{row.description}</TableCell>
                            <TableCell className="text-sm">{row.referenceNumber || '-'}</TableCell>
                            <TableCell className="text-right text-sm">{row.debit ? currency(row.debit) : '-'}</TableCell>
                            <TableCell className="text-right text-sm">{row.credit ? currency(row.credit) : '-'}</TableCell>
                            <TableCell>
                              <Badge className="bg-red-100 text-red-800">Unsettled</Badge>
                            </TableCell>
                            <TableCell className="min-w-64 space-y-2">
                              <SearchableSelect
                                id={`head-${row.id}`}
                                value={draft.accountingHeadId}
                                onValueChange={(value) => setDrafts((current) => ({
                                  ...current,
                                  [row.id]: { ...draft, accountingHeadId: value, partyId: '', supplierId: '' }
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
                            </TableCell>
                            <TableCell>
                              <Input
                                value={draft.remarks}
                                onChange={(e) => setDrafts((current) => ({
                                  ...current,
                                  [row.id]: { ...draft, remarks: e.target.value }
                                }))}
                                placeholder="Remarks"
                                className="w-full"
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* Buttons */}
              <div className="flex justify-end gap-2 p-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => unsettledRows.forEach(row => saveDraft(row.id))}
                  disabled={running || unsettledRows.length === 0}
                >
                  Save Reconciliation
                </Button>
                <Button
                  onClick={() => postRows(unsettledRows.map(row => row.id))}
                  disabled={running || unsettledRows.length === 0}
                >
                  Post to Ledger
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detail Dialog */}
        {selectedDetailRow && (
          <Dialog open={!!detailRowId} onOpenChange={() => setDetailRowId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transaction Details</DialogTitle>
                <DialogDescription>Details for the selected transaction.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <strong>Date:</strong> {dateText(selectedDetailRow.transactionDate)}
                </div>
                <div>
                  <strong>Description:</strong> {selectedDetailRow.description}
                </div>
                <div>
                  <strong>Reference:</strong> {selectedDetailRow.referenceNumber || '-'}
                </div>
                <div>
                  <strong>Amount:</strong> {currency(selectedDetailRow.amount)}
                </div>
                <div>
                  <strong>Status:</strong> {selectedDetailRow.matchStatus}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </DashboardLayout>
  )
}
