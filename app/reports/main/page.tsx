'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/app/components/DashboardLayout'
import ReportDashboard from '@/components/reports/ReportDashboard'
import { resolveCompanyId, stripCompanyParamsFromUrl } from '@/lib/company-context'

export default function ReportsMainPage() {
  const router = useRouter()
  const [companyId, setCompanyId] = useState('')
  const [companyResolving, setCompanyResolving] = useState(true)
  const [companyWarning, setCompanyWarning] = useState('')

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      let resolvedCompanyId = ''
      for (let attempt = 0; attempt < 2; attempt += 1) {
        resolvedCompanyId = await resolveCompanyId(window.location.search)
        if (resolvedCompanyId) break
        await new Promise((resolve) => setTimeout(resolve, 120))
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

  if (companyResolving) {
    return (
      <DashboardLayout companyId="">
        <div className="flex h-64 items-center justify-center text-lg">Loading...</div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout companyId={companyId}>
      <div className="p-6">
        <div className="mx-auto w-full max-w-[1600px] space-y-4">
          {companyWarning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              {companyWarning}
            </div>
          )}

          <ReportDashboard
            initialCompanyId={companyId}
            onBackToDashboard={() => router.push('/main/dashboard')}
          />
        </div>
      </div>
    </DashboardLayout>
  )
}
