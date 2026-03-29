'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Landmark, Search, Upload } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

type BankRecord = {
  id: string
  name: string
  branch?: string | null
  accountNumber?: string | null
}

type StatementStatus = 'settled' | 'unsettled' | 'invalid' | 'imported'

type StatementPreviewRow = {
  rowNo: number
  postedAt: string
  amount: number
  direction: 'in' | 'out'
  description: string
  reference: string | null
  externalId: string
  status: StatementStatus
  matchedPaymentId?: string
  matchedTypeLabel?: string
  reason?: string
}

type StatementSummary = {
  total: number
  settled: number
  unsettled: number
  imported: number
  errors: number
}

type StatementPayload = {
  success?: boolean
  bank?: BankRecord
  summary?: StatementSummary
  entries?: StatementPreviewRow[]
  error?: string
}

type CollectionPayload<T> =
  | T[]
  | {
      data?: T[]
    }

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

function getStatusVariant(status: StatementStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'settled' || status === 'imported') return 'default'
  if (status === 'unsettled') return 'secondary'
  if (status === 'invalid') return 'destructive'
  return 'outline'
}

export default function BankStatementUploadPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BankStatementUploadPageContent />
    </Suspense>
  )
}

function BankStatementUploadPageContent() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [readingStatement, setReadingStatement] = useState(false)
  const [uploadingStatement, setUploadingStatement] = useState(false)

  const [banks, setBanks] = useState<BankRecord[]>([])
  const [selectedBankId, setSelectedBankId] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [result, setResult] = useState<StatementPayload | null>(null)
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
        const response = await fetch(`/api/banks?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
        const payload = await response.json().catch(() => [] as CollectionPayload<BankRecord>)
        if (cancelled) return

        const nextBanks = normalizeCollection<BankRecord>(payload)
          .map((bank) => ({
            id: String(bank.id || ''),
            name: String(bank.name || '').trim(),
            branch: String(bank.branch || '').trim(),
            accountNumber: String(bank.accountNumber || '').trim()
          }))
          .filter((bank) => bank.id && bank.name)

        setBanks(nextBanks)
        setSelectedBankId((current) => current || nextBanks[0]?.id || '')
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

  const selectedBank = useMemo(
    () => banks.find((bank) => bank.id === selectedBankId) || null,
    [banks, selectedBankId]
  )

  const summary = useMemo<StatementSummary>(() => {
    const entries = result?.entries || []
    if (entries.length > 0) {
      return {
        total: entries.length,
        settled: entries.filter((entry) => entry.status === 'settled').length,
        unsettled: entries.filter((entry) => entry.status === 'unsettled').length,
        imported: entries.filter((entry) => entry.status === 'imported').length,
        errors: entries.filter((entry) => entry.status === 'invalid').length
      }
    }

    return result?.summary || {
      total: 0,
      settled: 0,
      unsettled: 0,
      imported: 0,
      errors: 0
    }
  }, [result])

  const hasPreview = Boolean(result && Array.isArray(result.entries))
  const canUpload = hasPreview && summary.unsettled > 0 && !uploadingStatement && !readingStatement

  const stepCards = [
    {
      title: 'Select Bank',
      value: selectedBank ? selectedBank.name : 'Pending',
      description: selectedBank ? 'Bank selected for statement matching.' : 'Choose bank before reading statement.'
    },
    {
      title: 'Read Bank Statement',
      value: hasPreview ? `${summary.total} rows read` : 'Pending',
      description: hasPreview ? 'Statement parsed and preview is ready.' : 'Upload CSV and read the statement.'
    },
    {
      title: 'Settled / Unsettled Check',
      value: hasPreview ? `${summary.settled} settled / ${summary.unsettled} unsettled` : 'Pending',
      description: hasPreview ? `${summary.errors} invalid rows flagged during preview.` : 'Comparison starts after preview.'
    },
    {
      title: 'Bank Statement Uploaded',
      value: summary.imported > 0 ? `${summary.imported} imported` : 'Pending',
      description:
        summary.imported > 0
          ? 'Unsettled bank entries are now added to payment history.'
          : 'Import will add only unsettled statement rows.'
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
      alert('Choose CSV bank statement file.')
      return
    }

    if (action === 'preview') {
      setReadingStatement(true)
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

      const response = await fetch('/api/payments/bank-statement/import', {
        method: 'POST',
        body: formData
      })
      const payload = (await response.json().catch(() => ({}))) as StatementPayload
      if (!response.ok) {
        throw new Error(payload.error || `Failed to ${action === 'preview' ? 'read' : 'upload'} bank statement`)
      }

      setResult(payload)

      if (action === 'preview') {
        setStatusTone('success')
        setStatusMessage('Bank statement read successfully. Review settled and unsettled entries below.')
      } else {
        const importedCount = Number(payload.summary?.imported || 0)
        setStatusTone('success')
        setStatusMessage(
          importedCount > 0
            ? `Bank statement uploaded successfully. ${importedCount} new entries added to payment history.`
            : 'Bank statement uploaded successfully. No new unsettled entries were found.'
        )
      }
    } catch (error) {
      const fallback = action === 'preview' ? 'Failed to read bank statement' : 'Failed to upload bank statement'
      const message = error instanceof Error ? error.message : fallback
      setStatusTone('error')
      setStatusMessage(message)
      alert(message)
    } finally {
      if (action === 'preview') {
        setReadingStatement(false)
      } else {
        setUploadingStatement(false)
      }
    }
  }

  if (loading) {
    return (
      <DashboardLayout companyId={companyId}>
        <div className="flex h-64 items-center justify-center">
          <div className="text-lg">Loading...</div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Upload Bank Statement</h1>
              <p className="mt-1 text-sm text-slate-600">
                Select bank, read CSV statement, check settled and unsettled entries, then upload new rows into payment history.
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
                  <p className="mt-2 text-xl font-semibold text-slate-900">{card.value}</p>
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
                      <Label htmlFor="statementFile">Read Bank Statement</Label>
                      <Input
                        id="statementFile"
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) => {
                          setSelectedFile(event.target.files?.[0] || null)
                          setResult(null)
                          setStatusMessage('')
                          setStatusTone(null)
                        }}
                      />
                    </div>
                  </div>

                  {selectedBank && (
                    <div className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-700">
                      <p className="font-medium text-slate-900">{selectedBank.name}</p>
                      <p className="mt-1">
                        Branch: {selectedBank.branch || 'N/A'} | Account No: {selectedBank.accountNumber || 'N/A'}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <Button onClick={() => void submitStatement('preview')} disabled={!selectedBankId || !selectedFile || readingStatement || uploadingStatement}>
                      <Search className="mr-2 h-4 w-4" />
                      {readingStatement ? 'Reading Statement...' : 'Read Bank Statement'}
                    </Button>
                    <Button variant="outline" onClick={() => void submitStatement('import')} disabled={!canUpload}>
                      <Upload className="mr-2 h-4 w-4" />
                      {uploadingStatement ? 'Uploading Statement...' : 'Upload Bank Statement'}
                    </Button>
                  </div>

                  {statusMessage && (
                    <div
                      className={`rounded-lg border px-4 py-3 text-sm ${
                        statusTone === 'error'
                          ? 'border-red-200 bg-red-50 text-red-800'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      }`}
                    >
                      {statusMessage}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                Statement Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Total Rows</p>
                  <p className="mt-2 text-2xl font-semibold">{summary.total}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Settled Entries</p>
                  <p className="mt-2 text-2xl font-semibold text-emerald-700">{summary.settled}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Unsettled Entries</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-700">{summary.unsettled}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Uploaded / Errors</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {summary.imported} / {summary.errors}
                  </p>
                </div>
              </div>

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
                      <TableHead>Matched / Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(result?.entries || []).map((entry) => (
                      <TableRow key={`${entry.externalId || 'row'}-${entry.rowNo}`}>
                        <TableCell>{entry.rowNo}</TableCell>
                        <TableCell>{formatStatementDate(entry.postedAt)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{entry.direction === 'in' ? 'Credit' : 'Debit'}</Badge>
                        </TableCell>
                        <TableCell>{formatCurrency(entry.amount)}</TableCell>
                        <TableCell>{entry.reference || '-'}</TableCell>
                        <TableCell>{entry.description || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(entry.status)}>{entry.status}</Badge>
                        </TableCell>
                        <TableCell>{entry.matchedTypeLabel || entry.reason || '-'}</TableCell>
                      </TableRow>
                    ))}
                    {!result?.entries?.length && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-slate-500">
                          Read a bank statement to preview settled and unsettled entries.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
