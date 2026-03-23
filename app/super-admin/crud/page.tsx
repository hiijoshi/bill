'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Building2, Loader2, Lock, Pencil, Plus, RefreshCw, ShieldCheck, Store, Unlock, Users, type LucideIcon } from 'lucide-react'
import { PERMISSION_MODULES, type PermissionModule } from '@/lib/permissions'

type CrudSection = 'traders' | 'companies' | 'users'

type TraderRow = {
  id: string
  name: string
  maxCompanies?: number | null
  maxUsers?: number | null
  locked: boolean
  _count?: {
    companies?: number
    users?: number
  }
}

type CompanyRow = {
  id: string
  name: string
  traderId: string | null
  locked: boolean
  phone?: string | null
  address?: string | null
  mandiAccountNumber?: string | null
  trader?: { id: string; name: string } | null
  _count?: {
    users?: number
  }
}

type UserRow = {
  id: string
  userId: string
  traderId: string
  companyId: string | null
  name?: string | null
  role?: string | null
  locked: boolean
  active?: boolean
  trader?: { id: string; name: string } | null
  company?: { id: string; name: string } | null
  permissions?: Array<{
    companyId?: string | null
    company?: { id: string; name: string } | null
  }>
}

type ModalState = {
  section: CrudSection
  mode: 'create' | 'edit'
  recordId?: string
  form: {
    name?: string
    traderId?: string
    companyId?: string
    userId?: string
    password?: string
    address?: string
    phone?: string
    mandiAccountNumber?: string
    locked?: boolean
    privilegePreset?: 'keep' | 'none' | 'read' | 'all'
    maxCompanies?: string
    maxUsers?: string
  }
}

type KpiState = {
  traders: number
  lockedTraders: number
  companies: number
  lockedCompanies: number
  users: number
  lockedUsers: number
}

const tabs: Array<{ key: CrudSection; label: string; icon: LucideIcon }> = [
  { key: 'traders', label: 'Traders', icon: Store },
  { key: 'companies', label: 'Companies', icon: Building2 },
  { key: 'users', label: 'Users', icon: Users }
]

export default function SuperAdminCrudPage() {
  const [activeTab, setActiveTab] = useState<CrudSection>('traders')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [saving, setSaving] = useState(false)
  const [lockingKey, setLockingKey] = useState<string | null>(null)
  const [privilegeSavingKey, setPrivilegeSavingKey] = useState<string | null>(null)
  const [quickLimitCompanyId, setQuickLimitCompanyId] = useState('')
  const [quickLimitForm, setQuickLimitForm] = useState({ maxCompanies: '0', maxUsers: '0' })
  const [quickLimitSaving, setQuickLimitSaving] = useState(false)
  const [kpis, setKpis] = useState<KpiState>({
    traders: 0,
    lockedTraders: 0,
    companies: 0,
    lockedCompanies: 0,
    users: 0,
    lockedUsers: 0
  })

  const [traders, setTraders] = useState<TraderRow[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const modalScrollRef = useRef<HTMLDivElement | null>(null)

  const fetchData = useCallback(async (section: CrudSection = activeTab) => {
    setError(null)
    setRefreshing(true)
    try {
      const requests: Promise<Response>[] = [fetch('/api/super-admin/stats')]
      if (section === 'traders') {
        requests.push(fetch('/api/super-admin/traders'))
      } else if (section === 'companies') {
        requests.push(fetch('/api/super-admin/traders'), fetch('/api/super-admin/companies'))
      } else {
        requests.push(fetch('/api/super-admin/traders'), fetch('/api/super-admin/companies'), fetch('/api/super-admin/users'))
      }

      const settledResponses = await Promise.allSettled(requests)
      const responses = await Promise.all(
        settledResponses.map(async (result) => {
          if (result.status !== 'fulfilled') {
            return {
              ok: false,
              payload: { error: 'Request failed' } as Record<string, unknown>
            }
          }

          return {
            ok: result.value.ok,
            payload: await result.value.json().catch(() => ({} as Record<string, unknown>))
          }
        })
      )

      const [statsResult, ...sectionResults] = responses
      const statsPayload = statsResult?.payload || {}

      if (statsResult?.ok) {
        setKpis({
          traders: Number((statsPayload as Record<string, unknown>).totalTraders || 0),
          lockedTraders: Number((statsPayload as Record<string, unknown>).lockedTraders || 0),
          companies: Number((statsPayload as Record<string, unknown>).totalCompanies || 0),
          lockedCompanies: Number((statsPayload as Record<string, unknown>).lockedCompanies || 0),
          users: Number((statsPayload as Record<string, unknown>).totalUsers || 0),
          lockedUsers: Number((statsPayload as Record<string, unknown>).lockedUsers || 0)
        })
      } else {
        setKpis({
          traders: 0,
          lockedTraders: 0,
          companies: 0,
          lockedCompanies: 0,
          users: 0,
          lockedUsers: 0
        })
      }

      if (section === 'traders') {
        if (sectionResults[0]?.ok && Array.isArray(sectionResults[0].payload)) {
          setTraders(sectionResults[0].payload as TraderRow[])
        } else if (!traders.length) {
          setError('Failed to load traders')
        }
      } else if (section === 'companies') {
        if (sectionResults[0]?.ok && Array.isArray(sectionResults[0].payload)) {
          setTraders(sectionResults[0].payload as TraderRow[])
        } else if (!traders.length) {
          setError('Failed to load traders')
        }
        if (sectionResults[1]?.ok && Array.isArray(sectionResults[1].payload)) {
          setCompanies(sectionResults[1].payload as CompanyRow[])
        } else if (!companies.length) {
          setError((current) => current || 'Failed to load companies')
        }
      } else {
        if (sectionResults[0]?.ok && Array.isArray(sectionResults[0].payload)) {
          setTraders(sectionResults[0].payload as TraderRow[])
        } else if (!traders.length) {
          setError('Failed to load traders')
        }
        if (sectionResults[1]?.ok && Array.isArray(sectionResults[1].payload)) {
          setCompanies(sectionResults[1].payload as CompanyRow[])
        } else if (!companies.length) {
          setError((current) => current || 'Failed to load companies')
        }
        if (sectionResults[2]?.ok && Array.isArray(sectionResults[2].payload)) {
          setUsers(sectionResults[2].payload as UserRow[])
        } else if (!users.length) {
          setError((current) => current || 'Failed to load users')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeTab, companies.length, traders.length, users.length])

  useEffect(() => {
    setLoading(true)
    void fetchData(activeTab)
  }, [activeTab, fetchData])

  const lowerSearch = search.trim().toLowerCase()

  const filteredTraders = useMemo(() => {
    if (!lowerSearch) return traders
    return traders.filter((row) => row.name.toLowerCase().includes(lowerSearch))
  }, [lowerSearch, traders])

  const filteredCompanies = useMemo(() => {
    if (!lowerSearch) return companies
    return companies.filter((row) => {
      const traderName = row.trader?.name || ''
      return (
        row.name.toLowerCase().includes(lowerSearch) ||
        traderName.toLowerCase().includes(lowerSearch) ||
        (row.phone || '').toLowerCase().includes(lowerSearch)
      )
    })
  }, [lowerSearch, companies])

  const filteredUsers = useMemo(() => {
    if (!lowerSearch) return users
    return users.filter((row) => {
      const companyName = row.company?.name || ''
      return (
        row.userId.toLowerCase().includes(lowerSearch) ||
        (row.name || '').toLowerCase().includes(lowerSearch) ||
        row.traderId.toLowerCase().includes(lowerSearch) ||
        companyName.toLowerCase().includes(lowerSearch)
      )
    })
  }, [lowerSearch, users])

  const traderMap = useMemo(() => new Map(traders.map((row) => [row.id, row])), [traders])

  const resetModal = () => {
    setModal(null)
    setModalError(null)
    setError(null)
  }

  const openCreateModal = (section: CrudSection) => {
    setError(null)
    setModalError(null)
    if (section === 'traders') {
      setModal({
        section,
        mode: 'create',
        form: {
          name: '',
          maxCompanies: '0',
          maxUsers: '0',
          locked: false
        }
      })
      return
    }

    if (section === 'companies') {
      setModal({
        section,
        mode: 'create',
        form: {
          name: '',
          traderId: '',
          address: '',
          phone: '',
          mandiAccountNumber: '',
          locked: false
        }
      })
      return
    }

    setModal({
      section,
      mode: 'create',
      form: {
        traderId: '',
        companyId: '',
        userId: '',
        name: '',
        password: '',
        locked: false,
        privilegePreset: 'all'
      }
    })
  }

  const openEditModal = (section: CrudSection, record: TraderRow | CompanyRow | UserRow) => {
    setError(null)
    setModalError(null)
    if (section === 'traders') {
      const row = record as TraderRow
      setModal({
        section,
        mode: 'edit',
        recordId: row.id,
        form: {
          name: row.name,
          maxCompanies: String(row.maxCompanies ?? 0),
          maxUsers: String(row.maxUsers ?? 0),
          locked: row.locked
        }
      })
      return
    }

    if (section === 'companies') {
      const row = record as CompanyRow
      setModal({
        section,
        mode: 'edit',
        recordId: row.id,
        form: {
          name: row.name,
          traderId: row.traderId || '',
          address: row.address || '',
          phone: row.phone || '',
          mandiAccountNumber: row.mandiAccountNumber || '',
          locked: row.locked
        }
      })
      return
    }

    const row = record as UserRow
    setModal({
      section,
      mode: 'edit',
      recordId: row.id,
        form: {
          traderId: row.traderId,
          companyId: row.companyId || '',
          userId: row.userId,
          name: row.name || '',
          password: '',
          locked: row.locked,
          privilegePreset: 'keep'
        }
      })
  }

  const setModalField = (field: keyof ModalState['form'], value: string | boolean) => {
    setModal((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        form: {
          ...prev.form,
          [field]: value
        }
      }
    })
  }

  const buildPermissionsPayload = (preset: 'none' | 'read' | 'all') =>
    PERMISSION_MODULES.map((module: PermissionModule) => ({
      module,
      canRead: preset !== 'none',
      canWrite: preset === 'all'
    }))

  const resolveActionError = async (error: unknown, fallback: string) => {
    if (error instanceof Response) {
      const payload = await error.json().catch(() => null)
      if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
        return payload.error
      }

      const text = await error.text().catch(() => '')
      return text || fallback
    }

    return error instanceof Error ? error.message : fallback
  }

  const extractValidationDetails = (payload: unknown): string[] => {
    if (!payload || typeof payload !== 'object') return []

    if ('details' in payload && Array.isArray(payload.details)) {
      return payload.details
        .map((detail) => {
          if (!detail || typeof detail !== 'object') return ''
          const path =
            'path' in detail && typeof detail.path === 'string' && detail.path.trim().length > 0
              ? detail.path.trim()
              : ''
          const message =
            'message' in detail && typeof detail.message === 'string' && detail.message.trim().length > 0
              ? detail.message.trim()
              : ''
          if (!message) return ''
          return path ? `${path}: ${message}` : message
        })
        .filter(Boolean)
    }

    if ('errors' in payload && Array.isArray(payload.errors)) {
      return payload.errors.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }

    return []
  }

  const extractResponseError = (payload: unknown, fallback: string, status?: number) => {
    const details = extractValidationDetails(payload)
    const withDetails = (base: string) => (details.length ? [base, ...details.map((detail) => `- ${detail}`)].join('\n') : base)

    if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
      return withDetails(payload.error)
    }
    if (payload && typeof payload === 'object' && 'timedOut' in payload && payload.timedOut === true) {
      return 'Request timed out. Please retry once.'
    }
    if (status === 504) {
      return 'Request timed out. Please retry once.'
    }
    if (status === 499) {
      return 'Request was interrupted. Please retry.'
    }
    return withDetails(fallback)
  }

  const applyUserPrivileges = async (
    userDbId: string,
    companyId: string,
    preset: 'none' | 'read' | 'all'
  ) => {
    const response = await fetch(`/api/super-admin/users/${userDbId}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId,
        permissions: buildPermissionsPayload(preset)
      })
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(extractResponseError(payload, 'Failed to save privileges', response.status))
    }
  }

  const saveModal = async () => {
    if (!modal) return
    setSaving(true)
    setError(null)
    setModalError(null)

    try {
      const { section, mode, recordId, form } = modal

      let url = ''
      let method: 'POST' | 'PUT' = 'POST'
      let payload: Record<string, unknown> = {}

      if (section === 'traders') {
        const name = (form.name || '').trim()
        if (!name) throw new Error('Trader name is required')
        url = mode === 'create' ? '/api/super-admin/traders' : `/api/super-admin/traders/${recordId}`
        method = mode === 'create' ? 'POST' : 'PUT'
        payload = {
          name,
          maxCompanies: form.maxCompanies?.trim() === '' ? 0 : Number(form.maxCompanies),
          maxUsers: form.maxUsers?.trim() === '' ? 0 : Number(form.maxUsers),
          locked: form.locked === true
        }
      } else if (section === 'companies') {
        const name = (form.name || '').trim()
        if (!name) throw new Error('Company name is required')
        url = mode === 'create' ? '/api/super-admin/companies' : `/api/super-admin/companies/${recordId}`
        method = mode === 'create' ? 'POST' : 'PUT'
        payload = {
          name,
          traderId: form.traderId?.trim() || null,
          address: form.address?.trim() || null,
          phone: form.phone?.trim() || null,
          mandiAccountNumber: form.mandiAccountNumber?.trim() || null,
          locked: form.locked === true
        }
      } else {
        const traderId = form.traderId?.trim() || ''
        const companyId = form.companyId?.trim() || ''
        const userId = form.userId?.trim() || ''
        const password = form.password?.trim() || ''
        if (!traderId || !companyId || !userId) {
          throw new Error('Trader, company and user ID are required')
        }
        if (mode === 'create' && password.length < 6) {
          throw new Error('Password must be at least 6 characters')
        }
        if (mode === 'edit' && password && password.length < 6) {
          throw new Error('Password must be at least 6 characters')
        }

        url = mode === 'create' ? '/api/super-admin/users' : `/api/super-admin/users/${recordId}`
        method = mode === 'create' ? 'POST' : 'PUT'
        payload = {
          traderId,
          companyId,
          userId,
          name: form.name?.trim() || null,
          locked: form.locked === true,
          ...(mode === 'create'
            ? { privilegePreset: (form.privilegePreset || 'all') as 'none' | 'read' | 'all' }
            : {}),
          ...(password ? { password } : {})
        }
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const responsePayload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(extractResponseError(responsePayload, 'Failed to save', response.status))
      }

      if (section === 'users' && mode === 'edit') {
        const preset = (form.privilegePreset || 'keep') as 'keep' | 'none' | 'read' | 'all'
        const targetUserId = String(responsePayload?.id || recordId || '')
        const targetCompanyId = String(form.companyId?.trim() || '')
        if (preset !== 'keep' && targetUserId && targetCompanyId) {
          await applyUserPrivileges(targetUserId, targetCompanyId, preset)
        }
      }

      resetModal()
      await fetchData(activeTab)
    } catch (err) {
      setModalError(await resolveActionError(err, 'Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  const quickApplyPrivileges = async (row: UserRow, preset: 'none' | 'read' | 'all') => {
    const targetCompanyId = (row.companyId || row.company?.id || '').trim()
    if (!targetCompanyId) {
      setError('User has no company assigned. Cannot set privileges.')
      return
    }

    const key = `${row.id}:${preset}`
    if (privilegeSavingKey === key) return

    try {
      setError(null)
      setPrivilegeSavingKey(key)
      await applyUserPrivileges(row.id, targetCompanyId, preset)
      await fetchData(activeTab)
    } catch (err) {
      setError(await resolveActionError(err, 'Failed to update privileges'))
    } finally {
      setPrivilegeSavingKey(null)
    }
  }

  const deleteModalRecord = async () => {
    if (!modal || modal.mode !== 'edit' || !modal.recordId) return
    const confirmDelete = window.confirm('Delete this record?')
    if (!confirmDelete) return

    try {
      setModalError(null)
      const endpoint =
        modal.section === 'traders'
          ? `/api/super-admin/traders/${modal.recordId}`
          : modal.section === 'companies'
            ? `/api/super-admin/companies/${modal.recordId}`
            : `/api/super-admin/users/${modal.recordId}`

      const response = await fetch(endpoint, { method: 'DELETE' })
      const responsePayload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(extractResponseError(responsePayload, 'Failed to delete', response.status))
      }

      resetModal()
      await fetchData(activeTab)
    } catch (err) {
      setModalError(await resolveActionError(err, 'Failed to delete'))
    }
  }

  const toggleLock = async (section: CrudSection, id: string, currentlyLocked: boolean) => {
    const key = `${section}:${id}`
    if (lockingKey === key) return

    const nextLocked = !currentlyLocked
    setLockingKey(key)

    try {
      const endpoint =
        section === 'traders'
          ? `/api/super-admin/traders/${id}/lock`
          : section === 'companies'
            ? `/api/super-admin/companies/${id}/lock`
            : `/api/super-admin/users/${id}/lock`

      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: nextLocked })
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(extractResponseError(payload, 'Failed to update status', response.status))
      }

      await fetchData(activeTab)
    } catch (err) {
      setError(await resolveActionError(err, 'Failed to update status'))
    } finally {
      setLockingKey(null)
    }
  }

  const traderOptions = traders.map((row) => ({ value: row.id, label: row.name }))
  const companyOptions = companies
    .filter((row) => !modal?.form.traderId || row.traderId === modal.form.traderId)
    .map((row) => ({ value: row.id, label: row.name }))
  const modalTrader = modal?.form.traderId ? traders.find((row) => row.id === modal.form.traderId) || null : null
  const quickLimitCompany = companies.find((row) => row.id === quickLimitCompanyId) || null
  const quickLimitTrader = traders.find((row) => row.id === quickLimitCompany?.traderId) || null

  useEffect(() => {
    if (activeTab !== 'companies') return
    if (!companies.length) {
      setQuickLimitCompanyId('')
      setQuickLimitForm({ maxCompanies: '0', maxUsers: '0' })
      return
    }

    const nextCompanyId = companies.some((row) => row.id === quickLimitCompanyId) ? quickLimitCompanyId : companies[0].id
    const nextCompany = companies.find((row) => row.id === nextCompanyId) || null
    const nextTrader = traders.find((row) => row.id === nextCompany?.traderId) || null

    setQuickLimitCompanyId(nextCompanyId)
    setQuickLimitForm({
      maxCompanies: String(nextTrader?.maxCompanies ?? 0),
      maxUsers: String(nextTrader?.maxUsers ?? 0)
    })
  }, [activeTab, companies, traders, quickLimitCompanyId])

  useEffect(() => {
    if (!modalError) return
    const container = modalScrollRef.current
    if (!container) return

    container.scrollTo({ top: 0, behavior: 'smooth' })
  }, [modalError])

  const selectQuickLimitCompany = (companyId: string) => {
    setError(null)
    setQuickLimitCompanyId(companyId)
    const selectedCompany = companies.find((row) => row.id === companyId) || null
    const selectedTrader = traders.find((row) => row.id === selectedCompany?.traderId) || null
    setQuickLimitForm({
      maxCompanies: String(selectedTrader?.maxCompanies ?? 0),
      maxUsers: String(selectedTrader?.maxUsers ?? 0)
    })
  }

  const saveQuickLimits = async () => {
    if (!quickLimitCompany) {
      setError('Select a company first')
      return
    }

    if (!quickLimitCompany.traderId) {
      setError('Selected company is not linked to a trader')
      return
    }

    try {
      setError(null)
      setQuickLimitSaving(true)

      const response = await fetch(`/api/super-admin/traders/${quickLimitCompany.traderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxCompanies: quickLimitForm.maxCompanies.trim() === '' ? 0 : Number(quickLimitForm.maxCompanies),
          maxUsers: quickLimitForm.maxUsers.trim() === '' ? 0 : Number(quickLimitForm.maxUsers)
        })
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update limits')
      }

      await fetchData(activeTab)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update limits')
    } finally {
      setQuickLimitSaving(false)
    }
  }

  const activeTabLabel = tabs.find((tab) => tab.key === activeTab)?.label || 'Records'

  return (
    <SuperAdminShell
      title="Control Panel"
      subtitle="Top-level tenant operations with strict server-side control"
    >
      <div className="space-y-4">
        {error ? (
          <div className="whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        <Card className="border-slate-200">
          <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-6">
            <KpiTile label="Total Traders" value={kpis.traders} />
            <KpiTile label="Locked Traders" value={kpis.lockedTraders} danger />
            <KpiTile label="Total Companies" value={kpis.companies} />
            <KpiTile label="Locked Companies" value={kpis.lockedCompanies} danger />
            <KpiTile label="Total Users" value={kpis.users} />
            <KpiTile label="Locked Users" value={kpis.lockedUsers} danger />
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <Button
                    key={tab.key}
                    type="button"
                    size="sm"
                    variant={activeTab === tab.key ? 'default' : 'outline'}
                    onClick={() => setActiveTab(tab.key)}
                    className="gap-2"
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </Button>
                )
              })}
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${activeTabLabel.toLowerCase()}...`}
                className="md:max-w-sm"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => fetchData(activeTab)} disabled={refreshing}>
                  {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </Button>
                <Button type="button" size="sm" onClick={() => openCreateModal(activeTab)}>
                  <Plus className="h-4 w-4" />
                  Add {activeTabLabel.slice(0, -1)}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
          </div>
        ) : null}

        {!loading && activeTab === 'traders' ? (
          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Traders Table</CardTitle>
              <p className="text-sm text-slate-600">
                Super-admin can increase or decrease trader limits at any time. If a limit is not set, it defaults to
                0. Lowering a limit does not remove existing companies or users; it only blocks new additions until
                usage comes under the limit.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Companies</TableHead>
                    <TableHead>Company Limit</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>User Limit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTraders.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row._count?.companies || 0}</TableCell>
                      <TableCell>{row.maxCompanies ?? 0}</TableCell>
                      <TableCell>{row._count?.users || 0}</TableCell>
                      <TableCell>{row.maxUsers ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant={row.locked ? 'destructive' : 'default'}>
                          {row.locked ? 'Locked' : 'Active'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => toggleLock('traders', row.id, row.locked)}
                            disabled={lockingKey === `traders:${row.id}`}
                          >
                            {row.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                            {row.locked ? 'Unlock' : 'Lock'}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => openEditModal('traders', row)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {!loading && activeTab === 'companies' ? (
          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Companies Table</CardTitle>
              <p className="text-sm text-slate-600">
                Select any company here and update its trader limits directly. These limits apply across all companies of
                the same trader.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-5">
                <div className="md:col-span-2">
                  <Label>Select Company</Label>
                  <Select value={quickLimitCompanyId} onValueChange={selectQuickLimitCompany}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select company" />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Company Limit</Label>
                  <Input
                    type="number"
                    min="0"
                    value={quickLimitForm.maxCompanies}
                    onChange={(e) => setQuickLimitForm((prev) => ({ ...prev, maxCompanies: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label>User Limit</Label>
                  <Input
                    type="number"
                    min="0"
                    value={quickLimitForm.maxUsers}
                    onChange={(e) => setQuickLimitForm((prev) => ({ ...prev, maxUsers: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="flex items-end">
                  <Button type="button" className="w-full" onClick={saveQuickLimits} disabled={quickLimitSaving || !quickLimitCompanyId}>
                    {quickLimitSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Set Limits
                  </Button>
                </div>
                <div className="md:col-span-5 text-xs text-slate-500">
                  Trader: {quickLimitTrader?.name || quickLimitCompany?.trader?.name || '-'} | Lowering a limit keeps
                  current records active and only restricts new additions. Blank values are saved as 0.
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Trader</TableHead>
                    <TableHead>Company Limit</TableHead>
                    <TableHead>User Limit</TableHead>
                    <TableHead>Mandi Account No.</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCompanies.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.trader?.name || row.traderId || '-'}</TableCell>
                      <TableCell>{(row.traderId ? traderMap.get(row.traderId)?.maxCompanies : undefined) ?? 0}</TableCell>
                      <TableCell>{(row.traderId ? traderMap.get(row.traderId)?.maxUsers : undefined) ?? 0}</TableCell>
                      <TableCell>{row.mandiAccountNumber || '-'}</TableCell>
                      <TableCell>{row._count?.users || 0}</TableCell>
                      <TableCell>
                        <Badge variant={row.locked ? 'destructive' : 'default'}>
                          {row.locked ? 'Locked' : 'Active'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => selectQuickLimitCompany(row.id)}>
                            Limits
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => toggleLock('companies', row.id, row.locked)}
                            disabled={lockingKey === `companies:${row.id}`}
                          >
                            {row.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                            {row.locked ? 'Unlock' : 'Lock'}
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => openEditModal('companies', row)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {!loading && activeTab === 'users' ? (
          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Users Table</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Trader</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Privilege</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((row) => {
                    const locked = row.locked
                    const accessCompanyNames = Array.from(
                      new Set(
                        [
                          row.company?.name || null,
                          ...(Array.isArray(row.permissions)
                            ? row.permissions.map((permission) => permission.company?.name || null)
                            : [])
                        ].filter((value): value is string => Boolean(value))
                      )
                    )
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.userId}</TableCell>
                        <TableCell>{row.name || '-'}</TableCell>
                        <TableCell>{row.trader?.name || row.traderId}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div>{row.company?.name || row.companyId || '-'}</div>
                            {accessCompanyNames.length > 1 ? (
                              <div className="text-xs text-slate-500">
                                Access: {accessCompanyNames.join(', ')}
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{row.role || 'company_user'}</TableCell>
                        <TableCell>
                          <Badge variant={locked ? 'destructive' : 'default'}>
                            {locked ? 'Locked' : 'Active'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Link
                              href={`/super-admin/users/${row.id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                            >
                              <ShieldCheck className="h-3 w-3" />
                              Matrix
                            </Link>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              disabled={!(row.companyId || row.company?.id) || privilegeSavingKey === `${row.id}:all`}
                              onClick={() => quickApplyPrivileges(row, 'all')}
                            >
                              Full
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              disabled={!(row.companyId || row.company?.id) || privilegeSavingKey === `${row.id}:read`}
                              onClick={() => quickApplyPrivileges(row, 'read')}
                            >
                              Read
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              disabled={!(row.companyId || row.company?.id) || privilegeSavingKey === `${row.id}:none`}
                              onClick={() => quickApplyPrivileges(row, 'none')}
                            >
                              None
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => toggleLock('users', row.id, locked)}
                              disabled={lockingKey === `users:${row.id}`}
                            >
                              {locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                              {locked ? 'Unlock' : 'Lock'}
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => openEditModal('users', row)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {modal ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={resetModal} />
          <Card ref={modalScrollRef} className="fixed inset-0 z-50 m-auto max-h-[90vh] w-full max-w-3xl overflow-auto shadow-xl">
            <CardHeader className="sticky top-0 z-10 border-b bg-white">
              <div className="flex items-center justify-between">
                <CardTitle>
                  {modal.mode === 'create' ? 'Create' : 'Edit'}{' '}
                  {modal.section === 'traders' ? 'Trader' : modal.section === 'companies' ? 'Company' : 'User'}
                </CardTitle>
                <Button type="button" variant="ghost" onClick={resetModal}>
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {modalError ? (
                <div className="whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {modalError}
                </div>
              ) : null}
              {modal.section === 'traders' ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Label>Trader Name</Label>
                    <Input value={modal.form.name || ''} onChange={(e) => setModalField('name', e.target.value)} />
                  </div>
                  <div>
                    <Label>Company Limit</Label>
                    <Input
                      type="number"
                      min="0"
                      value={modal.form.maxCompanies || ''}
                      onChange={(e) => setModalField('maxCompanies', e.target.value)}
                      placeholder="0"
                    />
                    <p className="mt-1 text-xs text-slate-500">Defaults to 0 if left empty. Existing companies stay active.</p>
                  </div>
                  <div>
                    <Label>User Limit</Label>
                    <Input
                      type="number"
                      min="0"
                      value={modal.form.maxUsers || ''}
                      onChange={(e) => setModalField('maxUsers', e.target.value)}
                      placeholder="0"
                    />
                    <p className="mt-1 text-xs text-slate-500">Defaults to 0 if left empty. Existing users stay active.</p>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      checked={modal.form.locked === true}
                      onChange={(e) => setModalField('locked', e.target.checked)}
                    />
                    <Label>Locked</Label>
                  </div>
                </div>
              ) : null}

              {modal.section === 'companies' ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label>Company Name</Label>
                    <Input value={modal.form.name || ''} onChange={(e) => setModalField('name', e.target.value)} />
                  </div>
                  <div>
                    <Label>Trader</Label>
                    <Select value={modal.form.traderId || ''} onValueChange={(value) => setModalField('traderId', value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select trader" />
                      </SelectTrigger>
                      <SelectContent>
                        {traderOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {modalTrader ? (
                    <div className="md:col-span-2">
                      <LimitStatusBox
                        label={`Trader limit status for ${modalTrader.name}`}
                        companyCount={modalTrader._count?.companies || 0}
                        companyLimit={modalTrader.maxCompanies ?? 0}
                        userCount={modalTrader._count?.users || 0}
                        userLimit={modalTrader.maxUsers ?? 0}
                      />
                    </div>
                  ) : null}
                  <div>
                    <Label>Phone</Label>
                    <Input
                      value={modal.form.phone || ''}
                      onChange={(e) => setModalField('phone', e.target.value)}
                      placeholder="10 digit phone"
                    />
                  </div>
                  <div>
                    <Label>Address</Label>
                    <Input value={modal.form.address || ''} onChange={(e) => setModalField('address', e.target.value)} />
                  </div>
                  <div>
                    <Label>Mandi Account Number</Label>
                    <Input
                      value={modal.form.mandiAccountNumber || ''}
                      onChange={(e) => setModalField('mandiAccountNumber', e.target.value)}
                      placeholder="Leave blank to auto-generate"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      checked={modal.form.locked === true}
                      onChange={(e) => setModalField('locked', e.target.checked)}
                    />
                    <Label>Locked</Label>
                  </div>
                </div>
              ) : null}

              {modal.section === 'users' ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <Label>Trader</Label>
                    <Select
                      value={modal.form.traderId || ''}
                      onValueChange={(value) => {
                        setModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                form: {
                                  ...prev.form,
                                  traderId: value,
                                  companyId: ''
                                }
                              }
                            : prev
                        )
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select trader" />
                      </SelectTrigger>
                      <SelectContent>
                        {traderOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {modalTrader ? (
                    <div className="md:col-span-2">
                      <LimitStatusBox
                        label={`Trader limit status for ${modalTrader.name}`}
                        companyCount={modalTrader._count?.companies || 0}
                        companyLimit={modalTrader.maxCompanies ?? 0}
                        userCount={modalTrader._count?.users || 0}
                        userLimit={modalTrader.maxUsers ?? 0}
                      />
                    </div>
                  ) : null}
                  <div>
                    <Label>Company</Label>
                    <Select value={modal.form.companyId || ''} onValueChange={(value) => setModalField('companyId', value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select company" />
                      </SelectTrigger>
                      <SelectContent>
                        {companyOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>User ID</Label>
                    <Input value={modal.form.userId || ''} onChange={(e) => setModalField('userId', e.target.value)} />
                    {modal.mode === 'create' ? (
                      <p className="mt-1 text-xs text-slate-500">
                        If this user ID already exists under the same trader, the system will attach the selected company access instead of creating a duplicate user.
                      </p>
                    ) : null}
                    {modalTrader && (modalTrader.maxUsers ?? 0) <= (modalTrader._count?.users || 0) ? (
                      <p className="mt-1 text-xs text-amber-600">
                        Trader user limit is already full. New unique users will be blocked, but existing same user IDs can still attach to another company of this trader.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <Label>Name</Label>
                    <Input value={modal.form.name || ''} onChange={(e) => setModalField('name', e.target.value)} />
                  </div>
                  <div>
                    <Label>Password {modal.mode === 'create' ? '' : '(leave blank to keep current)'}</Label>
                    <Input
                      type="password"
                      value={modal.form.password || ''}
                      onChange={(e) => setModalField('password', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Privilege Preset</Label>
                    <Select
                      value={modal.form.privilegePreset || 'keep'}
                      onValueChange={(value) => setModalField('privilegePreset', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select privilege preset" />
                      </SelectTrigger>
                      <SelectContent>
                        {modal.mode === 'edit' ? <SelectItem value="keep">Keep Existing</SelectItem> : null}
                        <SelectItem value="all">Full Access (Read + Write)</SelectItem>
                        <SelectItem value="read">Read Only</SelectItem>
                        <SelectItem value="none">No Access</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      checked={modal.form.locked === true}
                      onChange={(e) => setModalField('locked', e.target.checked)}
                    />
                    <Label>Locked</Label>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end gap-2 border-t pt-4">
                {modal.mode === 'edit' ? (
                  <Button type="button" variant="destructive" onClick={deleteModalRecord} disabled={saving}>
                    Delete
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={resetModal} disabled={saving}>
                  Cancel
                </Button>
                <Button type="button" onClick={saveModal} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </SuperAdminShell>
  )
}

function KpiTile({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-xl font-semibold ${danger ? 'text-red-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  )
}

function LimitStatusBox({
  label,
  companyCount,
  companyLimit,
  userCount,
  userLimit
}: {
  label: string
  companyCount: number
  companyLimit: number
  userCount: number
  userLimit: number
}) {
  const companyRemaining = companyLimit - companyCount
  const userRemaining = userLimit - userCount
  const companyOver = companyRemaining <= 0
  const userOver = userRemaining <= 0

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-900">{label}</p>
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className={`rounded-md border px-3 py-2 text-sm ${companyOver ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-700'}`}>
          Companies: {companyCount}/{companyLimit} used
          <div className="text-xs">{companyOver ? 'No company slots left' : `${companyRemaining} slots left`}</div>
        </div>
        <div className={`rounded-md border px-3 py-2 text-sm ${userOver ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-700'}`}>
          Users: {userCount}/{userLimit} used
          <div className="text-xs">{userOver ? 'No user slots left' : `${userRemaining} slots left`}</div>
        </div>
      </div>
    </div>
  )
}
