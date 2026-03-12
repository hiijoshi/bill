import { redirect } from 'next/navigation'

interface DashboardPageProps {
  searchParams: Promise<{ companyId?: string }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { companyId } = await searchParams

  if (!companyId) {
    redirect('/main/dashboard')
  }

  redirect('/main/dashboard')
}
