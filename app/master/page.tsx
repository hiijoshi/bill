import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'

export default async function MasterLandingPage() {
  const superAdminSession = await getSession('super_admin')
  if (superAdminSession?.role?.toLowerCase().replace(/\s+/g, '_') === 'super_admin') {
    redirect('/super-admin/masters')
  }

  const appSession = await getSession()
  if (appSession) {
    redirect('/master/product')
  }

  redirect('/login')
}
