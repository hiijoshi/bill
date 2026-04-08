import { redirect } from 'next/navigation'
import SuperAdminOverviewClient from '@/app/super-admin/components/SuperAdminOverviewClient'
import { loadSuperAdminOverviewData } from '@/lib/server-super-admin-overview'
import { resolveServerAuth } from '@/lib/server-auth'

export default async function SuperAdminDashboardPage() {
  const resolved = await resolveServerAuth({ namespace: 'super_admin', allowedRoles: ['super_admin'] })
  if (!resolved) {
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
  const initialProfile = {
    user: {
      userId: resolved.user.userId,
      name: resolved.user.name || undefined,
      role: resolved.user.role || undefined
    }
  }

  return (
    <SuperAdminOverviewClient initialOverview={initialOverview} initialProfile={initialProfile} />
  )
}
