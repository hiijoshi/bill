import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { prisma } from '@/lib/prisma'
import CompanySelectorSimple from './CompanySelectorSimple'

export default async function CompanySelectPage() {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  const isSuperAdmin = session.role === 'super_admin'
  const companies = await prisma.company.findMany({
    where: isSuperAdmin
      ? undefined
      : {
          OR: [
            { traderId: session.traderId },
            { traderId: null }
          ]
        },
    select: {
      id: true,
      name: true
    },
    orderBy: {
      name: 'asc'
    }
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
