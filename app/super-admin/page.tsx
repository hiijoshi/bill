import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import SuperAdminOverviewClient from '@/app/super-admin/components/SuperAdminOverviewClient'

export default async function SuperAdminDashboardPage() {
  const session = await getSession()
  if (!session || session.role?.toLowerCase().replace(/\s+/g, '_') !== 'super_admin') {
    redirect('/super-admin/login')
  }

  const [traders, companies, users] = await Promise.all([
    prisma.trader.count({ where: { deletedAt: null } }),
    prisma.company.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null } })
  ])

  return (
    <SuperAdminOverviewClient
      initialStats={{
        traders,
        companies,
        users
      }}
    />
  )
}
