'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, Store, Building2, Users, ShieldCheck, Settings2, ArrowLeft, ScrollText, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'

type SuperAdminShellProps = {
  title: string
  subtitle?: string
  children: React.ReactNode
}

const navItems = [
  { href: '/super-admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/super-admin/crud', label: 'Control Panel', icon: Settings2 },
  { href: '/super-admin/traders', label: 'Traders', icon: Store },
  { href: '/super-admin/companies', label: 'Companies', icon: Building2 },
  { href: '/super-admin/users', label: 'Users', icon: Users },
  { href: '/super-admin/audit-logs', label: 'Audit Logs', icon: ScrollText }
]

export default function SuperAdminShell({ title, subtitle, children }: SuperAdminShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true)

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/super-admin')
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
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
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
            <Button variant="outline" size="sm" onClick={handleBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </header>

          {children}
        </main>
      </div>
    </div>
  )
}
