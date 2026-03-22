import { redirect } from 'next/navigation'
import SuperAdminShell from '@/app/super-admin/components/SuperAdminShell'
import ProfileSettings from '@/components/account/ProfileSettings'
import { loadSelfProfileFromSession } from '@/lib/self-profile'

export default async function SuperAdminProfilePage() {
  const initialUser = await loadSelfProfileFromSession('super_admin')

  if (!initialUser || (initialUser.role || '').toLowerCase() !== 'super_admin') {
    redirect('/super-admin/login')
  }

  return (
    <SuperAdminShell title="Profile" subtitle="Manage your Super Admin account securely">
      <div className="mx-auto max-w-7xl px-6 py-6 md:px-8">
        <ProfileSettings
          profileEndpoint="/api/super-admin/profile"
          initialUser={initialUser}
          breadcrumbRoot="Super Admin"
          pageTitle="Super Admin Settings"
          description="Database-backed credentials, platform scope, and password security for the primary administration account."
        />
      </div>
    </SuperAdminShell>
  )
}
