'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import HeaderAccountPanel from '@/components/account/HeaderAccountPanel'
import { LayoutDashboard, Store, Building2, Users, ShieldCheck, Settings2, ArrowLeft, ScrollText, PanelLeftClose, PanelLeftOpen, LogOut, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { clearSuperAdminTabUnlocked, isSuperAdminTabUnlocked } from '@/lib/super-admin-tab'

type SuperAdminShellProps = {
  title: string
  subtitle?: string
  children: React.ReactNode
}

const navItems = [
  { href: '/super-admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/super-admin/crud', label: 'Control Panel', icon: Settings2 },
  { href: '/super-admin/masters', label: 'Masters', icon: Settings2 },
  { href: '/super-admin/masters?resource=buyer-limits', label: 'Buyer Limits', icon: Users },
  { href: '/super-admin/traders', label: 'Traders', icon: Store },
  { href: '/super-admin/companies', label: 'Companies', icon: Building2 },
  { href: '/super-admin/users', label: 'Users', icon: Users },
  { href: '/super-admin/audit-logs', label: 'Audit Logs', icon: ScrollText }
]

export default function SuperAdminShell({ title, subtitle, children }: SuperAdminShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true)
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentUserName, setCurrentUserName] = useState('')
  const [currentUserRole, setCurrentUserRole] = useState('')
  const [tabUnlocked, setTabUnlocked] = useState(false)
  const liveSyncMs = Math.max(30000, Number(process.env.NEXT_PUBLIC_LIVE_SYNC_MS || 60000))

  useEffect(() => {
    if (!isSuperAdminTabUnlocked()) {
      router.replace('/super-admin/login?tab=unlock')
      return
    }
    const frameId = window.requestAnimationFrame(() => {
      setTabUnlocked(true)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [router])

  useEffect(() => {
    if (!tabUnlocked) return
    let cancelled = false
    let timerId: ReturnType<typeof setInterval> | null = null

    const loadCurrentUser = async () => {
      try {
        const response = await fetch('/api/super-admin/profile', { cache: 'no-store' })
        if (!response.ok || cancelled) return

        const payload = await response.json().catch(() => ({}))
        if (cancelled) return
        setCurrentUserId(String(payload?.user?.userId || ''))
        setCurrentUserName(String(payload?.user?.name || ''))
        setCurrentUserRole(String(payload?.user?.role || ''))
      } catch {
        if (cancelled) return
      }
    }

    void loadCurrentUser()
    timerId = setInterval(() => {
      void loadCurrentUser()
    }, liveSyncMs)

    return () => {
      cancelled = true
      if (timerId) clearInterval(timerId)
    }
  }, [liveSyncMs, tabUnlocked])

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/super-admin')
  }

  const handleLogout = async () => {
    clearSuperAdminTabUnlocked()
    try {
      await fetch('/api/super-admin/logout', { method: 'POST' })
    } catch {
      // ignore and continue redirect
    }

    router.push('/super-admin/login')
  }

  if (!tabUnlocked) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">Verifying super admin tab...</div>
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-[1500px]">
        <aside
          className={cn(
            'sticky top-0 h-screen border-r border-slate-200 bg-white px-3 py-4 transition-all',
            isSidebarCollapsed ? 'w-[84px]' : 'w-[220px]'
          )}
        >
          <div
            className={cn(
              'mb-4 flex items-center rounded-xl bg-slate-900 px-3 py-3 text-white',
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
              className="mb-4 w-full"
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
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                    isSidebarCollapsed && 'justify-center px-2',
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
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

        <main className="flex-1 p-6">
          <header className="mb-5 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
              {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
            </div>
            <div className="flex items-center gap-2">
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
              <Button variant="outline" size="sm" onClick={handleBack} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </div>
          </header>

          {children}
        </main>
      </div>
    </div>
  )
}
