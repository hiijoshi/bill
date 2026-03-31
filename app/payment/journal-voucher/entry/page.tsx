'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, ReceiptText, X } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  JOURNAL_LEDGER_TYPE_OPTIONS,
  type JournalLedgerType
} from '@/lib/journal-vouchers'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

type AccountingHeadRecord = {
  id: string
  name: string
  category: string
  accountGroup?: string | null
}

type PartyRecord = {
  id: string
  name: string
  address?: string | null
  phone1?: string | null
}

type FarmerRecord = {
  id: string
  name: string
  address?: string | null
  phone1?: string | null
}

type BankRecord = {
  id: string
  name: string
  branch?: string | null
  ifscCode?: string | null
}

type CollectionPayload<T> =
  | T[]
  | {
      data?: T[]
    }

type JournalVoucherLine = {
  id: string
  ledgerType: JournalLedgerType
  ledgerId: string
  debitAmount: string
  creditAmount: string
  remark: string
}

const EMPTY_JV_LINE = (): JournalVoucherLine => ({
  id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  ledgerType: 'ACCOUNT_HEAD',
  ledgerId: '',
  debitAmount: '',
  creditAmount: '',
  remark: ''
})

function normalizeCollection<T>(payload: CollectionPayload<T>): T[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
    return payload.data
  }
  return []
}

function normalizeMoneyInput(value: string): string {
  const sanitized = value.replace(/[^\d.]/g, '')
  if (!sanitized) return ''

  const parsed = Number(sanitized)
  if (!Number.isFinite(parsed) || parsed < 0) return ''
  return sanitized
}

function parseAmount(value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

function formatCurrency(value: number): string {
  return `₹ ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function JournalVoucherEntryPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <JournalVoucherEntryPageContent />
    </Suspense>
  )
}

function JournalVoucherEntryPageContent() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().split('T')[0])
  const [voucherNo, setVoucherNo] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [remark, setRemark] = useState('')
  const [lines, setLines] = useState<JournalVoucherLine[]>([EMPTY_JV_LINE(), EMPTY_JV_LINE()])

  const [accountingHeads, setAccountingHeads] = useState<AccountingHeadRecord[]>([])
  const [parties, setParties] = useState<PartyRecord[]>([])
  const [farmers, setFarmers] = useState<FarmerRecord[]>([])
  const [banks, setBanks] = useState<BankRecord[]>([])

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
        const [accountHeadsResponse, partiesResponse, farmersResponse, banksResponse, voucherSummaryResponse] = await Promise.all([
          fetch(`/api/accounting-heads?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
          fetch(`/api/parties?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
          fetch(`/api/farmers?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
          fetch(`/api/banks?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
          fetch(`/api/payments/journal-vouchers?companyId=${encodeURIComponent(companyId)}&summary=true`, { cache: 'no-store' })
        ])

        const [accountHeadsPayload, partiesPayload, farmersPayload, banksPayload, voucherSummaryPayload] = await Promise.all([
          accountHeadsResponse.json().catch(() => [] as CollectionPayload<AccountingHeadRecord>),
          partiesResponse.json().catch(() => [] as CollectionPayload<PartyRecord>),
          farmersResponse.json().catch(() => [] as CollectionPayload<FarmerRecord>),
          banksResponse.json().catch(() => [] as CollectionPayload<BankRecord>),
          voucherSummaryResponse.json().catch(() => ({ nextVoucherNo: 'JV-000001' } as { nextVoucherNo?: string }))
        ])

        if (cancelled) return

        setAccountingHeads(
          normalizeCollection<AccountingHeadRecord>(accountHeadsPayload)
            .map((row) => ({
              id: String(row.id || ''),
              name: String(row.name || '').trim(),
              category: String(row.category || '').trim(),
              accountGroup: row.accountGroup || null
            }))
            .filter((row) => row.id && row.name)
        )

        setParties(
          normalizeCollection<PartyRecord>(partiesPayload)
            .map((row) => ({
              id: String(row.id || ''),
              name: String(row.name || '').trim(),
              address: String(row.address || '').trim(),
              phone1: String(row.phone1 || '').trim()
            }))
            .filter((row) => row.id && row.name)
        )

        setFarmers(
          normalizeCollection<FarmerRecord>(farmersPayload)
            .map((row) => ({
              id: String(row.id || ''),
              name: String(row.name || '').trim(),
              address: String(row.address || '').trim(),
              phone1: String(row.phone1 || '').trim()
            }))
            .filter((row) => row.id && row.name)
        )

        setBanks(
          normalizeCollection<BankRecord>(banksPayload)
            .map((row) => ({
              id: String(row.id || ''),
              name: String(row.name || '').trim(),
              branch: String(row.branch || '').trim(),
              ifscCode: String(row.ifscCode || '').trim().toUpperCase()
            }))
            .filter((row) => row.id && row.name)
        )

        setVoucherNo(String(voucherSummaryPayload.nextVoucherNo || 'JV-000001').trim() || 'JV-000001')
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

  const ledgerTypeOptions = useMemo(() => JOURNAL_LEDGER_TYPE_OPTIONS, [])

  const accountHeadOptions = useMemo<SearchableSelectOption[]>(
    () =>
      accountingHeads.map((head) => ({
        value: head.id,
        label: head.name,
        description: [head.category, head.accountGroup || ''].filter(Boolean).join(' | ') || 'Account Head',
        keywords: [head.name, head.category, String(head.accountGroup || '')]
      })),
    [accountingHeads]
  )

  const partyOptions = useMemo<SearchableSelectOption[]>(
    () =>
      parties.map((party) => ({
        value: party.id,
        label: party.name,
        description: [party.address, party.phone1].filter(Boolean).join(' | ') || 'Party',
        keywords: [party.name, String(party.address || ''), String(party.phone1 || '')]
      })),
    [parties]
  )

  const farmerOptions = useMemo<SearchableSelectOption[]>(
    () =>
      farmers.map((farmer) => ({
        value: farmer.id,
        label: farmer.name,
        description: [farmer.address, farmer.phone1].filter(Boolean).join(' | ') || 'Farmer',
        keywords: [farmer.name, String(farmer.address || ''), String(farmer.phone1 || '')]
      })),
    [farmers]
  )

  const bankOptions = useMemo<SearchableSelectOption[]>(
    () =>
      banks.map((bank) => ({
        value: bank.id,
        label: bank.branch ? `${bank.name} (${bank.branch})` : bank.name,
        description: bank.ifscCode || 'Bank',
        keywords: [bank.name, String(bank.branch || ''), String(bank.ifscCode || '')]
      })),
    [banks]
  )

  const getLedgerOptions = (ledgerType: JournalLedgerType): SearchableSelectOption[] => {
    if (ledgerType === 'PARTY') return partyOptions
    if (ledgerType === 'FARMER') return farmerOptions
    if (ledgerType === 'BANK') return bankOptions
    if (ledgerType === 'CASH') return [{ value: 'cash', label: 'Cash', description: 'Cash ledger' }]
    return accountHeadOptions
  }

  const totalDebit = useMemo(
    () => lines.reduce((sum, line) => sum + parseAmount(line.debitAmount), 0),
    [lines]
  )
  const totalCredit = useMemo(
    () => lines.reduce((sum, line) => sum + parseAmount(line.creditAmount), 0),
    [lines]
  )
  const difference = useMemo(() => totalDebit - totalCredit, [totalCredit, totalDebit])

  const isBalanced = Math.abs(difference) < 0.009 && totalDebit > 0 && totalCredit > 0

  const updateLine = (lineId: string, updater: (current: JournalVoucherLine) => JournalVoucherLine) => {
    setLines((current) => current.map((line) => (line.id === lineId ? updater(line) : line)))
  }

  const addRow = () => {
    setLines((current) => [...current, EMPTY_JV_LINE()])
  }

  const removeRow = (lineId: string) => {
    setLines((current) => {
      if (current.length <= 2) return current
      return current.filter((line) => line.id !== lineId)
    })
  }

  const resetForm = () => {
    setReferenceNo('')
    setRemark('')
    setLines([EMPTY_JV_LINE(), EMPTY_JV_LINE()])
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!companyId) {
      alert('Company not selected.')
      return
    }

    if (!voucherDate || !voucherNo.trim()) {
      alert('Date and JV number are required.')
      return
    }

    const normalizedLines = lines.map((line) => ({
      ledgerType: line.ledgerType,
      ledgerId: line.ledgerType === 'CASH' ? null : line.ledgerId || null,
      debitAmount: parseAmount(line.debitAmount),
      creditAmount: parseAmount(line.creditAmount),
      remark: line.remark.trim() || null
    }))

    const hasIncompleteLine = lines.some((line) => {
      const hasLedger = line.ledgerType === 'CASH' || Boolean(line.ledgerId)
      const hasAmount = parseAmount(line.debitAmount) > 0 || parseAmount(line.creditAmount) > 0
      return !hasLedger || !hasAmount
    })

    if (hasIncompleteLine) {
      alert('Select ledger account and amount for every row.')
      return
    }

    if (!isBalanced) {
      alert('Total debit and total credit must match before saving.')
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/payments/journal-vouchers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          companyId,
          voucherNo: voucherNo.trim(),
          voucherDate,
          referenceNo: referenceNo.trim() || null,
          remark: remark.trim() || null,
          lines: normalizedLines
        })
      })

      const payload = await response.json().catch(() => ({} as { error?: string; nextVoucherNo?: string }))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save journal voucher')
      }

      alert('Journal voucher saved successfully.')
      setVoucherNo(String(payload.nextVoucherNo || '').trim() || voucherNo)
      resetForm()
      router.push('/payment/dashboard')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save journal voucher')
    } finally {
      setSubmitting(false)
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
        <div className="mx-auto max-w-7xl">
          <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Journal Voucher Entry</h1>
              <p className="mt-1 text-sm text-slate-600">
                Record balanced debit and credit ledger postings with voucher-wise control.
              </p>
            </div>
            <Button variant="outline" onClick={() => router.push('/payment/dashboard')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>

          <Card className="overflow-hidden rounded-[28px] border border-slate-200 shadow-sm">
            <CardContent className="p-8">
              <form onSubmit={handleSubmit} className="space-y-8">
                <div className="grid gap-5 lg:grid-cols-[1.3fr_0.45fr_0.95fr]">
                  <div className="grid gap-2">
                    <Label htmlFor="voucherDate" className="text-base font-semibold text-slate-900">
                      Date
                    </Label>
                    <Input
                      id="voucherDate"
                      type="date"
                      value={voucherDate}
                      onChange={(event) => setVoucherDate(event.target.value)}
                      className="h-14 text-xl"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="voucherNo" className="text-base font-semibold text-slate-900">
                      JV No.
                    </Label>
                    <Input
                      id="voucherNo"
                      value={voucherNo}
                      onChange={(event) => setVoucherNo(event.target.value.toUpperCase())}
                      className="h-14 text-xl"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="referenceNo" className="text-base font-semibold text-slate-900">
                      Reference No.
                    </Label>
                    <Input
                      id="referenceNo"
                      value={referenceNo}
                      onChange={(event) => setReferenceNo(event.target.value)}
                      placeholder="Optional"
                      className="h-14 text-xl"
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="voucherRemark" className="text-base font-semibold text-slate-900">
                    Remark
                  </Label>
                  <Input
                    id="voucherRemark"
                    value={remark}
                    onChange={(event) => setRemark(event.target.value)}
                    placeholder="Enter remark"
                    className="h-14 text-xl"
                  />
                </div>

                <div className="rounded-3xl border border-slate-200">
                  <div className="border-b border-slate-200 px-6 py-5">
                    <div className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
                      <ReceiptText className="h-6 w-6 text-slate-500" />
                      Ledger Entries
                    </div>
                  </div>

                  <div className="grid grid-cols-[2.3fr_0.95fr_0.95fr_1.5fr_72px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4 text-xl font-medium text-slate-700">
                    <div>Ledger Account</div>
                    <div>Debit (Dr)</div>
                    <div>Credit (Cr)</div>
                    <div>Remark</div>
                    <div />
                  </div>

                  <div className="divide-y divide-slate-200">
                    {lines.map((line) => {
                      const ledgerOptions = getLedgerOptions(line.ledgerType)

                      return (
                        <div key={line.id} className="grid grid-cols-[2.3fr_0.95fr_0.95fr_1.5fr_72px] gap-4 px-5 py-4">
                          <div className="grid grid-cols-[220px_1fr] gap-3">
                            <Select
                              value={line.ledgerType}
                              onValueChange={(value) =>
                                updateLine(line.id, (current) => ({
                                  ...current,
                                  ledgerType: value as JournalLedgerType,
                                  ledgerId: value === 'CASH' ? 'cash' : '',
                                  debitAmount: current.debitAmount,
                                  creditAmount: current.creditAmount
                                }))
                              }
                            >
                              <SelectTrigger id={`ledgerType-${line.id}`} className="h-12 text-lg">
                                <SelectValue placeholder="Ledger Type" />
                              </SelectTrigger>
                              <SelectContent>
                                {ledgerTypeOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <SearchableSelect
                              id={`ledger-${line.id}`}
                              value={line.ledgerId}
                              onValueChange={(value) =>
                                updateLine(line.id, (current) => ({
                                  ...current,
                                  ledgerId: value
                                }))
                              }
                              options={ledgerOptions}
                              placeholder="Search and select ledger"
                              searchPlaceholder="Search ledger..."
                              emptyText="No ledgers found."
                            />
                          </div>

                          <Input
                            id={`debit-${line.id}`}
                            type="text"
                            inputMode="decimal"
                            value={line.debitAmount}
                            onChange={(event) =>
                              updateLine(line.id, (current) => ({
                                ...current,
                                debitAmount: normalizeMoneyInput(event.target.value),
                                creditAmount: event.target.value ? '' : current.creditAmount
                              }))
                            }
                            placeholder="0.00"
                            className="h-12 text-lg"
                          />

                          <Input
                            id={`credit-${line.id}`}
                            type="text"
                            inputMode="decimal"
                            value={line.creditAmount}
                            onChange={(event) =>
                              updateLine(line.id, (current) => ({
                                ...current,
                                creditAmount: normalizeMoneyInput(event.target.value),
                                debitAmount: event.target.value ? '' : current.debitAmount
                              }))
                            }
                            placeholder="0.00"
                            className="h-12 text-lg"
                          />

                          <Input
                            id={`lineRemark-${line.id}`}
                            value={line.remark}
                            onChange={(event) =>
                              updateLine(line.id, (current) => ({
                                ...current,
                                remark: event.target.value
                              }))
                            }
                            placeholder="Remark"
                            className="h-12 text-lg"
                          />

                          <Button
                            type="button"
                            variant="outline"
                            className="h-12 w-[72px] border-slate-200 text-slate-500 hover:text-red-500"
                            onClick={() => removeRow(line.id)}
                            disabled={lines.length <= 2}
                          >
                            <X className="h-5 w-5" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>

                  <div className="px-5 py-4">
                    <Button type="button" variant="outline" onClick={addRow} className="h-12 text-lg">
                      <Plus className="mr-2 h-5 w-5" />
                      Add Row
                    </Button>
                  </div>

                  <div className="border-t border-slate-200 px-5 py-6">
                    <div className="ml-auto grid max-w-[520px] gap-3 text-2xl">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="font-medium text-slate-700">Total Debit:</span>
                        <span className="font-semibold text-slate-900">{formatCurrency(totalDebit)}</span>
                      </div>
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="font-medium text-slate-700">Total Credit:</span>
                        <span className="font-semibold text-slate-900">{formatCurrency(totalCredit)}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3">
                        <span className="font-semibold text-slate-900">Difference:</span>
                        <span className={`font-bold ${isBalanced ? 'text-green-700' : 'text-amber-700'}`}>
                          {formatCurrency(Math.abs(difference))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => router.push('/payment/dashboard')} className="h-14 px-8 text-xl">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !isBalanced} className="h-14 px-8 text-xl">
                    {submitting ? 'Saving...' : 'Save Voucher'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
