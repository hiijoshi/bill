import { redirect } from 'next/navigation'

import SuperAdminTraderSubscriptionsClient from '@/app/super-admin/subscriptions/SubscriptionsClient'
import { prisma } from '@/lib/prisma'
import { resolveServerAuth } from '@/lib/server-auth'
import { getSuperAdminSubscriptionBootstrap } from '@/lib/super-admin-subscription-data'

interface SuperAdminTraderSubscriptionsPageProps {
  searchParams: Promise<{
    traderId?: string
    state?: string
  }>
}

export default async function SuperAdminTraderSubscriptionsPage({
  searchParams
}: SuperAdminTraderSubscriptionsPageProps) {
  const resolved = await resolveServerAuth({ namespace: 'super_admin', allowedRoles: ['super_admin'] })
  if (!resolved) {
    redirect('/super-admin/login')
  }

  const { traderId, state } = await searchParams

  try {
    const bootstrap = await getSuperAdminSubscriptionBootstrap(prisma, {
      requestedTraderId: traderId,
      state
    })

    return (
      <SuperAdminTraderSubscriptionsClient
        requestedTraderId={traderId}
        requestedState={state}
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
        requestedState={state}
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
