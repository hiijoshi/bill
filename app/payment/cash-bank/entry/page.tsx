'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Building2, Landmark, Repeat, Wallet } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import {
  buildCashBankPaymentReference,
  buildSelfTransferReference,
  CASH_BANK_PAYMENT_TYPE,
  SELF_TRANSFER_PAYMENT_TYPE
} from '@/lib/payment-entry-types'
import {
  DEFAULT_PAYMENT_MODES,
  isCashPaymentMode,
  type PaymentModeOption
} from '@/lib/payment-mode-utils'
import { invalidateAppDataCaches, notifyAppDataChanged } from '@/lib/app-live-data'
import { loadClientCachedValue } from '@/lib/client-cached-value'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { getDefaultTransactionDateInput } from '@/lib/client-financial-years'
import { useClientFinancialYear } from '@/lib/use-client-financial-year'

type AccountingHeadRecord = {
  id: string
  name: string
  category: string
  amount: number
  value: number
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

type BankRecord = {
  id: string
  name: string
  branch: string
  ifscCode: string
  accountNumber: string
  address: string
  phone: string
  isActive: boolean
}

type PaymentModeRecord = PaymentModeOption
type ReferenceType = 'accounting-head' | 'party' | 'supplier'
type EntryMode = 'cash-bank' | 'self-transfer'
type SelectedReference =
  | { referenceType: 'accounting-head'; id: string }
  | { referenceType: 'party'; id: string }
  | { referenceType: 'supplier'; id: string }
  | null

type CollectionPayload<T> =
  | T[]
  | {
      data?: T[]
    }

const CASH_BANK_ENTRY_CACHE_AGE_MS = 30_000

type CashBankEntryCachePayload = {
  accountingHeads: AccountingHeadRecord[]
  parties: PartyRecord[]
  suppliers: SupplierRecord[]
  banks: BankRecord[]
  paymentModes: PaymentModeRecord[]
}

function normalizeCollection<T>(payload: CollectionPayload<T>): T[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
    return payload.data
  }
  return []
}

function toNonNegativeAmount(value: string): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return ''
  return String(parsed)
}

function parseReferenceValue(value: string): SelectedReference {
  const normalized = String(value || '').trim()
  const separatorIndex = normalized.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) return null

  const referenceType = normalized.slice(0, separatorIndex) as ReferenceType
  const id = normalized.slice(separatorIndex + 1)
  if (!id) return null
  if (referenceType !== 'accounting-head' && referenceType !== 'party' && referenceType !== 'supplier') return null

  return { referenceType, id }
}

export default function CashBankPaymentEntryPage() {
  return (
    <Suspense fallback={<AppLoaderShell kind="bank" fullscreen />}>
      <CashBankPaymentEntryPageContent />
    </Suspense>
  )
}

function CashBankPaymentEntryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const { financialYear } = useClientFinancialYear()
  const [entryMode, setEntryMode] = useState<EntryMode>(
    searchParams.get('entry') === 'self-transfer' ? 'self-transfer' : 'cash-bank'
  )

  const [paymentDate, setPaymentDate] = useState('')
  const [mode, setMode] = useState('cash')
  const [selectedReferenceValue, setSelectedReferenceValue] = useState('')
  const [selectedBankId, setSelectedBankId] = useState('')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [transferDate, setTransferDate] = useState('')
  const [fromAccount, setFromAccount] = useState('cash')
  const [toAccount, setToAccount] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferRemark, setTransferRemark] = useState('')

  const [bankNameSnapshot, setBankNameSnapshot] = useState('')
  const [bankBranchSnapshot, setBankBranchSnapshot] = useState('')
  const [ifscCode, setIfscCode] = useState('')
  const [beneficiaryBankAccount, setBeneficiaryBankAccount] = useState('')

  const [accountingHeadOptions, setAccountingHeadOptions] = useState<AccountingHeadRecord[]>([])
  const [partyOptions, setPartyOptions] = useState<PartyRecord[]>([])
  const [supplierOptions, setSupplierOptions] = useState<SupplierRecord[]>([])
  const [bankOptions, setBankOptions] = useState<BankRecord[]>([])
  const [paymentModes, setPaymentModes] = useState<PaymentModeRecord[]>([])

  useEffect(() => {
    setPaymentDate(getDefaultTransactionDateInput(financialYear))
    setTransferDate(getDefaultTransactionDateInput(financialYear))
  }, [financialYear?.id])

  useEffect(() => {
    setEntryMode(searchParams.get('entry') === 'self-transfer' ? 'self-transfer' : 'cash-bank')
  }, [searchParams])

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
    setLoading(true)

    ;(async () => {
      try {
        const payload = await loadClientCachedValue<CashBankEntryCachePayload>(
          `cash-bank-entry:${companyId}`,
          async () => {
            const [accountingHeadsResponse, partiesResponse, suppliersResponse, banksResponse, paymentModesResponse] = await Promise.all([
              fetch(`/api/accounting-heads?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
              fetch(`/api/parties?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
              fetch(`/api/suppliers?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
              fetch(`/api/banks?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
              fetch(`/api/payment-modes?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
            ])

            const [accountingHeadsPayload, partiesPayload, suppliersPayload, banksPayload, paymentModesPayload] = await Promise.all([
              accountingHeadsResponse.json().catch(() => [] as CollectionPayload<AccountingHeadRecord>),
              partiesResponse.json().catch(() => [] as CollectionPayload<PartyRecord>),
              suppliersResponse.json().catch(() => [] as CollectionPayload<SupplierRecord>),
              banksResponse.json().catch(() => [] as CollectionPayload<BankRecord>),
              paymentModesResponse.json().catch(() => [] as CollectionPayload<PaymentModeRecord>)
            ])

            return {
              accountingHeads: normalizeCollection<AccountingHeadRecord>(accountingHeadsPayload)
                .map((row) => ({
                  id: String(row.id || ''),
                  name: String(row.name || '').trim(),
                  category: String(row.category || '').trim(),
                  amount: Number(row.amount || 0),
                  value: Number(row.value || 0)
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
                .filter((row) => row.id && row.name),
              banks: normalizeCollection<BankRecord>(banksPayload)
                .map((row) => ({
                  id: String(row.id || ''),
                  name: String(row.name || '').trim(),
                  branch: String(row.branch || '').trim(),
                  ifscCode: String(row.ifscCode || '').trim().toUpperCase(),
                  accountNumber: String(row.accountNumber || '').trim(),
                  address: String(row.address || '').trim(),
                  phone: String(row.phone || '').trim(),
                  isActive: row.isActive !== false
                }))
                .filter((row) => row.id && row.name && row.isActive),
              paymentModes: normalizeCollection<PaymentModeRecord>(paymentModesPayload)
                .map((row) => ({
                  id: String(row.id || ''),
                  name: String(row.name || '').trim(),
                  code: String(row.code || '').trim(),
                  isActive: row.isActive !== false
                }))
                .filter((row) => row.id && row.name && row.code && row.isActive)
            }
          },
          { maxAgeMs: CASH_BANK_ENTRY_CACHE_AGE_MS }
        )

        if (cancelled) return

        setAccountingHeadOptions(payload.accountingHeads)
        setPartyOptions(payload.parties)
        setSupplierOptions(payload.suppliers)
        setBankOptions(payload.banks)
        setPaymentModes(payload.paymentModes)
        setToAccount((current) => current || payload.banks[0]?.id || '')
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

  const paymentModeOptions = useMemo<PaymentModeRecord[]>(() => {
    return paymentModes.length > 0 ? paymentModes : DEFAULT_PAYMENT_MODES
  }, [paymentModes])

  useEffect(() => {
    if (paymentModeOptions.length === 0) return
    if (paymentModeOptions.some((option) => option.code === mode)) return
    setMode(paymentModeOptions[0]?.code || 'cash')
  }, [mode, paymentModeOptions])

  const paymentModeItems = useMemo<SearchableSelectOption[]>(
    () =>
      paymentModeOptions.map((paymentMode) => ({
        value: paymentMode.code,
        label: paymentMode.name,
        keywords: [paymentMode.code, paymentMode.name]
      })),
    [paymentModeOptions]
  )

  const selectedPaymentMode = useMemo(
    () => paymentModeOptions.find((paymentMode) => paymentMode.code === mode) || null,
    [mode, paymentModeOptions]
  )

  const isCashMode = useMemo(
    () => isCashPaymentMode(mode, selectedPaymentMode?.name || ''),
    [mode, selectedPaymentMode]
  )

  const showBankDetails = Boolean(mode) && !isCashMode

  const referenceItems = useMemo<SearchableSelectOption[]>(
    () => [
      ...accountingHeadOptions.map((head) => ({
        value: `accounting-head:${head.id}`,
        label: `Accounting Head • ${head.name}`,
        description: head.category ? `Accounting Head • ${head.category}` : 'Accounting Head',
        keywords: [head.name, head.category]
      })),
      ...partyOptions.map((party) => ({
        value: `party:${party.id}`,
        label: `Party • ${party.name}`,
        description: [party.type, party.address, party.phone1].filter(Boolean).join(' • ') || 'Party',
        keywords: [party.name, party.type, party.address, party.phone1, party.bankName, party.accountNo, party.ifscCode]
      })),
      ...supplierOptions.map((supplier) => ({
        value: `supplier:${supplier.id}`,
        label: `Supplier • ${supplier.name}`,
        description: supplier.address || supplier.gstNumber || supplier.phone1 || 'Supplier',
        keywords: [supplier.name, supplier.address, supplier.gstNumber, supplier.phone1, supplier.bankName]
      }))
    ],
    [accountingHeadOptions, partyOptions, supplierOptions]
  )

  const bankItems = useMemo<SearchableSelectOption[]>(
    () =>
      bankOptions.map((bank) => ({
        value: bank.id,
        label: bank.name,
        description: [bank.branch, bank.ifscCode].filter(Boolean).join(' | ') || 'Bank',
        keywords: [bank.name, bank.branch, bank.ifscCode, bank.accountNumber]
      })),
    [bankOptions]
  )

  const transferOptions = useMemo<SearchableSelectOption[]>(
    () => [
      { value: 'cash', label: 'Cash', keywords: ['cash', 'nakad'] },
      ...bankOptions.map((bank) => ({
        value: bank.id,
        label: bank.branch ? `${bank.name} (${bank.branch})` : bank.name,
        description: [bank.branch, bank.ifscCode].filter(Boolean).join(' | ') || 'Bank',
        keywords: [bank.name, bank.branch, bank.ifscCode, bank.accountNumber]
      }))
    ],
    [bankOptions]
  )

  const transferLabelMap = useMemo(
    () =>
      new Map(
        transferOptions.map((option) => [
          option.value,
          option.label
        ])
      ),
    [transferOptions]
  )

  const selectedReference = useMemo(() => parseReferenceValue(selectedReferenceValue), [selectedReferenceValue])

  const selectedAccountingHead = useMemo(() => {
    if (selectedReference?.referenceType !== 'accounting-head') return null
    return accountingHeadOptions.find((head) => head.id === selectedReference.id) || null
  }, [accountingHeadOptions, selectedReference])

  const selectedParty = useMemo(() => {
    if (selectedReference?.referenceType !== 'party') return null
    return partyOptions.find((party) => party.id === selectedReference.id) || null
  }, [partyOptions, selectedReference])

  const selectedSupplier = useMemo(() => {
    if (selectedReference?.referenceType !== 'supplier') return null
    return supplierOptions.find((supplier) => supplier.id === selectedReference.id) || null
  }, [selectedReference, supplierOptions])

  const selectedBank = useMemo(
    () => bankOptions.find((bank) => bank.id === selectedBankId) || null,
    [bankOptions, selectedBankId]
  )

  useEffect(() => {
    if (!selectedAccountingHead) return
    if (amount.trim()) return

    const configuredAmount = Number(selectedAccountingHead.amount || 0)
    if (configuredAmount > 0) {
      setAmount(String(configuredAmount))
    }
  }, [amount, selectedAccountingHead])

  useEffect(() => {
    if (!showBankDetails) {
      setSelectedBankId('')
      setBankNameSnapshot('')
      setBankBranchSnapshot('')
      setIfscCode('')
      setBeneficiaryBankAccount('')
      return
    }

    if (!selectedBank) {
      setBankNameSnapshot('')
      setBankBranchSnapshot('')
      setIfscCode('')
      setBeneficiaryBankAccount('')
      return
    }

    setBankNameSnapshot(selectedBank.name || '')
    setBankBranchSnapshot(selectedBank.branch || '')
    setIfscCode(selectedBank.ifscCode || '')
    setBeneficiaryBankAccount(selectedBank.accountNumber || '')
  }, [selectedBank, showBankDetails])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!companyId) {
      alert('Company not selected.')
      return
    }

    if (!selectedReference) {
      alert('Select account head, party, or supplier.')
      return
    }

    const paymentAmount = Number(amount)
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      alert('Enter a valid amount.')
      return
    }

    if (!paymentDate) {
      alert('Date is required.')
      return
    }

    if (showBankDetails && !selectedBank) {
      alert('Select bank for non-cash payment mode.')
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          companyId,
          billType: CASH_BANK_PAYMENT_TYPE,
          billId: buildCashBankPaymentReference(selectedReference.referenceType, selectedReference.id),
          partyId: selectedReference.referenceType === 'party' ? selectedReference.id : null,
          payDate: paymentDate,
          amount: paymentAmount,
          mode,
          bankId: showBankDetails ? selectedBank?.id || null : null,
          onlinePayAmount: showBankDetails ? paymentAmount : null,
          onlinePaymentDate: showBankDetails ? paymentDate : null,
          ifscCode: showBankDetails ? ifscCode || null : null,
          beneficiaryBankAccount: showBankDetails ? beneficiaryBankAccount || null : null,
          bankNameSnapshot: showBankDetails ? bankNameSnapshot || null : null,
          bankBranchSnapshot: showBankDetails ? bankBranchSnapshot || null : null,
          note: remark.trim() || null,
          status: 'paid'
        })
      })

      const payload = await response.json().catch(() => ({} as { error?: string }))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to record cash / bank payment')
      }

      invalidateAppDataCaches(companyId, ['payments'])
      notifyAppDataChanged({ companyId, scopes: ['payments'] })
      alert('Cash / bank payment recorded successfully.')
      router.push('/payment/dashboard')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to record cash / bank payment')
    } finally {
      setSubmitting(false)
    }
  }

  const updateEntryMode = (nextMode: EntryMode) => {
    setEntryMode(nextMode)
    const currentUrl = new URL(window.location.href)
    if (nextMode === 'self-transfer') {
      currentUrl.searchParams.set('entry', 'self-transfer')
    } else {
      currentUrl.searchParams.delete('entry')
    }
    window.history.replaceState({}, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`)
  }

  const handleTransferSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!companyId) {
      alert('Company not selected.')
      return
    }

    if (!fromAccount || !toAccount) {
      alert('Select both From and To accounts.')
      return
    }

    if (fromAccount === toAccount) {
      alert('From and To cannot be the same.')
      return
    }

    const normalizedAmount = Number(transferAmount)
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      alert('Enter a valid amount.')
      return
    }

    if (!transferDate) {
      alert('Date is required.')
      return
    }

    setSubmitting(true)

    try {
      const fromLabel = transferLabelMap.get(fromAccount) || 'From'
      const toLabel = transferLabelMap.get(toAccount) || 'To'

      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          companyId,
          billType: SELF_TRANSFER_PAYMENT_TYPE,
          billId: buildSelfTransferReference(fromAccount, toAccount),
          payDate: transferDate,
          amount: normalizedAmount,
          mode: 'transfer',
          bankNameSnapshot: fromLabel,
          bankBranchSnapshot: toLabel,
          note: transferRemark.trim() || null,
          status: 'paid'
        })
      })

      const payload = await response.json().catch(() => ({} as { error?: string }))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to record self transfer')
      }

      invalidateAppDataCaches(companyId, ['payments'])
      notifyAppDataChanged({ companyId, scopes: ['payments'] })
      alert('Self transfer recorded successfully.')
      router.push('/payment/dashboard')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to record self transfer')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (loading || submitting) return

      const selector =
        entryMode === 'self-transfer'
          ? 'form[data-entry-mode="self-transfer"]'
          : 'form[data-entry-mode="cash-bank"]'
      const form = document.querySelector<HTMLFormElement>(selector)
      if (!form) return
      form.requestSubmit()
    }

    window.addEventListener('keydown', handleShortcut)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
    }
  }, [entryMode, loading, submitting])

  if (loading) {
    return (
      <AppLoaderShell
        kind="bank"
        companyId={companyId}
        title="Preparing payment entry workspace"
        message="Loading payment modes, bank master details, and transfer references."
      />
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Cash, Bank, and Transfer Entry</h1>
              <p className="mt-1 text-sm text-slate-600">
                Use one shared payment workspace for direct cash or bank payments and internal self transfers.
              </p>
            </div>
            <Button variant="outline" onClick={() => router.push('/payment/dashboard')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>

          <div className="mb-6 inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            <Button
              type="button"
              variant={entryMode === 'cash-bank' ? 'default' : 'ghost'}
              className="rounded-xl"
              onClick={() => updateEntryMode('cash-bank')}
            >
              <Wallet className="mr-2 h-4 w-4" />
              Cash / Bank Payment
            </Button>
            <Button
              type="button"
              variant={entryMode === 'self-transfer' ? 'default' : 'ghost'}
              className="rounded-xl"
              onClick={() => updateEntryMode('self-transfer')}
            >
              <Repeat className="mr-2 h-4 w-4" />
              Self Transfer
            </Button>
          </div>

          {entryMode === 'cash-bank' ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  Payment Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form data-entry-mode="cash-bank" onSubmit={handleSubmit} className="grid gap-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="paymentDate">Date</Label>
                    <Input
                      id="paymentDate"
                      type="date"
                      value={paymentDate}
                      onChange={(event) => setPaymentDate(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="paymentMode">Mode of Payment</Label>
                    <SearchableSelect
                      id="paymentMode"
                      value={mode}
                      onValueChange={setMode}
                      options={paymentModeItems}
                      placeholder="Select mode of payment"
                      searchPlaceholder="Search payment mode..."
                      emptyText="No payment modes found."
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="referenceValue">Payment For</Label>
                  <SearchableSelect
                    id="referenceValue"
                    value={selectedReferenceValue}
                    onValueChange={setSelectedReferenceValue}
                    options={referenceItems}
                    placeholder="Search account head, party, or supplier"
                    searchPlaceholder="Search payment target..."
                    emptyText="No payment target found."
                  />
                </div>

                {selectedAccountingHead ? (
                  <div className="grid gap-4 rounded-lg border bg-slate-50 p-4 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label htmlFor="selectedHeadCategory">Category</Label>
                      <Input id="selectedHeadCategory" value={selectedAccountingHead.category || ''} readOnly />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="selectedHeadAmount">Configured Amount</Label>
                      <Input
                        id="selectedHeadAmount"
                        value={Number(selectedAccountingHead.amount || 0).toFixed(2)}
                        readOnly
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="selectedHeadValue">Configured Value</Label>
                      <Input
                        id="selectedHeadValue"
                        value={Number(selectedAccountingHead.value || 0).toFixed(2)}
                        readOnly
                      />
                    </div>
                  </div>
                ) : null}

                {selectedParty ? (
                  <div className="grid gap-4 rounded-lg border bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="grid gap-2">
                      <Label htmlFor="selectedPartyType">Party Type</Label>
                      <Input id="selectedPartyType" value={selectedParty.type || ''} readOnly />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="selectedPartyPhone">Party Contact</Label>
                      <Input id="selectedPartyPhone" value={selectedParty.phone1 || ''} readOnly />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="selectedPartyBankName">Saved Bank Name</Label>
                      <Input id="selectedPartyBankName" value={selectedParty.bankName || ''} readOnly />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="selectedPartyBankAccount">Saved Bank Account</Label>
                      <Input id="selectedPartyBankAccount" value={selectedParty.accountNo || ''} readOnly />
                    </div>
                  </div>
                ) : null}

                {selectedSupplier ? (
                  <div className="grid gap-4 rounded-lg border bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="grid gap-2">
                      <Label htmlFor="selectedSupplierPhone">Supplier Contact</Label>
                      <Input id="selectedSupplierPhone" value={selectedSupplier.phone1 || ''} readOnly />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="selectedSupplierGst">GST Number</Label>
                      <Input id="selectedSupplierGst" value={selectedSupplier.gstNumber || ''} readOnly />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="selectedSupplierBankName">Saved Bank Name</Label>
                      <Input id="selectedSupplierBankName" value={selectedSupplier.bankName || ''} readOnly />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="selectedSupplierBankAccount">Saved Bank Account</Label>
                      <Input id="selectedSupplierBankAccount" value={selectedSupplier.accountNo || ''} readOnly />
                    </div>
                  </div>
                ) : null}

                {showBankDetails ? (
                  <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <Landmark className="h-4 w-4" />
                      Bank Details
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="selectedBank">Bank</Label>
                        <SearchableSelect
                          id="selectedBank"
                          value={selectedBankId}
                          onValueChange={setSelectedBankId}
                          options={bankItems}
                          placeholder="Search and select bank"
                          searchPlaceholder="Search bank, branch, IFSC..."
                          emptyText="No banks found."
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="selectedBankBranch">Branch</Label>
                        <Input id="selectedBankBranch" value={bankBranchSnapshot} readOnly />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="selectedBankIfsc">IFSC Code</Label>
                        <Input id="selectedBankIfsc" value={ifscCode} readOnly />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="selectedBankAccount">Bank Account</Label>
                        <Input id="selectedBankAccount" value={beneficiaryBankAccount} readOnly />
                      </div>
                      <div className="grid gap-2 md:col-span-2">
                        <Label htmlFor="selectedBankAddress">Bank Address</Label>
                        <Input id="selectedBankAddress" value={selectedBank?.address || ''} readOnly />
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="amount">Payment Amount</Label>
                    <Input
                      id="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(event) => setAmount(toNonNegativeAmount(event.target.value))}
                      placeholder="Enter amount"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="remark">Remark</Label>
                    <Input
                      id="remark"
                      value={remark}
                      onChange={(event) => setRemark(event.target.value)}
                      placeholder="Enter remark"
                    />
                  </div>
                </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <p className="mr-auto flex items-center text-xs text-slate-500">
                      Shortcut: <span className="ml-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700">Ctrl / Cmd + S</span>
                    </p>
                    {!selectedReference || selectedReference.referenceType === 'accounting-head' ? (
                      accountingHeadOptions.length === 0 ? (
                        <Button type="button" variant="outline" onClick={() => router.push('/master/accounting-head')}>
                          <Building2 className="mr-2 h-4 w-4" />
                          Add Accounting Head
                        </Button>
                      ) : null
                    ) : null}
                    {selectedReference?.referenceType === 'party' && partyOptions.length === 0 ? (
                      <Button type="button" variant="outline" onClick={() => router.push('/master/party')}>
                        Add Party
                      </Button>
                    ) : null}
                    {selectedReference?.referenceType === 'supplier' && supplierOptions.length === 0 ? (
                      <Button type="button" variant="outline" onClick={() => router.push('/master/supplier')}>
                        Add Supplier
                      </Button>
                    ) : null}
                    <Button type="button" variant="outline" onClick={() => router.push('/payment/dashboard')}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={submitting}>
                      {submitting ? 'Saving...' : 'Save Payment'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Repeat className="h-5 w-5" />
                  Transfer Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form data-entry-mode="self-transfer" onSubmit={handleTransferSubmit} className="grid gap-5">
                  <div className="grid gap-2">
                    <Label htmlFor="transferDate">Date</Label>
                    <Input
                      id="transferDate"
                      type="date"
                      value={transferDate}
                      onChange={(event) => setTransferDate(event.target.value)}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="fromAccount">From</Label>
                      <SearchableSelect
                        id="fromAccount"
                        value={fromAccount}
                        onValueChange={setFromAccount}
                        options={transferOptions}
                        placeholder="Select source"
                        searchPlaceholder="Search source..."
                        emptyText="No accounts found."
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="toAccount">To</Label>
                      <SearchableSelect
                        id="toAccount"
                        value={toAccount}
                        onValueChange={setToAccount}
                        options={transferOptions}
                        placeholder="Select destination"
                        searchPlaceholder="Search destination..."
                        emptyText="No accounts found."
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="transferAmount">Amount</Label>
                      <Input
                        id="transferAmount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={transferAmount}
                        onChange={(event) => setTransferAmount(toNonNegativeAmount(event.target.value))}
                        placeholder="Enter amount"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="transferRemark">Remark</Label>
                      <Input
                        id="transferRemark"
                        value={transferRemark}
                        onChange={(event) => setTransferRemark(event.target.value)}
                        placeholder="Enter remark"
                      />
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    Internal transfer entries move funds between cash and bank accounts without duplicating external payment history.
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <p className="mr-auto flex items-center text-xs text-slate-500">
                      Shortcut: <span className="ml-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700">Ctrl / Cmd + S</span>
                    </p>
                    <Button type="button" variant="outline" onClick={() => router.push('/payment/dashboard')}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={submitting}>
                      {submitting ? 'Saving...' : 'Save Transfer'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
