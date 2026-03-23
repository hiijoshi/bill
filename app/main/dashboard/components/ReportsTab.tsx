'use client'

import ReportDashboard from '@/components/reports/ReportDashboard'

type CompanyOption = {
  id: string
  name: string
}

interface ReportsTabProps {
  companyId: string
  companyOptions?: CompanyOption[]
}

export default function ReportsTab({ companyId, companyOptions }: ReportsTabProps) {
  return <ReportDashboard initialCompanyId={companyId} embedded companyOptions={companyOptions} />
}
