import { prisma } from '@/lib/prisma'
import { buildWorkspacePayload } from '../serializers'

export async function loadBankStatementWorkspace(companyId: string) {
  const [banks, recentBatches] = await Promise.all([
    prisma.bank.findMany({
      where: {
        companyId,
        isActive: true
      },
      orderBy: [{ name: 'asc' }, { branch: 'asc' }]
    }),
    prisma.bankStatementBatch.findMany({
      where: {
        companyId
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 12
    })
  ])

  return buildWorkspacePayload({
    companyId,
    banks,
    recentBatches
  })
}
