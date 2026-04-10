'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, FileClock, Package, Receipt, ShoppingCart } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import OperationsReportWorkspace from '@/components/reports/OperationsReportWorkspace'
import ReportDashboard from '@/components/reports/ReportDashboard'
import StockReportDashboard from '@/components/reports/StockReportDashboard'
import { APP_COMPANY_CHANGED_EVENT } from '@/lib/company-context'
import type { DashboardLayoutInitialData } from '@/lib/app-shell-types'

type ReportType = 'main' | 'purchase' | 'sales' | 'stock' | 'operations'
type OperationsView = 'overview' | 'outstanding' | 'ledger' | 'daily' | 'cash-ledger' | 'bank-ledger'

type CompanyOption = {
  id: string
  name: string
}

type ReportDashboardSeed = {
  datasets?: Array<Record<string, unknown>>
  dateFrom?: string
  dateTo?: string
  lastGeneratedAt?: string
}

type StockReportSeed = {
  rows?: Array<Record<string, unknown>>
  dateFrom?: string
  dateTo?: string
  lastGeneratedAt?: string
}

type OperationsReportSeed = {
  payload?: Record<string, unknown> | null
  dateFrom?: string
  dateTo?: string
  lastGeneratedAt?: string
}

interface ReportsMainClientProps {
  initialCompanyId?: string
  initialLayoutData?: DashboardLayoutInitialData | null
  companyOptions?: CompanyOption[]
  initialReportType?: ReportType
  initialOperationsView?: OperationsView
  initialSelectedPartyId?: string
  initialCompanyWarning?: string
  initialReportDashboardSeed?: ReportDashboardSeed | null
  initialStockReportSeed?: StockReportSeed | null
  initialOperationsReportSeed?: OperationsReportSeed | null
}

export default function ReportsMainClient({
  initialCompanyId = '',
  initialLayoutData = null,
  companyOptions = [],
  initialReportType = 'main',
  initialOperationsView = 'overview',
  initialSelectedPartyId = '',
  initialCompanyWarning = '',
  initialReportDashboardSeed = null,
  initialStockReportSeed = null,
  initialOperationsReportSeed = null
}: ReportsMainClientProps) {
  const router = useRouter()
  const [companyId, setCompanyId] = useState(initialCompanyId)

  useEffect(() => {
    if (!initialCompanyId) return
    setCompanyId(initialCompanyId)
  }, [initialCompanyId])

  useEffect(() => {
    const onCompanyChanged = (event: Event) => {
      const nextCompanyId =
        event instanceof CustomEvent && event.detail && typeof event.detail.companyId === 'string'
          ? event.detail.companyId.trim()
          : ''

      if (!nextCompanyId || nextCompanyId === companyId) return

      const current = new URL(window.location.href)
      const params = new URLSearchParams(current.search)
      params.set('companyId', nextCompanyId)

      router.replace(`/reports/main?${params.toString()}`)
    }

    window.addEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    return () => {
      window.removeEventListener(APP_COMPANY_CHANGED_EVENT, onCompanyChanged)
    }
  }, [companyId, router])

  const openReport = (type: ReportType) => {
    const params = new URLSearchParams()
    if (type !== 'main') {
      params.set('reportType', type)
    }
    if (companyId) {
      params.set('companyId', companyId)
    }
    if (type === 'operations' && initialOperationsView !== 'overview') {
      params.set('view', initialOperationsView)
    }

    router.push(`/reports/main${params.toString() ? `?${params.toString()}` : ''}`)
  }

  const reportTypeLabel = useMemo(() => initialReportType, [initialReportType])

  return (
    <DashboardLayout companyId={companyId} lockViewport initialData={initialLayoutData}>
      <div className="min-h-full bg-[#f5f5f7]">
        <div className="mx-auto w-full max-w-[1600px] space-y-6 p-6 md:p-8">
          {initialCompanyWarning ? (
            <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {initialCompanyWarning}
            </div>
          ) : null}

          <section className="overflow-hidden rounded-[2rem] border border-black/5 bg-[#fbfaf8] shadow-[0_24px_60px_-40px_rgba(15,23,42,0.16)]">
            <div className="px-4 py-4 md:px-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">Reports</p>
                  <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 md:text-2xl">Switch report</h1>
                </div>

                <div className="flex overflow-x-auto pb-1">
                  <div className="flex min-w-max gap-2">
                    {[
                      { key: 'main', label: 'Dashboard', icon: BarChart3 },
                      { key: 'purchase', label: 'Purchase', icon: ShoppingCart },
                      { key: 'sales', label: 'Sales', icon: Receipt },
                      { key: 'stock', label: 'Stock', icon: Package },
                      { key: 'operations', label: 'Operations', icon: FileClock }
                    ].map((item) => {
                      const active = reportTypeLabel === item.key
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => openReport(item.key as ReportType)}
                          className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                            active
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {initialReportType === 'stock' ? (
            <StockReportDashboard
              initialCompanyId={companyId}
              companyOptions={companyOptions}
              initialGeneratedRows={(initialStockReportSeed?.rows as never[]) || []}
              initialDateFrom={initialStockReportSeed?.dateFrom || ''}
              initialDateTo={initialStockReportSeed?.dateTo || ''}
              initialLastGeneratedAt={initialStockReportSeed?.lastGeneratedAt || ''}
              onBackToDashboard={() => router.push('/main/dashboard')}
            />
          ) : initialReportType === 'operations' ? (
            <OperationsReportWorkspace
              initialCompanyId={companyId}
              initialView={initialOperationsView}
              companyOptions={companyOptions}
              initialReportData={(initialOperationsReportSeed?.payload as never) || null}
              initialDateFrom={initialOperationsReportSeed?.dateFrom || ''}
              initialDateTo={initialOperationsReportSeed?.dateTo || ''}
              initialLastGeneratedAt={initialOperationsReportSeed?.lastGeneratedAt || ''}
              initialSelectedPartyId={initialSelectedPartyId}
              onBackToDashboard={() => router.push('/main/dashboard')}
            />
          ) : (
            <ReportDashboard
              initialCompanyId={companyId}
              companyOptions={companyOptions}
              initialDatasets={(initialReportDashboardSeed?.datasets as never[]) || []}
              initialDateFrom={initialReportDashboardSeed?.dateFrom || ''}
              initialDateTo={initialReportDashboardSeed?.dateTo || ''}
              initialLastGeneratedAt={initialReportDashboardSeed?.lastGeneratedAt || ''}
              reportType={initialReportType === 'main' ? 'main' : initialReportType}
              onBackToDashboard={() => router.push('/main/dashboard')}
            />
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
