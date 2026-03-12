'use client'

import ReportDashboard from '@/components/reports/ReportDashboard'

interface ReportsTabProps {
  companyId: string
}

export default function ReportsTab({ companyId }: ReportsTabProps) {
  return <ReportDashboard initialCompanyId={companyId} embedded />
}
