import { redirect } from 'next/navigation'

import SuperAdminTraderSubscriptionsClient from '@/app/super-admin/subscriptions/SubscriptionsClient'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { getSuperAdminSubscriptionBootstrap } from '@/lib/super-admin-subscription-data'

interface SuperAdminTraderSubscriptionsPageProps {
  searchParams: Promise<{
    traderId?: string
  }>
}

export default async function SuperAdminTraderSubscriptionsPage({
  searchParams
}: SuperAdminTraderSubscriptionsPageProps) {
  const session = await getSession('super_admin')
  if (!session || session.role?.toLowerCase().replace(/\s+/g, '_') !== 'super_admin') {
    redirect('/super-admin/login')
  }

  const { traderId } = await searchParams

  try {
    const bootstrap = await getSuperAdminSubscriptionBootstrap(prisma, {
      requestedTraderId: traderId
    })

    return (
      <SuperAdminTraderSubscriptionsClient
        requestedTraderId={traderId}
        initialTraders={bootstrap.traders}
        initialPlans={bootstrap.plans}
        initialSelectedTraderId={bootstrap.selectedTraderId}
        initialDetail={bootstrap.detail}
        initialSchemaReady={bootstrap.schemaReady}
        initialSchemaWarning={bootstrap.schemaWarning}
      />
    )
  } catch (error) {
    console.error('super-admin subscriptions page bootstrap failed:', error)

    return (
      <SuperAdminTraderSubscriptionsClient
        requestedTraderId={traderId}
        initialTraders={[]}
        initialPlans={[]}
        initialSelectedTraderId=""
        initialDetail={null}
        initialSchemaReady={true}
        initialSchemaWarning={null}
        initialError="Failed to load subscription workspace. Please retry once."
      />
    )
  }
}
