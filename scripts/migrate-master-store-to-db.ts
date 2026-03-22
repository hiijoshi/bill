import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'

type LegacyBank = {
  id?: string
  companyId?: string
  name?: string
  branch?: string | null
  ifscCode?: string
  accountNumber?: string | null
  address?: string | null
  phone?: string | null
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

type LegacyMarka = {
  id?: string
  companyId?: string
  markaNumber?: string
  description?: string | null
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

type LegacyPaymentMode = {
  id?: string
  companyId?: string
  name?: string
  code?: string
  description?: string | null
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

type LegacyStore = {
  banks?: LegacyBank[]
  markas?: LegacyMarka[]
  paymentModes?: LegacyPaymentMode[]
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

async function main() {
  const filePath = path.join(process.cwd(), 'data', 'master-data.json')
  const raw = await fs.readFile(filePath, 'utf-8')
  const parsed = JSON.parse(raw) as LegacyStore

  const companyIds = new Set<string>()
  for (const row of parsed.banks || []) if (clean(row.companyId)) companyIds.add(clean(row.companyId)!)
  for (const row of parsed.markas || []) if (clean(row.companyId)) companyIds.add(clean(row.companyId)!)
  for (const row of parsed.paymentModes || []) if (clean(row.companyId)) companyIds.add(clean(row.companyId)!)

  const companies = await prisma.company.findMany({
    where: { id: { in: Array.from(companyIds) } },
    select: { id: true }
  })
  const validCompanyIds = new Set(companies.map((row) => row.id))

  const summary = {
    banksImported: 0,
    banksSkipped: 0,
    markasImported: 0,
    markasSkipped: 0,
    paymentModesImported: 0,
    paymentModesSkipped: 0
  }
  const warnings: string[] = []

  for (const row of parsed.banks || []) {
    const companyId = clean(row.companyId)
    const name = clean(row.name)
    const ifscCode = clean(row.ifscCode)?.toUpperCase() || null
    if (!companyId || !validCompanyIds.has(companyId) || !name || !ifscCode) {
      summary.banksSkipped += 1
      warnings.push(`Skipped bank ${clean(row.id) || '(no-id)'}: missing company or required fields`)
      continue
    }

    await prisma.bank.upsert({
      where: {
        companyId_name_ifscCode: {
          companyId,
          name,
          ifscCode
        }
      },
      update: {
        branch: clean(row.branch),
        accountNumber: clean(row.accountNumber),
        address: clean(row.address),
        phone: clean(row.phone),
        isActive: row.isActive !== false
      },
      create: {
        ...(clean(row.id) ? { id: clean(row.id)! } : {}),
        companyId,
        name,
        branch: clean(row.branch),
        ifscCode,
        accountNumber: clean(row.accountNumber),
        address: clean(row.address),
        phone: clean(row.phone),
        isActive: row.isActive !== false,
        ...(toDate(row.createdAt) ? { createdAt: toDate(row.createdAt)! } : {}),
        ...(toDate(row.updatedAt) ? { updatedAt: toDate(row.updatedAt)! } : {})
      }
    })

    summary.banksImported += 1
  }

  for (const row of parsed.markas || []) {
    const companyId = clean(row.companyId)
    const markaNumber = clean(row.markaNumber)?.toUpperCase() || null
    if (!companyId || !validCompanyIds.has(companyId) || !markaNumber) {
      summary.markasSkipped += 1
      warnings.push(`Skipped marka ${clean(row.id) || '(no-id)'}: missing company or required fields`)
      continue
    }

    await prisma.marka.upsert({
      where: {
        companyId_markaNumber: {
          companyId,
          markaNumber
        }
      },
      update: {
        description: clean(row.description),
        isActive: row.isActive !== false
      },
      create: {
        ...(clean(row.id) ? { id: clean(row.id)! } : {}),
        companyId,
        markaNumber,
        description: clean(row.description),
        isActive: row.isActive !== false,
        ...(toDate(row.createdAt) ? { createdAt: toDate(row.createdAt)! } : {}),
        ...(toDate(row.updatedAt) ? { updatedAt: toDate(row.updatedAt)! } : {})
      }
    })

    summary.markasImported += 1
  }

  for (const row of parsed.paymentModes || []) {
    const companyId = clean(row.companyId)
    const name = clean(row.name)
    const code = clean(row.code)?.toUpperCase() || null
    if (!companyId || !validCompanyIds.has(companyId) || !name || !code) {
      summary.paymentModesSkipped += 1
      warnings.push(`Skipped payment mode ${clean(row.id) || '(no-id)'}: missing company or required fields`)
      continue
    }

    await prisma.paymentMode.upsert({
      where: {
        companyId_code: {
          companyId,
          code
        }
      },
      update: {
        name,
        description: clean(row.description),
        isActive: row.isActive !== false
      },
      create: {
        ...(clean(row.id) ? { id: clean(row.id)! } : {}),
        companyId,
        name,
        code,
        description: clean(row.description),
        isActive: row.isActive !== false,
        ...(toDate(row.createdAt) ? { createdAt: toDate(row.createdAt)! } : {}),
        ...(toDate(row.updatedAt) ? { updatedAt: toDate(row.updatedAt)! } : {})
      }
    })

    summary.paymentModesImported += 1
  }

  console.log('Legacy master store migration summary:')
  console.table(summary)
  if (warnings.length > 0) {
    console.warn('Migration warnings:')
    for (const warning of warnings) {
      console.warn(`- ${warning}`)
    }
  }
}

main()
  .catch((error) => {
    console.error('Failed to migrate legacy master store:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
