'use client'

import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, FileClock, Package, Receipt, ShoppingCart } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import { MetricRail, ModuleChrome } from '@/components/business/module-chrome'
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
  const companyId = initialCompanyId

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
  const reportTypeTitle = reportTypeLabel === 'main'
    ? 'Unified Reports'
    : reportTypeLabel === 'operations'
      ? 'Operational Ledgers'
      : `${reportTypeLabel.charAt(0).toUpperCase()}${reportTypeLabel.slice(1)} Reports`

  return (
    <DashboardLayout companyId={companyId} lockViewport initialData={initialLayoutData}>
      <div className="min-h-full bg-[#f5f5f7]">
        <div className="mx-auto w-full max-w-[1600px] space-y-6 p-6 md:p-8">
          {initialCompanyWarning ? (
            <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {initialCompanyWarning}
            </div>
          ) : null}

          <ModuleChrome
            eyebrow="Reports Workspace"
            title={reportTypeTitle}
            description="Business reports are grouped by workflow, not by technical endpoints. Desktop users get fast switching and dense data review, while smaller screens stay readable with the same scoped filters and export behavior."
            badges={
              <>
                <span className="inline-flex rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-xs font-semibold text-slate-600">
                  Scope: {companyId ? 'Single company' : 'Assigned companies'}
                </span>
                <span className="inline-flex rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-xs font-semibold text-slate-600">
                  View: {reportTypeTitle}
                </span>
                {initialReportType === 'operations' ? (
                  <span className="inline-flex rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-xs font-semibold text-slate-600">
                    Ledger focus: {initialOperationsView.replace(/-/g, ' ')}
                  </span>
                ) : null}
              </>
            }
            actions={
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
            }
          >
            <MetricRail
              items={[
                {
                  label: 'Companies',
                  value: String(companyOptions.length || (companyId ? 1 : 0)),
                  helper: companyId ? 'Scoped to selected company' : 'Available in assigned scope'
                },
                {
                  label: 'Module',
                  value: initialReportType === 'main' ? 'Summary' : initialReportType,
                  helper: initialReportType === 'operations' ? 'Ledger and daily views' : 'Reporting workspace'
                },
                {
                  label: 'Operations View',
                  value: initialReportType === 'operations' ? initialOperationsView : 'N/A',
                  helper: 'Only active for operations reports'
                },
                {
                  label: 'Layout',
                  value: companyId ? 'Focused' : 'Portfolio',
                  helper: 'Desktop dense, mobile simplified'
                }
              ]}
            />
          </ModuleChrome>

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
