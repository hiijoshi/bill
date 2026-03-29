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
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

type PartyRecord = {
  id: string
  name: string
}

type SupplierRecord = {
  id: string
  name: string
}

type SelectOption = {
  value: string
  entityType: 'party' | 'supplier'
  entityId: string
  name: string
  label: string
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
  const [mode, setMode] = useState<'cash' | 'bank'>('cash')
  const [selectedReference, setSelectedReference] = useState('')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')

  const [partyOptions, setPartyOptions] = useState<PartyRecord[]>([])
  const [supplierOptions, setSupplierOptions] = useState<SupplierRecord[]>([])

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
        const [partiesResponse, suppliersResponse] = await Promise.all([
          fetch(`/api/parties?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
          fetch(`/api/suppliers?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
        ])

        const [partiesPayload, suppliersPayload] = await Promise.all([
          partiesResponse.json().catch(() => [] as CollectionPayload<PartyRecord>),
          suppliersResponse.json().catch(() => [] as CollectionPayload<SupplierRecord>)
        ])

        if (cancelled) return

        setPartyOptions(
          normalizeCollection<PartyRecord>(partiesPayload).map((row) => ({
            id: String(row.id || ''),
            name: String(row.name || '').trim()
          })).filter((row) => row.id && row.name)
        )
        setSupplierOptions(
          normalizeCollection<SupplierRecord>(suppliersPayload).map((row) => ({
            id: String(row.id || ''),
            name: String(row.name || '').trim()
          })).filter((row) => row.id && row.name)
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

  const referenceOptions = useMemo<SelectOption[]>(() => {
    const parties = partyOptions.map((party) => ({
      value: `party:${party.id}`,
      entityType: 'party' as const,
      entityId: party.id,
      name: party.name,
      label: `Account Head: ${party.name}`
    }))

    const suppliers = supplierOptions.map((supplier) => ({
      value: `supplier:${supplier.id}`,
      entityType: 'supplier' as const,
      entityId: supplier.id,
      name: supplier.name,
      label: `Supplier: ${supplier.name}`
    }))

    return [...parties, ...suppliers].sort((left, right) => left.label.localeCompare(right.label))
  }, [partyOptions, supplierOptions])

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
          partyId: selectedOption.entityType === 'party' ? selectedOption.entityId : null,
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
              <p className="mt-1 text-sm text-slate-600">Store direct outgoing payments to account heads or suppliers.</p>
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
                    <Select value={mode} onValueChange={(value: 'cash' | 'bank') => setMode(value)}>
                      <SelectTrigger id="paymentMode">
                        <SelectValue placeholder="Select mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="reference">Account Head / Supplier</Label>
                  <Select value={selectedReference} onValueChange={setSelectedReference}>
                    <SelectTrigger id="reference">
                      <SelectValue placeholder="Select account head / supplier" />
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

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="amount">Amount</Label>
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
