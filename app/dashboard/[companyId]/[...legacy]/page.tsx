import { redirect } from 'next/navigation'
import { resolveServerDefaultAppRoute } from '@/lib/server-app-default-route'

interface LegacyDashboardRoutePageProps {
  params: Promise<{
    companyId: string
    legacy?: string[]
  }>
}

export default async function LegacyDashboardRoutePage({ params }: LegacyDashboardRoutePageProps) {
  const resolvedParams = await params
  const companyId = String(resolvedParams.companyId || '').trim()
  redirect((await resolveServerDefaultAppRoute(companyId)) || '/login')
}
