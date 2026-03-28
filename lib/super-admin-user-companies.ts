import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type CompanyAccessDb = typeof prisma | Prisma.TransactionClient

export type LinkedUserCompany = {
  id: string
  name: string
  locked: boolean
  isPrimary: boolean
}

export async function getLinkedCompanyIdsForUser(
  db: CompanyAccessDb,
  params: {
    userId: string
    primaryCompanyId?: string | null
  }
): Promise<string[]> {
  const permissionRows = await db.userPermission.findMany({
    where: {
      userId: params.userId
    },
    select: {
      companyId: true
    }
  })

  return Array.from(
    new Set(
      [
        ...(params.primaryCompanyId ? [params.primaryCompanyId] : []),
        ...permissionRows.map((row) => row.companyId)
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    )
  )
}

export async function getLinkedCompaniesForUser(
  db: CompanyAccessDb,
  params: {
    userId: string
    traderId: string
    primaryCompanyId?: string | null
  }
): Promise<LinkedUserCompany[]> {
  const linkedCompanyIds = await getLinkedCompanyIdsForUser(db, params)
  if (linkedCompanyIds.length === 0) {
    return []
  }

  const companies = await db.company.findMany({
    where: {
      id: { in: linkedCompanyIds },
      traderId: params.traderId,
      deletedAt: null
    },
    select: {
      id: true,
      name: true,
      locked: true
    },
    orderBy: {
      name: 'asc'
    }
  })

  return companies.sort((left, right) => {
    const leftPrimary = left.id === params.primaryCompanyId
    const rightPrimary = right.id === params.primaryCompanyId
    if (leftPrimary !== rightPrimary) {
      return leftPrimary ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  }).map((company) => ({
    id: company.id,
    name: company.name,
    locked: company.locked,
    isPrimary: company.id === params.primaryCompanyId
  }))
}
