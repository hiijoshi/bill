import { redirect } from 'next/navigation'
import { resolveServerDefaultAppRoute } from '@/lib/server-app-default-route'

interface DashboardPageProps {
  searchParams: Promise<{ companyId?: string }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { companyId } = await searchParams
  redirect((await resolveServerDefaultAppRoute(companyId)) || '/login')
}
