'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { RefreshOverlay } from '@/components/performance/refresh-overlay'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Building2, Clock3, Download, Lock, RefreshCw, Shield, Store, Trash2, Unlock, Users } from 'lucide-react'
import { subscribeSuperAdminDataChanged } from '@/lib/super-admin-live-data'
import type { SuperAdminClosureQueueItem } from '@/lib/super-admin-subscription-data'

type SuperAdminOverviewClientProps = {
  initialOverview: {
    stats: {
      traders: number
      companies: number
      users: number
    }
    traders: TraderRow[]
    companies: CompanyRow[]
    users: UserRow[]
    closureQueue: ClosureQueueState
    permissionPreview: PermissionPreview | null
  }
  initialProfile?: {
    user?: {
      userId?: string
      name?: string
      role?: string
    }
  } | null
}

type TraderRow = {
  id: string
  name: string
  locked: boolean
  _count: { companies: number; users: number }
}

type CompanyRow = {
  id: string
  name: string
  traderId: string | null
  locked: boolean
  _count: { users: number }
}

type UserRow = {
  id: string
  userId: string
  name?: string | null
  role?: string | null
  companyId?: string | null
  locked: boolean
}

type PermissionRow = {
  module: string
  label: string
  canRead: boolean
  canWrite: boolean
}

type PermissionPreview = {
  companyId?: string
  companyOptions?: Array<{ id: string; name: string; locked: boolean; isPrimary: boolean }>
  permissions: PermissionRow[]
}

type ClosureQueueState = {
  schemaReady: boolean
  schemaWarning: string | null
  summary: {
    closureRequested: number
    backupReady: number
    deletionPending: number
  }
  rows: SuperAdminClosureQueueItem[]
}

type OverviewSection = 'stats' | 'traders' | 'companies' | 'users' | 'closureQueue' | 'permissionPreview'

type Point = {
  x: number
  y: number
}

function buildConnectorPath(from: Point, to: Point): string {
  const horizontal = Math.max(32, Math.abs(to.x - from.x) * 0.45)
  const controlX1 = from.x + horizontal
  const controlX2 = to.x - horizontal
  return `M ${from.x} ${from.y} C ${controlX1} ${from.y}, ${controlX2} ${to.y}, ${to.x} ${to.y}`
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(parsed)
}

function getClosureQueueHref(item: SuperAdminClosureQueueItem) {
  const params = new URLSearchParams()
  params.set('traderId', item.id)
  params.set('state', item.queueStage)
  return `/super-admin/subscriptions?${params.toString()}`
}

function getClosureQueueBadgeVariant(stage: SuperAdminClosureQueueItem['queueStage']): 'default' | 'secondary' | 'destructive' {
  if (stage === 'deletion_pending') return 'destructive'
  if (stage === 'backup_ready') return 'secondary'
  return 'default'
}

function getClosureQueueStageLabel(stage: SuperAdminClosureQueueItem['queueStage']) {
  if (stage === 'deletion_pending') return 'Deletion Pending'
  if (stage === 'backup_ready') return 'Backup Ready'
  return 'Closure Requested'
}

function getClosureQueueMetaLabel(item: SuperAdminClosureQueueItem) {
  if (item.queueStage === 'deletion_pending') {
    return `Scheduled delete: ${formatDate(item.scheduledDeletionAt)}`
  }

  if (item.queueStage === 'backup_ready') {
    return `Backup ready: ${formatDate(item.latestReadyBackupAt)}`
  }

  return `Requested: ${formatDate(item.closureRequestedAt)}`
}

export default function SuperAdminOverviewClient({ initialOverview, initialProfile = null }: SuperAdminOverviewClientProps) {
  const [summaryStats, setSummaryStats] = useState(initialOverview.stats)
  const [traders, setTraders] = useState<TraderRow[]>(initialOverview.traders || [])
  const [companies, setCompanies] = useState<CompanyRow[]>(initialOverview.companies || [])
  const [users, setUsers] = useState<UserRow[]>(initialOverview.users || [])
  const [closureQueue, setClosureQueue] = useState<ClosureQueueState>(initialOverview.closureQueue)
  const [permissionPreview, setPermissionPreview] = useState<PermissionPreview | null>(initialOverview.permissionPreview || null)

  const [selectedTraderId, setSelectedTraderId] = useState<string | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const [traderQuery, setTraderQuery] = useState('')
  const [companyQuery, setCompanyQuery] = useState('')
  const [userQuery, setUserQuery] = useState('')

  const [loadingTraders, setLoadingTraders] = useState(false)
  const [loadingCompanies, setLoadingCompanies] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [loadingPermissions, setLoadingPermissions] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const graphContainerRef = useRef<HTMLDivElement | null>(null)
  const scopedRefreshTimerRef = useRef<number | null>(null)
  const traderListRef = useRef<HTMLDivElement | null>(null)
  const companyListRef = useRef<HTMLDivElement | null>(null)
  const userListRef = useRef<HTMLDivElement | null>(null)
  const traderNodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const companyNodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const userNodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [graphPoints, setGraphPoints] = useState<{
    traderToCompany?: { from: Point; to: Point }
    companyToUser?: { from: Point; to: Point }
  }>({})

  const selectedTrader = useMemo(
    () => traders.find((row) => row.id === selectedTraderId) || null,
    [traders, selectedTraderId]
  )
  const selectedCompany = useMemo(
    () => companies.find((row) => row.id === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  )
  const selectedUser = useMemo(
    () => users.find((row) => row.id === selectedUserId) || null,
    [users, selectedUserId]
  )
  const traderSummaryCount = traders.length > 0 ? traders.length : summaryStats.traders
  const companySummaryCount = selectedTrader ? companies.length : summaryStats.companies
  const userSummaryCount = selectedCompany ? users.length : summaryStats.users

  const filteredTraders = useMemo(() => {
    const query = traderQuery.trim().toLowerCase()
    if (!query) return traders
    return traders.filter((row) => row.name.toLowerCase().includes(query) || row.id.toLowerCase().includes(query))
  }, [traders, traderQuery])

  const filteredCompanies = useMemo(() => {
    const query = companyQuery.trim().toLowerCase()
    if (!query) return companies
    return companies.filter((row) => row.name.toLowerCase().includes(query) || row.id.toLowerCase().includes(query))
  }, [companies, companyQuery])

  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase()
    if (!query) return users
    return users.filter(
      (row) =>
        row.userId.toLowerCase().includes(query) ||
        (row.name || '').toLowerCase().includes(query) ||
        (row.role || '').toLowerCase().includes(query)
    )
  }, [users, userQuery])

  const readCount = useMemo(
    () => permissionPreview?.permissions.filter((row) => row.canRead).length || 0,
    [permissionPreview]
  )
  const writeCount = useMemo(
    () => permissionPreview?.permissions.filter((row) => row.canWrite).length || 0,
    [permissionPreview]
  )
  const renderGraphConnector = useCallback((from: Point, to: Point, key: string) => {
    const path = buildConnectorPath(from, to)
    return (
      <g key={key}>
        <path d={path} fill="none" stroke="#94a3b8" strokeOpacity="0.25" strokeWidth="8" />
        <path
          d={path}
          fill="none"
          stroke="url(#tenantFlowGradient)"
          strokeWidth="2.5"
          strokeLinecap="round"
          markerEnd="url(#tenantFlowArrow)"
        />
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeDasharray="6 10" strokeLinecap="round">
          <animate attributeName="stroke-dashoffset" from="0" to="-32" dur="1.2s" repeatCount="indefinite" />
        </path>
      </g>
    )
  }, [])

  const recalculateGraphPoints = useCallback(() => {
    const container = graphContainerRef.current
    if (!container) {
      setGraphPoints({})
      return
    }

    const containerRect = container.getBoundingClientRect()
    const toRelativePoint = (element: HTMLDivElement, side: 'left' | 'right'): Point => {
      const rect = element.getBoundingClientRect()
      return {
        x: (side === 'right' ? rect.right : rect.left) - containerRect.left,
        y: rect.top + rect.height / 2 - containerRect.top
      }
    }

    const traderNode = selectedTraderId ? traderNodeRefs.current[selectedTraderId] : null
    const companyNode = selectedCompanyId ? companyNodeRefs.current[selectedCompanyId] : null
    const userNode = selectedUserId ? userNodeRefs.current[selectedUserId] : null

    const nextPoints: {
      traderToCompany?: { from: Point; to: Point }
      companyToUser?: { from: Point; to: Point }
    } = {}

    if (traderNode && companyNode) {
      nextPoints.traderToCompany = {
        from: toRelativePoint(traderNode, 'right'),
        to: toRelativePoint(companyNode, 'left')
      }
    }

    if (companyNode && userNode) {
      nextPoints.companyToUser = {
        from: toRelativePoint(companyNode, 'right'),
        to: toRelativePoint(userNode, 'left')
      }
    }

    setGraphPoints(nextPoints)
  }, [selectedTraderId, selectedCompanyId, selectedUserId])

  const fetchOverview = useCallback(async (
    selection?: {
      traderId?: string | null
      companyId?: string | null
      userId?: string | null
    },
    options?: { silent?: boolean; sections?: OverviewSection[] }
  ) => {
    const nextTraderId = selection?.traderId?.trim() || ''
    const nextCompanyId = selection?.companyId?.trim() || ''
    const nextUserId = selection?.userId?.trim() || ''
    const requestedSections = options?.sections?.length
      ? options.sections
      : (['stats', 'traders', 'companies', 'users', 'permissionPreview'] as OverviewSection[])

    setError(null)
    setLoadingTraders(!options?.silent && requestedSections.includes('traders'))
    setLoadingCompanies(requestedSections.includes('companies') && Boolean(nextTraderId))
    setLoadingUsers(requestedSections.includes('users') && Boolean(nextCompanyId))
    setLoadingPermissions(requestedSections.includes('permissionPreview') && Boolean(nextUserId))

    try {
      const params = new URLSearchParams()
      if (nextTraderId) params.set('traderId', nextTraderId)
      if (nextCompanyId) params.set('companyId', nextCompanyId)
      if (nextUserId) params.set('userId', nextUserId)
      if (requestedSections.length > 0) {
        params.set('sections', requestedSections.join(','))
      }

      const response = await fetch(
        `/api/super-admin/overview${params.toString() ? `?${params.toString()}` : ''}`,
        { cache: 'no-store' }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(String(payload?.error || 'Failed to load super admin overview'))
      }

      if ('stats' in payload) {
        setSummaryStats((previous) =>
          payload.stats && typeof payload.stats === 'object'
          ? {
              traders: Number(payload.stats.traders || 0),
              companies: Number(payload.stats.companies || 0),
              users: Number(payload.stats.users || 0)
            }
          : previous
        )
      }
      if ('traders' in payload) {
        setTraders(Array.isArray(payload.traders) ? payload.traders : [])
      }
      if ('companies' in payload) {
        setCompanies(Array.isArray(payload.companies) ? payload.companies : [])
      }
      if ('users' in payload) {
        setUsers(Array.isArray(payload.users) ? payload.users : [])
      }
      if ('closureQueue' in payload) {
        setClosureQueue(
          payload.closureQueue && typeof payload.closureQueue === 'object'
            ? {
                schemaReady: Boolean(payload.closureQueue.schemaReady),
                schemaWarning: typeof payload.closureQueue.schemaWarning === 'string' ? payload.closureQueue.schemaWarning : null,
                summary: {
                  closureRequested: Number(payload.closureQueue.summary?.closureRequested || 0),
                  backupReady: Number(payload.closureQueue.summary?.backupReady || 0),
                  deletionPending: Number(payload.closureQueue.summary?.deletionPending || 0)
                },
                rows: Array.isArray(payload.closureQueue.rows) ? payload.closureQueue.rows : []
              }
            : {
                schemaReady: true,
                schemaWarning: null,
                summary: {
                  closureRequested: 0,
                  backupReady: 0,
                  deletionPending: 0
                },
                rows: []
              }
        )
      }
      if ('permissionPreview' in payload) {
        setPermissionPreview(
          payload.permissionPreview && Array.isArray(payload.permissionPreview.permissions)
          ? {
              companyId: payload.permissionPreview.companyId,
              companyOptions: Array.isArray(payload.permissionPreview.companyOptions)
                ? payload.permissionPreview.companyOptions
                : [],
              permissions: payload.permissionPreview.permissions
            }
          : null
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load super admin overview')
    } finally {
      setLoadingTraders(false)
      setLoadingCompanies(false)
      setLoadingUsers(false)
      setLoadingPermissions(false)
    }
  }, [])

  const setTraderLockState = useCallback((traderId: string, locked: boolean) => {
    setTraders((previous) =>
      previous.map((row) => (row.id === traderId ? { ...row, locked } : row))
    )
  }, [])

  const setCompanyLockState = useCallback((companyId: string, locked: boolean) => {
    setCompanies((previous) =>
      previous.map((row) => (row.id === companyId ? { ...row, locked } : row))
    )
    setPermissionPreview((previous) =>
      previous
        ? {
            ...previous,
            companyOptions: Array.isArray(previous.companyOptions)
              ? previous.companyOptions.map((row) => (row.id === companyId ? { ...row, locked } : row))
              : previous.companyOptions
          }
        : previous
    )
  }, [])

  const setUserLockState = useCallback((userId: string, locked: boolean) => {
    setUsers((previous) =>
      previous.map((row) => (row.id === userId ? { ...row, locked } : row))
    )
  }, [])

  const buildRefreshSections = useCallback((mode: 'full' | 'scoped' = 'full'): OverviewSection[] => {
    if (mode === 'full') {
      return [
        'stats',
        'traders',
        ...(selectedTraderId ? (['companies'] as OverviewSection[]) : []),
        ...(selectedCompanyId ? (['users'] as OverviewSection[]) : []),
        'closureQueue',
        ...(selectedUserId ? (['permissionPreview'] as OverviewSection[]) : [])
      ]
    }

    return [
      'stats',
      'closureQueue',
      ...(selectedTraderId ? (['companies'] as OverviewSection[]) : (['traders'] as OverviewSection[])),
      ...(selectedCompanyId ? (['users'] as OverviewSection[]) : []),
      ...(selectedUserId ? (['permissionPreview'] as OverviewSection[]) : [])
    ]
  }, [selectedCompanyId, selectedTraderId, selectedUserId])

  useEffect(() => {
    const raf = requestAnimationFrame(() => recalculateGraphPoints())
    return () => cancelAnimationFrame(raf)
  }, [
    recalculateGraphPoints,
    selectedTraderId,
    selectedCompanyId,
    selectedUserId,
    filteredTraders.length,
    filteredCompanies.length,
    filteredUsers.length,
    loadingTraders,
    loadingCompanies,
    loadingUsers
  ])

  useEffect(() => {
    const handleLayoutChange = () => recalculateGraphPoints()
    const traderListElement = traderListRef.current
    const companyListElement = companyListRef.current
    const userListElement = userListRef.current

    window.addEventListener('resize', handleLayoutChange)
    traderListElement?.addEventListener('scroll', handleLayoutChange)
    companyListElement?.addEventListener('scroll', handleLayoutChange)
    userListElement?.addEventListener('scroll', handleLayoutChange)

    return () => {
      window.removeEventListener('resize', handleLayoutChange)
      traderListElement?.removeEventListener('scroll', handleLayoutChange)
      companyListElement?.removeEventListener('scroll', handleLayoutChange)
      userListElement?.removeEventListener('scroll', handleLayoutChange)
    }
  }, [recalculateGraphPoints])

  useEffect(() => {
    if (!selectedTraderId) return
    if (traders.some((row) => row.id === selectedTraderId)) return
    setSelectedTraderId(null)
    setSelectedCompanyId(null)
    setSelectedUserId(null)
    setCompanies([])
    setUsers([])
    setPermissionPreview(null)
  }, [selectedTraderId, traders])

  useEffect(() => {
    if (!selectedCompanyId) return
    if (companies.some((row) => row.id === selectedCompanyId)) return
    setSelectedCompanyId(null)
    setSelectedUserId(null)
    setUsers([])
    setPermissionPreview(null)
  }, [companies, selectedCompanyId])

  useEffect(() => {
    if (!selectedUserId) return
    if (users.some((row) => row.id === selectedUserId)) return
    setSelectedUserId(null)
    setPermissionPreview(null)
  }, [selectedUserId, users])

  const handleSelectTrader = async (traderId: string) => {
    setSelectedTraderId(traderId)
    setSelectedCompanyId(null)
    setSelectedUserId(null)
    setPermissionPreview(null)
    await fetchOverview({ traderId }, { sections: ['companies'] })
  }

  const handleSelectCompany = async (companyId: string) => {
    setSelectedCompanyId(companyId)
    setSelectedUserId(null)
    setPermissionPreview(null)
    await fetchOverview({ traderId: selectedTraderId, companyId }, { sections: ['users'] })
  }

  const handleSelectUser = async (userId: string) => {
    setSelectedUserId(userId)
    setPermissionPreview(null)
    await fetchOverview(
      { traderId: selectedTraderId, companyId: selectedCompanyId, userId },
      { sections: ['permissionPreview'] }
    )
  }

  const toggleTraderLock = async (row: TraderRow) => {
    const response = await fetch(`/api/super-admin/traders/${row.id}/lock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: !row.locked })
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      setError(payload.error || 'Failed to update trader lock')
      return
    }
    setTraderLockState(row.id, !row.locked)
  }

  const toggleCompanyLock = async (row: CompanyRow) => {
    const response = await fetch(`/api/super-admin/companies/${row.id}/lock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: !row.locked })
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      setError(payload.error || 'Failed to update company lock')
      return
    }
    setCompanyLockState(row.id, !row.locked)
  }

  const toggleUserLock = async (row: UserRow) => {
    const response = await fetch(`/api/super-admin/users/${row.id}/lock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked: !row.locked })
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      setError(payload.error || 'Failed to update user lock')
      return
    }
    setUserLockState(row.id, !row.locked)
  }

  const refreshAll = useCallback(async (options?: { silent?: boolean; mode?: 'full' | 'scoped' }) => {
    if (!options?.silent) {
      setRefreshing(true)
    }

    try {
      await fetchOverview(
        {
          traderId: selectedTraderId,
          companyId: selectedCompanyId,
          userId: selectedUserId
        },
        {
          ...options,
          sections: buildRefreshSections(options?.mode || 'full')
        }
      )
    } finally {
      if (!options?.silent) {
        setRefreshing(false)
      }
    }
  }, [buildRefreshSections, fetchOverview, selectedCompanyId, selectedTraderId, selectedUserId])

  useEffect(() => {
    return () => {
      if (scopedRefreshTimerRef.current !== null) {
        window.clearTimeout(scopedRefreshTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const unsubscribe = subscribeSuperAdminDataChanged(() => {
      if (scopedRefreshTimerRef.current !== null) {
        window.clearTimeout(scopedRefreshTimerRef.current)
      }

      scopedRefreshTimerRef.current = window.setTimeout(() => {
        scopedRefreshTimerRef.current = null
        void refreshAll({ silent: true, mode: 'scoped' })
      }, 180)
    })

    return () => {
      if (scopedRefreshTimerRef.current !== null) {
        window.clearTimeout(scopedRefreshTimerRef.current)
        scopedRefreshTimerRef.current = null
      }
      unsubscribe()
    }
  }, [refreshAll])

  return (
    <SuperAdminShell
      title="Super Admin Dashboard"
      subtitle="Tenant graph explorer: Trader -> Company -> User with strict scope visibility"
      initialProfile={initialProfile}
    >
      <div className="space-y-6">
        {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

        <Card className="border-slate-200">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Shield className="h-6 w-6 text-blue-600" />
                <div>
                  <h2 className="text-xl font-semibold">Connected Tenant Explorer</h2>
                  <p className="text-sm text-slate-500">
                    Select trader, then company, then user. Data is isolated and never mixed.
                  </p>
                </div>
              </div>
              <Button variant="outline" onClick={() => refreshAll({ mode: 'full' })} disabled={refreshing}>
                {refreshing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-2xl font-semibold text-indigo-600">{traderSummaryCount}</p>
                <p className="text-xs text-slate-500">Traders</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-2xl font-semibold text-blue-600">{companySummaryCount}</p>
                <p className="text-xs text-slate-500">Companies (selected scope)</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-2xl font-semibold text-emerald-600">{userSummaryCount}</p>
                <p className="text-xs text-slate-500">Users (selected scope)</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-2xl font-semibold text-orange-600">{writeCount}</p>
                <p className="text-xs text-slate-500">Write Privileges (selected user)</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={selectedTrader ? 'default' : 'secondary'}>
                Trader: {selectedTrader?.name || 'Not selected'}
              </Badge>
              <span className="text-slate-400">→</span>
              <Badge variant={selectedCompany ? 'default' : 'secondary'}>
                Company: {selectedCompany?.name || 'Not selected'}
              </Badge>
              <span className="text-slate-400">→</span>
              <Badge variant={selectedUser ? 'default' : 'secondary'}>
                User: {selectedUser?.userId || 'Not selected'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="relative border-slate-200">
          <RefreshOverlay refreshing={refreshing} label="Refreshing closure queue" />
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Closure Requests Queue</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Review backup-ready traders, deletion approvals, and closure requests from one place.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/super-admin/subscriptions?state=closure_requested">
                  <Button size="sm" variant="outline">Open Closure Reviews</Button>
                </Link>
                <Link href="/super-admin/subscriptions?state=deletion_pending">
                  <Button size="sm" variant="outline">Open Deletion Pending</Button>
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {closureQueue.schemaWarning ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {closureQueue.schemaWarning}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Closure Requested</p>
                    <p className="mt-1 text-2xl font-semibold text-blue-900">{closureQueue.summary.closureRequested}</p>
                  </div>
                  <Clock3 className="h-5 w-5 text-blue-700" />
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Backup Ready</p>
                    <p className="mt-1 text-2xl font-semibold text-amber-900">{closureQueue.summary.backupReady}</p>
                  </div>
                  <Download className="h-5 w-5 text-amber-700" />
                </div>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Deletion Pending</p>
                    <p className="mt-1 text-2xl font-semibold text-red-900">{closureQueue.summary.deletionPending}</p>
                  </div>
                  <Trash2 className="h-5 w-5 text-red-700" />
                </div>
              </div>
            </div>

            {closureQueue.rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                No traders are waiting in the closure workflow right now.
              </div>
            ) : (
              <div className="space-y-3">
                {closureQueue.rows.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                          <Badge variant={getClosureQueueBadgeVariant(item.queueStage)}>
                            {getClosureQueueStageLabel(item.queueStage)}
                          </Badge>
                          {item.locked ? <Badge variant="outline">Locked</Badge> : null}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>{getClosureQueueMetaLabel(item)}</span>
                          <span>Plan: {item.currentPlanName || 'Not assigned'}</span>
                          <span>Subscription: {item.subscriptionState.replace(/_/g, ' ')}</span>
                          <span>Days left: {item.daysLeft ?? '-'}</span>
                        </div>
                        <p className="text-sm text-slate-600">{item.lifecycleMessage || 'Closure workflow is active for this trader.'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link href={getClosureQueueHref(item)}>
                          <Button size="sm">Open Review</Button>
                        </Link>
                        <Link href={`/super-admin/traders/${item.id}`}>
                          <Button size="sm" variant="outline">Trader Details</Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div ref={graphContainerRef} className="relative grid gap-4 xl:grid-cols-3">
          <svg
            className="pointer-events-none absolute inset-0 z-20 hidden xl:block"
            width="100%"
            height="100%"
            viewBox={`0 0 ${graphContainerRef.current?.clientWidth || 1} ${graphContainerRef.current?.clientHeight || 1}`}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="tenantFlowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#0f172a" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0.9" />
              </linearGradient>
              <marker id="tenantFlowArrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#2563eb" />
              </marker>
            </defs>

            {graphPoints.traderToCompany
              ? renderGraphConnector(graphPoints.traderToCompany.from, graphPoints.traderToCompany.to, 'trader-company')
              : null}
            {graphPoints.companyToUser
              ? renderGraphConnector(graphPoints.companyToUser.from, graphPoints.companyToUser.to, 'company-user')
              : null}
          </svg>

          <Card className="transition-all duration-300">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="h-4 w-4" />
                Traders
              </CardTitle>
              <Input
                placeholder="Search trader..."
                value={traderQuery}
                onChange={(e) => setTraderQuery(e.target.value)}
              />
            </CardHeader>
            <CardContent>
              <div ref={traderListRef} className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
                {loadingTraders ? (
                  <div className="py-8 text-center text-sm text-slate-500">Loading traders...</div>
                ) : (
                  filteredTraders.map((row) => (
                    <div
                      key={row.id}
                      ref={(node) => {
                        traderNodeRefs.current[row.id] = node
                      }}
                      onClick={() => void handleSelectTrader(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          void handleSelectTrader(row.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        selectedTraderId === row.id
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white hover:border-slate-400'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{row.name}</p>
                          <p className="text-xs opacity-80">
                            {row._count.companies} companies • {row._count.users} users
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded p-1 hover:bg-black/10"
                            onClick={(event) => {
                              event.stopPropagation()
                              void toggleTraderLock(row)
                            }}
                            aria-label={row.locked ? 'Unlock trader' : 'Lock trader'}
                          >
                            {row.locked ? <Lock className="h-3 w-3 text-red-400" /> : <Unlock className="h-3 w-3 text-emerald-500" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card
            className={`transition-all duration-300 ${
              selectedTrader ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-4 opacity-50'
            }`}
          >
            <div className="relative">
              <RefreshOverlay refreshing={loadingCompanies} label="Refreshing companies" />
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" />
                Companies {selectedTrader ? `of ${selectedTrader.name}` : ''}
              </CardTitle>
              <Input
                placeholder="Search company..."
                value={companyQuery}
                onChange={(e) => setCompanyQuery(e.target.value)}
                disabled={!selectedTrader}
              />
            </CardHeader>
            <CardContent>
              {!selectedTrader ? (
                <div className="py-10 text-center text-sm text-slate-500">Select a trader to load connected companies.</div>
              ) : (
                <div ref={companyListRef} className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
                  {loadingCompanies ? (
                    filteredCompanies.length === 0 ? (
                      <div className="py-8 text-center text-sm text-slate-500">Loading companies...</div>
                    ) : (
                      filteredCompanies.map((row) => (
                        <div
                          key={row.id}
                          ref={(node) => {
                            companyNodeRefs.current[row.id] = node
                          }}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold">{row.name}</p>
                              <p className="text-xs opacity-80">{row._count.users} users connected</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )
                  ) : (
                    filteredCompanies.map((row) => (
                      <div
                        key={row.id}
                        ref={(node) => {
                          companyNodeRefs.current[row.id] = node
                        }}
                        onClick={() => void handleSelectCompany(row.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            void handleSelectCompany(row.id)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                          selectedCompanyId === row.id
                            ? 'border-blue-700 bg-blue-700 text-white'
                            : 'border-slate-200 bg-white hover:border-slate-400'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">{row.name}</p>
                            <p className="text-xs opacity-80">{row._count.users} users connected</p>
                          </div>
                          <button
                            type="button"
                            className="rounded p-1 hover:bg-black/10"
                            onClick={(event) => {
                              event.stopPropagation()
                              void toggleCompanyLock(row)
                            }}
                            aria-label={row.locked ? 'Unlock company' : 'Lock company'}
                          >
                            {row.locked ? <Lock className="h-3 w-3 text-red-400" /> : <Unlock className="h-3 w-3 text-emerald-500" />}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
            </div>
          </Card>

          <Card
            className={`transition-all duration-300 ${
              selectedCompany ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-4 opacity-50'
            }`}
          >
            <div className="relative">
              <RefreshOverlay refreshing={loadingUsers} label="Refreshing users" />
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Users {selectedCompany ? `of ${selectedCompany.name}` : ''}
              </CardTitle>
              <Input
                placeholder="Search user..."
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                disabled={!selectedCompany}
              />
            </CardHeader>
            <CardContent>
              {!selectedCompany ? (
                <div className="py-10 text-center text-sm text-slate-500">Select a company to load connected users.</div>
              ) : (
                <div ref={userListRef} className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
                  {loadingUsers ? (
                    filteredUsers.length === 0 ? (
                      <div className="py-8 text-center text-sm text-slate-500">Loading users...</div>
                    ) : (
                      filteredUsers.map((row) => (
                        <div
                          key={row.id}
                          ref={(node) => {
                            userNodeRefs.current[row.id] = node
                          }}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold">{row.userId}</p>
                              <p className="text-xs opacity-80">
                                {row.name || '-'} • {row.role || 'company_user'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    )
                  ) : (
                    filteredUsers.map((row) => (
                      <div
                        key={row.id}
                        ref={(node) => {
                          userNodeRefs.current[row.id] = node
                        }}
                        onClick={() => void handleSelectUser(row.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            void handleSelectUser(row.id)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                          selectedUserId === row.id
                            ? 'border-emerald-700 bg-emerald-700 text-white'
                            : 'border-slate-200 bg-white hover:border-slate-400'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">{row.userId}</p>
                            <p className="text-xs opacity-80">
                              {row.name || '-'} • {row.role || 'company_user'}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="rounded p-1 hover:bg-black/10"
                            onClick={(event) => {
                              event.stopPropagation()
                              void toggleUserLock(row)
                            }}
                            aria-label={row.locked ? 'Unlock user' : 'Lock user'}
                          >
                            {row.locked ? <Lock className="h-3 w-3 text-red-400" /> : <Unlock className="h-3 w-3 text-emerald-500" />}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
            </div>
          </Card>
        </div>

        <Card className="relative transition-all duration-300">
          <RefreshOverlay refreshing={loadingPermissions} label="Refreshing privileges" />
          <CardHeader>
            <CardTitle>Selected User Privilege Snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedUser ? (
              <p className="text-sm text-slate-500">Select a user to preview module privileges.</p>
            ) : loadingPermissions ? (
              <p className="text-sm text-slate-500">Loading privilege snapshot...</p>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded border border-slate-200 p-3 text-sm">User: <strong>{selectedUser.userId}</strong></div>
                  <div className="rounded border border-slate-200 p-3 text-sm">Role: <strong>{selectedUser.role || 'company_user'}</strong></div>
                  <div className="rounded border border-slate-200 p-3 text-sm">Read Modules: <strong>{readCount}</strong></div>
                  <div className="rounded border border-slate-200 p-3 text-sm">Write Modules: <strong>{writeCount}</strong></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {permissionPreview?.permissions
                    .filter((row) => row.canWrite)
                    .slice(0, 8)
                    .map((row) => (
                      <Badge key={row.module} variant="default">
                        {row.label}
                      </Badge>
                    ))}
                  {writeCount === 0 ? <Badge variant="secondary">No write permissions</Badge> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/super-admin/users/${selectedUser.id}`}>
                    <Button size="sm">Open Full Privilege Matrix</Button>
                  </Link>
                  {selectedTrader ? (
                    <Link href={`/super-admin/traders/${selectedTrader.id}`}>
                      <Button size="sm" variant="outline">Open Trader Details</Button>
                    </Link>
                  ) : null}
                  {selectedCompany ? (
                    <Link href={`/super-admin/companies/${selectedCompany.id}`}>
                      <Button size="sm" variant="outline">Open Company Details</Button>
                    </Link>
                  ) : null}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SuperAdminShell>
  )
}
