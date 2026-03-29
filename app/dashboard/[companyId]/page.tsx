import { redirect } from 'next/navigation'
import { resolveServerDefaultAppRoute } from '@/lib/server-app-default-route'

interface DashboardByCompanyPageProps {
  params: Promise<{ companyId: string }>
}

export default async function DashboardByCompanyPage({ params }: DashboardByCompanyPageProps) {
  const resolvedParams = await params
  redirect((await resolveServerDefaultAppRoute(resolvedParams.companyId)) || '/login')
}
