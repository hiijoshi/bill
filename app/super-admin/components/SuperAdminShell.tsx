'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import HeaderAccountPanel from '@/components/account/HeaderAccountPanel'
import { LayoutDashboard, Store, Building2, Users, ShieldCheck, Settings2, ArrowLeft, ScrollText, PanelLeftClose, PanelLeftOpen, LogOut, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clearClientCache, getClientCache, setClientCache } from '@/lib/client-fetch-cache'

type SuperAdminShellProps = {
  title: string
  subtitle?: string
  children: React.ReactNode
  initialProfile?: {
    user?: {
      userId?: string
      name?: string
      role?: string
    }
  } | null
}

const navItems = [
  { href: '/super-admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/super-admin/crud', label: 'Control Panel', icon: Settings2 },
  { href: '/super-admin/masters', label: 'Masters', icon: Settings2 },
  { href: '/super-admin/masters?resource=buyer-limits', label: 'Buyer Limits', icon: Users },
  { href: '/super-admin/traders', label: 'Traders', icon: Store },
  { href: '/super-admin/subscriptions', label: 'Subscriptions', icon: ScrollText },
  { href: '/super-admin/subscriptions?state=closure_requested', label: 'Closure Reviews', icon: ScrollText },
  { href: '/super-admin/subscriptions/plans', label: 'Plan Catalog', icon: Settings2 },
  { href: '/super-admin/companies', label: 'Companies', icon: Building2 },
  { href: '/super-admin/users', label: 'Users', icon: Users },
  { href: '/super-admin/audit-logs', label: 'Audit Logs', icon: ScrollText }
]

export default function SuperAdminShell({ title, subtitle, children, initialProfile = null }: SuperAdminShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true)
  const [currentUserId, setCurrentUserId] = useState(String(initialProfile?.user?.userId || ''))
  const [currentUserName, setCurrentUserName] = useState(String(initialProfile?.user?.name || ''))
  const [currentUserRole, setCurrentUserRole] = useState(String(initialProfile?.user?.role || ''))
  const profileCacheKey = 'super-admin:profile'
  const profileCacheAgeMs = 30_000
  const skipPreparedProfileFetchRef = useRef(Boolean(initialProfile?.user?.userId))

  const loadCurrentUser = useCallback(async (force = false) => {
    try {
      const cached = force
        ? null
        : getClientCache<{ user?: { userId?: string; name?: string; role?: string } }>(profileCacheKey, profileCacheAgeMs)

      if (cached?.user) {
        setCurrentUserId(String(cached.user.userId || ''))
        setCurrentUserName(String(cached.user.name || ''))
        setCurrentUserRole(String(cached.user.role || ''))
        return
      }

      const response = await fetch('/api/super-admin/profile', { cache: 'no-store' })
      if (!response.ok) return

      const payload = await response.json().catch(() => ({}))
      setClientCache(profileCacheKey, payload)
      setCurrentUserId(String(payload?.user?.userId || ''))
      setCurrentUserName(String(payload?.user?.name || ''))
      setCurrentUserRole(String(payload?.user?.role || ''))
    } catch {
      // ignore transient profile refresh failures
    }
  }, [])

  useEffect(() => {
    if (initialProfile?.user?.userId) {
      setClientCache(profileCacheKey, initialProfile)
    }
  }, [initialProfile, profileCacheKey])

  useEffect(() => {
    let cancelled = false

    const run = (force = false) => {
      if (cancelled) return
      if (!force && skipPreparedProfileFetchRef.current) {
        skipPreparedProfileFetchRef.current = false
        return
      }
      void loadCurrentUser(force)
    }

    run(false)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        run(false)
      }
    }
    const onFocus = () => run(false)
    const onSessionRefresh = () => run(true)

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    window.addEventListener('sessionRefreshed', onSessionRefresh)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('sessionRefreshed', onSessionRefresh)
    }
  }, [loadCurrentUser, pathname])

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/super-admin')
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/super-admin/logout', { method: 'POST' })
    } catch {
      // ignore and continue redirect
    }

    clearClientCache()
    router.push('/super-admin/login')
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto flex max-w-[1550px] gap-4 p-4 xl:p-5">
        <aside
          className={cn(
            'premium-panel sticky top-0 h-[calc(100dvh-2rem)] rounded-[2rem] px-3 py-4 transition-all',
            isSidebarCollapsed ? 'w-[84px]' : 'w-[220px]'
          )}
        >
          <div
            className={cn(
              'mb-4 flex items-center rounded-[1.35rem] bg-slate-950 px-3 py-3 text-white',
              isSidebarCollapsed ? 'justify-center' : 'justify-between'
            )}
          >
            <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5" />
              {!isSidebarCollapsed ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-300">Platform</p>
                  <p className="text-sm font-semibold">Super Admin</p>
                </div>
              ) : null}
            </div>
            {!isSidebarCollapsed ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-white hover:bg-slate-800 hover:text-white"
                onClick={() => setIsSidebarCollapsed(true)}
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          {isSidebarCollapsed ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="mb-4 w-full rounded-xl"
              onClick={() => setIsSidebarCollapsed(false)}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          ) : null}

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const itemPath = item.href.split('?')[0]
              const active = pathname === itemPath || pathname.startsWith(`${itemPath}/`)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors',
                    isSidebarCollapsed && 'justify-center px-2',
                    active
                      ? 'bg-slate-950 text-white shadow-[0_12px_26px_rgba(15,23,42,0.16)]'
                      : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
                  )}
                  title={item.label}
                >
                  <Icon className="h-4 w-4" />
                  {!isSidebarCollapsed ? item.label : null}
                </Link>
              )
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="premium-panel mb-5 rounded-[2rem] px-5 py-5 md:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Super Admin Control Plane
                </div>
                <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-950 md:text-3xl">{title}</h1>
                {subtitle ? <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Privileged session
                </div>
              {currentUserId ? (
                <HeaderAccountPanel
                  name={currentUserName}
                  userId={currentUserId}
                  role={currentUserRole || 'super_admin'}
                  contextLabel="Platform: Super Admin"
                  menuItems={[
                    { label: 'Profile', icon: User, onClick: () => router.push('/super-admin/profile') },
                    { label: 'Settings', icon: Settings2, onClick: () => router.push('/super-admin/profile') },
                    { label: 'Control Panel', icon: LayoutDashboard, onClick: () => router.push('/super-admin/crud') },
                    { label: 'Audit Logs', icon: ScrollText, onClick: () => router.push('/super-admin/audit-logs') },
                    { label: 'Logout', icon: LogOut, onClick: handleLogout, tone: 'danger', separatorBefore: true }
                  ]}
                />
              ) : null}
              <Button variant="outline" size="sm" onClick={handleBack} className="gap-2 rounded-xl">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              </div>
            </div>
          </header>

          {children}
        </main>
      </div>
    </div>
  )
}
