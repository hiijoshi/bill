import { redirect } from 'next/navigation'
import { resolveServerAuth } from '@/lib/server-auth'

export default async function MasterLandingPage() {
  const [superAdminAuth, appAuth] = await Promise.all([
    resolveServerAuth({ namespace: 'super_admin' }),
    resolveServerAuth({ namespace: 'app' })
  ])

  if (superAdminAuth) {
    redirect('/super-admin/masters')
  }

  if (appAuth) {
    redirect('/master/product')
  }

  redirect('/login')
}
