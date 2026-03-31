'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, ChevronLeft, ChevronRight, LayoutDashboard, ShoppingCart, TrendingUp, Menu, Package, CreditCard, FileText, Settings, Lock, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getClientCache, setClientCache } from '@/lib/client-fetch-cache'
import { APP_COMPANY_CHANGED_EVENT, notifyAppCompanyChanged } from '@/lib/company-context'
import type { PermissionModule as MenuPermissionModule } from '@/lib/permissions'

type MenuChild = {
  title: string
  href: string
  permissionModule?: MenuPermissionModule
}

type MenuItem = {
  title: string
  href?: string
  icon: LucideIcon
  permissionModule?: MenuPermissionModule
  children: MenuChild[]
}

const menuItems: MenuItem[] = [
  {
    title: 'Dashboard',
    href: '/main/dashboard',
    icon: LayoutDashboard,
    permissionModule: 'DASHBOARD',
    children: [],
  },
  {
    title: 'Master',
    icon: Settings,
    children: [
      { title: 'Product', href: '/master/product', permissionModule: 'MASTER_PRODUCTS' },
      { title: 'Supplier', href: '/master/supplier', permissionModule: 'MASTER_PARTIES' },
      { title: 'Sales Item', href: '/master/sales-item', permissionModule: 'MASTER_SALES_ITEM' },
      { title: 'Marka', href: '/master/marka', permissionModule: 'MASTER_MARKA' },
      { title: 'Party', href: '/master/party', permissionModule: 'MASTER_PARTIES' },
      { title: 'Transport', href: '/master/transport', permissionModule: 'MASTER_TRANSPORT' },
      { title: 'Unit', href: '/master/unit', permissionModule: 'MASTER_UNITS' },
      { title: 'Payment Mode', href: '/master/payment-mode', permissionModule: 'MASTER_PAYMENT_MODE' },
      { title: 'Mandi Type', href: '/master/mandi-type', permissionModule: 'MASTER_ACCOUNTING_HEAD' },
      { title: 'Accounting Head', href: '/master/accounting-head', permissionModule: 'MASTER_ACCOUNTING_HEAD' },
      { title: 'Bank', href: '/master/bank', permissionModule: 'MASTER_BANK' },
    ],
  },
  {
    title: 'Purchase',
    icon: ShoppingCart,
    children: [
      { title: 'Purchase Entry', href: '/purchase/entry', permissionModule: 'PURCHASE_ENTRY' },
      { title: 'Special Purchase', href: '/purchase/special-entry', permissionModule: 'PURCHASE_ENTRY' },
      { title: 'Purchase List', href: '/purchase/list', permissionModule: 'PURCHASE_LIST' },
    ],
  },
  {
    title: 'Sales',
    icon: TrendingUp,
    children: [
      { title: 'Sales Entry', href: '/sales/entry', permissionModule: 'SALES_ENTRY' },
      { title: 'Sales List', href: '/sales/list', permissionModule: 'SALES_LIST' },
    ],
  },
  {
    title: 'Stock Management',
    icon: Package,
    children: [
      { title: 'Stock Adjustment', href: '/stock/adjustment', permissionModule: 'STOCK_ADJUSTMENT' },
    ],
  },
  {
    title: 'Payment',
    icon: CreditCard,
    children: [
      { title: 'Record Purchase Payment', href: '/payment/purchase/entry', permissionModule: 'PAYMENTS' },
      { title: 'Record Sales Receipt', href: '/payment/sales/entry', permissionModule: 'PAYMENTS' },
      { title: 'Record Cash / Bank Payment', href: '/payment/cash-bank/entry', permissionModule: 'PAYMENTS' },
      { title: 'Journal Voucher Entry', href: '/payment/journal-voucher/entry', permissionModule: 'PAYMENTS' },
      { title: 'Record Self Transfer', href: '/payment/self-transfer/entry', permissionModule: 'PAYMENTS' },
      { title: 'Upload Bank Statement', href: '/payment/bank-statement/upload', permissionModule: 'PAYMENTS' },
      { title: 'Payment History', href: '/payment/dashboard', permissionModule: 'PAYMENTS' },
    ],
  },
  {
    title: 'Reports',
    icon: FileText,
    children: [
      { title: 'Report Dashboard', href: '/reports/main', permissionModule: 'REPORTS' },
      { title: 'Purchase Report', href: '/reports/main?reportType=purchase', permissionModule: 'REPORTS' },
      { title: 'Sales Report', href: '/reports/main?reportType=sales', permissionModule: 'REPORTS' },
      { title: 'Stock Report', href: '/reports/main?reportType=stock', permissionModule: 'REPORTS' },
      { title: 'Outstanding Report', href: '/reports/main?reportType=operations&view=outstanding', permissionModule: 'REPORTS' },
      { title: 'Party Ledger', href: '/reports/main?reportType=operations&view=ledger', permissionModule: 'REPORTS' },
      { title: 'Daily Transaction', href: '/reports/main?reportType=operations&view=daily-transaction', permissionModule: 'REPORTS' },
      { title: 'Daily Consolidated', href: '/reports/main?reportType=operations&view=daily-consolidated', permissionModule: 'REPORTS' },
      { title: 'Cash Ledger', href: '/reports/main?reportType=operations&view=cash-ledger', permissionModule: 'REPORTS' },
      { title: 'Bank Ledger', href: '/reports/main?reportType=operations&view=bank-ledger', permissionModule: 'REPORTS' },
    ],
  },
]

type AuthCachePayload = {
  user?: {
    userId?: string | null
  } | null
}

const APP_SHELL_AUTH_LOADED_EVENT = 'app-shell-auth-loaded'
const AUTH_CACHE_KEY = 'shell:auth-me'
const AUTH_CACHE_AGE_MS = 30_000

interface SidebarProps {
  companyId: string
  isCollapsed?: boolean
  isMobileOpen?: boolean
  onToggleCollapse?: () => void
  onCloseMobile?: () => void
}

export default function Sidebar({
  companyId,
  isCollapsed = false,
  isMobileOpen = false,
  onToggleCollapse,
  onCloseMobile
}: SidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [openItems, setOpenItems] = useState<string[]>([])
  const [allowedModules, setAllowedModules] = useState<Set<MenuPermissionModule> | null>(null)
  const permissionsCacheKey = `permissions:${companyId || 'none'}`

  const withCompany = useCallback((href?: string) => {
    void companyId
    return href || '/main/dashboard'
  }, [companyId])

  const syncActiveCompany = () => {
    if (!companyId) return
    void (async () => {
      const response = await fetch('/api/auth/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ companyId, force: true })
      }).catch(() => null)

      if (!response?.ok) return
      notifyAppCompanyChanged(companyId)
    })()
  }

  useEffect(() => {
    let cancelled = false
    const isAuthPage = pathname === '/login' || pathname === '/super-admin/login'

    const fetchPermissions = async (force = false) => {
      if (cancelled || isAuthPage || !companyId) {
        return
      }

      const authCache = getClientCache<AuthCachePayload>(AUTH_CACHE_KEY, AUTH_CACHE_AGE_MS)
      if (!authCache?.user?.userId) {
        setAllowedModules(null)
        return
      }

      try {
        const cached = force ? null : getClientCache<string[]>(permissionsCacheKey, 60_000)
        if (cached) {
          setAllowedModules(new Set(cached as MenuPermissionModule[]))
          return
        }

        const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}&includeMeta=true` : '?includeMeta=true'
        const response = await fetch(`/api/auth/permissions${qs}`, { cache: 'no-store' })
        if (cancelled) return
        if (!response.ok) {
          setAllowedModules(null)
          return
        }

        const payload = await response.json().catch(() => ({}))
        if (cancelled) return
        const permissions = Array.isArray(payload.permissions) ? payload.permissions : []
        const readableModules = permissions
          .filter((row: { module?: string; canRead?: boolean; canWrite?: boolean }) => row.canRead || row.canWrite)
          .map((row: { module?: string }) => row.module)
          .filter((module: unknown): module is MenuPermissionModule => typeof module === 'string')
        setClientCache(permissionsCacheKey, readableModules)
        setAllowedModules(new Set(readableModules))
      } catch {
        if (cancelled) return
        setAllowedModules(null)
      }
    }

    if (!isAuthPage && companyId) {
      void fetchPermissions(false)
    }

    const onShellAuthLoaded = () => {
      void fetchPermissions(false)
    }
    const onSessionRefresh = () => {
      void fetchPermissions(true)
    }
    const onCompanyChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail
      if (!detail?.companyId || detail.companyId === companyId) {
        void fetchPermissions(true)
      }
    }

    window.addEventListener(APP_SHELL_AUTH_LOADED_EVENT, onShellAuthLoaded)
    window.addEventListener('sessionRefreshed', onSessionRefresh)
    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)

    return () => {
      cancelled = true
      window.removeEventListener(APP_SHELL_AUTH_LOADED_EVENT, onShellAuthLoaded)
      window.removeEventListener('sessionRefreshed', onSessionRefresh)
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [companyId, pathname, permissionsCacheKey])

  const hasChildAccess = useCallback((child: MenuChild) => {
    if (!child.permissionModule) return true
    if (!allowedModules) return true
    return allowedModules.has(child.permissionModule)
  }, [allowedModules])

  const hasItemAccess = useCallback((item: MenuItem) => {
    if (!item.permissionModule) return true
    if (!allowedModules) return true
    return allowedModules.has(item.permissionModule)
  }, [allowedModules])

  const toggleItem = (title: string) => {
    setOpenItems(prev =>
      prev.includes(title)
        ? prev.filter(item => item !== title)
        : [...prev, title]
    )
  }

  const handleNavigate = () => {
    syncActiveCompany()
    onCloseMobile?.()
  }

  const isActive = (href: string) => {
    const [pathPart, queryPart = ''] = href.split('?')
    if (pathname !== pathPart) return false

    if (!queryPart) {
      if (pathPart === '/reports/main') {
        return !searchParams.get('reportType')
      }
      return true
    }

    const targetParams = new URLSearchParams(queryPart)
    const keysToCheck = Array.from(targetParams.keys()).filter((key) => key !== 'companyId' && key !== 'companyIds')
    if (keysToCheck.length === 0) return true

    return keysToCheck.every((key) => searchParams.get(key) === targetParams.get(key))
  }

  const isParentActive = (item: MenuItem) => {
    if (item.href && isActive(item.href)) return true
    return item.children?.some((child) => isActive(child.href))
  }

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-slate-950/40 transition-opacity duration-200 md:hidden',
          isMobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        aria-hidden={!isMobileOpen}
        onClick={onCloseMobile}
      />
      <aside
        className={cn(
          'z-50 flex h-dvh flex-col border-r border-slate-200 bg-white transition-all duration-300 ease-in-out md:relative md:z-auto md:h-auto',
          isCollapsed ? 'md:w-16' : 'md:w-64',
          'fixed inset-y-0 left-0 w-[18rem] max-w-[85vw] shadow-xl md:translate-x-0 md:shadow-none',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="flex flex-shrink-0 items-center justify-between p-4">
          <h2 className={cn('text-lg font-semibold text-slate-900', isCollapsed && 'md:hidden')}>Navigation</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCloseMobile}
              className="h-8 w-8 rounded-lg border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 hover:text-slate-900 md:hidden"
              aria-label="Close navigation"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="hidden h-8 w-8 rounded-lg border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 hover:text-slate-900 md:inline-flex"
              aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {isCollapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {menuItems.map((item) => {
          const hasChildren = item.children && item.children.length > 0
          const isOpen = openItems.includes(item.title)
          const active = isParentActive(item)

          if (!hasChildren) {
            if (!hasItemAccess(item)) {
              return (
                <Button
                  key={item.title}
                  variant="ghost"
                  disabled
                  className={cn(
                    'mb-2 h-12 w-full justify-between rounded-xl px-4 text-[15px] font-medium opacity-60 cursor-not-allowed',
                    isCollapsed && 'h-11 justify-center px-0'
                  )}
                >
                  <div className="flex items-center">
                    {item.icon && <item.icon className={cn("h-4 w-4", isCollapsed ? "md:mr-0" : "mr-3")} />}
                    <span className={cn(isCollapsed && 'md:hidden')}>{item.title}</span>
                  </div>
                  {!isCollapsed ? (
                    <span className="inline-flex items-center gap-1 text-[10px]">
                      <Lock className="h-3 w-3" />
                      No Access
                    </span>
                  ) : null}
                </Button>
              )
            }

            return (
              <Link key={item.title} href={withCompany(item.href)} onClick={handleNavigate}>
                <Button
                  variant="ghost"
                  className={cn(
                    'mb-2 h-12 w-full justify-start rounded-xl px-4 text-[15px] font-medium transition-colors',
                    active
                      ? 'bg-slate-900 text-white shadow-sm hover:bg-slate-900 hover:text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    isCollapsed && 'h-11 justify-center px-0'
                  )}
                >
                  {item.icon && <item.icon className={cn("h-4 w-4", isCollapsed ? "md:mr-0" : "mr-3")} />}
                  <span className={cn(isCollapsed && 'md:hidden')}>{item.title}</span>
                </Button>
              </Link>
            )
          }

          return (
            <Collapsible key={item.title} open={isOpen} onOpenChange={() => toggleItem(item.title)}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    'mb-2 h-12 w-full justify-between rounded-xl px-4 text-[15px] font-medium transition-colors',
                    active
                      ? 'bg-slate-900 text-white shadow-sm hover:bg-slate-900 hover:text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    isCollapsed && 'h-11 justify-center px-0'
                  )}
                >
                  <div className="flex items-center">
                    {item.icon && <item.icon className={cn("h-4 w-4", isCollapsed ? "" : "mr-3")} />}
                    {!isCollapsed && item.title}
                  </div>
                  {!isCollapsed && (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
                </Button>
              </CollapsibleTrigger>
              {!isCollapsed && (
                <CollapsibleContent className="pl-4 md:block">
                  {item.children.map((child) => (
                    hasChildAccess(child) ? (
                      <Link key={child.title} href={withCompany(child.href)} onClick={handleNavigate}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            'mb-1.5 h-10 w-full justify-start rounded-lg px-4 text-sm transition-colors',
                            isActive(child.href)
                              ? 'bg-slate-100 font-medium text-slate-900'
                              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                          )}
                        >
                          {child.title}
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        key={child.title}
                        variant="ghost"
                        size="sm"
                        disabled
                        className="w-full justify-between mb-1 opacity-60 cursor-not-allowed"
                      >
                        <span>{child.title}</span>
                        <span className="inline-flex items-center gap-1 text-[10px]">
                          <Lock className="h-3 w-3" />
                          No Access
                        </span>
                      </Button>
                    )
                  ))}
                </CollapsibleContent>
              )}
            </Collapsible>
          )
        })}
        </nav>
      </aside>
    </>
  )
}
