'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BarChart3, FileClock, Package, Receipt, ShoppingCart } from 'lucide-react'

import DashboardLayout from '@/app/components/DashboardLayout'
import OperationsReportWorkspace from '@/components/reports/OperationsReportWorkspace'
import ReportDashboard from '@/components/reports/ReportDashboard'
import StockReportDashboard from '@/components/reports/StockReportDashboard'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

type ReportType = 'main' | 'purchase' | 'sales' | 'stock' | 'operations'
type OperationsView = 'outstanding' | 'ledger' | 'daily-transaction' | 'daily-consolidated' | 'bank-ledger'

const normalizeReportType = (value: string | null): ReportType => {
  if (value === 'purchase' || value === 'sales' || value === 'stock' || value === 'operations') return value
  return 'main'
}

const normalizeOperationsView = (value: string | null): OperationsView => {
  if (
    value === 'outstanding' ||
    value === 'ledger' ||
    value === 'daily-transaction' ||
    value === 'daily-consolidated' ||
    value === 'bank-ledger'
  ) {
    return value
  }
  return 'outstanding'
}

export default function ReportsMainPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gray-50">Loading...</div>}>
      <ReportsMainPageContent />
    </Suspense>
  )
}

function ReportsMainPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [companyId, setCompanyId] = useState('')
  const [companyResolving, setCompanyResolving] = useState(true)
  const [companyWarning, setCompanyWarning] = useState('')

  const activeReportType = useMemo<ReportType>(() => {
    return normalizeReportType(searchParams.get('reportType'))
  }, [searchParams])

  const activeOperationsView = useMemo<OperationsView>(() => {
    return normalizeOperationsView(searchParams.get('view'))
  }, [searchParams])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      let resolvedCompanyId = ''
      for (let attempt = 0; attempt < 2; attempt += 1) {
        resolvedCompanyId = await resolveCompanyId(window.location.search)
        if (resolvedCompanyId) break
        await new Promise((resolve) => setTimeout(resolve, 40))
      }

      if (cancelled) return

      setCompanyId(resolvedCompanyId || '')
      setCompanyWarning(resolvedCompanyId ? '' : 'Company is not resolved yet. Data may be limited until company is selected.')
      if (resolvedCompanyId) {
        stripCompanyParamsFromUrl()
      }
      setCompanyResolving(false)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const openReport = (type: ReportType) => {
    const params = new URLSearchParams()
    if (type !== 'main') {
      params.set('reportType', type)
    }
    if (companyId) {
      params.set('companyId', companyId)
    }
    const query = params.toString()
    router.push(`/reports/main${query ? `?${query}` : ''}`)
  }

  if (companyResolving) {
    return (
      <DashboardLayout companyId="">
        <div className="flex h-64 items-center justify-center text-lg">Loading...</div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="min-h-full bg-[#f5f5f7]">
        <div className="mx-auto w-full max-w-[1600px] space-y-6 p-6 md:p-8">
          {companyWarning && (
            <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {companyWarning}
            </div>
          )}

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
                      const active = activeReportType === item.key
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

          {activeReportType === 'stock' ? (
            <StockReportDashboard
              initialCompanyId={companyId}
              onBackToDashboard={() => router.push('/main/dashboard')}
            />
          ) : activeReportType === 'operations' ? (
            <OperationsReportWorkspace
              initialCompanyId={companyId}
              initialView={activeOperationsView}
              onBackToDashboard={() => router.push('/main/dashboard')}
            />
          ) : (
            <ReportDashboard
              initialCompanyId={companyId}
              reportType={activeReportType === 'main' ? 'main' : activeReportType}
              onBackToDashboard={() => router.push('/main/dashboard')}
            />
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
