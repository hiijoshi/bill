'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, ChevronLeft, ChevronRight, LayoutDashboard, ShoppingCart, TrendingUp, Menu, Package, CreditCard, FileText, Settings, Lock, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getClientCache } from '@/lib/client-fetch-cache'
import { APP_COMPANY_CHANGED_EVENT, notifyAppCompanyChanged } from '@/lib/company-context'
import { loadClientPermissions } from '@/lib/client-permissions'
import { getReadablePermissionModules } from '@/lib/app-default-route'
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
      { title: 'Financial Year', href: '/master/financial-year', permissionModule: 'MASTER_ACCOUNTING_HEAD' },
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
      { title: 'Record Self Transfer', href: '/payment/cash-bank/entry?entry=self-transfer', permissionModule: 'PAYMENTS' },
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
  {
    title: 'Subscription',
    href: '/main/subscription',
    icon: Lock,
    children: [],
  },
]

type AuthCachePayload = {
  user?: {
    userId?: string | null
  } | null
}

const APP_SHELL_AUTH_LOADED_EVENT = 'app-shell-auth-loaded'
const AUTH_CACHE_KEY = 'shell:auth-me'
const AUTH_CACHE_AGE_MS = 5 * 60_000

interface SidebarProps {
  companyId: string
  companyName?: string | null
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

  const withCompany = useCallback((href?: string) => {
    void companyId
    return href || '/main/dashboard'
  }, [companyId])

  const syncActiveCompany = () => {
    if (!companyId) return
    const activeCompanyId = getClientCache<string>('shell:active-company-id', 20_000)
    if (activeCompanyId === companyId) {
      return
    }
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
        const payload = await loadClientPermissions(companyId, { force })
        if (cancelled) return
        const permissions = Array.isArray(payload.permissions) ? payload.permissions : []
        setAllowedModules(new Set(getReadablePermissionModules(permissions)))
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
  }, [companyId, pathname])

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
  const activeParentTitles = menuItems
    .filter((item) => item.children?.length && isParentActive(item))
    .map((item) => item.title)

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm transition-opacity duration-200 md:hidden',
          isMobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        aria-hidden={!isMobileOpen}
        onClick={onCloseMobile}
      />
      <aside
        className={cn(
          'z-50 flex h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out md:relative md:z-auto md:h-auto',
          isCollapsed ? 'md:w-20' : 'md:w-[18.5rem]',
          'fixed inset-y-0 left-0 w-[18.5rem] max-w-[88vw] shadow-2xl md:translate-x-0 md:shadow-none',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="flex flex-shrink-0 items-center justify-end border-b border-white/10 p-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onCloseMobile}
              className="h-9 w-9 rounded-xl border-white/15 bg-white/5 p-1 text-slate-300 hover:bg-white/10 hover:text-white md:hidden"
              aria-label="Close navigation"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleCollapse}
              className="hidden h-9 w-9 rounded-xl border-white/15 bg-white/5 p-1 text-slate-300 hover:bg-white/10 hover:text-white md:inline-flex"
              aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {isCollapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
        {menuItems.map((item) => {
          const hasChildren = item.children && item.children.length > 0
          const isOpen = openItems.includes(item.title) || activeParentTitles.includes(item.title)
          const active = isParentActive(item)

          if (!hasChildren) {
            if (!hasItemAccess(item)) {
              return (
                <Button
                  key={item.title}
                  variant="ghost"
                  disabled
                  className={cn(
                    'mb-2 h-12 w-full justify-between rounded-2xl border border-white/6 px-4 text-[15px] font-medium opacity-60 cursor-not-allowed',
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
                    'mb-2 h-12 w-full justify-start rounded-2xl px-4 text-[15px] font-medium transition-colors',
                    active
                      ? 'bg-white text-slate-950 shadow-[0_12px_26px_rgba(15,23,42,0.18)] hover:bg-white hover:text-slate-950'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white',
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
                    'mb-2 h-12 w-full justify-between rounded-2xl px-4 text-[15px] font-medium transition-colors',
                    active
                      ? 'bg-white text-slate-950 shadow-[0_12px_26px_rgba(15,23,42,0.18)] hover:bg-white hover:text-slate-950'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white',
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
                            'mb-1.5 h-10 w-full justify-start rounded-xl px-4 text-sm transition-colors',
                            isActive(child.href)
                              ? 'bg-white/12 font-medium text-white'
                              : 'text-slate-400 hover:bg-white/8 hover:text-white'
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
                        className="mb-1 w-full justify-between rounded-xl opacity-60 cursor-not-allowed"
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
