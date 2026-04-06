import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import SuperAdminOverviewClient from '@/app/super-admin/components/SuperAdminOverviewClient'
import { loadSuperAdminOverviewData } from '@/lib/server-super-admin-overview'

export default async function SuperAdminDashboardPage() {
  const session = await getSession('super_admin')
  if (!session || session.role?.toLowerCase().replace(/\s+/g, '_') !== 'super_admin') {
    redirect('/super-admin/login')
  }

  const overview = await loadSuperAdminOverviewData({
    sections: ['stats', 'traders', 'companies', 'users', 'permissionPreview']
  })
  const initialOverview = {
    stats: overview.stats || { traders: 0, companies: 0, users: 0 },
    traders: overview.traders || [],
    companies: overview.companies || [],
    users: overview.users || [],
    permissionPreview: overview.permissionPreview || null
  }

  return (
    <SuperAdminOverviewClient initialOverview={initialOverview} />
  )
}
