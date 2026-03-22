import { redirect } from 'next/navigation'
import DashboardLayout from '@/app/components/DashboardLayout'
import ProfileSettings from '@/components/account/ProfileSettings'
import { loadSelfProfileFromSession } from '@/lib/self-profile'

export default async function MainProfilePage() {
  const initialUser = await loadSelfProfileFromSession('app')

  if (!initialUser) {
    redirect('/login')
  }

  if ((initialUser.role || '').toLowerCase() === 'super_admin') {
    redirect('/super-admin/profile')
  }

  return (
    <DashboardLayout companyId="">
      <div className="p-6 md:p-8">
        <div className="mx-auto max-w-7xl">
          <ProfileSettings
            profileEndpoint="/api/profile"
            initialUser={initialUser}
            breadcrumbRoot="Dashboard"
            pageTitle="Profile Settings"
            description="Review your account identity, workspace context, and password security in one production-ready settings surface."
          />
        </div>
      </div>
    </DashboardLayout>
  )
}
