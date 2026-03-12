'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, ChevronRight, LayoutDashboard, ShoppingCart, TrendingUp, Menu, X, Package, CreditCard, FileText, Settings, Lock, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

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
  const router = useRouter()
  const [openItems, setOpenItems] = useState<string[]>([])
  const [allowedModules, setAllowedModules] = useState<Set<MenuPermissionModule> | null>(null)
  const permissionsRefreshMs = Math.max(30000, Number(process.env.NEXT_PUBLIC_LIVE_SYNC_MS || 60000))

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
    void fetch('/api/auth/company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ companyId, force: true })
    })
  }

  useEffect(() => {
    let cancelled = false
    let timerId: ReturnType<typeof setInterval> | null = null

    const fetchPermissions = async () => {
      try {
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
        setAllowedModules(new Set(readableModules))
      } catch {
        if (cancelled) return
        setAllowedModules(null)
      }
    }

    void fetchPermissions()
    timerId = setInterval(() => {
      void fetchPermissions()
    }, permissionsRefreshMs)

    return () => {
      cancelled = true
      if (timerId) clearInterval(timerId)
    }
  }, [companyId, permissionsRefreshMs])

  const hasChildAccess = useCallback((child: MenuChild) => {
    if (!child.permissionModule) return true
    if (!allowedModules) return true
    return allowedModules.has(child.permissionModule)
  }, [allowedModules])

  useEffect(() => {
    const routeSet = new Set<string>()
    for (const item of menuItems) {
      if (item.href) routeSet.add(withCompany(item.href))
      for (const child of item.children) {
        if (hasChildAccess(child)) {
          routeSet.add(withCompany(child.href))
        }
      }
    }

    routeSet.forEach((href) => {
      if (!href) return
      router.prefetch(href)
    })
  }, [router, hasChildAccess, withCompany])

  const toggleItem = (title: string) => {
    setOpenItems(prev =>
      prev.includes(title)
        ? prev.filter(item => item !== title)
        : [...prev, title]
    )
  }

  const isActive = (href: string) => {
    const cleanHref = href.split('?')[0]
    return pathname === cleanHref
  }

  const isParentActive = (item: MenuItem) => {
    if (item.href && isActive(item.href)) return true
    return item.children?.some((child) => isActive(child.href))
  }

  return (
    <div className={cn(
      "bg-white border-r border-gray-200 h-full transition-all duration-300 ease-in-out flex flex-col",
      isCollapsed ? "w-16" : "w-64"
    )}>
      <div className="p-4 flex items-center justify-between flex-shrink-0">
        {!isCollapsed && <h2 className="text-lg font-semibold text-gray-900">Navigation</h2>}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          className="p-1 h-8 w-8"
        >
          {isCollapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="px-2 flex-1 overflow-y-auto">
        {menuItems.map((item) => {
          const hasChildren = item.children && item.children.length > 0
          const isOpen = openItems.includes(item.title)
          const active = isParentActive(item)

          if (!hasChildren) {
            return (
              <Link key={item.title} href={withCompany(item.href)} onClick={syncActiveCompany}>
                <Button
                  variant={active ? 'secondary' : 'ghost'}
                  className={cn(
                    'w-full justify-start mb-1',
                    active && 'bg-gray-100',
                    isCollapsed && 'px-2'
                  )}
                >
                  {item.icon && <item.icon className={cn("h-4 w-4", isCollapsed ? "" : "mr-2")} />}
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
                    'w-full justify-between mb-1',
                    active && 'bg-gray-100',
                    isCollapsed && 'px-2'
                  )}
                >
                  <div className="flex items-center">
                    {item.icon && <item.icon className={cn("h-4 w-4", isCollapsed ? "" : "mr-2")} />}
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
                          variant={isActive(child.href) ? 'secondary' : 'ghost'}
                          size="sm"
                          className={cn(
                            'w-full justify-start mb-1',
                            isActive(child.href) && 'bg-gray-100'
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
