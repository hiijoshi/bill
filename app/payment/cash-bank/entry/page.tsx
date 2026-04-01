'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Building2, Landmark, Wallet } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import {
  buildCashBankPaymentReference,
  CASH_BANK_PAYMENT_TYPE
} from '@/lib/payment-entry-types'
import {
  DEFAULT_PAYMENT_MODES,
  isCashPaymentMode,
  type PaymentModeOption
} from '@/lib/payment-mode-utils'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

type AccountingHeadRecord = {
  id: string
  name: string
  category: string
  amount: number
  value: number
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
type ReferenceType = 'accounting-head' | 'supplier'

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

function toNonNegativeAmount(value: string): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return ''
  return String(parsed)
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
  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [mode, setMode] = useState('cash')
  const [referenceType, setReferenceType] = useState<ReferenceType>('accounting-head')
  const [selectedAccountingHeadId, setSelectedAccountingHeadId] = useState('')
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [selectedBankId, setSelectedBankId] = useState('')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')

  const [bankNameSnapshot, setBankNameSnapshot] = useState('')
  const [bankBranchSnapshot, setBankBranchSnapshot] = useState('')
  const [ifscCode, setIfscCode] = useState('')
  const [beneficiaryBankAccount, setBeneficiaryBankAccount] = useState('')

  const [accountingHeadOptions, setAccountingHeadOptions] = useState<AccountingHeadRecord[]>([])
  const [supplierOptions, setSupplierOptions] = useState<SupplierRecord[]>([])
  const [bankOptions, setBankOptions] = useState<BankRecord[]>([])
  const [paymentModes, setPaymentModes] = useState<PaymentModeRecord[]>([])

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
        const [accountingHeadsResponse, suppliersResponse, banksResponse, paymentModesResponse] = await Promise.all([
          fetch(`/api/accounting-heads?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
          fetch(`/api/suppliers?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
          fetch(`/api/banks?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
          fetch(`/api/payment-modes?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
        ])

        const [accountingHeadsPayload, suppliersPayload, banksPayload, paymentModesPayload] = await Promise.all([
          accountingHeadsResponse.json().catch(() => [] as CollectionPayload<AccountingHeadRecord>),
          suppliersResponse.json().catch(() => [] as CollectionPayload<SupplierRecord>),
          banksResponse.json().catch(() => [] as CollectionPayload<BankRecord>),
          paymentModesResponse.json().catch(() => [] as CollectionPayload<PaymentModeRecord>)
        ])

        if (cancelled) return

        setAccountingHeadOptions(
          normalizeCollection<AccountingHeadRecord>(accountingHeadsPayload)
            .map((row) => ({
              id: String(row.id || ''),
              name: String(row.name || '').trim(),
              category: String(row.category || '').trim(),
              amount: Number(row.amount || 0),
              value: Number(row.value || 0)
            }))
            .filter((row) => row.id && row.name)
        )

        setSupplierOptions(
          normalizeCollection<SupplierRecord>(suppliersPayload)
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
        )

        setBankOptions(
          normalizeCollection<BankRecord>(banksPayload)
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
            .filter((row) => row.id && row.name && row.isActive)
        )

        setPaymentModes(
          normalizeCollection<PaymentModeRecord>(paymentModesPayload)
            .map((row) => ({
              id: String(row.id || ''),
              name: String(row.name || '').trim(),
              code: String(row.code || '').trim(),
              isActive: row.isActive !== false
            }))
            .filter((row) => row.id && row.name && row.code && row.isActive)
        )
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

  const referenceTypeItems = useMemo<SearchableSelectOption[]>(
    () => [
      {
        value: 'accounting-head',
        label: 'Account Head',
        description: 'Record expense against accounting head'
      },
      {
        value: 'supplier',
        label: 'Supplier',
        description: 'Record direct payment to supplier'
      }
    ],
    []
  )

  const accountingHeadItems = useMemo<SearchableSelectOption[]>(
    () =>
      accountingHeadOptions.map((head) => ({
        value: head.id,
        label: head.name,
        description: head.category ? `Category: ${head.category}` : 'Accounting head',
        keywords: [head.name, head.category]
      })),
    [accountingHeadOptions]
  )

  const supplierItems = useMemo<SearchableSelectOption[]>(
    () =>
      supplierOptions.map((supplier) => ({
        value: supplier.id,
        label: supplier.name,
        description: supplier.address || supplier.gstNumber || supplier.phone1 || 'Supplier',
        keywords: [supplier.name, supplier.address, supplier.gstNumber, supplier.phone1, supplier.bankName]
      })),
    [supplierOptions]
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

  const selectedAccountingHead = useMemo(
    () => accountingHeadOptions.find((head) => head.id === selectedAccountingHeadId) || null,
    [accountingHeadOptions, selectedAccountingHeadId]
  )

  const selectedSupplier = useMemo(
    () => supplierOptions.find((supplier) => supplier.id === selectedSupplierId) || null,
    [selectedSupplierId, supplierOptions]
  )

  const selectedBank = useMemo(
    () => bankOptions.find((bank) => bank.id === selectedBankId) || null,
    [bankOptions, selectedBankId]
  )

  useEffect(() => {
    if (referenceType === 'accounting-head') {
      setSelectedSupplierId('')
      return
    }
    setSelectedAccountingHeadId('')
  }, [referenceType])

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

    const selectedReference = referenceType === 'accounting-head' ? selectedAccountingHead : selectedSupplier
    if (!selectedReference) {
      alert(referenceType === 'accounting-head' ? 'Select account head.' : 'Select supplier.')
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
          billId: buildCashBankPaymentReference(referenceType, selectedReference.id),
          partyId: null,
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

      alert('Cash / bank payment recorded successfully.')
      router.push('/payment/dashboard')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to record cash / bank payment')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <AppLoaderShell
        kind="bank"
        companyId={companyId}
        title="Preparing cash and bank payment"
        message="Loading payment modes, bank master details, and account references."
      />
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Record Cash / Bank Payment</h1>
              <p className="mt-1 text-sm text-slate-600">
                Store direct outgoing payments to accounting heads or suppliers with mode-based bank visibility.
              </p>
            </div>
            <Button variant="outline" onClick={() => router.push('/payment/dashboard')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Payment Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="grid gap-5">
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

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="referenceType">Payment For</Label>
                    <SearchableSelect
                      id="referenceType"
                      value={referenceType}
                      onValueChange={(value) => setReferenceType(value as ReferenceType)}
                      options={referenceTypeItems}
                      placeholder="Select account head or supplier"
                      searchPlaceholder="Search type..."
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="referenceValue">
                      {referenceType === 'accounting-head' ? 'Account Head' : 'Supplier'}
                    </Label>
                    <SearchableSelect
                      id="referenceValue"
                      value={referenceType === 'accounting-head' ? selectedAccountingHeadId : selectedSupplierId}
                      onValueChange={(value) => {
                        if (referenceType === 'accounting-head') {
                          setSelectedAccountingHeadId(value)
                          return
                        }
                        setSelectedSupplierId(value)
                      }}
                      options={referenceType === 'accounting-head' ? accountingHeadItems : supplierItems}
                      placeholder={
                        referenceType === 'accounting-head'
                          ? 'Search and select account head'
                          : 'Search and select supplier'
                      }
                      searchPlaceholder={
                        referenceType === 'accounting-head'
                          ? 'Search account head...'
                          : 'Search supplier...'
                      }
                      emptyText={
                        referenceType === 'accounting-head'
                          ? 'No accounting head found.'
                          : 'No supplier found.'
                      }
                    />
                  </div>
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
                  {referenceType === 'accounting-head' && accountingHeadOptions.length === 0 ? (
                    <Button type="button" variant="outline" onClick={() => router.push('/master/accounting-head')}>
                      <Building2 className="mr-2 h-4 w-4" />
                      Add Accounting Head
                    </Button>
                  ) : null}
                  {referenceType === 'supplier' && supplierOptions.length === 0 ? (
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
        </div>
      </div>
    </DashboardLayout>
  )
}
