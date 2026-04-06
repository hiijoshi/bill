'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Repeat } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { AppLoaderShell } from '@/components/loaders/app-loader-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  buildSelfTransferReference,
  SELF_TRANSFER_PAYMENT_TYPE
} from '@/lib/payment-entry-types'
import { invalidateAppDataCaches, notifyAppDataChanged } from '@/lib/app-live-data'
import { loadClientCachedValue } from '@/lib/client-cached-value'
import { APP_COMPANY_CHANGED_EVENT, resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'
import { getDefaultTransactionDateInput } from '@/lib/client-financial-years'
import { useClientFinancialYear } from '@/lib/use-client-financial-year'

type BankRecord = {
  id: string
  name: string
  branch?: string | null
}

type TransferOption = {
  value: string
  label: string
}

type CollectionPayload<T> =
  | T[]
  | {
      data?: T[]
    }

const SELF_TRANSFER_BANK_CACHE_AGE_MS = 30_000

function normalizeCollection<T>(payload: CollectionPayload<T>): T[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
    return payload.data
  }
  return []
}

export default function SelfTransferEntryPage() {
  return (
    <Suspense fallback={<AppLoaderShell kind="transfer" fullscreen />}>
      <SelfTransferEntryPageContent />
    </Suspense>
  )
}

function SelfTransferEntryPageContent() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const { financialYear } = useClientFinancialYear()

  const [transferDate, setTransferDate] = useState('')
  const [fromAccount, setFromAccount] = useState('cash')
  const [toAccount, setToAccount] = useState('')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')

  const [banks, setBanks] = useState<BankRecord[]>([])

  useEffect(() => {
    setTransferDate(getDefaultTransactionDateInput(financialYear))
  }, [financialYear?.id])

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
        const normalizedBanks = await loadClientCachedValue<BankRecord[]>(
          `payment-banks:${companyId}`,
          async () => {
            const response = await fetch(`/api/banks?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
            const payload = await response.json().catch(() => [] as CollectionPayload<BankRecord>)

            return normalizeCollection<BankRecord>(payload)
              .map((row) => ({
                id: String(row.id || ''),
                name: String(row.name || '').trim(),
                branch: String(row.branch || '').trim()
              }))
              .filter((row) => row.id && row.name)
          },
          { maxAgeMs: SELF_TRANSFER_BANK_CACHE_AGE_MS }
        )
        if (cancelled) return

        setBanks(normalizedBanks)
        setToAccount((current) => current || normalizedBanks[0]?.id || '')
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

  const transferOptions = useMemo<TransferOption[]>(() => {
    return [
      { value: 'cash', label: 'Cash' },
      ...banks.map((bank) => ({
        value: bank.id,
        label: bank.branch ? `${bank.name} (${bank.branch})` : bank.name
      }))
    ]
  }, [banks])

  const optionLabelMap = useMemo(() => {
    return new Map(transferOptions.map((option) => [option.value, option.label]))
  }, [transferOptions])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
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

    const transferAmount = Number(amount)
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      alert('Enter a valid amount.')
      return
    }

    if (!transferDate) {
      alert('Date is required.')
      return
    }

    setSubmitting(true)

    try {
      const fromLabel = optionLabelMap.get(fromAccount) || 'From'
      const toLabel = optionLabelMap.get(toAccount) || 'To'

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
          amount: transferAmount,
          mode: 'transfer',
          bankNameSnapshot: fromLabel,
          bankBranchSnapshot: toLabel,
          note: remark.trim() || null,
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

  if (loading) {
    return (
      <AppLoaderShell
        kind="transfer"
        companyId={companyId}
        title="Preparing self transfer"
        message="Connecting cash and bank accounts for internal transfer recording."
      />
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Record Self Transfer</h1>
              <p className="mt-1 text-sm text-slate-600">Track internal movement between cash and bank accounts.</p>
            </div>
            <Button variant="outline" onClick={() => router.push('/payment/dashboard')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Repeat className="h-5 w-5" />
                Transfer Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="grid gap-5">
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
                    <Select value={fromAccount} onValueChange={setFromAccount}>
                      <SelectTrigger id="fromAccount">
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                      <SelectContent>
                        {transferOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="toAccount">To</Label>
                    <Select value={toAccount} onValueChange={setToAccount}>
                      <SelectTrigger id="toAccount">
                        <SelectValue placeholder="Select destination" />
                      </SelectTrigger>
                      <SelectContent>
                        {transferOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                    {submitting ? 'Saving...' : 'Save Transfer'}
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
