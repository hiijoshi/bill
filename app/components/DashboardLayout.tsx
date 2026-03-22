'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, User } from 'lucide-react'
import Sidebar from './Sidebar'
import HeaderAccountPanel from '@/components/account/HeaderAccountPanel'
import { isAbortError } from '@/lib/http'

interface DashboardLayoutProps {
  children: React.ReactNode
  companyId: string
  headerActions?: React.ReactNode
}

export default function DashboardLayout({ children, companyId, headerActions }: DashboardLayoutProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [currentUser, setCurrentUser] = useState<string | null>(null)
  const [currentUserName, setCurrentUserName] = useState<string | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [resolvedCompanyId, setResolvedCompanyId] = useState(companyId)
  const [currentCompanyName, setCurrentCompanyName] = useState<string | null>(null)
  const liveSyncMs = Math.max(30000, Number(process.env.NEXT_PUBLIC_LIVE_SYNC_MS || 60000))
  const router = useRouter()

  useEffect(() => {
    // Check authentication status via API call
    let cancelled = false
    let timerId: ReturnType<typeof setInterval> | null = null

    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' })
        if (cancelled) return
        if (response.ok) {
          const data = await response.json()
          if (cancelled) return
          const normalizedRole = String(data?.user?.role || data?.role || '')
            .toLowerCase()
            .replace(/\s+/g, '_')
          if (normalizedRole === 'super_admin' && window.location.pathname.startsWith('/main')) {
            router.replace('/super-admin/crud')
            return
          }
          setCurrentUser(data?.user?.userId || data?.userId || null)
          setCurrentUserName(data?.user?.name || null)
          setCurrentUserRole(data?.user?.role || null)
        } else {
          if (response.status === 401) {
            router.push('/login')
          }
        }
      } catch (error) {
        if (cancelled || isAbortError(error)) return
        void error
      }
    }
    
    void checkAuth()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkAuth()
      }
    }
    const onFocus = () => {
      void checkAuth()
    }
    timerId = setInterval(() => {
      void checkAuth()
    }, liveSyncMs)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      if (timerId) clearInterval(timerId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [router, liveSyncMs])

  useEffect(() => {
    let cancelled = false
    let timerId: ReturnType<typeof setInterval> | null = null
    const loadCompanyContext = async () => {
      if (cancelled) return

      let targetCompanyId = companyId?.trim() || ''
      let targetCompanyName = ''
      let companiesPayload: unknown = null

      try {
        const [activeCompanyResponse, companiesResponse] = await Promise.all([
          fetch('/api/auth/company', { cache: 'no-store' }),
          fetch('/api/companies', { cache: 'no-store' })
        ])

        if (cancelled) return

        if (activeCompanyResponse.ok) {
          const activeData = await activeCompanyResponse.json().catch(() => null)
          const activeCompany = activeData?.company
          if (activeCompany?.id) {
            if (!targetCompanyId) targetCompanyId = String(activeCompany.id)
            if (String(activeCompany.id) === targetCompanyId) {
              targetCompanyName = String(activeCompany.name || '')
            }
          }
        }

        if (companiesResponse.ok) {
          companiesPayload = await companiesResponse.json().catch(() => [])
        }
      } catch (error) {
        if (cancelled || isAbortError(error)) return
      }

      if (!targetCompanyId) {
        setResolvedCompanyId('')
        setCurrentCompanyName('Not selected')
        return
      }

      if (cancelled) return
      if (!Array.isArray(companiesPayload)) {
        setResolvedCompanyId(targetCompanyId)
        setCurrentCompanyName(targetCompanyName || 'Selected company')
        return
      }
      const currentCompany = companiesPayload.find((row) => String(row?.id) === targetCompanyId)
      setResolvedCompanyId(targetCompanyId)
      setCurrentCompanyName(targetCompanyName || currentCompany?.name || 'Selected company')
    }

    void loadCompanyContext()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadCompanyContext()
      }
    }
    const onFocus = () => {
      void loadCompanyContext()
    }
    timerId = setInterval(() => {
      void loadCompanyContext()
    }, liveSyncMs)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      if (timerId) clearInterval(timerId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [companyId, liveSyncMs])

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
