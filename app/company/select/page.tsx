import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { prisma } from '@/lib/prisma'
import { getAccessibleCompanies, normalizeAppRole } from '@/lib/api-security'
import CompanySelectorSimple from './CompanySelectorSimple'

export default async function CompanySelectPage() {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  const user = await prisma.user.findFirst({
    where: {
      userId: session.userId,
      traderId: session.traderId,
      deletedAt: null
    },
    select: {
      id: true,
      companyId: true,
      role: true
    }
  })

  if (!user) {
    redirect('/login')
  }

  const companies = await getAccessibleCompanies({
    userId: session.userId,
    traderId: session.traderId,
    role: normalizeAppRole(user.role || session.role),
    companyId: user.companyId,
    userDbId: user.id
  })

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Select Company</CardTitle>
          <p className="text-sm text-gray-600">Welcome back, {session.name || session.userId}! Select your company to continue.</p>
        </CardHeader>
        <CardContent>
          <CompanySelectorSimple companies={companies} />
        </CardContent>
      </Card>
    </div>
  )
}
