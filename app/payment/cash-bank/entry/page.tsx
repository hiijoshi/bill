'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Wallet } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  buildCashBankPaymentReference,
  CASH_BANK_PAYMENT_TYPE
} from '@/lib/payment-entry-types'
import {
  DEFAULT_PAYMENT_MODES,
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
}

type PaymentModeRecord = PaymentModeOption

type SelectOption = {
  value: string
  entityType: 'accounting-head' | 'supplier'
  entityId: string
  name: string
  label: string
  category?: string
  amount?: number
  valueAmount?: number
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

export default function CashBankPaymentEntryPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
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
  const [selectedReference, setSelectedReference] = useState('')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')

  const [accountingHeadOptions, setAccountingHeadOptions] = useState<AccountingHeadRecord[]>([])
  const [supplierOptions, setSupplierOptions] = useState<SupplierRecord[]>([])
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
        const [accountingHeadsResponse, suppliersResponse, paymentModesResponse] = await Promise.all([
          fetch(`/api/accounting-heads?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
          fetch(`/api/suppliers?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
          fetch(`/api/payment-modes?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
        ])

        const [accountingHeadsPayload, suppliersPayload, paymentModesPayload] = await Promise.all([
          accountingHeadsResponse.json().catch(() => [] as CollectionPayload<AccountingHeadRecord>),
          suppliersResponse.json().catch(() => [] as CollectionPayload<SupplierRecord>),
          paymentModesResponse.json().catch(() => [] as CollectionPayload<PaymentModeRecord>)
        ])

        if (cancelled) return

        setAccountingHeadOptions(
          normalizeCollection<AccountingHeadRecord>(accountingHeadsPayload).map((row) => ({
            id: String(row.id || ''),
            name: String(row.name || '').trim(),
            category: String(row.category || '').trim(),
            amount: Number(row.amount || 0),
            value: Number(row.value || 0)
          })).filter((row) => row.id && row.name)
        )
        setSupplierOptions(
          normalizeCollection<SupplierRecord>(suppliersPayload).map((row) => ({
            id: String(row.id || ''),
            name: String(row.name || '').trim()
          })).filter((row) => row.id && row.name)
        )
        setPaymentModes(
          normalizeCollection<PaymentModeRecord>(paymentModesPayload).map((row) => ({
            id: String(row.id || ''),
            name: String(row.name || '').trim(),
            code: String(row.code || '').trim(),
            isActive: row.isActive !== false
          })).filter((row) => row.id && row.name && row.code && row.isActive)
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
    const hasSelectedMode = paymentModeOptions.some((option) => option.code === mode)
    if (hasSelectedMode) return
    setMode(paymentModeOptions[0]?.code || 'cash')
  }, [mode, paymentModeOptions])

  const referenceOptions = useMemo<SelectOption[]>(() => {
    const accountingHeads = accountingHeadOptions.map((head) => ({
      value: `accounting-head:${head.id}`,
      entityType: 'accounting-head' as const,
      entityId: head.id,
      name: head.name,
      label: head.category ? `Accounting Head: ${head.name} (${head.category})` : `Accounting Head: ${head.name}`,
      category: head.category,
      amount: Number(head.amount || 0),
      valueAmount: Number(head.value || 0)
    }))

    const suppliers = supplierOptions.map((supplier) => ({
      value: `supplier:${supplier.id}`,
      entityType: 'supplier' as const,
      entityId: supplier.id,
      name: supplier.name,
      label: `Supplier: ${supplier.name}`
    }))

    return [...accountingHeads, ...suppliers].sort((left, right) => left.label.localeCompare(right.label))
  }, [accountingHeadOptions, supplierOptions])

  const selectedAccountingHead = useMemo(() => {
    const selectedOption = referenceOptions.find((option) => option.value === selectedReference)
    if (!selectedOption || selectedOption.entityType !== 'accounting-head') return null
    return selectedOption
  }, [referenceOptions, selectedReference])

  useEffect(() => {
    if (!selectedAccountingHead) return
    if (amount.trim()) return

    const configuredAmount = Number(selectedAccountingHead.amount || 0)
    if (configuredAmount > 0) {
      setAmount(String(configuredAmount))
    }
  }, [amount, selectedAccountingHead])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!companyId) {
      alert('Company not selected.')
      return
    }

    const selectedOption = referenceOptions.find((option) => option.value === selectedReference)
    if (!selectedOption) {
      alert('Select account head / supplier.')
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
          billId: buildCashBankPaymentReference(selectedOption.entityType, selectedOption.entityId),
          partyId: null,
          payDate: paymentDate,
          amount: paymentAmount,
          mode,
          bankNameSnapshot: selectedOption.name,
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
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Record Cash / Bank Payment</h1>
              <p className="mt-1 text-sm text-slate-600">Store direct outgoing payments to accounting heads or suppliers.</p>
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
                    <Select value={mode} onValueChange={setMode}>
                      <SelectTrigger id="paymentMode">
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentModeOptions.map((paymentMode) => (
                          <SelectItem key={paymentMode.id} value={paymentMode.code}>
                            {paymentMode.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="reference">Account Head / Supplier</Label>
                  <Select value={selectedReference} onValueChange={setSelectedReference}>
                    <SelectTrigger id="reference">
                      <SelectValue placeholder="Select accounting head / supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {referenceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedAccountingHead && (
                  <div className="grid gap-4 rounded-lg border bg-slate-50 p-4 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label htmlFor="selectedHeadCategory">Category</Label>
                      <Input
                        id="selectedHeadCategory"
                        value={selectedAccountingHead.category || ''}
                        readOnly
                      />
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
                        value={Number(selectedAccountingHead.valueAmount || 0).toFixed(2)}
                        readOnly
                      />
                    </div>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="amount">Payment Amount</Label>
                    <Input
                      id="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
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
                  {accountingHeadOptions.length === 0 && (
                    <Button type="button" variant="outline" onClick={() => router.push('/master/accounting-head')}>
                      Add Accounting Head
                    </Button>
                  )}
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
