'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, User } from 'lucide-react'
import Sidebar from './Sidebar'
import HeaderAccountPanel from '@/components/account/HeaderAccountPanel'
import { isAbortError } from '@/lib/http'
import { clearClientCache, getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { APP_COMPANY_CHANGED_EVENT } from '@/lib/app-shell-events'

interface DashboardLayoutProps {
  children: React.ReactNode
  companyId: string
  headerActions?: React.ReactNode
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

export default function DashboardLayout({ children, companyId, headerActions }: DashboardLayoutProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [currentUserName, setCurrentUserName] = useState<string | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [resolvedCompanyId, setResolvedCompanyId] = useState(companyId)
  const [currentCompanyName, setCurrentCompanyName] = useState<string | null>(null)
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
        companiesPayload?.find((row) => row.id === targetCompanyId)?.name ||
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

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed)
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

  return (
    <div className="flex h-screen bg-gray-50">
      <Suspense fallback={<div className="w-20 border-r bg-white" />}>
        <Sidebar
          companyId={resolvedCompanyId}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />
      </Suspense>
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Top Navigation Bar */}
        <div className="bg-white shadow-sm border-b px-6 py-3">
          <div className="max-w-7xl mx-auto flex justify-between items-center gap-4">
            <div className="flex flex-wrap items-center gap-3">
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
            <div className="flex items-center gap-2">
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
        </div>
        {children}
      </div>
    </div>
  )
}
