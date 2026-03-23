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

type MenuPermissionModule =
  | 'MASTER_PRODUCTS'
  | 'MASTER_SALES_ITEM'
  | 'MASTER_MARKA'
  | 'MASTER_PARTIES'
  | 'MASTER_TRANSPORT'
  | 'MASTER_UNITS'
  | 'MASTER_PAYMENT_MODE'
  | 'MASTER_BANK'
  | 'PURCHASE_ENTRY'
  | 'PURCHASE_LIST'
  | 'SALES_ENTRY'
  | 'SALES_LIST'
  | 'STOCK_ADJUSTMENT'
  | 'STOCK_DASHBOARD'
  | 'PAYMENTS'
  | 'REPORTS'

type MenuChild = {
  title: string
  href: string
  permissionModule?: MenuPermissionModule
}

type MenuItem = {
  title: string
  href?: string
  icon: LucideIcon
  children: MenuChild[]
}

const menuItems: MenuItem[] = [
  {
    title: 'Dashboard',
    href: '/main/dashboard',
    icon: LayoutDashboard,
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
      { title: 'Stock Dashboard', href: '/stock/dashboard', permissionModule: 'STOCK_DASHBOARD' },
    ],
  },
  {
    title: 'Payment',
    icon: CreditCard,
    children: [
      { title: 'Record Purchase Payment', href: '/payment/purchase/entry', permissionModule: 'PAYMENTS' },
      { title: 'Record Sales Receipt', href: '/payment/sales/entry', permissionModule: 'PAYMENTS' },
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
    ],
  },
]

interface SidebarProps {
  companyId: string
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

export default function Sidebar({ companyId, isCollapsed = false, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [openItems, setOpenItems] = useState<string[]>([])
  const [allowedModules, setAllowedModules] = useState<Set<MenuPermissionModule> | null>(null)
  const permissionsCacheKey = `permissions:${companyId || 'none'}`

  const withCompany = useCallback((href?: string) => {
    const base = href || '/main/dashboard'
    if (!companyId || base.includes('companyId=') || base.includes('companyIds=')) return base

    const [pathWithQuery, hashPart = ''] = base.split('#')
    const [pathnamePart, queryPart = ''] = pathWithQuery.split('?')
    const params = new URLSearchParams(queryPart)
    params.set('companyId', companyId)
    const query = params.toString()
    return `${pathnamePart}${query ? `?${query}` : ''}${hashPart ? `#${hashPart}` : ''}`
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

    const fetchPermissions = async (force = false) => {
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

    void fetchPermissions(false)

    const onSessionRefresh = () => {
      void fetchPermissions(true)
    }
    const onCompanyChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail
      if (!detail?.companyId || detail.companyId === companyId) {
        void fetchPermissions(true)
      }
    }

    window.addEventListener('sessionRefreshed', onSessionRefresh)
    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)

    return () => {
      cancelled = true
      window.removeEventListener('sessionRefreshed', onSessionRefresh)
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [companyId, permissionsCacheKey])

  const hasChildAccess = useCallback((child: MenuChild) => {
    if (!child.permissionModule) return true
    if (!allowedModules) return true
    return allowedModules.has(child.permissionModule)
  }, [allowedModules])

  const toggleItem = (title: string) => {
    setOpenItems(prev =>
      prev.includes(title)
        ? prev.filter(item => item !== title)
        : [...prev, title]
    )
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
    <div className={cn(
      "bg-white border-r border-slate-200 h-full transition-all duration-300 ease-in-out flex flex-col",
      isCollapsed ? "w-16" : "w-64"
    )}>
      <div className="p-4 flex items-center justify-between flex-shrink-0">
        {!isCollapsed && <h2 className="text-lg font-semibold text-slate-900">Navigation</h2>}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          className="h-8 w-8 rounded-lg border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        >
          {isCollapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="px-3 pb-4 flex-1 overflow-y-auto">
        {menuItems.map((item) => {
          const hasChildren = item.children && item.children.length > 0
          const isOpen = openItems.includes(item.title)
          const active = isParentActive(item)

          if (!hasChildren) {
            return (
              <Link key={item.title} href={withCompany(item.href)} onClick={syncActiveCompany}>
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
                  {item.icon && <item.icon className={cn("h-4 w-4", isCollapsed ? "" : "mr-3")} />}
                  {!isCollapsed && item.title}
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
                <CollapsibleContent className="pl-4">
                  {item.children.map((child) => (
                    hasChildAccess(child) ? (
                      <Link key={child.title} href={withCompany(child.href)} onClick={syncActiveCompany}>
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
    </div>
  )
}
