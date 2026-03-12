type CompanyLookupClient = {
  company: {
    findFirst: (args: {
      where: {
        mandiAccountNumber: string
        deletedAt?: null
      }
      select: {
        id: true
      }
    }) => Promise<{ id: string } | null>
    findMany: (args: {
      where: {
        deletedAt?: null
        OR: Array<{ mandiAccountNumber: null } | { mandiAccountNumber: '' }>
      }
      select: {
        id: true
      }
    }) => Promise<Array<{ id: string }>>
    update: (args: {
      where: {
        id: string
      }
      data: {
        mandiAccountNumber: string
      }
    }) => Promise<unknown>
  }
}

export function generateMandiAccountNumberCandidate(): string {
  const timestampPart = Date.now().toString().slice(-8)
  const randomPart = Math.floor(100000 + Math.random() * 900000).toString()
  return `MND${timestampPart}${randomPart}`
}

export async function generateUniqueMandiAccountNumber(
  client: CompanyLookupClient,
  maxAttempts = 30
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateMandiAccountNumberCandidate()
    const existing = await client.company.findFirst({
      where: {
        mandiAccountNumber: candidate,
        deletedAt: null
      },
      select: {
        id: true
      }
    })

    if (!existing) {
      return candidate
    }
  }

  return `MND${Date.now()}${Math.floor(100000000 + Math.random() * 900000000)}`
}

export async function backfillMissingMandiAccountNumbers(client: CompanyLookupClient): Promise<number> {
  const missingCompanies = await client.company.findMany({
    where: {
      deletedAt: null,
      OR: [{ mandiAccountNumber: null }, { mandiAccountNumber: '' }]
    },
    select: {
      id: true
    }
  })

  for (const company of missingCompanies) {
    const generated = await generateUniqueMandiAccountNumber(client)
    await client.company.update({
      where: {
        id: company.id
      },
      data: {
        mandiAccountNumber: generated
      }
    })
  }

  return missingCompanies.length
}
