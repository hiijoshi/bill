import { redirect } from 'next/navigation'

import DashboardLayout from '@/app/components/DashboardLayout'
import SubscriptionOverview from '@/components/subscription/SubscriptionOverview'
import { loadSelfProfileFromSession } from '@/lib/self-profile'
import { loadServerAppShellBootstrap } from '@/lib/server-app-shell'
import { loadSubscriptionOverviewData } from '@/lib/server-subscription-overview'

export default async function MainSubscriptionPage() {
  const initialUser = await loadSelfProfileFromSession('app')

  if (!initialUser) {
    redirect('/login')
  }

  if ((initialUser.role || '').toLowerCase() === 'super_admin') {
    redirect('/super-admin/subscriptions')
  }

  const [shellBootstrap, overview] = await Promise.all([
    loadServerAppShellBootstrap(),
    loadSubscriptionOverviewData(initialUser.traderId)
  ])

  return (
    <DashboardLayout
      companyId={shellBootstrap?.activeCompanyId || ''}
      initialData={shellBootstrap?.layoutData || null}
    >
      <div className="p-6 md:p-8">
        <div className="mx-auto max-w-7xl">
          <SubscriptionOverview
            initialCurrent={overview.current}
            initialHistory={overview.history}
          />
        </div>
      </div>
    </DashboardLayout>
  )
}
