'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Building2, Lock, RefreshCw, Shield, Store, Unlock, Users } from 'lucide-react'

type SuperAdminOverviewClientProps = {
  initialStats: {
    traders: number
    companies: number
    users: number
  }
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
  permissions: PermissionRow[]
}

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

export default function SuperAdminOverviewClient({ initialStats }: SuperAdminOverviewClientProps) {
  const [traders, setTraders] = useState<TraderRow[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [permissionPreview, setPermissionPreview] = useState<PermissionPreview | null>(null)

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

  const companiesRequestRef = useRef(0)
  const usersRequestRef = useRef(0)
  const permissionsRequestRef = useRef(0)
  const graphContainerRef = useRef<HTMLDivElement | null>(null)
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

  const fetchTraders = useCallback(async () => {
    setLoadingTraders(true)
    setError(null)
    try {
      const response = await fetch('/api/super-admin/traders')
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load traders')
      }
      setTraders(Array.isArray(payload) ? payload : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load traders')
    } finally {
      setLoadingTraders(false)
    }
  }, [])

  const fetchCompanies = useCallback(async (traderId: string) => {
    const requestId = ++companiesRequestRef.current
    setLoadingCompanies(true)
    try {
      const response = await fetch(`/api/super-admin/companies?traderId=${encodeURIComponent(traderId)}`)
      const payload = await response.json().catch(() => ({}))
      if (requestId !== companiesRequestRef.current) return
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load companies')
      }
      setCompanies(Array.isArray(payload) ? payload : [])
    } catch (err) {
      if (requestId !== companiesRequestRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load companies')
    } finally {
      if (requestId === companiesRequestRef.current) {
        setLoadingCompanies(false)
      }
    }
  }, [])

  const fetchUsers = useCallback(async (companyId: string) => {
    const requestId = ++usersRequestRef.current
    setLoadingUsers(true)
    try {
      const response = await fetch(`/api/super-admin/users?companyId=${encodeURIComponent(companyId)}`)
      const payload = await response.json().catch(() => ({}))
      if (requestId !== usersRequestRef.current) return
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load users')
      }
      setUsers(Array.isArray(payload) ? payload : [])
    } catch (err) {
      if (requestId !== usersRequestRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      if (requestId === usersRequestRef.current) {
        setLoadingUsers(false)
      }
    }
  }, [])

  const fetchPermissionPreview = useCallback(async (userId: string, companyId?: string | null) => {
    const requestId = ++permissionsRequestRef.current
    setLoadingPermissions(true)
    try {
      const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
      const response = await fetch(`/api/super-admin/users/${userId}/permissions${qs}`)
      const payload = await response.json().catch(() => ({}))
      if (requestId !== permissionsRequestRef.current) return
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load permission preview')
      }
      setPermissionPreview({
        permissions: Array.isArray(payload.permissions) ? payload.permissions : []
      })
    } catch (err) {
      if (requestId !== permissionsRequestRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load permission preview')
    } finally {
      if (requestId === permissionsRequestRef.current) {
        setLoadingPermissions(false)
      }
    }
  }, [])

  useEffect(() => {
    void fetchTraders()
    return () => undefined
  }, [fetchTraders])

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
    window.addEventListener('resize', handleLayoutChange)
    traderListRef.current?.addEventListener('scroll', handleLayoutChange)
    companyListRef.current?.addEventListener('scroll', handleLayoutChange)
    userListRef.current?.addEventListener('scroll', handleLayoutChange)

    return () => {
      window.removeEventListener('resize', handleLayoutChange)
      traderListRef.current?.removeEventListener('scroll', handleLayoutChange)
      companyListRef.current?.removeEventListener('scroll', handleLayoutChange)
      userListRef.current?.removeEventListener('scroll', handleLayoutChange)
    }
  }, [recalculateGraphPoints])

  const handleSelectTrader = async (traderId: string) => {
    setSelectedTraderId(traderId)
    setSelectedCompanyId(null)
    setSelectedUserId(null)
    setCompanies([])
    setUsers([])
    setPermissionPreview(null)
    await fetchCompanies(traderId)
  }

  const handleSelectCompany = async (companyId: string) => {
    setSelectedCompanyId(companyId)
    setSelectedUserId(null)
    setUsers([])
    setPermissionPreview(null)
    await fetchUsers(companyId)
  }

  const handleSelectUser = async (userId: string, companyId?: string | null) => {
    setSelectedUserId(userId)
    await fetchPermissionPreview(userId, companyId)
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
    await fetchTraders()
    if (selectedTraderId === row.id) {
      await fetchCompanies(row.id)
    }
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
    if (selectedTraderId) {
      await fetchCompanies(selectedTraderId)
    }
    if (selectedCompanyId === row.id) {
      await fetchUsers(row.id)
    }
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
    if (selectedCompanyId) {
      await fetchUsers(selectedCompanyId)
    }
    if (selectedUserId === row.id) {
      await fetchPermissionPreview(row.id, row.companyId)
    }
  }

  const refreshAll = async () => {
    setRefreshing(true)
    await fetchTraders()
    if (selectedTraderId) {
      await fetchCompanies(selectedTraderId)
    }
    if (selectedCompanyId) {
      await fetchUsers(selectedCompanyId)
    }
    if (selectedUserId && selectedUser?.companyId) {
      await fetchPermissionPreview(selectedUserId, selectedUser.companyId)
    }
    setRefreshing(false)
  }

  return (
    <SuperAdminShell
      title="Super Admin Dashboard"
      subtitle="Tenant graph explorer: Trader -> Company -> User with strict scope visibility"
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
              <Button variant="outline" onClick={() => refreshAll()} disabled={refreshing}>
                {refreshing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-2xl font-semibold text-indigo-600">{traders.length || initialStats.traders}</p>
                <p className="text-xs text-slate-500">Traders</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-2xl font-semibold text-blue-600">{companies.length || initialStats.companies}</p>
                <p className="text-xs text-slate-500">Companies (selected scope)</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-2xl font-semibold text-emerald-600">{users.length || initialStats.users}</p>
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
                    <div className="py-8 text-center text-sm text-slate-500">Loading companies...</div>
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
          </Card>

          <Card
            className={`transition-all duration-300 ${
              selectedCompany ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-4 opacity-50'
            }`}
          >
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
                    <div className="py-8 text-center text-sm text-slate-500">Loading users...</div>
                  ) : (
                    filteredUsers.map((row) => (
                      <div
                        key={row.id}
                        ref={(node) => {
                          userNodeRefs.current[row.id] = node
                        }}
                        onClick={() => void handleSelectUser(row.id, row.companyId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            void handleSelectUser(row.id, row.companyId)
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
          </Card>
        </div>

        <Card className="transition-all duration-300">
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
