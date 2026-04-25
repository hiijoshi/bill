'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock3, Download, LifeBuoy, Lock, RefreshCw, ShieldCheck } from 'lucide-react'

import { MetricRail, ModuleChrome } from '@/components/business/module-chrome'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { apiClient } from '@/lib/http/api-client'

type SubscriptionFeature = {
  featureKey: string
  featureLabel: string
  description: string | null
  enabled: boolean
}

type SubscriptionSummary = {
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
  trialDays: number | null
  daysLeft: number
  featureSource: string
  features: SubscriptionFeature[]
}

type CapacitySummary = {
  maxCompanies: number | null
  maxUsers: number | null
  currentCompanies: number
  currentUsers: number
  limitSource: string
}

type BackupSummary = {
  id: string
  status: string
  format: string
  fileName: string | null
  exportedAt: string | null
  failedAt?: string | null
  createdAt?: string | null
  downloadCount: number
  lastDownloadedAt: string | null
  errorMessage?: string | null
}

type DataLifecycleSummary = {
  state?: string | null
  readOnlyMode?: boolean
  message?: string | null
  allowBackupRequest?: boolean
  allowBackupDownload?: boolean
  allowClosureRequest?: boolean
  closureRequestedAt?: string | null
  closureRequestSource?: string | null
  closureNotes?: string | null
  scheduledDeletionAt?: string | null
  latestBackup?: BackupSummary | null
  latestReadyBackup?: BackupSummary | null
}

type CurrentPayload = {
  trader?: {
    id?: string
    name?: string
  }
  entitlement?: {
    lifecycleState?: string
    isConfigured?: boolean
    message?: string | null
    daysLeft?: number | null
    features?: SubscriptionFeature[]
  } | null
  dataLifecycle?: DataLifecycleSummary | null
  currentSubscription?: SubscriptionSummary | null
  capacity?: CapacitySummary | null
}

type HistoryPayload = {
  history?: SubscriptionSummary[]
  backups?: BackupSummary[]
  payments?: Array<{
    id: string
    planNameSnapshot: string | null
    amount: number
    currency: string
    status: string
    paymentMode: string
    referenceNo: string | null
    paidAt: string | null
    notes: string | null
  }>
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

function formatLifecycleLabel(state?: string | null) {
  return String(state || 'none')
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

function getBadgeVariant(state?: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'trial') return 'secondary'
  if (state === 'active') return 'default'
  if (state === 'backup_ready') return 'secondary'
  if (state === 'expired' || state === 'cancelled' || state === 'suspended' || state === 'deletion_pending') return 'destructive'
  return 'outline'
}

interface SubscriptionOverviewProps {
  initialCurrent?: CurrentPayload | null
  initialHistory?: HistoryPayload | null
}

const surfaceCardClass =
  'overflow-hidden rounded-[1.75rem] border border-black/5 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.16)]'

export default function SubscriptionOverview({
  initialCurrent = null,
  initialHistory = null
}: SubscriptionOverviewProps) {
  const hasInitialData = Boolean(initialCurrent || initialHistory)
  const [current, setCurrent] = useState<CurrentPayload | null>(initialCurrent)
  const [history, setHistory] = useState<HistoryPayload | null>(initialHistory)
  const [loading, setLoading] = useState(!hasInitialData)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [currentPayload, historyPayload] = await Promise.all([
        apiClient.getJson<CurrentPayload>('/api/subscription/current').catch((error) => {
          if (error instanceof Error && /status 404/i.test(error.message)) {
            return null as CurrentPayload | null
          }
          throw error
        }),
        apiClient.getJson<HistoryPayload>('/api/subscription/history')
      ])

      setCurrent(currentPayload)
      setHistory(historyPayload)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load subscription summary')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (hasInitialData) return
    void load()
  }, [hasInitialData, load])

  const currentLifecycleState = current?.dataLifecycle?.state || current?.entitlement?.lifecycleState || 'none'

  const features = useMemo(() => {
    const subscriptionFeatures = current?.currentSubscription?.features
    if (Array.isArray(subscriptionFeatures) && subscriptionFeatures.length > 0) {
      return subscriptionFeatures
    }
    return current?.entitlement?.features || []
  }, [current])

  const runAction = useCallback(
    async (action: 'request_backup' | 'request_closure' | 'cancel_closure_request') => {
      setActionLoading(true)
      setActionError(null)

      try {
        await apiClient.postJson<{ success?: boolean }>('/api/subscription/actions', { action })

        await load()
      } catch (actionLoadError) {
        setActionError(actionLoadError instanceof Error ? actionLoadError.message : 'Failed to submit request')
      } finally {
        setActionLoading(false)
      }
    },
    [load]
  )

  const latestReadyBackup = current?.dataLifecycle?.latestReadyBackup || null
  const metricItems = [
    {
      label: 'Plan State',
      value: formatLifecycleLabel(currentLifecycleState),
      helper: current?.currentSubscription?.planName || 'No plan assigned'
    },
    {
      label: 'Days Left',
      value: String(current?.entitlement?.daysLeft ?? current?.currentSubscription?.daysLeft ?? '-'),
      helper: formatDate(current?.currentSubscription?.endDate)
    },
    {
      label: 'Companies',
      value: `${current?.capacity?.currentCompanies ?? 0}/${current?.capacity?.maxCompanies ?? 'U'}`,
      helper: 'Capacity in active scope'
    },
    {
      label: 'Users',
      value: `${current?.capacity?.currentUsers ?? 0}/${current?.capacity?.maxUsers ?? 'U'}`,
      helper: current?.dataLifecycle?.readOnlyMode ? 'Workspace is in read-only mode' : 'Workspace access is active'
    }
  ]

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {actionError ? (
        <div className="rounded-[1.25rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
      ) : null}

      <ModuleChrome
        eyebrow="Subscription"
        title="Plan, access, and data safety"
        description="A premium control surface for entitlement status, expiry, backup readiness, and lifecycle actions. Business users can read the important state first, then move into history and retention details."
        badges={
          <>
            <Badge variant="outline" className="rounded-full bg-white/80 px-3 py-1">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              {current?.currentSubscription?.planName || 'No active plan'}
            </Badge>
            <Badge variant={getBadgeVariant(currentLifecycleState)} className="rounded-full px-3 py-1">
              <Clock3 className="mr-1.5 h-3.5 w-3.5" />
              {formatLifecycleLabel(currentLifecycleState)}
            </Badge>
            <Badge variant="outline" className="rounded-full bg-white/80 px-3 py-1">
              <Lock className="mr-1.5 h-3.5 w-3.5" />
              {current?.dataLifecycle?.readOnlyMode ? 'Read only' : 'Full access'}
            </Badge>
          </>
        }
        actions={
          <>
            {current?.dataLifecycle?.allowBackupRequest ? (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => void runAction('request_backup')}
                disabled={loading || actionLoading}
              >
                <LifeBuoy className="mr-2 h-4 w-4" />
                {actionLoading ? 'Please wait...' : 'Request Backup'}
              </Button>
            ) : null}
            {current?.dataLifecycle?.allowClosureRequest ? (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => void runAction('request_closure')}
                disabled={loading || actionLoading}
              >
                <Lock className="mr-2 h-4 w-4" />
                {current?.dataLifecycle?.closureRequestedAt ? 'Update Closure' : 'Request Closure'}
              </Button>
            ) : null}
            {current?.dataLifecycle?.closureRequestedAt ? (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => void runAction('cancel_closure_request')}
                disabled={loading || actionLoading}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Cancel Closure Request
              </Button>
            ) : null}
            {latestReadyBackup?.id ? (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => window.open(`/api/subscription/backups/${latestReadyBackup.id}/download`, '_blank', 'noopener')}
                disabled={loading}
              >
                <Download className="mr-2 h-4 w-4" />
                Download Backup
              </Button>
            ) : null}
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void load()} disabled={loading || actionLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </>
        }
      >
        <MetricRail items={metricItems} />
      </ModuleChrome>

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            <span>{current?.currentSubscription?.planName || 'Subscription Not Assigned'}</span>
            <Badge variant={getBadgeVariant(currentLifecycleState)}>
              {formatLifecycleLabel(currentLifecycleState)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">Amount</div>
              <div className="mt-1 font-semibold text-slate-900">
                {formatAmount(current?.currentSubscription?.amount, current?.currentSubscription?.currency || 'INR')}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">Start Date</div>
              <div className="mt-1 font-semibold text-slate-900">{formatDate(current?.currentSubscription?.startDate)}</div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">Expiry Date</div>
              <div className="mt-1 font-semibold text-slate-900">{formatDate(current?.currentSubscription?.endDate)}</div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">Days Left</div>
              <div className="mt-1 font-semibold text-slate-900">
                {current?.entitlement?.daysLeft ?? current?.currentSubscription?.daysLeft ?? '-'}
              </div>
            </div>
          </div>

          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {current?.dataLifecycle?.message ||
              current?.entitlement?.message ||
              'Manual renewal and plan changes are handled by your super admin.'}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-slate-200 px-3 py-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Company Limit</div>
              <div className="text-sm text-slate-800">
                {current?.capacity?.currentCompanies ?? 0} used / {current?.capacity?.maxCompanies ?? 'Unlimited'}
              </div>
            </div>
            <div className="rounded border border-slate-200 px-3 py-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">User Limit</div>
              <div className="text-sm text-slate-800">
                {current?.capacity?.currentUsers ?? 0} used / {current?.capacity?.maxUsers ?? 'Unlimited'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle>Access and Backup</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">Mode</div>
              <div className="mt-1 font-semibold text-slate-900">
                {current?.dataLifecycle?.readOnlyMode ? 'Read Only' : 'Normal Access'}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">Latest Backup</div>
              <div className="mt-1 font-semibold text-slate-900">
                {formatDate(current?.dataLifecycle?.latestBackup?.exportedAt)}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">Closure Request</div>
              <div className="mt-1 font-semibold text-slate-900">
                {formatDate(current?.dataLifecycle?.closureRequestedAt)}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <div className="text-xs uppercase tracking-wide text-slate-500">Deletion Schedule</div>
              <div className="mt-1 font-semibold text-slate-900">
                {formatDate(current?.dataLifecycle?.scheduledDeletionAt)}
              </div>
            </div>
          </div>

          {current?.dataLifecycle?.closureNotes ? (
            <div className="mt-3 rounded border border-slate-200 px-3 py-2 text-sm text-slate-700">
              {current.dataLifecycle.closureNotes}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle>Included Features</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {features.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-sm text-slate-500">
                    No feature matrix assigned yet.
                  </TableCell>
                </TableRow>
              ) : (
                features.map((feature) => (
                  <TableRow key={feature.featureKey}>
                    <TableCell>{feature.featureLabel}</TableCell>
                    <TableCell>
                      <Badge variant={feature.enabled ? 'default' : 'outline'}>
                        {feature.enabled ? 'Included' : 'Blocked'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{feature.description || '-'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle>Backup History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Exported At</TableHead>
                <TableHead>Downloads</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history?.backups || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-slate-500">
                    No backup history recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                (history?.backups || []).map((backup) => (
                  <TableRow key={backup.id}>
                    <TableCell>{formatLifecycleLabel(backup.status)}</TableCell>
                    <TableCell>{backup.fileName || `${backup.format}.json`}</TableCell>
                    <TableCell>{formatDate(backup.exportedAt || backup.failedAt || backup.createdAt)}</TableCell>
                    <TableCell>{backup.downloadCount}</TableCell>
                    <TableCell>
                      {backup.status === 'ready' ? (
                        <Button
                          variant="outline"
                          size="sm"
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
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle>Subscription History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history?.history || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-slate-500">
                    No subscription history available.
                  </TableCell>
                </TableRow>
              ) : (
                (history?.history || []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.planName || 'Custom Plan'}</TableCell>
                    <TableCell>{formatLifecycleLabel(row.subscriptionType)}</TableCell>
                    <TableCell>{formatLifecycleLabel(row.lifecycleState)}</TableCell>
                    <TableCell>{formatDate(row.startDate)}</TableCell>
                    <TableCell>{formatDate(row.endDate)}</TableCell>
                    <TableCell>{formatAmount(row.amount, row.currency)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={surfaceCardClass}>
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Paid At</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history?.payments || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-slate-500">
                    No payment history recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                (history?.payments || []).map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{payment.planNameSnapshot || '-'}</TableCell>
                    <TableCell>{formatAmount(payment.amount, payment.currency)}</TableCell>
                    <TableCell>{formatLifecycleLabel(payment.status)}</TableCell>
                    <TableCell>{formatLifecycleLabel(payment.paymentMode)}</TableCell>
                    <TableCell>{formatDate(payment.paidAt)}</TableCell>
                    <TableCell>{payment.referenceNo || '-'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
