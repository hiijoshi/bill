'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { authHeadersScoped } from '@/lib/csrf'
import { readSubscriptionSchemaState } from '@/lib/subscription-schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type TraderRow = {
  id: string
  name: string
  locked: boolean
  currentCompanies: number
  currentUsers: number
  maxCompanies: number | null
  maxUsers: number | null
  subscriptionConfigured: boolean
  subscriptionState: string
  subscriptionMessage: string | null
  dataLifecycleState: string
  readOnlyMode: boolean
  lifecycleMessage: string | null
  latestBackupStatus: string | null
  latestBackupCreatedAt: string | null
  latestReadyBackupAt: string | null
  scheduledDeletionAt: string | null
  closureRequestedAt: string | null
  daysLeft: number | null
  currentPlanName: string | null
  subscriptionType: string | null
  status: string | null
  startDate: string | null
  endDate: string | null
  amount: number | null
  currency: string | null
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

type TraderDetailPayload = {
  trader?: {
    id: string
    name: string
    locked: boolean
    maxCompanies: number | null
    maxUsers: number | null
    currentCompanies: number
    currentUsers: number
    limitSource: string
  }
  entitlement?: {
    lifecycleState?: string
    message?: string | null
    daysLeft?: number | null
  } | null
  dataLifecycle?: {
    state?: string | null
    readOnlyMode?: boolean
    message?: string | null
    allowBackupRequest?: boolean
    latestBackup?: {
      id: string
      status: string
      fileName: string | null
      createdAt: string
      exportedAt: string | null
    } | null
    latestReadyBackup?: {
      id: string
      status: string
      fileName: string | null
      createdAt: string
      exportedAt: string | null
    } | null
    closureRequestedAt?: string | null
    closureRequestSource?: string | null
    closureNotes?: string | null
    retentionDays?: number | null
    scheduledDeletionAt?: string | null
  } | null
  currentSubscription?: {
    id: string
    planName: string | null
    subscriptionType: string
    lifecycleState: string
    status: string
    billingCycle: string | null
    amount: number
    currency: string
    startDate: string
    endDate: string
    features: Array<{ featureKey: string; featureLabel: string; enabled: boolean }>
  } | null
  history?: Array<{
    id: string
    planName: string | null
    subscriptionType: string
    lifecycleState: string
    status: string
    startDate: string
    endDate: string
    amount: number
    currency: string
  }>
  payments?: Array<{
    id: string
    amount: number
    currency: string
    status: string
    paymentMode: string
    referenceNo: string | null
    paidAt: string | null
    planNameSnapshot: string | null
  }>
  backups?: Array<{
    id: string
    status: string
    format: string
    fileName: string | null
    exportedAt: string | null
    downloadCount: number
    createdAt: string
    errorMessage?: string | null
  }>
}

type ActionFormState = {
  action:
    | 'assign_trial'
    | 'assign_paid'
    | 'renew_paid'
    | 'convert_to_paid'
    | 'extend'
    | 'cancel'
    | 'suspend'
    | 'activate'
    | 'request_backup'
    | 'mark_read_only'
    | 'restore_access'
    | 'request_closure'
    | 'update_retention'
    | 'mark_deletion_pending'
    | 'confirm_final_deletion'
  planId: string
  backupId: string
  startDate: string
  endDate: string
  trialDays: string
  extendDays: string
  retentionDays: string
  amount: string
  currency: string
  paymentMode: string
  referenceNo: string
  paidAt: string
  readOnlyState: 'expired' | 'cancelled'
  confirmDeletion: boolean
  notes: string
  replaceExisting: boolean
}

function createEmptyActionForm(): ActionFormState {
  return {
    action: 'assign_trial',
    planId: '',
    backupId: '',
    startDate: '',
    endDate: '',
    trialDays: '',
    extendDays: '',
    retentionDays: '',
    amount: '',
    currency: 'INR',
    paymentMode: 'manual',
    referenceNo: '',
    paidAt: '',
    readOnlyState: 'cancelled',
    confirmDeletion: false,
    notes: '',
    replaceExisting: false
  }
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(parsed)
}

function formatAmount(amount?: number | null, currency = 'INR') {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '-'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(amount)
}

function formatLabel(value?: string | null) {
  return String(value || '-')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getBadgeVariant(value?: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (value === 'trial') return 'secondary'
  if (value === 'backup_ready') return 'secondary'
  if (value === 'active') return 'default'
  if (value === 'expired' || value === 'cancelled' || value === 'suspended' || value === 'deletion_pending') return 'destructive'
  return 'outline'
}

export default function SuperAdminTraderSubscriptionsPage() {
  const searchParams = useSearchParams()
  const requestedTraderId = String(searchParams.get('traderId') || '').trim()
  const [traders, setTraders] = useState<TraderRow[]>([])
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [selectedTraderId, setSelectedTraderId] = useState<string>('')
  const [detail, setDetail] = useState<TraderDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [expiringWithinDays, setExpiringWithinDays] = useState('30')
  const [error, setError] = useState<string | null>(null)
  const [schemaReady, setSchemaReady] = useState(true)
  const [schemaWarning, setSchemaWarning] = useState<string | null>(null)
  const [form, setForm] = useState<ActionFormState>(createEmptyActionForm())

  const loadPlans = useCallback(async () => {
    const response = await fetch('/api/super-admin/subscription-plans?includeInactive=true', { cache: 'no-store' })
    const schemaState = readSubscriptionSchemaState(response.headers)
    setSchemaReady((current) => current && schemaState.schemaReady)
    setSchemaWarning(schemaState.schemaWarning)
    const payload = (await response.json().catch(() => [])) as PlanOption[]
    setPlans(Array.isArray(payload) ? payload : [])
  }, [])

  const loadTraders = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('query', query.trim())
      if (expiringWithinDays.trim()) params.set('expiringWithinDays', expiringWithinDays.trim())

      const response = await fetch(`/api/super-admin/trader-subscriptions?${params.toString()}`, { cache: 'no-store' })
      const schemaState = readSubscriptionSchemaState(response.headers)
      setSchemaReady(schemaState.schemaReady)
      setSchemaWarning(schemaState.schemaWarning)
      const payload = (await response.json().catch(() => [])) as TraderRow[] | { error?: string }
      if (!response.ok) {
        throw new Error(Array.isArray(payload) ? 'Failed to load traders' : payload.error || 'Failed to load traders')
      }

      const rows = Array.isArray(payload) ? payload : []
      setTraders(rows)
      if (!selectedTraderId && rows[0]?.id) {
        setSelectedTraderId(rows[0].id)
      }
      if (selectedTraderId && !rows.some((row) => row.id === selectedTraderId)) {
        setSelectedTraderId(rows[0]?.id || '')
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load traders')
    } finally {
      setLoading(false)
    }
  }, [expiringWithinDays, query, selectedTraderId])

  const loadDetail = useCallback(async (traderId: string) => {
    if (!traderId) {
      setDetail(null)
      return
    }

    setDetailLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/super-admin/trader-subscriptions/${traderId}`, { cache: 'no-store' })
      const schemaState = readSubscriptionSchemaState(response.headers)
      setSchemaReady(schemaState.schemaReady)
      setSchemaWarning(schemaState.schemaWarning)
      const payload = (await response.json().catch(() => ({}))) as TraderDetailPayload & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load trader detail')
      }
      setDetail(payload)
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : 'Failed to load trader detail')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!requestedTraderId) return
    setSelectedTraderId(requestedTraderId)
  }, [requestedTraderId])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  useEffect(() => {
    void loadTraders()
  }, [loadTraders])

  useEffect(() => {
    void loadDetail(selectedTraderId)
  }, [loadDetail, selectedTraderId])

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === form.planId) || null,
    [form.planId, plans]
  )

  useEffect(() => {
    if (!selectedPlan) return
    setForm((current) => ({
      ...current,
      amount:
        current.action === 'assign_paid' || current.action === 'renew_paid' || current.action === 'convert_to_paid'
          ? String(selectedPlan.amount)
          : current.amount,
      currency: selectedPlan.currency,
      trialDays: current.action === 'assign_trial' && selectedPlan.defaultTrialDays ? String(selectedPlan.defaultTrialDays) : current.trialDays
    }))
  }, [selectedPlan])

  useEffect(() => {
    const readyBackupId = detail?.dataLifecycle?.latestReadyBackup?.id || detail?.backups?.find((backup) => backup.status === 'ready')?.id || ''
    if (!readyBackupId) return
    if (form.backupId) return
    if (form.action !== 'mark_deletion_pending' && form.action !== 'confirm_final_deletion') return

    setForm((current) => ({
      ...current,
      backupId: readyBackupId
    }))
  }, [detail, form.action, form.backupId])

  const submitAction = async () => {
    if (!selectedTraderId) return

    setSaving(true)
    setError(null)

    try {
      const payload = {
        action: form.action,
        planId: form.planId || null,
        backupId: form.backupId || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        trialDays: form.trialDays.trim() ? Number(form.trialDays) : null,
        extendDays: form.extendDays.trim() ? Number(form.extendDays) : null,
        retentionDays: form.retentionDays.trim() ? Number(form.retentionDays) : null,
        amount: form.amount.trim() ? Number(form.amount) : null,
        currency: form.currency.trim() || 'INR',
        paymentMode: form.paymentMode.trim() || 'manual',
        referenceNo: form.referenceNo.trim() || null,
        paidAt: form.paidAt || null,
        readOnlyState: form.readOnlyState,
        confirmDeletion: form.confirmDeletion,
        notes: form.notes.trim() || null,
        replaceExisting: form.replaceExisting
      }

      const response = await fetch(`/api/super-admin/trader-subscriptions/${selectedTraderId}/actions`, {
        method: 'POST',
        headers: authHeadersScoped('super_admin'),
        body: JSON.stringify(payload)
      })

      const result = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(result.error || 'Failed to apply subscription action')
      }

      setForm(createEmptyActionForm())
      await Promise.all([loadTraders(), loadDetail(selectedTraderId)])
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to apply subscription action')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SuperAdminShell
      title="Trader Subscriptions"
      subtitle="Assign trials, activate paid plans, extend validity, and monitor expiring trader subscriptions."
    >
      <div className="space-y-6">
        {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {schemaWarning ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {schemaWarning}
          </div>
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Expiring and Current Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <Input
                placeholder="Search trader or plan"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Input
                type="number"
                min="0"
                placeholder="Expiring within days"
                value={expiringWithinDays}
                onChange={(event) => setExpiringWithinDays(event.target.value)}
              />
              <Button variant="outline" onClick={() => void loadTraders()} disabled={loading}>
                Refresh List
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trader</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Days Left</TableHead>
                  <TableHead>Limits</TableHead>
                  <TableHead>Open</TableHead>
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
                      No traders matched the current filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  traders.map((trader) => (
                    <TableRow key={trader.id} className={selectedTraderId === trader.id ? 'bg-slate-50' : ''}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{trader.name}</div>
                        <div className="text-xs text-slate-500">
                          {trader.lifecycleMessage || trader.subscriptionMessage || '-'}
                        </div>
                      </TableCell>
                      <TableCell>{trader.currentPlanName || '-'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={getBadgeVariant(
                            trader.dataLifecycleState && trader.dataLifecycleState !== 'active'
                              ? trader.dataLifecycleState
                              : trader.subscriptionState
                          )}
                        >
                          {formatLabel(
                            trader.dataLifecycleState && trader.dataLifecycleState !== 'active'
                              ? trader.dataLifecycleState
                              : trader.subscriptionState
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(trader.endDate)}</TableCell>
                      <TableCell>{trader.daysLeft ?? '-'}</TableCell>
                      <TableCell>
                        C {trader.currentCompanies}/{trader.maxCompanies ?? 'U'} | U {trader.currentUsers}/{trader.maxUsers ?? 'U'}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setSelectedTraderId(trader.id)}>
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Selected Trader Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {detailLoading ? (
                <div className="text-sm text-slate-500">Loading trader detail...</div>
              ) : detail?.trader ? (
                <>
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Trader</div>
                      <div className="mt-1 font-semibold text-slate-900">{detail.trader.name}</div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Current State</div>
                      <div className="mt-1">
                        <Badge variant={getBadgeVariant(detail.dataLifecycle?.state || detail.entitlement?.lifecycleState)}>
                          {formatLabel(detail.dataLifecycle?.state || detail.entitlement?.lifecycleState)}
                        </Badge>
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Company Limit</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {detail.trader.currentCompanies} / {detail.trader.maxCompanies ?? 'U'}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">User Limit</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {detail.trader.currentUsers} / {detail.trader.maxUsers ?? 'U'}
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {detail.dataLifecycle?.message || detail.entitlement?.message || 'No current subscription message.'}
                  </div>

                  <div className="rounded border border-slate-200 px-3 py-3">
                    <div className="mb-2 text-sm font-semibold text-slate-900">Current Subscription</div>
                    {detail.currentSubscription ? (
                      <div className="grid gap-3 md:grid-cols-4 text-sm">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">Plan</div>
                          <div className="mt-1 text-slate-900">{detail.currentSubscription.planName || '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">Type</div>
                          <div className="mt-1 text-slate-900">{formatLabel(detail.currentSubscription.subscriptionType)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">Window</div>
                          <div className="mt-1 text-slate-900">
                            {formatDate(detail.currentSubscription.startDate)} to {formatDate(detail.currentSubscription.endDate)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">Amount</div>
                          <div className="mt-1 text-slate-900">
                            {formatAmount(detail.currentSubscription.amount, detail.currentSubscription.currency)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">No subscription assigned yet.</div>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Read Only</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {detail.dataLifecycle?.readOnlyMode ? 'Yes' : 'No'}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Latest Ready Backup</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatDate(detail.dataLifecycle?.latestReadyBackup?.exportedAt)}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Closure Request</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatDate(detail.dataLifecycle?.closureRequestedAt)}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Deletion Schedule</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatDate(detail.dataLifecycle?.scheduledDeletionAt)}
                      </div>
                    </div>
                  </div>

                  {(detail.backups || []).length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Backup</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Exported</TableHead>
                          <TableHead>Downloads</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(detail.backups || []).map((backup) => (
                          <TableRow key={backup.id}>
                            <TableCell>{backup.fileName || `${backup.format}.json`}</TableCell>
                            <TableCell>{formatLabel(backup.status)}</TableCell>
                            <TableCell>{formatDate(backup.exportedAt)}</TableCell>
                            <TableCell>{backup.downloadCount}</TableCell>
                            <TableCell>
                              {backup.status === 'ready' ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    window.open(`/api/subscription/backups/${backup.id}/download`, '_blank', 'noopener')
                                  }
                                >
                                  Download
                                </Button>
                              ) : (
                                <span className="text-xs text-slate-500">{backup.errorMessage || '-'}</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>History</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Start</TableHead>
                        <TableHead>End</TableHead>
                        <TableHead>Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detail.history || []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-sm text-slate-500">
                            No subscription history recorded.
                          </TableCell>
                        </TableRow>
                      ) : (
                        (detail.history || []).map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{row.planName || '-'}</TableCell>
                            <TableCell>{formatLabel(row.subscriptionType)}</TableCell>
                            <TableCell>{formatLabel(row.lifecycleState)}</TableCell>
                            <TableCell>{formatDate(row.startDate)}</TableCell>
                            <TableCell>{formatDate(row.endDate)}</TableCell>
                            <TableCell>{formatAmount(row.amount, row.currency)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <div className="text-sm text-slate-500">Select a trader to manage subscription.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Subscription Action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Action</span>
                  <select
                    className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                    value={form.action}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        action: event.target.value as ActionFormState['action']
                      }))
                    }
                  >
                    <option value="assign_trial">Assign Trial</option>
                    <option value="assign_paid">Assign Paid</option>
                    <option value="renew_paid">Renew Paid</option>
                    <option value="convert_to_paid">Convert Trial to Paid</option>
                    <option value="extend">Extend Subscription</option>
                    <option value="cancel">Cancel</option>
                    <option value="suspend">Suspend</option>
                    <option value="activate">Activate / Resume</option>
                    <option value="request_backup">Generate Backup</option>
                    <option value="mark_read_only">Mark Read Only</option>
                    <option value="restore_access">Restore Access</option>
                    <option value="request_closure">Request Closure Review</option>
                    <option value="update_retention">Update Retention</option>
                    <option value="mark_deletion_pending">Mark Deletion Pending</option>
                    <option value="confirm_final_deletion">Confirm Final Delete</option>
                  </select>
                </label>

                {form.action === 'assign_trial' || form.action === 'assign_paid' || form.action === 'renew_paid' || form.action === 'convert_to_paid' ? (
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Plan</span>
                    <select
                      className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                      value={form.planId}
                      onChange={(event) => setForm((current) => ({ ...current, planId: event.target.value }))}
                    >
                      <option value="">Select plan</option>
                      {plans
                        .filter((plan) =>
                          form.action === 'assign_trial' ? plan.isTrialCapable : true
                        )
                        .map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name} ({plan.currency} {plan.amount.toFixed(2)})
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}

                {(form.action === 'assign_trial' || form.action === 'assign_paid' || form.action === 'renew_paid' || form.action === 'convert_to_paid') ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      type="date"
                      value={form.startDate}
                      onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
                    />
                    <Input
                      type="date"
                      value={form.endDate}
                      onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
                    />
                  </div>
                ) : null}

                {form.action === 'assign_trial' ? (
                  <Input
                    type="number"
                    min="1"
                    placeholder="Trial days"
                    value={form.trialDays}
                    onChange={(event) => setForm((current) => ({ ...current, trialDays: event.target.value }))}
                  />
                ) : null}

                {form.action === 'extend' ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      type="number"
                      min="1"
                      placeholder="Extend days"
                      value={form.extendDays}
                      onChange={(event) => setForm((current) => ({ ...current, extendDays: event.target.value }))}
                    />
                    <Input
                      type="date"
                      value={form.endDate}
                      onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
                    />
                  </div>
                ) : null}

                {(form.action === 'mark_read_only' || form.action === 'update_retention' || form.action === 'mark_deletion_pending') ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {form.action === 'mark_read_only' ? (
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Read Only State</span>
                        <select
                          className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                          value={form.readOnlyState}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              readOnlyState: event.target.value as 'expired' | 'cancelled'
                            }))
                          }
                        >
                          <option value="cancelled">Cancelled</option>
                          <option value="expired">Expired</option>
                        </select>
                      </label>
                    ) : null}
                    <Input
                      type="number"
                      min="0"
                      placeholder="Retention days"
                      value={form.retentionDays}
                      onChange={(event) => setForm((current) => ({ ...current, retentionDays: event.target.value }))}
                    />
                  </div>
                ) : null}

                {(form.action === 'mark_deletion_pending' || form.action === 'confirm_final_deletion') ? (
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Ready Backup</span>
                    <select
                      className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                      value={form.backupId}
                      onChange={(event) => setForm((current) => ({ ...current, backupId: event.target.value }))}
                    >
                      <option value="">Select backup</option>
                      {(detail?.backups || [])
                        .filter((backup) => backup.status === 'ready')
                        .map((backup) => (
                          <option key={backup.id} value={backup.id}>
                            {backup.fileName || `${backup.format}.json`} ({formatDate(backup.exportedAt || backup.createdAt)})
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}

                {(form.action === 'assign_paid' || form.action === 'renew_paid' || form.action === 'convert_to_paid') ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      type="number"
                      min="0"
                      placeholder="Amount"
                      value={form.amount}
                      onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                    />
                    <Input
                      placeholder="Currency"
                      value={form.currency}
                      onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                    />
                    <Input
                      placeholder="Payment mode"
                      value={form.paymentMode}
                      onChange={(event) => setForm((current) => ({ ...current, paymentMode: event.target.value }))}
                    />
                    <Input
                      placeholder="Reference no"
                      value={form.referenceNo}
                      onChange={(event) => setForm((current) => ({ ...current, referenceNo: event.target.value }))}
                    />
                    <Input
                      type="date"
                      value={form.paidAt}
                      onChange={(event) => setForm((current) => ({ ...current, paidAt: event.target.value }))}
                    />
                  </div>
                ) : null}

                {form.action === 'assign_trial' || form.action === 'assign_paid' ? (
                  <label className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.replaceExisting}
                      onChange={() => setForm((current) => ({ ...current, replaceExisting: !current.replaceExisting }))}
                    />
                    Replace existing non-terminal subscription
                  </label>
                ) : null}

                {form.action === 'confirm_final_deletion' ? (
                  <label className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <input
                      type="checkbox"
                      checked={form.confirmDeletion}
                      onChange={() => setForm((current) => ({ ...current, confirmDeletion: !current.confirmDeletion }))}
                    />
                    I confirm final deletion after verified backup.
                  </label>
                ) : null}

                <textarea
                  rows={4}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none"
                  placeholder="Notes for this action"
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                />

                <Button onClick={() => void submitAction()} disabled={saving || !schemaReady || !selectedTraderId}>
                  {saving ? 'Saving...' : 'Apply Action'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </SuperAdminShell>
  )
}
