'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

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

  return (
    <DashboardLayout companyId={companyId} lockViewport hidePageIntro initialData={initialLayoutData}>
      <div className="min-h-full bg-[#f5f5f7]">
        <div className="mx-auto w-full max-w-[1600px] space-y-6 p-6 md:p-8">
          {initialCompanyWarning ? (
            <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {initialCompanyWarning}
            </div>
          ) : null}

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
              embedded
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
