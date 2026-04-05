import { redirect } from 'next/navigation'

import { resolveServerDefaultAppRoute } from '@/lib/server-app-default-route'

export default async function CompanySelectPage() {
  const nextRoute = await resolveServerDefaultAppRoute()

  if (!nextRoute) {
    redirect('/login')
  }

  if (nextRoute === '/company/select') {
    redirect('/main/profile')
  }

  redirect(nextRoute)
}
