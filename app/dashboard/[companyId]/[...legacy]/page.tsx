import { redirect } from 'next/navigation'

interface LegacyDashboardRoutePageProps {
  params: Promise<{
    companyId: string
    legacy?: string[]
  }>
}

export default async function LegacyDashboardRoutePage({ params }: LegacyDashboardRoutePageProps) {
  const resolvedParams = await params
  const companyId = String(resolvedParams.companyId || '').trim()

  if (companyId) {
    redirect(`/main/dashboard?companyId=${encodeURIComponent(companyId)}`)
  }

  redirect('/main/dashboard')
}
