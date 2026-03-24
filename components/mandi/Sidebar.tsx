'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  Building2, 
  Package, 
  ShoppingCart, 
  Receipt, 
  CreditCard, 
  BarChart3, 
  Settings,
  Shield
} from 'lucide-react'

interface SidebarProps {
  companyId: string
  userRole: string
}

export function Sidebar({ companyId, userRole }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const pathname = usePathname()

  const menuItems = [
    {
      title: 'MASTER',
      icon: Building2,
      items: [
        { title: 'Unit', href: `/dashboard/${companyId}/master/unit` },
        { title: 'Bank Account', href: `/dashboard/${companyId}/master/bank` },
        { title: 'Product', href: `/dashboard/${companyId}/master/product` },
        { title: 'Sales Items', href: `/dashboard/${companyId}/master/sales-items` },
        { title: 'Purchase Items', href: `/dashboard/${companyId}/master/purchase-items` },
      ]
    },
    {
      title: 'PURCHASE',
      icon: ShoppingCart,
      items: [
        { title: 'Regular Purchase', href: `/dashboard/${companyId}/purchase/regular` },
        { title: 'Bulk Purchase', href: `/dashboard/${companyId}/purchase/bulk` },
        { title: 'Special Purchase', href: `/dashboard/${companyId}/purchase/special` },
      ]
    },
    {
      title: 'SALES',
      icon: Receipt,
      items: [
        { title: 'Sales Entry', href: `/dashboard/${companyId}/sales/entry` },
        { title: 'Bulk Sales', href: `/dashboard/${companyId}/sales/bulk` },
      ]
    },
    {
      title: 'PAYMENT',
      icon: CreditCard,
      items: [
        { title: 'Purchase Payment', href: `/dashboard/${companyId}/payment/purchase` },
        { title: 'Sales Payment', href: `/dashboard/${companyId}/payment/sales` },
      ]
    },
    {
      title: 'STOCK',
      icon: Package,
      items: [
        { title: 'Stock Adjustment', href: `/dashboard/${companyId}/stock/adjustment` },
      ]
    },
    {
      title: 'REPORT',
      icon: BarChart3,
      items: [
        { title: 'Purchase Report', href: `/dashboard/${companyId}/report/purchase` },
        { title: 'Sales Report', href: `/dashboard/${companyId}/report/sales` },
        { title: 'Stock Report', href: `/dashboard/${companyId}/report/stock` },
        { title: 'Sales Outstanding', href: `/dashboard/${companyId}/report/outstanding` },
      ]
    },
  ]

  // Super Admin menu
  if (userRole === 'super_admin') {
    menuItems.push({
      title: 'SUPER ADMIN',
      icon: Shield,
      items: [
        { title: 'Company Management', href: '/super-admin/companies' },
        { title: 'User Management', href: '/super-admin/users' },
        { title: 'Global Settings', href: '/super-admin/settings' },
      ]
    })
  }

  const isActive = (href: string) => pathname === href

  return (
    <div className={`${isCollapsed ? 'w-16' : 'w-64'} bg-white border-r border-gray-200 transition-all duration-300 flex flex-col`}>
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center space-x-2">
          <Building2 className="h-8 w-8 text-blue-600" />
          {!isCollapsed && <span className="font-bold text-lg">Mandi ERP</span>}
        </div>
      </div>
      
      <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
        {menuItems.map((section) => (
          <div key={section.title}>
            <div className="flex items-center space-x-2 mb-2 text-xs font-semibold text-gray-500 uppercase">
              <section.icon className="h-4 w-4" />
              {!isCollapsed && <span>{section.title}</span>}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center space-x-2 px-2 py-1 rounded text-sm transition-colors ${
                    isActive(item.href)
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full bg-current" />
                  {!isCollapsed && <span>{item.title}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      
      <div className="p-4 border-t border-gray-200">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full flex items-center justify-center p-2 text-gray-500 hover:bg-gray-100 rounded"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
