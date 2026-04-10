'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertTriangle, Plus, RefreshCcw, SplitSquareVertical, Trash2 } from 'lucide-react'

type WorkspaceItem = {
  id: string
  productId: string
  productName: string
  weight: number
  bags: number
  rate: number
  amount: number
  taxableAmount: number
  gstRateSnapshot: number
  gstAmount: number
  lineTotal: number
}

type WorkspacePart = {
  billId: string | null
  billNo: string
  suffix: string
  splitPartLabel: string
  notes: string | null
  transportName: string | null
  lorryNo: string | null
  totalAmount: number
  totalWeight: number
  totalBags: number
  allocations: Array<{
    parentSalesItemId: string
    weight: number
    bags: number
    amount: number
  }>
}

type SplitWorkspace = {
  parentBill: {
    id: string
    billNo: string
    billDate: string
    totalAmount: number
    totalWeight: number
    totalBags: number
    salesItems: WorkspaceItem[]
    splitMethod: string | null
    splitReason: string | null
  }
  splitGroup: {
    id: string | null
    status: string | null
    splitMethod: string | null
    reason: string | null
    notes: string | null
  }
  parts: WorkspacePart[]
  canEdit: boolean
  lockReason: string | null
  suggestedNextSuffix: string
}

type PreviewIssue = {
  code: string
  message: string
  itemName?: string
  suffix?: string
}

type PartAllocationForm = {
  parentSalesItemId: string
  weight: string
  bags: string
  amount: string
}

type PartForm = {
  billId: string | null
  suffix: string
  partLabel: string
  notes: string
  transportName: string
  lorryNo: string
  allocations: PartAllocationForm[]
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  billId: string
  expectedParentUpdatedAt?: string | null
  onSaved?: () => void
}

const SPLIT_METHOD_OPTIONS = [
  { value: 'manual', label: 'Manual Custom Split' },
  { value: 'selected_items', label: 'By Selected Items' },
  { value: 'quantity', label: 'By Quantity' },
  { value: 'weight', label: 'By Weight' },
  { value: 'amount', label: 'By Amount / Value' },
  { value: 'dispatch', label: 'By Dispatch / Lot' },
  { value: 'party_instruction', label: 'By Party Instruction' },
] as const

function toNumberInput(value: unknown): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || Math.abs(parsed) < 0.000001) return ''
  return String(Number(parsed.toFixed(2)))
}

function parseNumber(value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Number(parsed.toFixed(2)))
}

function distributeEvenly(workspace: SplitWorkspace): PartForm[] {
  const items = workspace.parentBill.salesItems
  const partA: PartForm = {
    billId: null,
    suffix: 'A',
    partLabel: 'Part A',
    notes: '',
    transportName: '',
    lorryNo: '',
    allocations: items.map((item) => ({
      parentSalesItemId: item.id,
      weight: toNumberInput(Number((item.weight / 2).toFixed(2))),
      bags: item.bags > 0 ? String(Math.floor(item.bags / 2)) : '',
      amount: '',
    })),
  }
  const partB: PartForm = {
    billId: null,
    suffix: 'B',
    partLabel: 'Part B',
    notes: '',
    transportName: '',
    lorryNo: '',
    allocations: items.map((item) => {
      const firstWeight = parseNumber(toNumberInput(Number((item.weight / 2).toFixed(2))))
      const firstBags = item.bags > 0 ? Math.floor(item.bags / 2) : 0
      return {
        parentSalesItemId: item.id,
        weight: toNumberInput(Number((item.weight - firstWeight).toFixed(2))),
        bags: item.bags > 0 ? String(Math.max(0, item.bags - firstBags)) : '',
        amount: '',
      }
    }),
  }

  return [partA, partB]
}

function buildFormParts(workspace: SplitWorkspace): PartForm[] {
  if (workspace.parts.length === 0) {
    return distributeEvenly(workspace)
  }

  return workspace.parts.map((part) => ({
    billId: part.billId,
    suffix: part.suffix,
    partLabel: part.splitPartLabel,
    notes: part.notes || '',
    transportName: part.transportName || '',
    lorryNo: part.lorryNo || '',
    allocations: workspace.parentBill.salesItems.map((item) => {
      const existing = part.allocations.find((allocation) => allocation.parentSalesItemId === item.id)
      return {
        parentSalesItemId: item.id,
        weight: toNumberInput(existing?.weight),
        bags: toNumberInput(existing?.bags),
        amount: toNumberInput(existing?.amount),
      }
    }),
  }))
}

function buildEmptyPart(workspace: SplitWorkspace, suffix: string): PartForm {
  return {
    billId: null,
    suffix,
    partLabel: `Part ${suffix}`,
    notes: '',
    transportName: '',
    lorryNo: '',
    allocations: workspace.parentBill.salesItems.map((item) => ({
      parentSalesItemId: item.id,
      weight: '',
      bags: '',
      amount: '',
    })),
  }
}

export default function SalesInvoiceSplitDialog({
  open,
  onOpenChange,
  companyId,
  billId,
  expectedParentUpdatedAt,
  onSaved,
}: Props) {
  const [workspace, setWorkspace] = useState<SplitWorkspace | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewIssues, setPreviewIssues] = useState<PreviewIssue[]>([])
  const [splitMethod, setSplitMethod] = useState<string>('manual')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [parts, setParts] = useState<PartForm[]>([])

  useEffect(() => {
    if (!open || !companyId || !billId) return

    let cancelled = false

    const loadWorkspace = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch(
          `/api/sales-bills/splits?companyId=${encodeURIComponent(companyId)}&billId=${encodeURIComponent(billId)}`
        )
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
          workspace?: SplitWorkspace
        }

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load split workspace')
        }

        if (cancelled || !payload.workspace) return

        setWorkspace(payload.workspace)
        setSplitMethod(payload.workspace.splitGroup.splitMethod || payload.workspace.parentBill.splitMethod || 'manual')
        setReason(payload.workspace.splitGroup.reason || payload.workspace.parentBill.splitReason || '')
        setNotes(payload.workspace.splitGroup.notes || '')
        setParts(buildFormParts(payload.workspace))
        setPreviewIssues([])
      } catch (fetchError) {
        if (cancelled) return
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load split workspace')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadWorkspace()
    return () => {
      cancelled = true
    }
  }, [billId, companyId, open])

  const itemMap = useMemo(() => {
    const map = new Map<string, WorkspaceItem>()
    for (const item of workspace?.parentBill.salesItems || []) {
      map.set(item.id, item)
    }
    return map
  }, [workspace])

  const allocationSummary = useMemo(() => {
    const rows = (workspace?.parentBill.salesItems || []).map((item) => {
      const assignedWeight = parts.reduce((sum, part) => {
        const allocation = part.allocations.find((entry) => entry.parentSalesItemId === item.id)
        return sum + parseNumber(allocation?.weight || '')
      }, 0)
      const assignedBags = parts.reduce((sum, part) => {
        const allocation = part.allocations.find((entry) => entry.parentSalesItemId === item.id)
        return sum + Math.floor(parseNumber(allocation?.bags || ''))
      }, 0)

      return {
        itemId: item.id,
        productName: item.productName,
        totalWeight: item.weight,
        assignedWeight: Number(assignedWeight.toFixed(2)),
        remainingWeight: Number((item.weight - assignedWeight).toFixed(2)),
        totalBags: item.bags,
        assignedBags,
        remainingBags: item.bags - assignedBags,
      }
    })

    return rows
  }, [parts, workspace])

  const localPartTotals = useMemo(() => {
    return parts.map((part) => {
      const totals = part.allocations.reduce(
        (sum, allocation) => {
          const item = itemMap.get(allocation.parentSalesItemId)
          const weight = parseNumber(allocation.weight)
          const bags = Math.floor(parseNumber(allocation.bags))
          const amount = parseNumber(allocation.amount) || Number(((weight || 0) * Number(item?.rate || 0)).toFixed(2))

          return {
            weight: Number((sum.weight + weight).toFixed(2)),
            bags: sum.bags + bags,
            amount: Number((sum.amount + amount).toFixed(2)),
          }
        },
        { weight: 0, bags: 0, amount: 0 }
      )

      return totals
    })
  }, [itemMap, parts])

  const updatePart = (index: number, updater: (part: PartForm) => PartForm) => {
    setParts((current) => current.map((part, partIndex) => (partIndex === index ? updater(part) : part)))
  }

  const updateAllocation = (
    partIndex: number,
    parentSalesItemId: string,
    field: keyof PartAllocationForm,
    value: string
  ) => {
    updatePart(partIndex, (part) => ({
      ...part,
      allocations: part.allocations.map((allocation) =>
        allocation.parentSalesItemId === parentSalesItemId ? { ...allocation, [field]: value } : allocation
      ),
    }))
  }

  const addPart = () => {
    if (!workspace) return
    const nextSuffix = parts.length === 0 ? workspace.suggestedNextSuffix : String.fromCharCode(65 + parts.length)
    setParts((current) => [...current, buildEmptyPart(workspace, nextSuffix)])
  }

  const removePart = (index: number) => {
    setParts((current) => current.filter((_, partIndex) => partIndex !== index))
  }

  const buildPayload = () => ({
    companyId,
    parentBillId: workspace?.parentBill.id || billId,
    splitMethod,
    reason: reason || null,
    notes: notes || null,
    expectedParentUpdatedAt: expectedParentUpdatedAt || null,
    parts: parts.map((part) => ({
      billId: part.billId,
      suffix: part.suffix,
      partLabel: part.partLabel,
      notes: part.notes || null,
      transportName: part.transportName || null,
      lorryNo: part.lorryNo || null,
      allocations: part.allocations.map((allocation) => ({
        parentSalesItemId: allocation.parentSalesItemId,
        weight: parseNumber(allocation.weight),
        bags: allocation.bags ? Math.floor(parseNumber(allocation.bags)) : null,
        amount: allocation.amount ? parseNumber(allocation.amount) : null,
      })),
    })),
  })

  const handlePreview = async () => {
    if (!workspace) return
    try {
      setSubmitting(true)
      setError(null)
      const response = await fetch('/api/sales-bills/splits/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        preview?: {
          issues?: PreviewIssue[]
        }
      }

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to preview split')
      }

      setPreviewIssues(Array.isArray(payload.preview?.issues) ? payload.preview.issues : [])
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to preview split')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSave = async (commit: boolean) => {
    if (!workspace) return

    if (commit && !window.confirm('Finalize this invoice split? Parent stock will move to child invoices.')) {
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      const response = await fetch('/api/sales-bills/splits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...buildPayload(),
          commit,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        workspace?: SplitWorkspace
      }

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save invoice split')
      }

      if (payload.workspace) {
        setWorkspace(payload.workspace)
        setParts(buildFormParts(payload.workspace))
        setSplitMethod(payload.workspace.splitGroup.splitMethod || splitMethod)
        setReason(payload.workspace.splitGroup.reason || reason)
        setNotes(payload.workspace.splitGroup.notes || notes)
      }
      setPreviewIssues([])
      onSaved?.()
      if (commit) {
        onOpenChange(false)
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save invoice split')
    } finally {
      setSubmitting(false)
    }
  }

  const handleMerge = async () => {
    if (!workspace) return
    if (!window.confirm('Merge all split parts back into the parent invoice?')) {
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      const response = await fetch(
        `/api/sales-bills/splits?companyId=${encodeURIComponent(companyId)}&parentBillId=${encodeURIComponent(
          workspace.parentBill.id
        )}`,
        { method: 'DELETE' }
      )
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to merge split invoices')
      }
      onSaved?.()
      onOpenChange(false)
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : 'Failed to merge split invoices')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-7xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <SplitSquareVertical className="h-5 w-5" />
            Invoice Split Workspace
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[78vh] overflow-y-auto px-6 py-5">
          {loading ? (
            <p className="text-sm text-slate-500">Loading invoice split workspace...</p>
          ) : workspace ? (
            <div className="space-y-5">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Parent Invoice Summary</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-6">
                  <div>
                    <p className="text-slate-500">Invoice</p>
                    <p className="font-semibold text-slate-900">{workspace.parentBill.billNo}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Date</p>
                    <p className="font-semibold text-slate-900">
                      {new Date(workspace.parentBill.billDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Total</p>
                    <p className="font-semibold text-slate-900">₹{workspace.parentBill.totalAmount.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Weight</p>
                    <p className="font-semibold text-slate-900">{workspace.parentBill.totalWeight.toFixed(2)} Qt</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Bags</p>
                    <p className="font-semibold text-slate-900">{workspace.parentBill.totalBags}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Current Split State</p>
                    <p className="font-semibold text-slate-900">
                      {workspace.splitGroup.status || 'Not yet split'}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {workspace.lockReason ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4" />
                    <div>
                      <p className="font-semibold">Split is locked</p>
                      <p>{workspace.lockReason}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              ) : null}

              {previewIssues.length > 0 ? (
                <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3">
                  <p className="text-sm font-semibold text-red-800">Validation issues</p>
                  <ul className="mt-2 space-y-1 text-sm text-red-700">
                    {previewIssues.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Split Definition</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-[220px_1fr_1fr]">
                  <div>
                    <Label htmlFor="splitMethod">Split Method</Label>
                    <Select value={splitMethod} onValueChange={setSplitMethod} disabled={!workspace.canEdit || submitting}>
                      <SelectTrigger id="splitMethod">
                        <SelectValue placeholder="Select split method" />
                      </SelectTrigger>
                      <SelectContent>
                        {SPLIT_METHOD_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="splitReason">Reason</Label>
                    <Input
                      id="splitReason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Why is this invoice being split?"
                      disabled={!workspace.canEdit || submitting}
                    />
                  </div>
                  <div>
                    <Label htmlFor="splitNotes">Notes</Label>
                    <Input
                      id="splitNotes"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Optional internal notes"
                      disabled={!workspace.canEdit || submitting}
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Split Parts</p>
                <Button type="button" variant="outline" onClick={addPart} disabled={!workspace.canEdit || submitting}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Part
                </Button>
              </div>

              <div className="grid gap-4">
                {parts.map((part, partIndex) => (
                  <Card key={`${part.billId || 'new'}-${partIndex}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <CardTitle className="text-base">{workspace.parentBill.billNo}({part.suffix || '?'})</CardTitle>
                          <p className="text-xs text-slate-500">
                            Local total: {localPartTotals[partIndex]?.weight.toFixed(2) || '0.00'} Qt | ₹
                            {localPartTotals[partIndex]?.amount.toFixed(2) || '0.00'}
                          </p>
                        </div>
                        {parts.length > 2 ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removePart(partIndex)}
                            disabled={!workspace.canEdit || submitting}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-4">
                        <div>
                          <Label htmlFor={`part-suffix-${partIndex}`}>Suffix</Label>
                          <Input
                            id={`part-suffix-${partIndex}`}
                            value={part.suffix}
                            onChange={(event) => updatePart(partIndex, (current) => ({ ...current, suffix: event.target.value.toUpperCase() }))}
                            disabled={!workspace.canEdit || submitting}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`part-label-${partIndex}`}>Part Label</Label>
                          <Input
                            id={`part-label-${partIndex}`}
                            value={part.partLabel}
                            onChange={(event) => updatePart(partIndex, (current) => ({ ...current, partLabel: event.target.value }))}
                            disabled={!workspace.canEdit || submitting}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`part-transport-${partIndex}`}>Transport Name</Label>
                          <Input
                            id={`part-transport-${partIndex}`}
                            value={part.transportName}
                            onChange={(event) =>
                              updatePart(partIndex, (current) => ({ ...current, transportName: event.target.value }))
                            }
                            disabled={!workspace.canEdit || submitting}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`part-lorry-${partIndex}`}>Lorry No.</Label>
                          <Input
                            id={`part-lorry-${partIndex}`}
                            value={part.lorryNo}
                            onChange={(event) =>
                              updatePart(partIndex, (current) => ({ ...current, lorryNo: event.target.value }))
                            }
                            disabled={!workspace.canEdit || submitting}
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor={`part-note-${partIndex}`}>Part Notes</Label>
                        <Input
                          id={`part-note-${partIndex}`}
                          value={part.notes}
                          onChange={(event) => updatePart(partIndex, (current) => ({ ...current, notes: event.target.value }))}
                          disabled={!workspace.canEdit || submitting}
                        />
                      </div>

                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full border-collapse text-sm">
                          <thead className="bg-slate-50">
                            <tr className="border-b">
                              <th className="px-3 py-2 text-left">Item</th>
                              <th className="px-3 py-2 text-right">Parent Qt</th>
                              <th className="px-3 py-2 text-right">Parent Bags</th>
                              <th className="px-3 py-2 text-right">Split Qt</th>
                              <th className="px-3 py-2 text-right">Split Bags</th>
                              <th className="px-3 py-2 text-right">Split Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {workspace.parentBill.salesItems.map((item) => {
                              const allocation = part.allocations.find((entry) => entry.parentSalesItemId === item.id)
                              return (
                                <tr key={`${partIndex}-${item.id}`} className="border-b">
                                  <td className="px-3 py-2 font-medium text-slate-900">{item.productName}</td>
                                  <td className="px-3 py-2 text-right">{item.weight.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right">{item.bags}</td>
                                  <td className="px-3 py-2">
                                    <Input
                                      name={`weight-${partIndex}-${item.id}`}
                                      value={allocation?.weight || ''}
                                      onChange={(event) =>
                                        updateAllocation(partIndex, item.id, 'weight', event.target.value)
                                      }
                                      inputMode="decimal"
                                      className="text-right"
                                      disabled={!workspace.canEdit || submitting}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <Input
                                      name={`bags-${partIndex}-${item.id}`}
                                      value={allocation?.bags || ''}
                                      onChange={(event) => updateAllocation(partIndex, item.id, 'bags', event.target.value)}
                                      inputMode="numeric"
                                      className="text-right"
                                      disabled={!workspace.canEdit || submitting}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <Input
                                      name={`amount-${partIndex}-${item.id}`}
                                      value={allocation?.amount || ''}
                                      onChange={(event) =>
                                        updateAllocation(partIndex, item.id, 'amount', event.target.value)
                                      }
                                      inputMode="decimal"
                                      className="text-right"
                                      disabled={!workspace.canEdit || submitting}
                                    />
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Allocation Check</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-slate-50">
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left">Item</th>
                        <th className="px-3 py-2 text-right">Total Qt</th>
                        <th className="px-3 py-2 text-right">Assigned Qt</th>
                        <th className="px-3 py-2 text-right">Remaining Qt</th>
                        <th className="px-3 py-2 text-right">Total Bags</th>
                        <th className="px-3 py-2 text-right">Assigned Bags</th>
                        <th className="px-3 py-2 text-right">Remaining Bags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocationSummary.map((row) => (
                        <tr key={row.itemId} className="border-b">
                          <td className="px-3 py-2 font-medium text-slate-900">{row.productName}</td>
                          <td className="px-3 py-2 text-right">{row.totalWeight.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">{row.assignedWeight.toFixed(2)}</td>
                          <td className={`px-3 py-2 text-right ${Math.abs(row.remainingWeight) > 0.01 ? 'text-red-600' : 'text-emerald-700'}`}>
                            {row.remainingWeight.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right">{row.totalBags}</td>
                          <td className="px-3 py-2 text-right">{row.assignedBags}</td>
                          <td className={`px-3 py-2 text-right ${row.remainingBags !== 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                            {row.remainingBags}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Split workspace is unavailable for this invoice.</p>
          )}
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-slate-500">
              Preview validates quantity, amount, tax, and bag distribution before finalizing.
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {workspace?.splitGroup.id ? (
                <Button type="button" variant="outline" onClick={handleMerge} disabled={submitting || !workspace.canEdit}>
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Merge Back
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => void handlePreview()} disabled={submitting || !workspace}>
                Preview
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleSave(false)} disabled={submitting || !workspace?.canEdit}>
                Save Draft
              </Button>
              <Button type="button" onClick={() => void handleSave(true)} disabled={submitting || !workspace?.canEdit}>
                {submitting ? 'Working...' : 'Finalize Split'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
