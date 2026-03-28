'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Menu, User } from 'lucide-react'
import Sidebar from './Sidebar'
import HeaderAccountPanel from '@/components/account/HeaderAccountPanel'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isAbortError } from '@/lib/http'
import { clearClientCache, getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { APP_COMPANY_CHANGED_EVENT, notifyAppCompanyChanged } from '@/lib/company-context'

interface DashboardLayoutProps {
  children: React.ReactNode
  companyId: string
  headerActions?: React.ReactNode
  lockViewport?: boolean
}

type AuthMePayload = {
  user?: {
    userId?: string | null
    name?: string | null
    role?: string | null
    companyId?: string | null
  } | null
  company?: {
    id?: string | null
    name?: string | null
  } | null
}

type CompanySummary = {
  id: string
  name: string
  locked?: boolean
}

const AUTH_CACHE_KEY = 'shell:auth-me'
const COMPANIES_CACHE_KEY = 'shell:companies'
const AUTH_CACHE_AGE_MS = 30_000
const COMPANIES_CACHE_AGE_MS = 60_000
const APP_SHELL_AUTH_LOADED_EVENT = 'app-shell-auth-loaded'

export default function DashboardLayout({ children, companyId, headerActions, lockViewport = false }: DashboardLayoutProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [currentUserName, setCurrentUserName] = useState<string | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [availableCompanies, setAvailableCompanies] = useState<CompanySummary[]>([])
  const [resolvedCompanyId, setResolvedCompanyId] = useState(companyId)
  const [currentCompanyName, setCurrentCompanyName] = useState<string | null>(null)
  const [isSwitchingCompany, setIsSwitchingCompany] = useState(false)
  const [companySwitchError, setCompanySwitchError] = useState<string | null>(null)
  const router = useRouter()

  const loadShellContext = useCallback(async (force = false) => {
    try {
      let authPayload = force ? null : getClientCache<AuthMePayload>(AUTH_CACHE_KEY, AUTH_CACHE_AGE_MS)
      let companiesPayload = force ? null : getClientCache<CompanySummary[]>(COMPANIES_CACHE_KEY, COMPANIES_CACHE_AGE_MS)

      const requests: Promise<void>[] = []

      if (!authPayload) {
        requests.push(
          fetch('/api/auth/me', { cache: 'no-store' }).then(async (response) => {
            if (response.status === 401) {
              router.push('/login')
              return
            }
            if (!response.ok) {
              return
            }
            const data = (await response.json().catch(() => null)) as AuthMePayload | null
            if (!data) return
            authPayload = data
            setClientCache(AUTH_CACHE_KEY, data)
          })
        )
      }

      if (!companiesPayload) {
        requests.push(
          fetch('/api/companies').then(async (response) => {
            if (!response.ok) return
            const data = (await response.json().catch(() => [])) as CompanySummary[]
            if (!Array.isArray(data)) return
            companiesPayload = data
            setClientCache(COMPANIES_CACHE_KEY, data)
          })
        )
      }

      await Promise.all(requests)

      const normalizedCompanies = Array.isArray(companiesPayload)
        ? companiesPayload
            .map((row) => ({
              id: String(row.id || '').trim(),
              name: String(row.name || row.id || '').trim() || String(row.id || '').trim(),
              locked: Boolean(row.locked)
            }))
            .filter((row) => row.id.length > 0)
        : []
      setAvailableCompanies(normalizedCompanies)

      if (!authPayload) {
        return
      }

      const normalizedRole = String(authPayload.user?.role || '')
        .toLowerCase()
        .replace(/\s+/g, '_')
      if (normalizedRole === 'super_admin' && window.location.pathname.startsWith('/main')) {
        router.replace('/super-admin/crud')
        return
      }

      setCurrentUser(authPayload.user?.userId || null)
      setCurrentUserName(authPayload.user?.name || null)
      setCurrentUserRole(authPayload.user?.role || null)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(APP_SHELL_AUTH_LOADED_EVENT))
      }

      const fallbackCompanyId = String(authPayload.company?.id || authPayload.user?.companyId || '').trim()
      const targetCompanyId = companyId?.trim() || fallbackCompanyId
      if (!targetCompanyId) {
        setResolvedCompanyId('')
        setCurrentCompanyName('Not selected')
        return
      }

      const cachedCompanyName =
        String(authPayload.company?.id || '').trim() === targetCompanyId
          ? String(authPayload.company?.name || '').trim()
          : ''
      const companyName =
        cachedCompanyName ||
        normalizedCompanies.find((row) => row.id === targetCompanyId)?.name ||
        'Selected company'

      setResolvedCompanyId(targetCompanyId)
      setCurrentCompanyName(companyName)
    } catch (error) {
      if (isAbortError(error)) return
      void error
    }
  }, [companyId, router])

  useEffect(() => {
    let cancelled = false
    let lastRunAt = 0

    const run = (force = false) => {
      if (cancelled) return
      const now = Date.now()
      if (!force && now - lastRunAt < 1_000) {
        return
      }
      lastRunAt = now
      void loadShellContext(force)
    }

    run(false)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        run(false)
      }
    }
    const onFocus = () => run(false)
    const onSessionRefresh = () => run(true)
    const onCompanyChanged = () => run(true)

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    window.addEventListener('sessionRefreshed', onSessionRefresh)
    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('sessionRefreshed', onSessionRefresh)
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [loadShellContext])

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousBodyOverflow = body.style.overflow

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    return () => {
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
    }
  }, [])

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed)
  }

  const closeMobileSidebar = () => {
    setIsMobileSidebarOpen(false)
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (error) {
      // Even if API call fails, redirect to login
      void error
    }
    clearClientCache()
    setCurrentUser(null)
    setCurrentUserName(null)
    setCurrentUserRole(null)
    router.push('/login')
  }

  const handleCompanySwitch = async (nextCompanyId: string) => {
    if (!nextCompanyId || nextCompanyId === resolvedCompanyId || isSwitchingCompany) {
      return
    }

    setCompanySwitchError(null)
    setIsSwitchingCompany(true)

    try {
      const response = await fetch('/api/auth/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ companyId: nextCompanyId, force: true })
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to switch company')
      }

      clearClientCache()
      notifyAppCompanyChanged(nextCompanyId)

      const currentUrl = new URL(window.location.href)
      currentUrl.searchParams.delete('companyId')
      currentUrl.searchParams.delete('companyIds')
      window.location.assign(`${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`)
      return
    } catch (error) {
      setCompanySwitchError(error instanceof Error ? error.message : 'Failed to switch company')
    } finally {
      setIsSwitchingCompany(false)
    }
  }

  const showCompanySwitcher = availableCompanies.length > 1

  return (
    <div className={lockViewport ? 'flex h-dvh overflow-hidden bg-gray-50' : 'flex h-dvh overflow-hidden bg-gray-50'}>
      <Suspense fallback={<div className="w-20 border-r bg-white" />}>
        <Sidebar
          companyId={resolvedCompanyId}
          isCollapsed={isSidebarCollapsed}
          isMobileOpen={isMobileSidebarOpen}
          onToggleCollapse={toggleSidebar}
          onCloseMobile={closeMobileSidebar}
        />
      </Suspense>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Navigation Bar */}
        <div className="shrink-0 border-b bg-white px-4 py-3 shadow-sm md:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 md:gap-4">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMobileSidebarOpen(true)}
                className="inline-flex h-9 w-9 rounded-lg border border-slate-200 p-0 text-slate-600 md:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </Button>
              <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
              <span className="text-sm text-gray-500">User Mode</span>
              {currentUser ? (
                <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 md:inline-flex">
                  User ID: {currentUser}
                </span>
              ) : null}
              {currentCompanyName && currentCompanyName !== 'Not selected' ? (
                <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 md:inline-flex">
                  Company: {currentCompanyName}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 self-start md:self-auto">
              {showCompanySwitcher ? (
                <div className="min-w-[180px] max-w-[240px]">
                  <Select
                    value={resolvedCompanyId || undefined}
                    onValueChange={(value) => {
                      void handleCompanySwitch(value)
                    }}
                    disabled={isSwitchingCompany}
                  >
                    <SelectTrigger
                      className="h-10 w-full rounded-2xl border-slate-200 bg-white text-sm text-slate-700"
                      aria-label="Change active company"
                    >
                      <SelectValue placeholder="Change company" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCompanies.map((company) => (
                        <SelectItem key={company.id} value={company.id} disabled={company.locked}>
                          {company.name}{company.locked ? ' (Locked)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {headerActions}
              {currentUser && (
                <HeaderAccountPanel
                  name={currentUserName}
                  userId={currentUser}
                  role={currentUserRole}
                  contextLabel={currentCompanyName || 'Workspace not selected'}
                  menuItems={[
                    { label: 'Profile', icon: User, onClick: () => router.push('/main/profile') },
                    { label: 'Logout', icon: LogOut, onClick: handleLogout, tone: 'danger', separatorBefore: true }
                  ]}
                />
              )}
            </div>
          </div>
          {companySwitchError ? (
            <div className="mx-auto mt-3 max-w-7xl rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {companySwitchError}
            </div>
          ) : null}
        </div>
        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
