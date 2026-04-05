'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CreditCard, Edit, Eye, Plus } from 'lucide-react'

import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { authHeadersScoped } from '@/lib/csrf'
import { readSubscriptionSchemaState } from '@/lib/subscription-schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type TraderRow = {
  id: string
  name: string
  maxCompanies?: number | null
  maxUsers?: number | null
  locked?: boolean
  _count?: { companies: number; users: number }
  createdAt: string
  currentPlanName?: string | null
  subscriptionState?: string
  subscriptionMessage?: string | null
  dataLifecycleState?: string
  lifecycleMessage?: string | null
  daysLeft?: number | null
  readOnlyMode?: boolean
}

type TraderSubscriptionRow = {
  id: string
  currentPlanName: string | null
  subscriptionState: string
  subscriptionMessage: string | null
  dataLifecycleState: string
  lifecycleMessage: string | null
  daysLeft: number | null
  readOnlyMode: boolean
}

type PlanOption = {
  id: string
  name: string
  amount: number
  currency: string
  billingCycle: string
  defaultTrialDays: number | null
  isActive: boolean
  isTrialCapable: boolean
}

type TraderFormState = {
  name: string
  maxCompanies: string
  maxUsers: string
  locked: boolean
  subscriptionMode: 'none' | 'trial' | 'paid'
  planId: string
  trialDays: string
  amount: string
  currency: string
}

function createEmptyTraderForm(): TraderFormState {
  return {
    name: '',
    maxCompanies: '0',
    maxUsers: '0',
    locked: false,
    subscriptionMode: 'none',
    planId: '',
    trialDays: '',
    amount: '',
    currency: 'INR'
  }
}

function formatDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(parsed)
}

function formatLabel(value?: string | null) {
  return String(value || 'none')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getBadgeVariant(value?: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (value === 'trial') return 'secondary'
  if (value === 'active') return 'default'
  if (value === 'expired' || value === 'cancelled' || value === 'suspended' || value === 'deletion_pending') {
    return 'destructive'
  }
  return 'outline'
}

export default function SuperAdminTradersPage() {
  const [traders, setTraders] = useState<TraderRow[]>([])
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [form, setForm] = useState<TraderFormState>(createEmptyTraderForm())
  const [editId, setEditId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [schemaReady, setSchemaReady] = useState(true)
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null)

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === form.planId) || null,
    [form.planId, plans]
  )

  useEffect(() => {
    if (!selectedPlan || editId) return

    setForm((current) => ({
      ...current,
      trialDays:
        current.subscriptionMode === 'trial' && !current.trialDays && selectedPlan.defaultTrialDays
          ? String(selectedPlan.defaultTrialDays)
          : current.trialDays,
      amount:
        current.subscriptionMode === 'paid' && !current.amount ? String(selectedPlan.amount) : current.amount,
      currency: selectedPlan.currency || current.currency
    }))
  }, [editId, selectedPlan])

  const load = async () => {
    setLoading(true)
    setError(null)

    try {
      const [traderResponse, subscriptionResponse, planResponse] = await Promise.all([
        fetch('/api/super-admin/traders', { cache: 'no-store' }),
        fetch('/api/super-admin/trader-subscriptions?includeLocked=true', { cache: 'no-store' }),
        fetch('/api/super-admin/subscription-plans', { cache: 'no-store' })
      ])

      const traderPayload = await traderResponse.json().catch(() => [])
      const subscriptionPayload = await subscriptionResponse.json().catch(() => [])
      const planPayload = await planResponse.json().catch(() => [])

      if (!traderResponse.ok) {
        throw new Error(
          Array.isArray(traderPayload) ? 'Failed to load traders' : traderPayload.error || 'Failed to load traders'
        )
      }

      if (!subscriptionResponse.ok) {
        throw new Error(
          Array.isArray(subscriptionPayload)
            ? 'Failed to load trader subscriptions'
            : subscriptionPayload.error || 'Failed to load trader subscriptions'
        )
      }

      if (!planResponse.ok) {
        throw new Error(
          Array.isArray(planPayload) ? 'Failed to load subscription plans' : planPayload.error || 'Failed to load subscription plans'
        )
      }

      const planSchema = readSubscriptionSchemaState(planResponse.headers)
      const subscriptionSchema = readSubscriptionSchemaState(subscriptionResponse.headers)
      setSchemaReady(planSchema.schemaReady && subscriptionSchema.schemaReady)
      setSchemaWarning(planSchema.schemaWarning || subscriptionSchema.schemaWarning)

      const subscriptionMap = new Map<string, TraderSubscriptionRow>(
        (Array.isArray(subscriptionPayload) ? subscriptionPayload : []).map((row) => [row.id, row as TraderSubscriptionRow])
      )

      const mergedTraders = (Array.isArray(traderPayload) ? traderPayload : []).map((trader) => {
        const summary = subscriptionMap.get(String(trader.id))

        return {
          ...(trader as TraderRow),
          currentPlanName: summary?.currentPlanName || null,
          subscriptionState: summary?.subscriptionState || 'none',
          subscriptionMessage: summary?.subscriptionMessage || null,
          dataLifecycleState: summary?.dataLifecycleState || 'active',
          lifecycleMessage: summary?.lifecycleMessage || null,
          daysLeft: summary?.daysLeft ?? null,
          readOnlyMode: summary?.readOnlyMode ?? false
        }
      })

      setTraders(mergedTraders)
      setPlans(Array.isArray(planPayload) ? (planPayload as PlanOption[]) : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load traders')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const resetForm = () => {
    setForm(createEmptyTraderForm())
    setEditId(null)
  }

  const save = async () => {
    if (!form.name.trim()) {
      setError('Trader name is required')
      return
    }

    if (!editId && form.subscriptionMode !== 'none' && !form.planId) {
      setError('Select a subscription plan before creating the trader')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        maxCompanies: form.maxCompanies.trim() === '' ? 0 : Number(form.maxCompanies),
        maxUsers: form.maxUsers.trim() === '' ? 0 : Number(form.maxUsers),
        locked: form.locked
      }

      if (!editId && form.subscriptionMode !== 'none') {
        payload.subscription = {
          mode: form.subscriptionMode,
          planId: form.planId,
          trialDays: form.subscriptionMode === 'trial' && form.trialDays.trim() ? Number(form.trialDays) : null,
          amount: form.subscriptionMode === 'paid' && form.amount.trim() ? Number(form.amount) : null,
          currency: form.currency.trim() || 'INR',
          notes: 'Assigned during trader creation'
        }
      }

      const response = await fetch(editId ? `/api/super-admin/traders/${editId}` : '/api/super-admin/traders', {
        method: editId ? 'PUT' : 'POST',
        headers: authHeadersScoped('super_admin'),
        body: JSON.stringify(payload)
      })

      const responsePayload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(responsePayload.error || 'Failed to save trader')
      }

      resetForm()
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save trader')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (trader: TraderRow) => {
    setError(null)
    setEditId(trader.id)
    setForm({
      name: trader.name,
      maxCompanies: String(trader.maxCompanies ?? 0),
      maxUsers: String(trader.maxUsers ?? 0),
      locked: trader.locked === true,
      subscriptionMode: 'none',
      planId: '',
      trialDays: '',
      amount: '',
      currency: 'INR'
    })
  }

  return (
    <SuperAdminShell
      title="Trader Management"
      subtitle="Create traders, assign trial or paid plan at creation, and jump into advanced subscription actions from the same screen."
    >
      <div className="space-y-6">
        {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        {schemaWarning ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {schemaWarning}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{editId ? 'Edit Trader' : 'Create Trader With Subscription'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-3">
                <Label htmlFor="trader-name">Trader Name</Label>
                <Input
                  id="trader-name"
                  placeholder="Trader name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="trader-max-companies">Company Limit</Label>
                <Input
                  id="trader-max-companies"
                  type="number"
                  min="0"
                  value={form.maxCompanies}
                  onChange={(event) => setForm((current) => ({ ...current, maxCompanies: event.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="trader-max-users">User Limit</Label>
                <Input
                  id="trader-max-users"
                  type="number"
                  min="0"
                  value={form.maxUsers}
                  onChange={(event) => setForm((current) => ({ ...current, maxUsers: event.target.value }))}
                />
              </div>

              <div className="flex items-end gap-2">
                <input
                  id="trader-locked"
                  type="checkbox"
                  checked={form.locked}
                  onChange={(event) => setForm((current) => ({ ...current, locked: event.target.checked }))}
                />
                <Label htmlFor="trader-locked">Locked</Label>
              </div>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Initial Subscription</div>
                  <div className="text-xs text-slate-500">
                    Assign the trader to a trial or paid plan during creation so there is no extra step later.
                  </div>
                </div>
                {!editId ? (
                  <Link href="/super-admin/subscriptions" className="text-xs text-slate-600 underline-offset-4 hover:underline">
                    Advanced subscription actions
                  </Link>
                ) : null}
              </div>

              {editId ? (
                <div className="text-sm text-slate-600">
                  Trader update only changes base trader fields here. Use the subscription page for renew, extend, suspend,
                  cancel, backup, or deletion workflow.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <Label>Assign Plan</Label>
                    <Select
                      value={form.subscriptionMode}
                      onValueChange={(value: 'none' | 'trial' | 'paid') =>
                        setForm((current) => ({
                          ...current,
                          subscriptionMode: value,
                          planId: value === 'none' ? '' : current.planId
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select assignment" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Create Without Subscription</SelectItem>
                        <SelectItem value="trial">Create With Trial</SelectItem>
                        <SelectItem value="paid">Create With Paid Plan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Plan</Label>
                    <Select
                      value={form.planId}
                      onValueChange={(value) => setForm((current) => ({ ...current, planId: value }))}
                      disabled={form.subscriptionMode === 'none' || !schemaReady || plans.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            !schemaReady
                              ? 'Subscription schema unavailable'
                              : plans.length === 0
                                ? 'No active plans'
                                : 'Select plan'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {plans
                          .filter((plan) => (form.subscriptionMode === 'trial' ? plan.isTrialCapable : true))
                          .map((plan) => (
                            <SelectItem key={plan.id} value={plan.id}>
                              {plan.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {form.subscriptionMode === 'trial' ? (
                    <div>
                      <Label>Trial Days</Label>
                      <Input
                        type="number"
                        min="1"
                        max="365"
                        value={form.trialDays}
                        onChange={(event) => setForm((current) => ({ ...current, trialDays: event.target.value }))}
                        placeholder={selectedPlan?.defaultTrialDays ? String(selectedPlan.defaultTrialDays) : '15'}
                      />
                    </div>
                  ) : null}

                  {form.subscriptionMode === 'paid' ? (
                    <>
                      <div>
                        <Label>Amount</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.amount}
                          onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                          placeholder={selectedPlan ? String(selectedPlan.amount) : '0'}
                        />
                      </div>
                      <div>
                        <Label>Currency</Label>
                        <Input
                          value={form.currency}
                          onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {!editId && form.subscriptionMode !== 'none' && selectedPlan ? (
                <div className="mt-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  <span className="font-medium text-slate-900">{selectedPlan.name}</span>
                  {' '}| Billing: {formatLabel(selectedPlan.billingCycle)}
                  {' '}| Default amount: {selectedPlan.currency} {selectedPlan.amount}
                  {' '}| Trial capable: {selectedPlan.isTrialCapable ? 'Yes' : 'No'}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={saving}>
                <Plus className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : editId ? 'Update Trader' : 'Create Trader'}
              </Button>
              {editId ? (
                <Button variant="outline" onClick={resetForm} disabled={saving}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Traders</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Companies</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-slate-500">
                      Loading traders...
                    </TableCell>
                  </TableRow>
                ) : traders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-sm text-slate-500">
                      No traders found.
                    </TableCell>
                  </TableRow>
                ) : (
                  traders.map((trader) => {
                    const displayState =
                      trader.dataLifecycleState && trader.dataLifecycleState !== 'active'
                        ? trader.dataLifecycleState
                        : trader.subscriptionState

                    return (
                      <TableRow key={trader.id}>
                        <TableCell>
                          <div className="font-medium text-slate-900">{trader.name}</div>
                          <div className="text-xs text-slate-500">
                            {trader.lifecycleMessage || trader.subscriptionMessage || (trader.locked ? 'Locked trader' : 'No active subscription message')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-slate-900">{trader.currentPlanName || '-'}</div>
                          <div className="text-xs text-slate-500">
                            {trader.daysLeft !== null && trader.daysLeft !== undefined ? `${trader.daysLeft} day(s) left` : '-'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getBadgeVariant(displayState)}>{formatLabel(displayState)}</Badge>
                          {trader.readOnlyMode ? <div className="mt-1 text-xs text-amber-700">Read only</div> : null}
                        </TableCell>
                        <TableCell>{trader._count?.companies ?? 0}</TableCell>
                        <TableCell>{trader._count?.users ?? 0}</TableCell>
                        <TableCell>{formatDate(trader.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => openEdit(trader)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/super-admin/traders/${trader.id}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/super-admin/subscriptions?traderId=${encodeURIComponent(trader.id)}`}>
                                <CreditCard className="h-4 w-4" />
                                Subscription
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </SuperAdminShell>
  )
}
