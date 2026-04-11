'use client'

import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Landmark,
  Loader2,
  RefreshCw,
  Save,
  ScanSearch,
  Search,
  Undo2,
  Upload,
  Wand2,
  X
} from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DashboardLayoutInitialData } from '@/lib/app-shell-types'
import { invalidateAppDataCaches, notifyAppDataChanged } from '@/lib/app-live-data'
import type {
  StatementDocumentKind,
  StatementDocumentMeta,
  StatementPreviewRow,
  StatementSummary,
  StatementTargetSelection
} from '@/lib/bank-statement-types'
import { getClientCachedValue, loadClientCachedValue } from '@/lib/client-cached-value'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { deleteClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { getCsrfTokenScoped } from '@/lib/csrf'

type BankRecord = {
  id: string
  name: string
  branch?: string | null
  accountNumber?: string | null
  ifscCode?: string | null
}

type ActivityRecord = {
  id: string
  createdAt: string
  actorRole?: string
  summary: string
  imported?: number
  totalRows?: number
  bankName?: string
  documentKind?: string
  fileName?: string
  source: 'server' | 'local'
}

type WorkspacePayload = {
  banks: BankRecord[]
  targets: SearchableSelectOption[]
  recentActivity: Array<Omit<ActivityRecord, 'source'>>
}

type StatementPayload = {
  success?: boolean
  bank?: BankRecord
  document?: StatementDocumentMeta
  summary?: StatementSummary
  entries?: StatementPreviewRow[]
  error?: string
}

type DraftPayload = {
  selectedBankId: string
  result: StatementPayload
  manualTargets: Record<string, string>
  savedAt: string
}

type PreviewCachePayload = {
  selectedBankId: string
  fileFingerprint: string
  result: StatementPayload
  manualTargets: Record<string, string>
  savedAt: string
}

type ToastTone = 'success' | 'error' | 'info'
type ToastRecord = {
  id: number
  tone: ToastTone
  title: string
  message: string
}

type RouteAction = 'preview' | 'import'
type ReviewFilter = 'all' | 'ready' | 'needs-target' | 'suggested' | 'amount-mismatch'

const BANK_STATEMENT_WORKSPACE_CACHE_AGE_MS = 5 * 60_000
const BANK_STATEMENT_DRAFT_CACHE_AGE_MS = 24 * 60 * 60_000
const BANK_STATEMENT_PREVIEW_CACHE_AGE_MS = 24 * 60 * 60_000
const BANK_STATEMENT_WORKSPACE_CACHE_PREFIX = 'bank-statement-workspace:'
const BANK_STATEMENT_DRAFT_CACHE_PREFIX = 'bank-statement-draft:'
const BANK_STATEMENT_PREVIEW_CACHE_PREFIX = 'bank-statement-preview:'
const INITIAL_VISIBLE_ROWS = 60
const LARGE_FILE_WARNING_BYTES = 8 * 1024 * 1024

type BankStatementUploadClientProps = {
  initialCompanyId: string
  initialWorkspace: WorkspacePayload | null
  initialLayoutData: DashboardLayoutInitialData | null
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
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

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(parsed)
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
      return 'The system will try readable PDF text first and then OCR only when needed.'
    case 'image':
      return 'Clear statement photos work best. OCR will scan each visible row before matching.'
    case 'text':
      return 'Plain text rows will be scanned for date, amount, narration, and reference.'
    default:
      return 'Select a supported statement file to start verification.'
  }
}

function getProcessingMessage(kind: StatementDocumentKind | null, action: RouteAction): string {
  if (action === 'import') {
    return 'Posting mapped statement rows to the ledger.'
  }

  switch (kind) {
    case 'csv':
    case 'excel':
      return 'Reading structured rows and matching them against ERP payments.'
    case 'pdf':
      return 'Scanning PDF pages and matching recognized transactions.'
    case 'image':
      return 'Running OCR on the statement image and checking each row against ERP data.'
    case 'text':
      return 'Reading text lines and matching them against ERP data.'
    default:
      return 'Verifying uploaded statement against ERP payments.'
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

function getEntryTargetLabel(entry: StatementPreviewRow, selectedTargetOption?: SearchableSelectOption | null): string {
  return (
    entry.matchedTargetLabel ||
    entry.selectedTarget?.targetLabel ||
    selectedTargetOption?.label ||
    entry.suggestedTarget?.targetLabel ||
    '-'
  )
}

function getEntryRemark(entry: StatementPreviewRow, selectedTargetOption?: SearchableSelectOption | null): string {
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

  if (entry.mismatchReason) {
    return entry.mismatchReason
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

function buildAutoSelectionMap(entries: StatementPreviewRow[], currentSelections: Record<string, string>): Record<string, string> {
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

function validateSelectedFile(file: File): { kind: StatementDocumentKind | null; error?: string; warning?: string } {
  const kind = detectSelectedFileKind(file)

  if (!kind) {
    return {
      kind,
      error: 'Unsupported file type. Please upload PDF, Excel, CSV, text, or a statement image.'
    }
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return {
      kind,
      error: 'The selected file is empty. Please choose a valid bank statement file.'
    }
  }

  if (file.size >= LARGE_FILE_WARNING_BYTES && (kind === 'pdf' || kind === 'image')) {
    return {
      kind,
      warning: 'Large scanned files take longer to process. CSV or Excel uploads remain the fastest.'
    }
  }

  return { kind }
}

function buildDraftCacheKey(companyId: string): string {
  return `${BANK_STATEMENT_DRAFT_CACHE_PREFIX}${companyId}`
}

function buildWorkspaceCacheKey(companyId: string): string {
  return `${BANK_STATEMENT_WORKSPACE_CACHE_PREFIX}${companyId}`
}

function buildPreviewCacheKey(companyId: string, bankId: string, fileFingerprint: string): string {
  return `${BANK_STATEMENT_PREVIEW_CACHE_PREFIX}${companyId}:${bankId}:${fileFingerprint}`
}

function buildFileFingerprint(file: File | null): string {
  if (!file) return ''
  return `${normalizeText(file.name)}:${file.size}:${Number(file.lastModified || 0)}`
}

function buildPreviewStatusMessage(payload: StatementPayload): string {
  const entries = Array.isArray(payload.entries) ? payload.entries : []
  const matched = entries.filter((entry) => entry.status === 'settled' || entry.status === 'imported').length
  const unmatched = entries.filter((entry) => entry.status === 'unsettled').length
  const invalidRows = entries.filter((entry) => entry.status === 'invalid')
  const firstInvalid = invalidRows[0]

  if (firstInvalid) {
    return `Statement verified. ${matched} matched, ${unmatched} unmatched, ${invalidRows.length} unread. First issue: row ${firstInvalid.rowNo} ${firstInvalid.reason || 'could not be read'}.`
  }

  return `Statement verified. ${matched} matched and ${unmatched} unmatched row${unmatched === 1 ? '' : 's'} are ready for review.`
}

function getConfidencePercent(confidence: StatementTargetSelection['confidence'] | null | undefined): number {
  if (confidence === 'high') return 92
  if (confidence === 'medium') return 74
  if (confidence === 'low') return 58
  return 0
}

function averageConfidenceScore(rows: StatementPreviewRow[], resolver?: (row: StatementPreviewRow) => number | null): number {
  if (!rows.length) return 0
  const scores = rows
    .map((row) => (resolver ? resolver(row) : row.matchConfidenceScore ?? row.suggestedTarget?.confidenceScore ?? getConfidencePercent(row.suggestedTarget?.confidence)))
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0)

  if (!scores.length) return 0
  return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
}

function getFileLifecycleState(
  activeAction: RouteAction | null,
  hasPreview: boolean,
  selectedFile: File | null
): {
  label: string
  detail: string
  className: string
} {
  if (activeAction === 'preview') {
    return {
      label: 'Processing',
      detail: 'Parsing transactions...',
      className: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
    }
  }

  if (activeAction === 'import') {
    return {
      label: 'Finalizing',
      detail: 'Posting verified rows...',
      className: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
    }
  }

  if (hasPreview) {
    return {
      label: 'Ready',
      detail: 'Verified and ready for review',
      className: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
    }
  }

  if (selectedFile) {
    return {
      label: 'Queued',
      detail: 'Auto-detect bank format',
      className: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    }
  }

  return {
    label: 'Idle',
    detail: 'Waiting for upload',
    className: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
  }
}

function getToneClasses(tone: ToastTone | null): string {
  if (tone === 'error') return 'border-red-200 bg-red-50 text-red-800'
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-blue-200 bg-blue-50 text-blue-800'
}

function areSelectionMapsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => left[key] === right[key])
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function downloadTextFile(fileName: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function cloneFormData(source: FormData): FormData {
  const next = new FormData()

  source.forEach((value, key) => {
    if (value instanceof File) {
      next.append(key, value, value.name)
      return
    }

    next.append(key, value)
  })

  return next
}

function submitStatementRequest(
  formData: FormData,
  action: RouteAction,
  onProgress: (value: number) => void
): Promise<StatementPayload> {
  const performRequest = (allowRetry: boolean): Promise<StatementPayload> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/payments/bank-statement/import')
    xhr.withCredentials = true
    xhr.timeout = action === 'import' ? 120_000 : 90_000
    xhr.responseType = 'text'
    const csrfToken = getCsrfTokenScoped('app')
    if (csrfToken) {
      xhr.setRequestHeader('x-csrf-token', csrfToken)
    }
    xhr.setRequestHeader('x-requested-with', 'XMLHttpRequest')

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        onProgress(20)
        return
      }

      const nextValue = Math.max(8, Math.min(72, Math.round((event.loaded / event.total) * 72)))
      onProgress(nextValue)
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2) {
        onProgress(88)
      }
    }

    xhr.onload = () => {
      onProgress(100)
      const raw = typeof xhr.response === 'string' ? xhr.response : xhr.responseText
      let payload: StatementPayload = {}
      try {
        payload = raw ? (JSON.parse(raw) as StatementPayload) : {}
      } catch {
        payload = {}
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload)
        return
      }

      if (xhr.status === 403 && /invalid csrf token/i.test(String(payload.error || ''))) {
        if (!allowRetry) {
          reject(new Error('Upload security token expired. Refresh the page once and retry the bank statement upload.'))
          return
        }

        void fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include'
        })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error('Session refresh failed')
            }

            onProgress(12)
            return performRequest(false).then(resolve, reject)
          })
          .catch(() => {
            reject(new Error('Upload security token expired. Refresh the page once and retry the bank statement upload.'))
          })

        return
      }

      reject(new Error(payload.error || `Failed to ${action === 'preview' ? 'verify' : 'import'} bank statement`))
    }

    xhr.onerror = () => {
      reject(new Error('Network error while uploading the statement. Please retry.'))
    }

    xhr.ontimeout = () => {
      reject(new Error('Statement processing timed out. CSV and Excel uploads finish fastest.'))
    }

    xhr.send(cloneFormData(formData))
  })

  return performRequest(true)
}

function renderCsvValue(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function SummaryMetricCard({
  label,
  count,
  amount,
  tone,
  helpText
}: {
  label: string
  count: number
  amount: number
  tone: 'neutral' | 'matched' | 'unmatched'
  helpText: string
}) {
  const toneClasses =
    tone === 'matched'
      ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
      : tone === 'unmatched'
        ? 'border-rose-200 bg-rose-50/80 text-rose-900'
        : 'border-slate-200 bg-white text-slate-900'

  const badgeClasses =
    tone === 'matched'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'unmatched'
        ? 'bg-rose-100 text-rose-700'
        : 'bg-slate-100 text-slate-700'

  return (
    <div className={`rounded-2xl border p-3 ${toneClasses}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em]">{label}</p>
          <p className="mt-2 text-3xl font-bold">{count}</p>
          <p className="mt-1 text-sm font-medium">{formatCurrency(amount)}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badgeClasses}`}>{helpText}</span>
      </div>
    </div>
  )
}

function ToastStack({
  toasts,
  onDismiss
}: {
  toasts: ToastRecord[]
  onDismiss: (id: number) => void
}) {
  if (!toasts.length) return null

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-lg ${getToneClasses(toast.tone)}`}
        >
          <div className="flex items-start gap-3">
            {toast.tone === 'error' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : toast.tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{toast.title}</p>
              <p className="mt-1 text-sm">{toast.message}</p>
            </div>
            <button
              type="button"
              className="rounded-full p-1 transition hover:bg-black/5"
              onClick={() => onDismiss(toast.id)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function BankStatementUploadClient({
  initialCompanyId,
  initialWorkspace,
  initialLayoutData
}: BankStatementUploadClientProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const restoredDraftRef = useRef('')

  const [companyId, setCompanyId] = useState(initialCompanyId)
  const [loading, setLoading] = useState(!initialWorkspace && !initialCompanyId)
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(initialWorkspace)
  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceReloadNonce, setWorkspaceReloadNonce] = useState(0)
  const [selectedBankId, setSelectedBankId] = useState(initialWorkspace?.banks[0]?.id || '')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [result, setResult] = useState<StatementPayload | null>(null)
  const [manualTargets, setManualTargets] = useState<Record<string, string>>({})
  const [statusMessage, setStatusMessage] = useState('')
  const [statusTone, setStatusTone] = useState<ToastTone | null>(null)
  const [requestProgress, setRequestProgress] = useState(0)
  const [activeAction, setActiveAction] = useState<RouteAction | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [lastFailedAction, setLastFailedAction] = useState<RouteAction | null>(null)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [matchedOpen, setMatchedOpen] = useState(false)
  const [suggestedOpen, setSuggestedOpen] = useState(true)
  const [unmatchedOpen, setUnmatchedOpen] = useState(true)
  const [invalidOpen, setInvalidOpen] = useState(false)
  const [matchedVisibleCount, setMatchedVisibleCount] = useState(INITIAL_VISIBLE_ROWS)
  const [suggestedVisibleCount, setSuggestedVisibleCount] = useState(INITIAL_VISIBLE_ROWS)
  const [unmatchedVisibleCount, setUnmatchedVisibleCount] = useState(INITIAL_VISIBLE_ROWS)
  const [invalidVisibleCount, setInvalidVisibleCount] = useState(INITIAL_VISIBLE_ROWS)
  const [expandedRows, setExpandedRows] = useState<string[]>([])
  const [selectedUnmatchedIds, setSelectedUnmatchedIds] = useState<string[]>([])
  const [bulkTargetValue, setBulkTargetValue] = useState('')
  const [confirmPostOpen, setConfirmPostOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const [undoStack, setUndoStack] = useState<Array<{ manualTargets: Record<string, string>; summary: string }>>([])
  const [localActivity, setLocalActivity] = useState<ActivityRecord[]>([])
  const [lastSavedAt, setLastSavedAt] = useState('')
  const deferredSearchTerm = useDeferredValue(searchTerm)

  const verifyingStatement = activeAction === 'preview'
  const uploadingStatement = activeAction === 'import'

  const pushToast = (tone: ToastTone, title: string, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((current) => [...current, { id, tone, title, message }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 4500)
  }

  const appendActivity = (summary: string, extra?: Partial<ActivityRecord>) => {
    setLocalActivity((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        summary,
        source: 'local' as const,
        ...extra
      },
      ...current
    ].slice(0, 10))
  }

  const persistDraft = (showToast = false) => {
    if (!companyId || !result?.entries?.length) return

    const draft: DraftPayload = {
      selectedBankId,
      result,
      manualTargets,
      savedAt: new Date().toISOString()
    }

    setClientCache(buildDraftCacheKey(companyId), draft, { persist: true })
    setLastSavedAt(draft.savedAt)

    if (showToast) {
      pushToast('success', 'Reconciliation saved', 'This draft is saved in your browser and can be restored instantly.')
      appendActivity('Saved reconciliation draft')
    }
  }

  const persistPreviewCache = (
    file: File | null,
    nextBankId: string,
    nextResult: StatementPayload,
    nextManualTargets: Record<string, string>
  ) => {
    const fileFingerprint = buildFileFingerprint(file)
    if (!companyId || !nextBankId || !fileFingerprint || !nextResult?.entries?.length) {
      return
    }

    const payload: PreviewCachePayload = {
      selectedBankId: nextBankId,
      fileFingerprint,
      result: nextResult,
      manualTargets: nextManualTargets,
      savedAt: new Date().toISOString()
    }

    setClientCache(buildPreviewCacheKey(companyId, nextBankId, fileFingerprint), payload, { persist: true })
  }

  const clearCurrentWorkspace = (options: { clearFile?: boolean; clearDraft?: boolean; message?: string } = {}) => {
    if (options.clearDraft && companyId) {
      deleteClientCache(buildDraftCacheKey(companyId))
      setLastSavedAt('')
    }

    if (options.clearFile) {
      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    setResult(null)
    setManualTargets({})
    setUndoStack([])
    setExpandedRows([])
    setSelectedUnmatchedIds([])
    setBulkTargetValue('')
    if (options.message) {
      setStatusTone('info')
      setStatusMessage(options.message)
    } else {
      setStatusMessage('')
      setStatusTone(null)
    }
  }

  useEffect(() => {
    if (!initialCompanyId || !initialWorkspace) return
    setClientCache(buildWorkspaceCacheKey(initialCompanyId), initialWorkspace, { persist: true })
  }, [initialCompanyId, initialWorkspace])

  useEffect(() => {
    if (initialCompanyId) {
      setCompanyId(initialCompanyId)
      setLoading(false)
      return
    }

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
  }, [initialCompanyId, router])

  useEffect(() => {
    const onCompanyChanged = (event: Event) => {
      const nextCompanyId = (event as CustomEvent<{ companyId?: string }>).detail?.companyId?.trim() || ''
      if (!nextCompanyId || nextCompanyId === companyId) return
      restoredDraftRef.current = ''
      setWorkspace(null)
      setWorkspaceError('')
      setSelectedBankId('')
      setLocalActivity([])
      clearCurrentWorkspace({ clearFile: true, clearDraft: false })
      setCompanyId(nextCompanyId)
    }

    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    return () => {
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [companyId])

  const refreshWorkspace = useCallback(
    async (
      nextCompanyId: string,
      options: {
        force?: boolean
        background?: boolean
      } = {}
    ) => {
      if (!nextCompanyId) return null

      const cacheKey = buildWorkspaceCacheKey(nextCompanyId)
      if (!options.background) {
        setLoading(true)
      }

      try {
        const payload = await loadClientCachedValue<WorkspacePayload>(
          cacheKey,
          async () => {
            const response = await fetch(`/api/payments/bank-statement/workspace?companyId=${encodeURIComponent(nextCompanyId)}`, {
              cache: 'no-store'
            })
            const data = (await response.json().catch(() => ({}))) as Partial<WorkspacePayload> & { error?: string }
            if (!response.ok) {
              throw new Error(data.error || 'Failed to load bank reconciliation workspace.')
            }

            return {
              banks: Array.isArray(data.banks) ? data.banks : [],
              targets: Array.isArray(data.targets) ? data.targets : [],
              recentActivity: Array.isArray(data.recentActivity) ? data.recentActivity : []
            }
          },
          {
            maxAgeMs: BANK_STATEMENT_WORKSPACE_CACHE_AGE_MS,
            force: options.force
          }
        )

        setWorkspace(payload)
        setSelectedBankId((current) => {
          if (current && payload.banks.some((bank) => bank.id === current)) return current
          return payload.banks[0]?.id || ''
        })
        setWorkspaceError('')
        return payload
      } catch (error) {
        setWorkspaceError(error instanceof Error ? error.message : 'Failed to load bank reconciliation workspace.')
        return null
      } finally {
        if (!options.background) {
          setLoading(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    if (!companyId) return

    let cancelled = false
    const cacheKey = buildWorkspaceCacheKey(companyId)
    const initialPayload =
      companyId === initialCompanyId && initialWorkspace
        ? initialWorkspace
        : null
    const cached =
      getClientCachedValue<WorkspacePayload>(cacheKey, BANK_STATEMENT_WORKSPACE_CACHE_AGE_MS) ||
      initialPayload
    const shouldForceRefresh = workspaceReloadNonce > 0

    if (cached) {
      setWorkspace(cached)
      setSelectedBankId((current) => current || cached.banks[0]?.id || '')
      setWorkspaceError('')
      setLoading(false)
    } else {
      setLoading(true)
    }

    ;(async () => {
      try {
        const payload = await refreshWorkspace(companyId, {
          background: Boolean(cached) && !shouldForceRefresh,
          force: shouldForceRefresh
        })
        if (cancelled) return
        if (!payload) {
          return
        }
      } finally {
        if (!cancelled && shouldForceRefresh) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [companyId, initialCompanyId, initialWorkspace, refreshWorkspace, workspaceReloadNonce])

  useEffect(() => {
    if (!companyId) return

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refreshWorkspace(companyId, { background: true, force: true })
    }, 45_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [companyId, refreshWorkspace])

  useEffect(() => {
    if (!companyId || !workspace || restoredDraftRef.current === companyId) return

    restoredDraftRef.current = companyId
    const draft = getClientCachedValue<DraftPayload>(buildDraftCacheKey(companyId), BANK_STATEMENT_DRAFT_CACHE_AGE_MS)
    if (!draft?.result?.entries?.length) return

    setSelectedBankId(
      draft.selectedBankId && workspace.banks.some((bank) => bank.id === draft.selectedBankId)
        ? draft.selectedBankId
        : workspace.banks[0]?.id || ''
    )
    setResult(draft.result)
    setManualTargets(draft.manualTargets || {})
    setLastSavedAt(draft.savedAt)
    setStatusTone('info')
    setStatusMessage('Saved reconciliation draft restored. Reattach the same file only if you need to post the mapped rows.')
    pushToast('info', 'Draft restored', 'Your last reconciliation draft is back and ready for review.')
  }, [companyId, workspace])

  useEffect(() => {
    if (!companyId || !result?.entries?.length) return

    const timer = window.setTimeout(() => {
      persistDraft(false)
    }, 500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [companyId, selectedBankId, result, manualTargets])

  const banks = workspace?.banks || []
  const statementTargetOptions = workspace?.targets || []
  const statementTargetMap = useMemo(
    () => new Map(statementTargetOptions.map((option) => [option.value, option] as const)),
    [statementTargetOptions]
  )

  const selectedBank = useMemo(
    () => banks.find((bank) => bank.id === selectedBankId) || null,
    [banks, selectedBankId]
  )
  const selectedFileKind = useMemo(() => detectSelectedFileKind(selectedFile), [selectedFile])

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

  const summary = useMemo<StatementSummary>(() => {
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
  }, [entries, result])

  const amountSummary = useMemo(() => {
    const totalAmount = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    const matchedAmount = settledEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    const unmatchedAmount = unsettledEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)

    return {
      totalAmount,
      matchedAmount,
      unmatchedAmount
    }
  }, [entries, settledEntries, unsettledEntries])

  const readyToImportCount = useMemo(
    () => unsettledEntries.filter((entry) => Boolean(manualTargets[entry.externalId] || entry.selectedTarget)).length,
    [manualTargets, unsettledEntries]
  )

  const recognizedEntriesCount = settledEntries.length + unsettledEntries.length
  const reconciliationPercent = recognizedEntriesCount > 0 ? Math.round((settledEntries.length / recognizedEntriesCount) * 100) : 0
  const hasPreview = entries.length > 0
  const canUpload = Boolean(
    hasPreview &&
    readyToImportCount > 0 &&
    selectedFile &&
    !uploadingStatement &&
    !verifyingStatement
  )
  const activeDocumentName = result?.document?.fileName || selectedFile?.name || 'No document selected'
  const activeBank = result?.bank || selectedBank
  const documentStatus = getDocumentStatusMeta(result?.document, selectedFileKind)
  const selectedUnmatchedIdSet = useMemo(() => new Set(selectedUnmatchedIds), [selectedUnmatchedIds])

  const matchesRowSearch = (entry: StatementPreviewRow) => {
    const query = normalizeText(deferredSearchTerm).toLowerCase()
    if (!query) return true

    const selectedOption = statementTargetMap.get(manualTargets[entry.externalId] || '') || null
    const haystacks = [
      entry.description,
      entry.reference || '',
      entry.reason || '',
      entry.mismatchReason || '',
      getEntryTargetLabel(entry, selectedOption)
    ]

    return haystacks.some((value) => normalizeText(value).toLowerCase().includes(query))
  }

  const matchesDateRange = (entry: StatementPreviewRow) => {
    if (!entry.postedAt) return true
    if (dateFrom && entry.postedAt < dateFrom) return false
    if (dateTo && entry.postedAt > dateTo) return false
    return true
  }

  const filteredSettledEntries = useMemo(
    () => settledEntries.filter((entry) => matchesRowSearch(entry) && matchesDateRange(entry)),
    [settledEntries, deferredSearchTerm, dateFrom, dateTo, manualTargets, statementTargetMap]
  )

  const filteredUnsettledEntries = useMemo(() => {
    return unsettledEntries.filter((entry) => {
      if (!matchesRowSearch(entry) || !matchesDateRange(entry)) {
        return false
      }

      const hasSelectedTarget = Boolean(manualTargets[entry.externalId] || entry.selectedTarget)

      switch (reviewFilter) {
        case 'ready':
          return hasSelectedTarget
        case 'needs-target':
          return !hasSelectedTarget
        case 'suggested':
          return Boolean(entry.suggestedTarget)
        case 'amount-mismatch':
          return Boolean(entry.amountMismatch)
        default:
          return true
      }
    })
  }, [unsettledEntries, deferredSearchTerm, dateFrom, dateTo, reviewFilter, manualTargets, statementTargetMap])

  const suggestedEntries = useMemo(
    () =>
      filteredUnsettledEntries.filter(
        (entry) =>
          Boolean(entry.suggestedTarget) &&
          !manualTargets[entry.externalId] &&
          !entry.selectedTarget
      ),
    [filteredUnsettledEntries, manualTargets]
  )

  const reviewOnlyEntries = useMemo(
    () =>
      filteredUnsettledEntries.filter(
        (entry) =>
          !entry.suggestedTarget ||
          Boolean(manualTargets[entry.externalId]) ||
          Boolean(entry.selectedTarget)
      ),
    [filteredUnsettledEntries, manualTargets]
  )

  const filteredInvalidEntries = useMemo(() => {
    const query = normalizeText(deferredSearchTerm).toLowerCase()
    return invalidEntries.filter((entry) => {
      if (!query) return true
      return normalizeText(entry.reason).toLowerCase().includes(query) || String(entry.rowNo).includes(query)
    })
  }, [invalidEntries, deferredSearchTerm])

  useEffect(() => {
    setMatchedVisibleCount(INITIAL_VISIBLE_ROWS)
  }, [filteredSettledEntries.length])

  useEffect(() => {
    setSuggestedVisibleCount(INITIAL_VISIBLE_ROWS)
  }, [suggestedEntries.length])

  useEffect(() => {
    setUnmatchedVisibleCount(INITIAL_VISIBLE_ROWS)
    setSelectedUnmatchedIds((current) =>
      current.filter((id) => reviewOnlyEntries.some((entry) => entry.externalId === id))
    )
  }, [reviewOnlyEntries.length])

  useEffect(() => {
    setInvalidVisibleCount(INITIAL_VISIBLE_ROWS)
  }, [filteredInvalidEntries.length])

  const visibleSettledEntries = filteredSettledEntries.slice(0, matchedVisibleCount)
  const visibleSuggestedEntries = suggestedEntries.slice(0, suggestedVisibleCount)
  const visibleUnsettledEntries = reviewOnlyEntries.slice(0, unmatchedVisibleCount)
  const visibleInvalidEntries = filteredInvalidEntries.slice(0, invalidVisibleCount)

  const combinedActivity = useMemo(() => {
    const serverActivity = (workspace?.recentActivity || []).map((row) => ({
      ...row,
      source: 'server' as const
    }))

    return [...localActivity, ...serverActivity]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 8)
  }, [localActivity, workspace])

  const activeRequestLabel =
    activeAction === 'import'
      ? 'Posting to Ledger'
      : activeAction === 'preview'
        ? 'Verifying Statement'
        : ''

  const fileLifecycle = getFileLifecycleState(activeAction, hasPreview, selectedFile)
  const matchedConfidenceAverage = averageConfidenceScore(filteredSettledEntries)
  const suggestedConfidenceAverage = averageConfidenceScore(
    suggestedEntries,
    (row) => row.suggestedTarget?.confidenceScore ?? getConfidencePercent(row.suggestedTarget?.confidence)
  )
  const unresolvedAmount = amountSummary.unmatchedAmount
  const reconciliationDifference = unresolvedAmount
  const completedReconciliation = hasPreview && unsettledEntries.length === 0 && invalidEntries.length === 0

  const applyManualTargets = (next: Record<string, string>, summaryText: string) => {
    if (areSelectionMapsEqual(manualTargets, next)) return

    setUndoStack((current) => [...current.slice(-9), { manualTargets, summary: summaryText }])
    setManualTargets(next)
    if (result?.entries?.length) {
      persistPreviewCache(selectedFile, selectedBankId, result, next)
    }
    appendActivity(summaryText)
  }

  const handleUndoLastAction = () => {
    const latest = undoStack.at(-1)
    if (!latest) {
      pushToast('info', 'Nothing to undo', 'There is no mapping change left to undo.')
      return
    }

    setUndoStack((current) => current.slice(0, -1))
    setManualTargets(latest.manualTargets)
    appendActivity(`Undid action: ${latest.summary}`)
    pushToast('success', 'Last action undone', latest.summary)
  }

  const handleApplyAutoMatch = () => {
    const next = buildAutoSelectionMap(entries, manualTargets)
    applyManualTargets(next, 'Applied automatic target suggestions')
    pushToast('success', 'Auto-match applied', 'Suggested rows are now ready for posting.')
  }

  const handleApplySuggestionsToSelected = () => {
    if (!selectedUnmatchedIds.length) {
      pushToast('info', 'No rows selected', 'Select unmatched rows first to apply suggestions in bulk.')
      return
    }

    const next = { ...manualTargets }
    let changed = 0

    for (const entry of reviewOnlyEntries) {
      if (!selectedUnmatchedIdSet.has(entry.externalId) || !entry.suggestedTarget) continue
      next[entry.externalId] = encodeTargetSelection(entry.suggestedTarget)
      changed += 1
    }

    if (changed === 0) {
      pushToast('info', 'No suggestions available', 'The selected rows do not have suggestion candidates yet.')
      return
    }

    applyManualTargets(next, `Applied suggestions to ${changed} selected row${changed === 1 ? '' : 's'}`)
    pushToast('success', 'Suggestions applied', `${changed} row${changed === 1 ? '' : 's'} updated.`)
  }

  const handleApplyBulkTarget = () => {
    if (!bulkTargetValue) {
      pushToast('info', 'Select an ERP target', 'Choose an ERP account, party, or supplier for the selected rows.')
      return
    }

    if (!selectedUnmatchedIds.length) {
      pushToast('info', 'No rows selected', 'Select unmatched rows first to apply a bulk target.')
      return
    }

    const next = { ...manualTargets }
    let changed = 0

    for (const entry of reviewOnlyEntries) {
      if (!selectedUnmatchedIdSet.has(entry.externalId)) continue
      next[entry.externalId] = bulkTargetValue
      changed += 1
    }

    applyManualTargets(next, `Assigned one ERP target to ${changed} selected row${changed === 1 ? '' : 's'}`)
    pushToast('success', 'Bulk target applied', `${changed} row${changed === 1 ? '' : 's'} are ready to post.`)
  }

  const handleClearSelectedAssignments = () => {
    if (!selectedUnmatchedIds.length) {
      pushToast('info', 'No rows selected', 'Select unmatched rows first to clear their assignments.')
      return
    }

    const next = { ...manualTargets }
    let changed = 0

    for (const entry of reviewOnlyEntries) {
      if (!selectedUnmatchedIdSet.has(entry.externalId)) continue
      if (next[entry.externalId]) {
        delete next[entry.externalId]
        changed += 1
      }
    }

    if (changed === 0) {
      pushToast('info', 'Nothing to clear', 'The selected rows do not have saved assignments yet.')
      return
    }

    applyManualTargets(next, `Cleared assignments for ${changed} selected row${changed === 1 ? '' : 's'}`)
    pushToast('success', 'Assignments cleared', `${changed} row${changed === 1 ? '' : 's'} returned to review.`)
  }

  const handleSelectFile = (nextFile: File | null) => {
    if (!nextFile) return

    const validation = validateSelectedFile(nextFile)
    if (validation.error) {
      pushToast('error', 'File validation failed', validation.error)
      setStatusTone('error')
      setStatusMessage(validation.error)
      return
    }

    setSelectedFile(nextFile)
    const nextFingerprint = buildFileFingerprint(nextFile)
    const cachedPreview =
      companyId && selectedBankId && nextFingerprint
        ? getClientCachedValue<PreviewCachePayload>(
            buildPreviewCacheKey(companyId, selectedBankId, nextFingerprint),
            BANK_STATEMENT_PREVIEW_CACHE_AGE_MS
          )
        : null

    clearCurrentWorkspace({
      clearDraft: !cachedPreview,
      message:
        cachedPreview
          ? `Cached reconciliation restored for ${nextFile.name}. Review and post without waiting for a fresh scan.`
          : validation.warning || `${getDocumentKindLabel(validation.kind)} selected. ${getDocumentKindGuidance(validation.kind)}`
    })
    setStatusTone(cachedPreview ? 'success' : validation.warning ? 'info' : 'success')

    if (cachedPreview?.result?.entries?.length) {
      setResult(cachedPreview.result)
      setManualTargets(cachedPreview.manualTargets || {})
      setLastSavedAt(cachedPreview.savedAt)
      setSelectedBankId((current) => current || cachedPreview.selectedBankId || '')
      pushToast('success', 'Cached preview loaded', 'The last verified statement was restored instantly.')
      appendActivity('Restored cached statement preview', {
        fileName: nextFile.name,
        documentKind: cachedPreview.result.document?.kind
      })
      return
    }

    if (validation.warning) {
      pushToast('info', 'Large file detected', validation.warning)
    } else {
      pushToast('success', 'File ready', `${nextFile.name} is ready for verification.`)
    }
  }

  const submitStatement = async (action: RouteAction) => {
    if (!companyId) {
      const message = 'Company is not selected yet.'
      setStatusTone('error')
      setStatusMessage(message)
      pushToast('error', 'Company missing', message)
      return
    }

    if (!selectedBankId) {
      const message = 'Select the bank account before verifying the statement.'
      setStatusTone('error')
      setStatusMessage(message)
      pushToast('error', 'Bank required', message)
      return
    }

    if (!selectedFile) {
      const message = 'Choose the bank statement file first.'
      setStatusTone('error')
      setStatusMessage(message)
      pushToast('error', 'File required', message)
      return
    }

    if (action === 'import' && readyToImportCount === 0) {
      const message = 'Map at least one unmatched row before posting to ledger.'
      setStatusTone('error')
      setStatusMessage(message)
      pushToast('error', 'Nothing to post', message)
      return
    }

    const formData = new FormData()
    formData.set('companyId', normalizeText(companyId))
    formData.set('bankId', normalizeText(selectedBankId))
    formData.set('action', action)
    formData.set('file', selectedFile)
    formData.set('manualTargets', JSON.stringify(manualTargets))

    setActiveAction(action)
    setLastFailedAction(null)
    setRequestProgress(10)
    setStatusTone('info')
    setStatusMessage(getProcessingMessage(selectedFileKind, action))

    try {
      if (action === 'preview') {
        const previewCacheKey = buildPreviewCacheKey(companyId, selectedBankId, buildFileFingerprint(selectedFile))
        const cachedPreview = getClientCachedValue<PreviewCachePayload>(
          previewCacheKey,
          BANK_STATEMENT_PREVIEW_CACHE_AGE_MS
        )

        if (cachedPreview?.result?.entries?.length) {
          setResult(cachedPreview.result)
          setManualTargets(cachedPreview.manualTargets || {})
          setLastSavedAt(cachedPreview.savedAt)
          setSelectedUnmatchedIds([])
          setBulkTargetValue('')
          setStatusTone('success')
          setStatusMessage(buildPreviewStatusMessage(cachedPreview.result))
          setActiveAction(null)
          setRequestProgress(0)
          pushToast('success', 'Loaded from cache', 'The verified statement was restored instantly from the last scan.')
          return
        }
      }

      const payload = await submitStatementRequest(formData, action, setRequestProgress)
      setResult(payload)
      const nextSelections = buildAutoSelectionMap(payload.entries || [], manualTargets)
      setManualTargets(nextSelections)
      setSelectedUnmatchedIds([])
      setBulkTargetValue('')
      persistPreviewCache(selectedFile, selectedBankId, payload, nextSelections)

      if (action === 'preview') {
        setStatusTone('success')
        setStatusMessage(buildPreviewStatusMessage(payload))
        pushToast('success', 'Statement verified', 'Matched and unmatched sections are now ready for review.')
        appendActivity('Verified statement preview', {
          documentKind: payload.document?.kind,
          fileName: payload.document?.fileName
        })
      } else {
        const importedCount = Number(payload.summary?.imported || 0)
        const remainingUnsettled = Number(payload.summary?.unsettled || 0)
        invalidateAppDataCaches(companyId, ['payments'])
        notifyAppDataChanged({ companyId, scopes: ['payments'] })
        setStatusTone('success')
        setStatusMessage(
          importedCount > 0
            ? `${importedCount} row${importedCount === 1 ? '' : 's'} posted successfully. ${remainingUnsettled} row${remainingUnsettled === 1 ? '' : 's'} still need attention.`
            : 'No mapped rows were posted.'
        )
        pushToast(
          importedCount > 0 ? 'success' : 'info',
          importedCount > 0 ? 'Ledger updated' : 'Nothing posted',
          importedCount > 0
            ? `${importedCount} statement row${importedCount === 1 ? '' : 's'} were posted to the ledger.`
            : 'No mapped rows were available to post.'
        )
        appendActivity('Posted verified rows to ledger', {
          imported: importedCount,
          totalRows: payload.summary?.total || 0,
          documentKind: payload.document?.kind,
          fileName: payload.document?.fileName
        })
        void refreshWorkspace(companyId, { background: true, force: true })
      }
    } catch (error) {
      const fallback = action === 'preview' ? 'Failed to verify bank statement.' : 'Failed to import bank statement.'
      const rawMessage = error instanceof Error ? error.message : fallback
      const message = /timed out/i.test(rawMessage)
        ? `${rawMessage} Large scanned PDFs and images can take longer; CSV or Excel imports finish fastest.`
        : rawMessage
      setStatusTone('error')
      setStatusMessage(message)
      setLastFailedAction(action)
      pushToast('error', action === 'preview' ? 'Verification failed' : 'Posting failed', message)
      appendActivity(action === 'preview' ? 'Statement verification failed' : 'Ledger posting failed', {
        summary: message
      })
    } finally {
      setActiveAction(null)
      window.setTimeout(() => setRequestProgress(0), 600)
    }
  }

  const exportRowsToCsv = () => {
    if (!hasPreview) {
      pushToast('info', 'Nothing to export', 'Verify a statement first to export the reconciliation review.')
      return
    }

    const rows = [
      ['Section', 'Row', 'Date', 'Description', 'Reference', 'Debit', 'Credit', 'Status', 'ERP Target', 'Remark'],
      ...filteredSettledEntries.map((entry) => [
        'Matched',
        String(entry.rowNo),
        entry.postedAt,
        entry.description || '',
        entry.reference || '',
        entry.direction === 'out' ? String(entry.amount) : '',
        entry.direction === 'in' ? String(entry.amount) : '',
        entry.status,
        getEntryTargetLabel(entry),
        entry.reason || ''
      ]),
      ...filteredUnsettledEntries.map((entry) => {
        const selectedTarget = statementTargetMap.get(manualTargets[entry.externalId] || '') || null
        return [
          'Unmatched',
          String(entry.rowNo),
          entry.postedAt,
          entry.description || '',
          entry.reference || '',
          entry.direction === 'out' ? String(entry.amount) : '',
          entry.direction === 'in' ? String(entry.amount) : '',
          entry.status,
          getEntryTargetLabel(entry, selectedTarget),
          getEntryRemark(entry, selectedTarget)
        ]
      }),
      ...filteredInvalidEntries.map((entry) => [
        'Unread',
        String(entry.rowNo),
        '',
        '',
        '',
        '',
        '',
        'invalid',
        '',
        entry.reason || 'Could not read this row.'
      ])
    ]

    const csv = rows.map((row) => row.map((value) => renderCsvValue(String(value || ''))).join(',')).join('\n')
    downloadTextFile(
      `bank-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      'text/csv;charset=utf-8'
    )
    pushToast('success', 'CSV exported', 'The reconciliation report was downloaded as CSV.')
  }

  const exportRowsToPdf = () => {
    if (!hasPreview) {
      pushToast('info', 'Nothing to export', 'Verify a statement first to export the reconciliation review.')
      return
    }

    const allRows = [
      ...filteredSettledEntries.map((entry) => {
        const selectedTarget = statementTargetMap.get(manualTargets[entry.externalId] || '') || null
        return `
          <tr>
            <td>Matched</td>
            <td>${escapeHtml(String(entry.rowNo))}</td>
            <td>${escapeHtml(formatCompactStatementDate(entry.postedAt))}</td>
            <td>${escapeHtml(entry.description || '-')}</td>
            <td>${escapeHtml(entry.reference || '-')}</td>
            <td>${escapeHtml(getEntryDebitAmount(entry))}</td>
            <td>${escapeHtml(getEntryCreditAmount(entry))}</td>
            <td>${escapeHtml(entry.status)}</td>
            <td>${escapeHtml(getEntryTargetLabel(entry, selectedTarget))}</td>
            <td>${escapeHtml(getEntryRemark(entry, selectedTarget))}</td>
          </tr>
        `
      }),
      ...filteredUnsettledEntries.map((entry) => {
        const selectedTarget = statementTargetMap.get(manualTargets[entry.externalId] || '') || null
        return `
          <tr>
            <td>Unmatched</td>
            <td>${escapeHtml(String(entry.rowNo))}</td>
            <td>${escapeHtml(formatCompactStatementDate(entry.postedAt))}</td>
            <td>${escapeHtml(entry.description || '-')}</td>
            <td>${escapeHtml(entry.reference || '-')}</td>
            <td>${escapeHtml(getEntryDebitAmount(entry))}</td>
            <td>${escapeHtml(getEntryCreditAmount(entry))}</td>
            <td>${escapeHtml(entry.status)}</td>
            <td>${escapeHtml(getEntryTargetLabel(entry, selectedTarget))}</td>
            <td>${escapeHtml(getEntryRemark(entry, selectedTarget))}</td>
          </tr>
        `
      }),
      ...filteredInvalidEntries.map((entry) => `
        <tr>
          <td>Unread</td>
          <td>${escapeHtml(String(entry.rowNo))}</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>invalid</td>
          <td>-</td>
          <td>${escapeHtml(entry.reason || 'Could not read this row.')}</td>
        </tr>
      `)
    ].join('')

    const printWindow = window.open('', '_blank', 'noopener,noreferrer')
    if (!printWindow) {
      pushToast('error', 'Popup blocked', 'Allow popups for this site to export the PDF report.')
      return
    }

    const documentHtml = `
      <!doctype html>
      <html>
        <head>
          <title>Bank Reconciliation Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
            h1 { margin: 0 0 8px; font-size: 22px; }
            p { margin: 0 0 16px; color: #475569; }
            .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0 20px; }
            .summary-card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; }
            .summary-card strong { display: block; font-size: 20px; margin-top: 6px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #e2e8f0; padding: 8px; vertical-align: top; text-align: left; }
            th { background: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>Bank Reconciliation Report</h1>
          <p>${escapeHtml(activeDocumentName)} | ${escapeHtml(activeBank?.name || 'Bank not selected')}</p>
          <div class="summary">
            <div class="summary-card">
              <div>Total transactions</div>
              <strong>${recognizedEntriesCount}</strong>
              <div>${escapeHtml(formatCurrency(amountSummary.totalAmount))}</div>
            </div>
            <div class="summary-card">
              <div>Matched</div>
              <strong>${settledEntries.length}</strong>
              <div>${escapeHtml(formatCurrency(amountSummary.matchedAmount))}</div>
            </div>
            <div class="summary-card">
              <div>Unmatched</div>
              <strong>${unsettledEntries.length}</strong>
              <div>${escapeHtml(formatCurrency(amountSummary.unmatchedAmount))}</div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Section</th>
                <th>Row</th>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Status</th>
                <th>ERP Target</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>${allRows}</tbody>
          </table>
        </body>
      </html>
    `

    printWindow.document.open()
    printWindow.document.write(documentHtml)
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => {
      printWindow.print()
    }, 250)
  }

  if (loading) {
    return (
      <AppLoaderShell
        kind="bank"
        companyId={companyId}
        title="Preparing bank reconciliation"
        message="Loading bank accounts, ERP targets, and saved reconciliation activity."
      />
    )
  }

  return (
    <DashboardLayout companyId={companyId} initialData={initialLayoutData}>
      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />

      <Dialog open={confirmPostOpen} onOpenChange={setConfirmPostOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Post mapped rows to ledger?</DialogTitle>
            <DialogDescription>
              This will create ERP payment entries for the mapped unmatched rows and keep unmatched rows pending for later review.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-4">
              <span>Ready to post</span>
              <strong className="text-slate-950">{readyToImportCount}</strong>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Unmatched remaining</span>
              <strong className="text-slate-950">{Math.max(unsettledEntries.length - readyToImportCount, 0)}</strong>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Document</span>
              <strong className="truncate text-slate-950">{activeDocumentName}</strong>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPostOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmPostOpen(false)
                void submitStatement('import')
              }}
              disabled={!canUpload}
            >
              {uploadingStatement ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Post to Ledger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="min-h-full bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_24%),radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_22%),linear-gradient(180deg,#f8fbff_0%,#f8fafc_46%,#eef4ff_100%)] p-3 sm:p-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-3">
          <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/70 p-4 shadow-[0_16px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="absolute" />
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">
                  <span>Intelligent finance workspace</span>
                  {result?.document?.parser ? (
                    <Badge variant="outline" className="border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700 hover:bg-sky-50">
                      Parser: {result.document.parser}
                    </Badge>
                  ) : null}
                </div>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Bank Reconciliation Workspace</h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Upload, auto-match, review and finalize transactions with one intelligent reconciliation flow.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-slate-700 ring-1 ring-inset ring-slate-200">
                    <Landmark className="h-4 w-4 text-emerald-600" />
                    <span className="max-w-[220px] truncate">{activeBank?.name || 'Bank not selected'}</span>
                  </span>
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${fileLifecycle.className}`}>
                    {fileLifecycle.label}
                  </span>
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${documentStatus.className}`}>
                    {documentStatus.label}
                  </span>
                  {lastSavedAt ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-slate-700 ring-1 ring-inset ring-slate-200">
                      <Clock3 className="h-4 w-4" />
                      Updated {formatDateTime(lastSavedAt)}
                    </span>
                  ) : null}
                  {selectedFile ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-slate-700 ring-1 ring-inset ring-slate-200">
                      <FileText className="h-4 w-4 text-slate-500" />
                      <span className="max-w-[240px] truncate">{selectedFile.name}</span>
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 text-xs font-medium text-slate-500">{fileLifecycle.detail}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => router.push('/payment/dashboard')}>
                  View History
                </Button>
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Upload New
                </Button>
                <Button size="sm" variant="outline" onClick={() => router.push('/main/dashboard')}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Dashboard
                </Button>
              </div>
            </div>
          </div>

          {workspaceError ? (
            <Card className="border-red-200 bg-white shadow-sm">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
                  <div>
                    <p className="font-semibold text-red-900">Workspace could not be loaded</p>
                    <p className="mt-1 text-sm text-red-700">{workspaceError}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    deleteClientCache(buildWorkspaceCacheKey(companyId))
                    setWorkspace(null)
                    setWorkspaceError('')
                    setLoading(true)
                    setWorkspaceReloadNonce((current) => current + 1)
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
            <Card className="overflow-hidden border-slate-200 bg-white/90 shadow-[0_12px_32px_rgba(15,23,42,0.06)] backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-slate-950">Upload & Processing Panel</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {banks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                    <p className="text-sm text-slate-700">No bank master is configured for this company yet.</p>
                    <Button className="mt-4" onClick={() => router.push('/master/bank')}>
                      Add Bank Master
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-[240px_1fr]">
                      <div className="grid gap-2">
                        <Label htmlFor="bankId">Bank account</Label>
                        <Select
                          value={selectedBankId}
                          onValueChange={(value) => {
                            setSelectedBankId(value)
                            clearCurrentWorkspace({
                              clearDraft: false,
                              message: 'Bank changed. Verify the statement again for the selected bank.'
                            })
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
                        <Label htmlFor="statementFile">Statement file</Label>
                        <input
                          ref={fileInputRef}
                          id="statementFile"
                          type="file"
                          accept=".csv,.txt,.xls,.xlsx,.pdf,.jpg,.jpeg,.png,.webp,.bmp,.gif,.tif,.tiff,image/*"
                          className="hidden"
                          onChange={(event) => handleSelectFile(event.target.files?.[0] || null)}
                        />
                        <button
                          type="button"
                          className={`group flex min-h-[164px] flex-col items-start justify-between rounded-[24px] border border-dashed p-4 text-left transition ${
                            dragActive
                              ? 'border-sky-400 bg-sky-50 shadow-[0_12px_28px_rgba(14,165,233,0.16)]'
                              : 'border-slate-300 bg-[linear-gradient(145deg,#ffffff_0%,#f8fbff_100%)] hover:border-sky-300 hover:shadow-[0_12px_28px_rgba(59,130,246,0.08)]'
                          }`}
                          onClick={() => fileInputRef.current?.click()}
                          onDragEnter={(event) => {
                            event.preventDefault()
                            setDragActive(true)
                          }}
                          onDragOver={(event) => {
                            event.preventDefault()
                            setDragActive(true)
                          }}
                          onDragLeave={(event) => {
                            event.preventDefault()
                            setDragActive(false)
                          }}
                          onDrop={(event) => {
                            event.preventDefault()
                            setDragActive(false)
                            handleSelectFile(event.dataTransfer.files?.[0] || null)
                          }}
                        >
                          <div>
                            <p className="text-base font-semibold text-slate-950">Drop bank statement here</p>
                            <p className="mt-1 text-sm text-slate-600">
                              Auto-detect bank format, parse transactions in background, and restore cached previews instantly.
                            </p>
                          </div>

                          {selectedFile ? (
                            <div className="w-full rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-slate-950">{selectedFile.name}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {getDocumentKindLabel(selectedFileKind)} | {formatFileSize(selectedFile.size)}
                                  </p>
                                  <p className="mt-1 text-xs text-sky-700">{fileLifecycle.detail}</p>
                                </div>
                                <Badge variant="outline" className={`hover:bg-transparent ${fileLifecycle.className}`}>
                                  {fileLifecycle.label}
                                </Badge>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-xl bg-white px-3 py-2 text-xs text-slate-500 shadow-sm">
                              Idle now. PDF, Excel, and CSV are supported.
                            </div>
                          )}
                        </button>
                      </div>
                    </div>

                    {selectedBank ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">{selectedBank.name}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              Branch: {selectedBank.branch || 'N/A'} | Account No: {selectedBank.accountNumber || 'N/A'} | IFSC: {selectedBank.ifscCode || 'N/A'}
                            </p>
                          </div>
                          <Badge variant="outline" className="border-slate-200 bg-white text-slate-700 hover:bg-white">
                            Company bank
                          </Badge>
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => void submitStatement('preview')}
                        disabled={!selectedBankId || !selectedFile || verifyingStatement || uploadingStatement}
                      >
                        {verifyingStatement ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}
                        {verifyingStatement ? 'Verifying...' : 'Verify Statement'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => clearCurrentWorkspace({ clearDraft: true, clearFile: true })}
                        disabled={!selectedFile && !hasPreview}
                      >
                        Clear
                      </Button>
                    </div>

                    {activeAction ? (
                      <div className="rounded-2xl border border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,1)_0%,rgba(255,255,255,0.95)_100%)] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <Loader2 className="h-4 w-4 animate-spin text-sky-700" />
                            <div>
                              <p className="font-semibold text-sky-900">{activeRequestLabel}</p>
                              <p className="text-sm text-sky-700">
                                {activeAction === 'preview' ? 'Auto-detecting bank format and parsing transactions…' : getProcessingMessage(selectedFileKind, activeAction)}
                              </p>
                            </div>
                          </div>
                          <span className="text-sm font-semibold text-sky-900">{requestProgress}%</span>
                        </div>
                        <Progress value={requestProgress} className="mt-3 h-2 bg-sky-100 [&_[data-slot='progress-indicator']]:bg-sky-600" />
                      </div>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-slate-200 bg-white/90 shadow-[0_12px_32px_rgba(15,23,42,0.06)] backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-slate-950">Reconciliation Intelligence Panel</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <SummaryMetricCard
                  label="Matched"
                  count={settledEntries.length}
                  amount={amountSummary.matchedAmount}
                  tone="matched"
                  helpText={`${matchedConfidenceAverage || reconciliationPercent}% confidence`}
                />
                <SummaryMetricCard
                  label="Suggested"
                  count={suggestedEntries.length}
                  amount={suggestedEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)}
                  tone="neutral"
                  helpText={`${suggestedConfidenceAverage || 0}% confidence`}
                />
                <SummaryMetricCard
                  label="Unmatched"
                  count={reviewOnlyEntries.length}
                  amount={reviewOnlyEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)}
                  tone="unmatched"
                  helpText="Needs review"
                />

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Completion</p>
                      <p className="mt-1 text-xl font-bold text-slate-950">{reconciliationPercent}% reconciled</p>
                      <p className="mt-1 text-xs text-slate-500">Total transactions: {recognizedEntriesCount}</p>
                    </div>
                    <div className="grid gap-2 text-sm text-slate-600">
                      <div className="flex items-center justify-between gap-3">
                        <span>Matched amount</span>
                        <strong className="text-slate-950">{formatCurrency(amountSummary.matchedAmount)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Unmatched amount</span>
                        <strong className="text-slate-950">{formatCurrency(amountSummary.unmatchedAmount)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Difference</span>
                        <strong className="text-slate-950">{formatCurrency(reconciliationDifference)}</strong>
                      </div>
                    </div>
                  </div>
                  <Progress value={reconciliationPercent} className="mt-3 h-2 bg-slate-200 [&_[data-slot='progress-indicator']]:bg-emerald-600" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-slate-200 bg-white text-slate-700 hover:bg-white">
                      Ready to post: {readyToImportCount}
                    </Badge>
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
                      Unread rows: {summary.errors}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {completedReconciliation ? (
            <Card className="overflow-hidden border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,1)_0%,rgba(255,255,255,0.98)_100%)] shadow-[0_12px_28px_rgba(16,185,129,0.12)]">
              <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Reconciliation Completed</p>
                  <h2 className="mt-2 text-2xl font-bold text-slate-950">Everything is reconciled 🎉</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {settledEntries.length} row{settledEntries.length === 1 ? '' : 's'} are matched or posted, and there are no remaining review issues.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={exportRowsToPdf}>
                    <FileText className="mr-2 h-4 w-4" />
                    Download report
                  </Button>
                  <Button onClick={() => setConfirmPostOpen(true)} disabled={!canUpload}>
                    <Upload className="mr-2 h-4 w-4" />
                    Post to ledger
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="sticky top-3 z-20 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <Badge variant="outline" className="border-slate-200 bg-slate-50 hover:bg-slate-50">
                Rows not read: {summary.errors}
              </Badge>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 hover:bg-slate-50">
                Ready to post: {readyToImportCount}
              </Badge>
              {selectedFile ? (
                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50">
                  Cached fingerprint: {buildFileFingerprint(selectedFile).slice(0, 28)}...
                </Badge>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => persistDraft(true)} disabled={!hasPreview}>
                <Save className="mr-2 h-4 w-4" />
                Save Reconciliation
              </Button>
              <Button variant="outline" onClick={handleApplyAutoMatch} disabled={!unsettledEntries.length}>
                <Wand2 className="mr-2 h-4 w-4" />
                Auto Match
              </Button>
              <Button variant="outline" onClick={handleUndoLastAction} disabled={!undoStack.length}>
                <Undo2 className="mr-2 h-4 w-4" />
                Undo
              </Button>
              <Button variant="outline" onClick={exportRowsToCsv} disabled={!hasPreview}>
                <Download className="mr-2 h-4 w-4" />
                CSV
              </Button>
              <Button variant="outline" onClick={exportRowsToPdf} disabled={!hasPreview}>
                <FileText className="mr-2 h-4 w-4" />
                PDF
              </Button>
              <Button
                onClick={() => setConfirmPostOpen(true)}
                disabled={!canUpload}
              >
                <Upload className="mr-2 h-4 w-4" />
                {uploadingStatement ? 'Posting...' : 'Post to Ledger'}
              </Button>
            </div>
          </div>

          {statusMessage ? (
            <div className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${getToneClasses(statusTone)}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {statusTone === 'error' ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : statusTone === 'success' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <p>{statusMessage}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {lastFailedAction && selectedFile ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-current bg-white/80"
                      onClick={() => void submitStatement(lastFailedAction)}
                    >
                      Retry
                    </Button>
                  ) : null}
                  {hasPreview ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-current"
                      onClick={() => clearCurrentWorkspace({ clearDraft: true, clearFile: true })}
                    >
                      Clear review
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="grid gap-3 p-4 lg:grid-cols-[1.1fr_0.9fr_0.9fr_0.8fr]">
              <div className="grid gap-2">
                <Label htmlFor="statement-search">Search transactions</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="statement-search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Description, reference, target, reason..."
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="date-from">Date from</Label>
                <Input id="date-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="date-to">Date to</Label>
                <Input id="date-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="review-filter">Review focus</Label>
                <Select value={reviewFilter} onValueChange={(value) => setReviewFilter(value as ReviewFilter)}>
                  <SelectTrigger id="review-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All unmatched rows</SelectItem>
                    <SelectItem value="ready">Ready to post</SelectItem>
                    <SelectItem value="needs-target">Needs ERP target</SelectItem>
                    <SelectItem value="suggested">Has suggestion</SelectItem>
                    <SelectItem value="amount-mismatch">Mismatched amount only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid gap-3">
              <Collapsible open={matchedOpen} onOpenChange={setMatchedOpen}>
                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader className="p-0">
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between gap-4 px-5 py-4 text-left">
                        <div className="flex items-center gap-3">
                          <span className="rounded-full bg-emerald-100 p-2 text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" />
                          </span>
                          <div>
                            <CardTitle className="text-base text-slate-950">Matched transactions</CardTitle>
                            <p className="mt-1 text-sm text-slate-500">
                              {filteredSettledEntries.length} row{filteredSettledEntries.length === 1 ? '' : 's'} | {formatCurrency(filteredSettledEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0))}
                            </p>
                          </div>
                        </div>
                        {matchedOpen ? <ChevronDown className="h-5 w-5 text-slate-400" /> : <ChevronRight className="h-5 w-5 text-slate-400" />}
                      </div>
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent className="p-0">
                      <div className="max-h-[32rem] overflow-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-slate-50">
                          <TableRow>
                            <TableHead className="w-[44px] px-3"> </TableHead>
                            <TableHead className="px-3 text-[11px] uppercase tracking-wide text-slate-500">Date</TableHead>
                            <TableHead className="px-3 text-[11px] uppercase tracking-wide text-slate-500">Narration</TableHead>
                            <TableHead className="px-3 text-[11px] uppercase tracking-wide text-slate-500">Amount</TableHead>
                            <TableHead className="px-3 text-[11px] uppercase tracking-wide text-slate-500">Status</TableHead>
                            <TableHead className="px-3 text-[11px] uppercase tracking-wide text-slate-500">ERP target</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleSettledEntries.map((entry) => {
                            const expanded = expandedRows.includes(`matched:${entry.externalId || entry.rowNo}`)
                            return (
                              <Fragment key={`matched-${entry.externalId || entry.rowNo}`}>
                                <TableRow className="bg-white">
                                  <TableCell className="px-3 py-2">
                                    <button
                                      type="button"
                                      className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100"
                                      onClick={() => {
                                        const key = `matched:${entry.externalId || entry.rowNo}`
                                        setExpandedRows((current) =>
                                          current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
                                        )
                                      }}
                                    >
                                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                  </TableCell>
                                  <TableCell className="px-3 py-2 text-sm">
                                    <div className="font-medium text-slate-900">{formatCompactStatementDate(entry.postedAt)}</div>
                                    <div className="text-xs text-slate-500">Row {entry.rowNo}</div>
                                  </TableCell>
                                  <TableCell className="max-w-[260px] px-3 py-2 text-sm text-slate-700">
                                    <div className="truncate font-medium">{entry.description || '-'}</div>
                                    <div className="truncate text-xs text-slate-500">{entry.reference || 'No reference'}</div>
                                  </TableCell>
                                  <TableCell className="px-3 py-2 text-sm font-semibold text-slate-900">
                                    {entry.direction === 'out' ? getEntryDebitAmount(entry) : getEntryCreditAmount(entry)}
                                  </TableCell>
                                  <TableCell className="px-3 py-2">
                                    <Badge
                                      className={
                                        entry.status === 'imported'
                                          ? 'bg-blue-100 text-blue-700 hover:bg-blue-100'
                                          : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                                      }
                                    >
                                      {entry.status === 'imported' ? 'Posted' : 'Matched'}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="max-w-[240px] px-3 py-2 text-sm text-slate-700">
                                    <div className="truncate">{getEntryTargetLabel(entry)}</div>
                                  </TableCell>
                                </TableRow>
                                {expanded ? (
                                  <TableRow>
                                    <TableCell colSpan={6} className="bg-slate-50 px-5 py-4 text-sm text-slate-600">
                                      <div className="grid gap-3 md:grid-cols-3">
                                        <div>
                                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reference</p>
                                          <p className="mt-1">{entry.reference || 'No reference'}</p>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remark</p>
                                          <p className="mt-1">{getEntryRemark(entry)}</p>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target</p>
                                          <p className="mt-1">{getEntryTargetLabel(entry)}</p>
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </Fragment>
                            )
                          })}
                          {!visibleSettledEntries.length ? (
                            <TableRow>
                              <TableCell colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                                Matched rows will appear here after statement verification.
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </TableBody>
                      </Table>
                      </div>
                      {filteredSettledEntries.length > visibleSettledEntries.length ? (
                        <div className="border-t border-slate-100 px-5 py-4">
                          <Button variant="outline" size="sm" onClick={() => setMatchedVisibleCount((current) => current + INITIAL_VISIBLE_ROWS)}>
                            Show more matched rows
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              <Collapsible open={suggestedOpen} onOpenChange={setSuggestedOpen}>
                <Card className="border-amber-200 bg-white shadow-sm">
                  <CardHeader className="p-0">
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between gap-4 px-5 py-4 text-left">
                        <div className="flex items-center gap-3">
                          <span className="rounded-full bg-amber-100 p-2 text-amber-700">
                            <Wand2 className="h-4 w-4" />
                          </span>
                          <div>
                            <CardTitle className="text-base text-slate-950">Suggested matches</CardTitle>
                            <p className="mt-1 text-sm text-slate-500">
                              {suggestedEntries.length} row{suggestedEntries.length === 1 ? '' : 's'} | {formatCurrency(suggestedEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0))}
                            </p>
                          </div>
                        </div>
                        {suggestedOpen ? <ChevronDown className="h-5 w-5 text-slate-400" /> : <ChevronRight className="h-5 w-5 text-slate-400" />}
                      </div>
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent className="grid gap-3 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-sm">
                        <div>
                          <p className="font-semibold text-amber-900">AI-assisted suggestions</p>
                          <p className="mt-1 text-amber-700">One click accepts the suggested ERP target. Suggestions stay separate from rows that still need manual review.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className="border-amber-200 bg-white text-amber-700 hover:bg-white">
                            Avg confidence: {suggestedConfidenceAverage || 0}%
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const next = { ...manualTargets }
                              let changed = 0
                              for (const entry of suggestedEntries) {
                                if (!entry.suggestedTarget) continue
                                next[entry.externalId] = encodeTargetSelection(entry.suggestedTarget)
                                changed += 1
                              }
                              if (changed > 0) {
                                applyManualTargets(next, `Accepted ${changed} suggested match${changed === 1 ? '' : 'es'}`)
                                pushToast('success', 'Suggestions accepted', `${changed} suggested row${changed === 1 ? '' : 's'} are now ready.`)
                              }
                            }}
                            disabled={!suggestedEntries.length}
                          >
                            <Wand2 className="mr-2 h-4 w-4" />
                            Accept all
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-3">
                        {visibleSuggestedEntries.map((entry) => {
                          const suggestion = entry.suggestedTarget
                          const confidenceScore = suggestion?.confidenceScore ?? getConfidencePercent(suggestion?.confidence)
                          return (
                            <div key={`suggested-${entry.externalId}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_auto] lg:items-center">
                                <div className="rounded-2xl bg-slate-50 p-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bank entry</p>
                                  <p className="mt-2 text-sm font-semibold text-slate-950">{entry.description || 'Statement row'}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {formatCompactStatementDate(entry.postedAt)} • {entry.reference || 'No reference'}
                                  </p>
                                  <p className="mt-2 text-base font-bold text-slate-950">
                                    {entry.direction === 'out' ? getEntryDebitAmount(entry) : getEntryCreditAmount(entry)}
                                  </p>
                                </div>
                                <div className="flex flex-col items-center justify-center gap-2 text-center">
                                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Suggested match</Badge>
                                  <div className="text-2xl font-bold text-amber-700">{confidenceScore}%</div>
                                  <div className="text-xs text-slate-500">confidence</div>
                                </div>
                                <div className="rounded-2xl bg-amber-50/60 p-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Ledger target</p>
                                  <p className="mt-2 text-sm font-semibold text-slate-950">{suggestion?.targetLabel || 'No suggestion'}</p>
                                  <p className="mt-1 text-xs text-slate-500">{suggestion?.reason || entry.reason || 'No matching explanation available.'}</p>
                                </div>
                                <div className="flex flex-wrap gap-2 lg:flex-col">
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      if (!entry.suggestedTarget) return
                                      applyManualTargets(
                                        {
                                          ...manualTargets,
                                          [entry.externalId]: encodeTargetSelection(entry.suggestedTarget)
                                        },
                                        `Accepted suggestion for row ${entry.rowNo}`
                                      )
                                    }}
                                  >
                                    Match
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setReviewFilter('needs-target')
                                      setUnmatchedOpen(true)
                                      pushToast('info', 'Moved to review queue', `Row ${entry.rowNo} remains unmatched and needs manual review.`)
                                    }}
                                  >
                                    Needs Review
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )
                        })}

                        {!visibleSuggestedEntries.length ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">
                            No suggestion candidates are waiting right now. Unmatched rows without suggestions stay in the red review queue below.
                          </div>
                        ) : null}
                      </div>

                      {suggestedEntries.length > visibleSuggestedEntries.length ? (
                        <div className="border-t border-slate-100 pt-4">
                          <Button variant="outline" size="sm" onClick={() => setSuggestedVisibleCount((current) => current + INITIAL_VISIBLE_ROWS)}>
                            Show more suggestions
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              <Collapsible open={unmatchedOpen} onOpenChange={setUnmatchedOpen}>
                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader className="p-0">
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between gap-4 px-5 py-4 text-left">
                        <div className="flex items-center gap-3">
                          <span className="rounded-full bg-rose-100 p-2 text-rose-700">
                            <AlertTriangle className="h-4 w-4" />
                          </span>
                          <div>
                            <CardTitle className="text-base text-slate-950">Unmatched transactions</CardTitle>
                            <p className="mt-1 text-sm text-slate-500">
                              {reviewOnlyEntries.length} row{reviewOnlyEntries.length === 1 ? '' : 's'} | {formatCurrency(reviewOnlyEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0))}
                            </p>
                          </div>
                        </div>
                        {unmatchedOpen ? <ChevronDown className="h-5 w-5 text-slate-400" /> : <ChevronRight className="h-5 w-5 text-slate-400" />}
                      </div>
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent className="grid gap-3 p-3">
                      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 lg:grid-cols-[auto_minmax(0,1fr)_220px_auto_auto] lg:items-center">
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          <input
                            type="checkbox"
                            checked={
                              visibleUnsettledEntries.length > 0 &&
                              visibleUnsettledEntries.every((entry) => selectedUnmatchedIdSet.has(entry.externalId))
                            }
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelectedUnmatchedIds(Array.from(new Set([
                                  ...selectedUnmatchedIds,
                                  ...visibleUnsettledEntries.map((entry) => entry.externalId)
                                ])))
                              } else {
                                const visibleIds = new Set(visibleUnsettledEntries.map((entry) => entry.externalId))
                                setSelectedUnmatchedIds((current) => current.filter((id) => !visibleIds.has(id)))
                              }
                            }}
                          />
                          Select visible rows
                        </label>
                        <SearchableSelect
                          id="bulkTarget"
                          value={bulkTargetValue}
                          onValueChange={setBulkTargetValue}
                          options={statementTargetOptions}
                          placeholder="Bulk assign ERP target"
                          searchPlaceholder="Search ERP target..."
                          emptyText="No targets found."
                          triggerClassName="bg-white"
                        />
                        <div className="text-sm text-slate-500">
                          {selectedUnmatchedIds.length} selected | {readyToImportCount} ready to post
                        </div>
                        <Button variant="outline" size="sm" onClick={handleApplySuggestionsToSelected}>
                          <Wand2 className="mr-2 h-4 w-4" />
                          Use suggestions
                        </Button>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={handleApplyBulkTarget}>
                            Apply target
                          </Button>
                          <Button variant="ghost" size="sm" onClick={handleClearSelectedAssignments}>
                            Clear
                          </Button>
                        </div>
                      </div>

                      <div className="max-h-[42rem] overflow-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-slate-50">
                          <TableRow>
                            <TableHead className="w-[42px] px-3" />
                            <TableHead className="w-[42px] px-3" />
                            <TableHead className="px-3 text-[11px] uppercase tracking-wide text-slate-500">Date</TableHead>
                            <TableHead className="px-3 text-[11px] uppercase tracking-wide text-slate-500">Narration</TableHead>
                            <TableHead className="px-3 text-[11px] uppercase tracking-wide text-slate-500">Amount</TableHead>
                            <TableHead className="px-3 text-[11px] uppercase tracking-wide text-slate-500">ERP target</TableHead>
                            <TableHead className="px-3 text-[11px] uppercase tracking-wide text-slate-500">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleUnsettledEntries.map((entry) => {
                            const selectedTarget = statementTargetMap.get(manualTargets[entry.externalId] || '') || null
                            const expanded = expandedRows.includes(`unmatched:${entry.externalId}`)
                            const isChecked = selectedUnmatchedIdSet.has(entry.externalId)
                            const hasSelectedTarget = Boolean(selectedTarget || entry.selectedTarget)
                            const suggestionConfidence = entry.suggestedTarget?.confidence || null

                            return (
                              <Fragment key={entry.externalId}>
                                <TableRow className="bg-white">
                                  <TableCell className="px-3 py-2">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(event) => {
                                        if (event.target.checked) {
                                          setSelectedUnmatchedIds((current) => Array.from(new Set([...current, entry.externalId])))
                                        } else {
                                          setSelectedUnmatchedIds((current) => current.filter((id) => id !== entry.externalId))
                                        }
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell className="px-3 py-2">
                                    <button
                                      type="button"
                                      className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100"
                                      onClick={() => {
                                        const key = `unmatched:${entry.externalId}`
                                        setExpandedRows((current) =>
                                          current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
                                        )
                                      }}
                                    >
                                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                  </TableCell>
                                  <TableCell className="px-3 py-2 text-sm">
                                    <div className="font-medium text-slate-900">{formatCompactStatementDate(entry.postedAt)}</div>
                                    <div className="text-xs text-slate-500">Row {entry.rowNo}</div>
                                  </TableCell>
                                  <TableCell className="max-w-[260px] px-3 py-2 text-sm text-slate-700">
                                    <div className="truncate font-medium">{entry.description || 'Unrecognized statement row'}</div>
                                    <div className="truncate text-xs text-slate-500">{entry.reference || 'No reference'}</div>
                                  </TableCell>
                                  <TableCell className="px-3 py-2 text-sm font-semibold text-slate-900">
                                    {entry.direction === 'out' ? getEntryDebitAmount(entry) : getEntryCreditAmount(entry)}
                                  </TableCell>
                                  <TableCell className="min-w-[250px] max-w-[250px] px-3 py-2 text-sm text-slate-700">
                                    <div className="truncate font-medium text-slate-900">
                                      {getEntryTargetLabel(entry, selectedTarget)}
                                    </div>
                                    <div className="truncate text-xs text-slate-500">
                                      {selectedTarget?.label
                                        ? 'Assigned target'
                                        : entry.suggestedTarget?.targetLabel
                                          ? 'Suggestion available'
                                          : 'Open row to choose ERP target'}
                                    </div>
                                  </TableCell>
                                  <TableCell className="px-3 py-2">
                                    <div className="flex flex-wrap gap-2">
                                      {hasSelectedTarget ? (
                                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Ready</Badge>
                                      ) : (
                                        <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50">
                                          Review
                                        </Badge>
                                      )}
                                      {entry.amountMismatch ? (
                                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
                                          Amount mismatch
                                        </Badge>
                                      ) : null}
                                      {suggestionConfidence ? (
                                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                                          Suggestion {suggestionConfidence}
                                          </Badge>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                </TableRow>
                                {expanded ? (
                                  <TableRow>
                                    <TableCell colSpan={7} className="bg-slate-50 px-5 py-4 text-sm text-slate-600">
                                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_1fr_1fr_auto]">
                                        <div>
                                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">ERP target</p>
                                          <div className="mt-2">
                                            <SearchableSelect
                                              id={`statement-target-${entry.externalId}`}
                                              value={manualTargets[entry.externalId] || ''}
                                              onValueChange={(value) => {
                                                applyManualTargets(
                                                  {
                                                    ...manualTargets,
                                                    [entry.externalId]: value
                                                  },
                                                  `Mapped row ${entry.rowNo} to ${statementTargetMap.get(value)?.label || 'ERP target'}`
                                                )
                                              }}
                                              options={statementTargetOptions}
                                              placeholder="Select ERP target"
                                              searchPlaceholder="Search account, party, or supplier..."
                                              emptyText="No ERP targets found."
                                              triggerClassName="h-9 rounded-lg border-slate-200 bg-white text-xs shadow-none"
                                            />
                                          </div>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remark</p>
                                          <p className="mt-1">{getEntryRemark(entry, selectedTarget)}</p>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reference</p>
                                          <p className="mt-1">{entry.reference || 'No reference captured'}</p>
                                        </div>
                                        <div>
                                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested target</p>
                                          <p className="mt-1">{entry.suggestedTarget?.targetLabel || 'No suggestion yet'}</p>
                                        </div>
                                        <div className="flex flex-wrap items-start justify-end gap-2">
                                          {entry.suggestedTarget ? (
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              onClick={() => {
                                                applyManualTargets(
                                                  {
                                                    ...manualTargets,
                                                    [entry.externalId]: encodeTargetSelection(entry.suggestedTarget)
                                                  },
                                                  `Accepted suggestion for row ${entry.rowNo}`
                                                )
                                              }}
                                            >
                                              Use suggestion
                                            </Button>
                                          ) : null}
                                          {manualTargets[entry.externalId] ? (
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => {
                                                const next = { ...manualTargets }
                                                delete next[entry.externalId]
                                                applyManualTargets(next, `Cleared mapping for row ${entry.rowNo}`)
                                              }}
                                            >
                                              Clear
                                            </Button>
                                          ) : null}
                                        </div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                              </Fragment>
                            )
                          })}
                          {!visibleUnsettledEntries.length ? (
                            <TableRow>
                              <TableCell colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                                All rows are either matched already or filtered out by the current review settings.
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </TableBody>
                      </Table>
                      </div>

                      {reviewOnlyEntries.length > visibleUnsettledEntries.length ? (
                        <div className="border-t border-slate-100 pt-4">
                          <Button variant="outline" size="sm" onClick={() => setUnmatchedVisibleCount((current) => current + INITIAL_VISIBLE_ROWS)}>
                            Show more unmatched rows
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              {filteredInvalidEntries.length > 0 ? (
                <Collapsible open={invalidOpen} onOpenChange={setInvalidOpen}>
                  <Card className="border-amber-200 bg-white shadow-sm">
                    <CardHeader className="p-0">
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between gap-4 px-5 py-4 text-left">
                          <div className="flex items-center gap-3">
                            <span className="rounded-full bg-amber-100 p-2 text-amber-700">
                              <AlertTriangle className="h-4 w-4" />
                            </span>
                            <div>
                              <CardTitle className="text-base text-slate-950">Rows that could not be read</CardTitle>
                              <p className="mt-1 text-sm text-slate-500">{filteredInvalidEntries.length} row{filteredInvalidEntries.length === 1 ? '' : 's'} need source-file correction</p>
                            </div>
                          </div>
                          {invalidOpen ? <ChevronDown className="h-5 w-5 text-slate-400" /> : <ChevronRight className="h-5 w-5 text-slate-400" />}
                        </div>
                      </CollapsibleTrigger>
                    </CardHeader>
                    <CollapsibleContent>
                      <CardContent className="p-0">
                        <div className="max-h-[18rem] overflow-auto">
                        <Table>
                          <TableHeader className="sticky top-0 z-10 bg-slate-50">
                            <TableRow>
                              <TableHead className="px-4 text-[11px] uppercase tracking-wide text-slate-500">Row</TableHead>
                              <TableHead className="px-4 text-[11px] uppercase tracking-wide text-slate-500">Reason</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {visibleInvalidEntries.map((entry) => (
                              <TableRow key={`invalid-${entry.rowNo}`}>
                                <TableCell className="px-4 py-3 font-medium text-slate-900">{entry.rowNo}</TableCell>
                                <TableCell className="px-4 py-3 text-sm text-slate-600">
                                  {entry.reason || 'Could not read this row.'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        </div>
                        {filteredInvalidEntries.length > visibleInvalidEntries.length ? (
                          <div className="border-t border-slate-100 px-5 py-4">
                            <Button variant="outline" size="sm" onClick={() => setInvalidVisibleCount((current) => current + INITIAL_VISIBLE_ROWS)}>
                              Show more unread rows
                            </Button>
                          </div>
                        ) : null}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              ) : null}
            </div>

            <div className="grid gap-3">
              <Card className="border-slate-200 bg-white shadow-sm xl:sticky xl:top-28">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-slate-950">Recent activity</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {combinedActivity.length > 0 ? (
                    combinedActivity.map((activity) => (
                      <div key={activity.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">{activity.summary}</p>
                            <p className="mt-1 text-xs text-slate-500">{formatDateTime(activity.createdAt)}</p>
                          </div>
                          <Badge variant="outline" className="border-slate-200 bg-white text-slate-700 hover:bg-white">
                            {activity.source === 'server' ? 'Audit log' : 'This session'}
                          </Badge>
                        </div>
                        {activity.fileName || activity.imported ? (
                          <p className="mt-2 text-xs text-slate-500">
                            {[activity.fileName, activity.bankName, activity.imported ? `${activity.imported}/${activity.totalRows || 0} rows` : '']
                              .filter(Boolean)
                              .join(' • ')}
                          </p>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                      Activity appears here after verification, draft saves, and ledger posting.
                    </div>
                  )}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    <p className="font-semibold text-slate-900">Fast workflow</p>
                    <p className="mt-1">Verify once, work only on unmatched rows, save anytime, and post only the ready mappings.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
