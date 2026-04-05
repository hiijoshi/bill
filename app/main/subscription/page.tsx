import { redirect } from 'next/navigation'

import DashboardLayout from '@/app/components/DashboardLayout'
import SubscriptionOverview from '@/components/subscription/SubscriptionOverview'
import { loadSelfProfileFromSession } from '@/lib/self-profile'

export default async function MainSubscriptionPage() {
  const initialUser = await loadSelfProfileFromSession('app')

  if (!initialUser) {
    redirect('/login')
  }

  if ((initialUser.role || '').toLowerCase() === 'super_admin') {
    redirect('/super-admin/subscriptions')
  }

  return (
    <DashboardLayout companyId="">
      <div className="p-6 md:p-8">
        <div className="mx-auto max-w-7xl">
          <SubscriptionOverview />
        </div>
      </div>
    </DashboardLayout>
  )
}
