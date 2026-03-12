'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import DashboardLayout from '@/app/components/DashboardLayout'
import { ShoppingCart, Receipt, Package, CreditCard, FileText } from 'lucide-react'

export default function SimpleDashboardPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SimpleDashboardPageContent />
    </Suspense>
  )
}

function SimpleDashboardPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get('companyId') || ''
  const [activeTab, setActiveTab] = useState('purchase')

  const tabs = [
    { id: 'purchase', label: 'Purchase', icon: <ShoppingCart className="w-4 h-4" /> },
    { id: 'sales', label: 'Sales', icon: <Receipt className="w-4 h-4" /> },
    { id: 'stock', label: 'Stock Management', icon: <Package className="w-4 h-4" /> },
    { id: 'payment', label: 'Payment', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'report', label: 'Reports', icon: <FileText className="w-4 h-4" /> }
  ]

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">Billing System Dashboard</h1>
          </div>

          {/* Tab Navigation */}
          <div className="flex space-x-1 mb-6 border-b">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {tabs.find(t => t.id === activeTab)?.icon}
                {tabs.find(t => t.id === activeTab)?.label} Module
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <h3 className="text-xl font-semibold mb-2">
                  {tabs.find(t => t.id === activeTab)?.label} Tab
                </h3>
                <p className="text-gray-600 mb-4">
                  This is the {tabs.find(t => t.id === activeTab)?.label.toLowerCase()} module.
                </p>
                <div className="space-y-2">
                  <p>✅ Tab is working correctly</p>
                  <p>✅ Component is loading</p>
                  <p>✅ Navigation is functional</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
