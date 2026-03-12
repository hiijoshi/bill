import { redirect } from 'next/navigation'

interface DashboardByCompanyPageProps {
  params: Promise<{ companyId: string }>
}

export default async function DashboardByCompanyPage({ params }: DashboardByCompanyPageProps) {
  void params
  redirect('/main/dashboard')
}
