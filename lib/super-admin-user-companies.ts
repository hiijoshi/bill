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

export async function getConnectedUserCountsForCompanies(
  db: CompanyAccessDb,
  params: {
    companyIds: string[]
    traderId?: string | null
    includeDeletedUsers?: boolean
  }
): Promise<Record<string, number>> {
  const companyIds = Array.from(
    new Set(
      params.companyIds
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  )

  if (companyIds.length === 0) {
    return {}
  }

  const companyIdSet = new Set(companyIds)
  const users = await db.user.findMany({
    where: {
      ...(params.includeDeletedUsers ? {} : { deletedAt: null }),
      ...(params.traderId ? { traderId: params.traderId } : {}),
      NOT: [{ role: 'SUPER_ADMIN' }, { role: 'super_admin' }],
      OR: [
        {
          companyId: {
            in: companyIds
          }
        },
        {
          permissions: {
            some: {
              companyId: {
                in: companyIds
              }
            }
          }
        }
      ]
    },
    select: {
      companyId: true,
      permissions: {
        where: {
          companyId: {
            in: companyIds
          }
        },
        select: {
          companyId: true
        }
      }
    }
  })

  const counts = Object.fromEntries(companyIds.map((companyId) => [companyId, 0]))

  for (const user of users) {
    const linkedCompanyIds = new Set<string>()

    if (user.companyId && companyIdSet.has(user.companyId)) {
      linkedCompanyIds.add(user.companyId)
    }

    for (const permission of user.permissions) {
      if (companyIdSet.has(permission.companyId)) {
        linkedCompanyIds.add(permission.companyId)
      }
    }

    for (const companyId of linkedCompanyIds) {
      counts[companyId] += 1
    }
  }

  return counts
}
