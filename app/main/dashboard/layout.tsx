import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'

import { resolveServerDefaultAppRoute } from '@/lib/server-app-default-route'

interface MainDashboardLayoutProps {
  children: ReactNode
}

export default async function MainDashboardLayout({ children }: MainDashboardLayoutProps) {
  const nextRoute = await resolveServerDefaultAppRoute()

  if (!nextRoute) {
    redirect('/login')
  }

  if (!nextRoute.startsWith('/main/dashboard')) {
    redirect(nextRoute)
  }

  return children
}
