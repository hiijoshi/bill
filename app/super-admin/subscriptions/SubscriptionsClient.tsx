'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { MetricRail, ModuleChrome } from '@/components/business/module-chrome'
import type {
  SuperAdminSubscriptionPlan,
  TraderSubscriptionDetailPayload,
  TraderSubscriptionListItem
} from '@/lib/super-admin-subscription-data'
import { readSubscriptionSchemaState } from '@/lib/subscription-schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { apiClient } from '@/lib/http/api-client'

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
    | 'clear_closure_request'
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

type SubscriptionsClientProps = {
  requestedTraderId?: string
  requestedState?: string
  initialTraders: TraderSubscriptionListItem[]
  initialPlans: SuperAdminSubscriptionPlan[]
  initialSelectedTraderId: string
  initialDetail: TraderSubscriptionDetailPayload | null
  initialSchemaReady: boolean
  initialSchemaWarning: string | null
  initialError?: string | null
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

function formatBackupErrorMessage(message?: string | null) {
  const normalized = String(message || '').trim()
  if (!normalized) return '-'

  if (/enoent/i.test(normalized) || /no such file or directory/i.test(normalized) || /\/var\/task\/var/i.test(normalized)) {
    return 'Backup storage path was unavailable on the server. Generate a fresh backup after the storage fix.'
  }

  return normalized
}

function getBadgeVariant(value?: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (value === 'trial') return 'secondary'
  if (value === 'backup_ready') return 'secondary'
  if (value === 'active') return 'default'
  if (value === 'expired' || value === 'cancelled' || value === 'suspended' || value === 'deletion_pending') return 'destructive'
  return 'outline'
}

export default function SuperAdminTraderSubscriptionsClient({
  requestedTraderId: requestedTraderIdProp,
  requestedState: requestedStateProp,
  initialTraders,
  initialPlans,
  initialSelectedTraderId,
  initialDetail,
  initialSchemaReady,
  initialSchemaWarning,
  initialError = null
}: SubscriptionsClientProps) {
  const requestedTraderId = String(requestedTraderIdProp || '').trim()
  const requestedState = String(requestedStateProp || '').trim().toLowerCase()
  const [traders, setTraders] = useState<TraderSubscriptionListItem[]>(initialTraders)
  const [plans, setPlans] = useState<SuperAdminSubscriptionPlan[]>(initialPlans)
  const [selectedTraderId, setSelectedTraderId] = useState<string>(initialSelectedTraderId)
  const [detail, setDetail] = useState<TraderSubscriptionDetailPayload | null>(initialDetail)
  const [detailCache, setDetailCache] = useState<Record<string, TraderSubscriptionDetailPayload>>(() =>
    initialDetail?.trader?.id ? { [initialDetail.trader.id]: initialDetail } : {}
  )
  const [lastLoadedDetailTraderId, setLastLoadedDetailTraderId] = useState(initialDetail?.trader?.id || '')
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState(requestedState)
  const [expiringWithinDays, setExpiringWithinDays] = useState('')
  const [error, setError] = useState<string | null>(initialError)
  const [schemaReady, setSchemaReady] = useState(initialSchemaReady)
  const [schemaWarning, setSchemaWarning] = useState<string | null>(initialSchemaWarning)
  const [form, setForm] = useState<ActionFormState>(createEmptyActionForm())

  const loadPlans = useCallback(async () => {
    try {
      const response = await fetch('/api/super-admin/subscription-plans?includeInactive=true', { cache: 'no-store' })
      const schemaState = readSubscriptionSchemaState(response.headers)
      setSchemaReady((current) => current && schemaState.schemaReady)
      setSchemaWarning(schemaState.schemaWarning)
      const payload = (await response.json().catch(() => [])) as SuperAdminSubscriptionPlan[] | { error?: string }
      if (!response.ok) {
        throw new Error(Array.isArray(payload) ? 'Failed to load plans' : payload.error || 'Failed to load plans')
      }
      setPlans(Array.isArray(payload) ? payload : [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load plans')
    }
  }, [])

  const loadTraders = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('query', query.trim())
      if (stateFilter.trim()) params.set('state', stateFilter.trim())
      if (expiringWithinDays.trim()) params.set('expiringWithinDays', expiringWithinDays.trim())

      const response = await fetch(`/api/super-admin/trader-subscriptions?${params.toString()}`, { cache: 'no-store' })
      const schemaState = readSubscriptionSchemaState(response.headers)
      setSchemaReady(schemaState.schemaReady)
      setSchemaWarning(schemaState.schemaWarning)
      const payload = (await response.json().catch(() => [])) as TraderSubscriptionListItem[] | { error?: string }
      if (!response.ok) {
        throw new Error(Array.isArray(payload) ? 'Failed to load traders' : payload.error || 'Failed to load traders')
      }

      const rows = Array.isArray(payload) ? payload : []
      setTraders(rows)
      const nextSelectedTraderId = rows.some((row) => row.id === selectedTraderId)
        ? selectedTraderId
        : (requestedTraderId && rows.some((row) => row.id === requestedTraderId)
            ? requestedTraderId
            : (rows[0]?.id ?? ''))

      if (nextSelectedTraderId !== selectedTraderId) {
        setSelectedTraderId(nextSelectedTraderId)
      }

      if (!nextSelectedTraderId) {
        setDetail(null)
        setLastLoadedDetailTraderId('')
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load traders')
    } finally {
      setLoading(false)
    }
  }, [expiringWithinDays, query, requestedTraderId, selectedTraderId, stateFilter])

  const loadDetail = useCallback(async (traderId: string) => {
    if (!traderId) {
      setDetail(null)
      setLastLoadedDetailTraderId('')
      return
    }

    const cachedDetail = detailCache[traderId]
    if (cachedDetail) {
      setDetail(cachedDetail)
    }

    setDetailLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/super-admin/trader-subscriptions/${traderId}`, { cache: 'no-store' })
      const schemaState = readSubscriptionSchemaState(response.headers)
      setSchemaReady(schemaState.schemaReady)
      setSchemaWarning(schemaState.schemaWarning)
      const payload = (await response.json().catch(() => ({}))) as TraderSubscriptionDetailPayload & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load trader detail')
      }
      setDetail(payload)
      setDetailCache((current) => ({
        ...current,
        ...(payload.trader?.id ? { [payload.trader.id]: payload } : {})
      }))
      setLastLoadedDetailTraderId(traderId)
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : 'Failed to load trader detail')
    } finally {
      setDetailLoading(false)
    }
  }, [detailCache])

  useEffect(() => {
    if (plans.length > 0) return
    void loadPlans()
  }, [loadPlans, plans.length])

  useEffect(() => {
    if (!requestedTraderId) {
      if (!selectedTraderId && traders.length > 0) {
        setSelectedTraderId(traders[0].id)
      }
      return
    }

    if (traders.some((row) => row.id === requestedTraderId) && selectedTraderId !== requestedTraderId) {
      setSelectedTraderId(requestedTraderId)
    }
  }, [requestedTraderId, selectedTraderId, traders])

  useEffect(() => {
    if (!selectedTraderId) {
      setDetail(null)
      setLastLoadedDetailTraderId('')
      return
    }

    if (selectedTraderId === lastLoadedDetailTraderId) {
      return
    }

    void loadDetail(selectedTraderId)
  }, [lastLoadedDetailTraderId, loadDetail, selectedTraderId])

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === form.planId) || null,
    [form.planId, plans]
  )
  const selectedTraderDetail = useMemo(() => {
    if (!selectedTraderId) {
      return null
    }

    if (detail?.trader?.id === selectedTraderId) {
      return detail
    }

    return detailCache[selectedTraderId] || null
  }, [detail, detailCache, selectedTraderId])
  const showInitialTableLoading = loading && traders.length === 0
  const showInitialDetailLoading = detailLoading && !selectedTraderDetail?.trader

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
    const readyBackupId =
      selectedTraderDetail?.dataLifecycle?.latestReadyBackup?.id ||
      selectedTraderDetail?.backups?.find((backup) => backup.status === 'ready')?.id ||
      ''
    if (!readyBackupId) return
    if (form.backupId) return
    if (form.action !== 'mark_deletion_pending' && form.action !== 'confirm_final_deletion') return

    setForm((current) => ({
      ...current,
      backupId: readyBackupId
    }))
  }, [form.action, form.backupId, selectedTraderDetail])

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

      await apiClient.postJson<{ success?: boolean }>(
        `/api/super-admin/trader-subscriptions/${selectedTraderId}/actions`,
        payload
      )

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
      subtitle={
        stateFilter === 'closure_requested'
          ? 'Review traders who submitted closure requests and complete the closure workflow.'
          : 'Assign trials, activate paid plans, extend validity, and monitor expiring trader subscriptions.'
      }
    >
      <div className="space-y-6">
        {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {schemaWarning ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {schemaWarning}
          </div>
        ) : null}

        <ModuleChrome
          eyebrow="Subscription Control"
          title={stateFilter === 'closure_requested' ? 'Closure workflow and renewals' : 'Trader entitlement operations'}
          description="This workspace centralizes trader plan assignment, lifecycle enforcement, backup readiness, and closure review without mixing tenant scopes. It is optimized for dense desktop administration while staying readable on smaller devices."
          badges={
            <>
              <Badge variant="outline" className="rounded-full bg-white/80 px-3 py-1">
                Traders: {traders.length}
              </Badge>
              <Badge variant="outline" className="rounded-full bg-white/80 px-3 py-1">
                Plans: {plans.length}
              </Badge>
              {selectedTraderDetail?.trader?.name ? (
                <Badge variant="secondary" className="rounded-full px-3 py-1">
                  Focus: {selectedTraderDetail.trader.name}
                </Badge>
              ) : null}
            </>
          }
        >
          <MetricRail
            items={[
              {
                label: 'Selected Trader',
                value: selectedTraderDetail?.trader?.name || 'None',
                helper: selectedTraderDetail?.currentSubscription?.planName || 'Choose a trader to manage'
              },
              {
                label: 'Lifecycle',
                value: formatLabel(selectedTraderDetail?.dataLifecycle?.state || selectedTraderDetail?.entitlement?.lifecycleState || stateFilter || 'all'),
                helper: 'Read from current data lifecycle state'
              },
              {
                label: 'Companies',
                value: selectedTraderDetail?.trader ? `${selectedTraderDetail.trader.currentCompanies}/${selectedTraderDetail.trader.maxCompanies ?? 'U'}` : '-',
                helper: 'Usage against tenant cap'
              },
              {
                label: 'Users',
                value: selectedTraderDetail?.trader ? `${selectedTraderDetail.trader.currentUsers}/${selectedTraderDetail.trader.maxUsers ?? 'U'}` : '-',
                helper: schemaReady ? 'Schema ready' : 'Schema not ready'
              }
            ]}
          />
        </ModuleChrome>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Expiring and Current Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_220px_180px_auto]">
              <Input
                name="subscription-search"
                placeholder="Search trader or plan"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                name="subscription-state-filter"
                className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
              >
                <option value="">All states</option>
                <option value="closure_requested">Closure Requested</option>
                <option value="backup_ready">Backup Ready</option>
                <option value="deletion_pending">Deletion Pending</option>
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="expired">Expired</option>
                <option value="cancelled">Cancelled</option>
                <option value="suspended">Suspended</option>
                <option value="pending">Pending</option>
              </select>
              <Input
                name="subscription-expiring-within-days"
                type="number"
                min="0"
                placeholder="Expiring within days"
                value={expiringWithinDays}
                onChange={(event) => setExpiringWithinDays(event.target.value)}
              />
              <Button variant="outline" onClick={() => void loadTraders()} disabled={loading}>
                {loading ? 'Refreshing...' : 'Refresh List'}
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
                {showInitialTableLoading ? (
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

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,1fr)]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Selected Trader Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {showInitialDetailLoading ? (
                <div className="text-sm text-slate-500">Loading trader detail...</div>
              ) : selectedTraderDetail?.trader ? (
                <>
                  {detailLoading ? (
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      Refreshing latest trader detail...
                    </div>
                  ) : null}
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Trader</div>
                      <div className="mt-1 font-semibold text-slate-900">{selectedTraderDetail.trader.name}</div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Current State</div>
                      <div className="mt-1">
                        <Badge variant={getBadgeVariant(selectedTraderDetail.dataLifecycle?.state || selectedTraderDetail.entitlement?.lifecycleState)}>
                          {formatLabel(selectedTraderDetail.dataLifecycle?.state || selectedTraderDetail.entitlement?.lifecycleState)}
                        </Badge>
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Company Limit</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {selectedTraderDetail.trader.currentCompanies} / {selectedTraderDetail.trader.maxCompanies ?? 'U'}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">User Limit</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {selectedTraderDetail.trader.currentUsers} / {selectedTraderDetail.trader.maxUsers ?? 'U'}
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {selectedTraderDetail.dataLifecycle?.message || selectedTraderDetail.entitlement?.message || 'No current subscription message.'}
                  </div>

                  <div className="rounded border border-slate-200 px-3 py-3">
                    <div className="mb-2 text-sm font-semibold text-slate-900">Current Subscription</div>
                    {selectedTraderDetail.currentSubscription ? (
                      <div className="grid gap-3 md:grid-cols-4 text-sm">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">Plan</div>
                          <div className="mt-1 text-slate-900">{selectedTraderDetail.currentSubscription.planName || '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">Type</div>
                          <div className="mt-1 text-slate-900">{formatLabel(selectedTraderDetail.currentSubscription.subscriptionType)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">Window</div>
                          <div className="mt-1 text-slate-900">
                            {formatDate(selectedTraderDetail.currentSubscription.startDate)} to {formatDate(selectedTraderDetail.currentSubscription.endDate)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-slate-500">Amount</div>
                          <div className="mt-1 text-slate-900">
                            {formatAmount(selectedTraderDetail.currentSubscription.amount, selectedTraderDetail.currentSubscription.currency)}
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
                        {selectedTraderDetail.dataLifecycle?.readOnlyMode ? 'Yes' : 'No'}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Latest Ready Backup</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatDate(selectedTraderDetail.dataLifecycle?.latestReadyBackup?.exportedAt)}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Closure Request</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatDate(selectedTraderDetail.dataLifecycle?.closureRequestedAt)}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Deletion Schedule</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatDate(selectedTraderDetail.dataLifecycle?.scheduledDeletionAt)}
                      </div>
                    </div>
                  </div>

                  {(selectedTraderDetail.backups || []).length > 0 ? (
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
                        {(selectedTraderDetail.backups || []).map((backup) => (
                          <TableRow key={backup.id}>
                            <TableCell>{backup.fileName || `${backup.format}.json`}</TableCell>
                            <TableCell>{formatLabel(backup.status)}</TableCell>
                            <TableCell>{formatDate(backup.exportedAt || backup.failedAt || backup.createdAt)}</TableCell>
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
                                <span className="text-xs text-slate-500">{formatBackupErrorMessage(backup.errorMessage)}</span>
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
                      {(selectedTraderDetail.history || []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-sm text-slate-500">
                            No subscription history recorded.
                          </TableCell>
                        </TableRow>
                      ) : (
                        (selectedTraderDetail.history || []).map((row) => (
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

          <Card className="h-fit xl:sticky xl:top-6">
            <CardHeader className="pb-3">
              <CardTitle>Subscription Action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Action</span>
                  <select
                    name="subscription-action"
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
                    <option value="clear_closure_request">Cancel Closure Request</option>
                    <option value="update_retention">Update Retention</option>
                    <option value="mark_deletion_pending">Mark Deletion Pending</option>
                    <option value="confirm_final_deletion">Confirm Final Delete</option>
                  </select>
                </label>

                {form.action === 'assign_trial' || form.action === 'assign_paid' || form.action === 'renew_paid' || form.action === 'convert_to_paid' ? (
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Plan</span>
                    <select
                      name="subscription-plan"
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
                  <div className="grid gap-3">
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
                  <div className="grid gap-3">
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
                  <div className="grid gap-3">
                    {form.action === 'mark_read_only' ? (
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Read Only State</span>
                        <select
                          name="subscription-read-only-state"
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
                      name="subscription-backup"
                      className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                      value={form.backupId}
                      onChange={(event) => setForm((current) => ({ ...current, backupId: event.target.value }))}
                    >
                      <option value="">Select backup</option>
                      {(selectedTraderDetail?.backups || [])
                        .filter((backup) => backup.status === 'ready')
                        .map((backup) => (
                          <option key={backup.id} value={backup.id}>
                            {backup.fileName || `${backup.format}.json`} ({formatDate(backup.exportedAt || backup.failedAt || backup.createdAt)})
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}

                {(form.action === 'assign_paid' || form.action === 'renew_paid' || form.action === 'convert_to_paid') ? (
                  <div className="grid gap-3">
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
                  <label className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm leading-5">
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
                  name="subscription-notes"
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
