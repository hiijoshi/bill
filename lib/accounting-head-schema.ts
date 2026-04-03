import type { PrismaClient } from '@prisma/client'

type AccountingHeadSchemaClient = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>

let schemaReady = false
let schemaPromise: Promise<void> | null = null

function isSqliteLikeDatabase(): boolean {
  const tursoUrl = String(process.env.TURSO_DATABASE_URL || '').trim()
  const databaseUrl = String(process.env.DATABASE_URL || '').trim().toLowerCase()

  return Boolean(
    tursoUrl ||
    databaseUrl.startsWith('file:') ||
    databaseUrl.startsWith('libsql:')
  )
}

function isAlreadyAppliedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  const normalized = message.toLowerCase()
  return normalized.includes('already exists') || normalized.includes('duplicate column')
}

async function applyAccountingHeadSchema(prisma: AccountingHeadSchemaClient) {
  if (!isSqliteLikeDatabase()) {
    return
  }

  const tableRows = await prisma.$queryRawUnsafe<Array<{ name?: string }>>('PRAGMA table_info("AccountingHead")')
  const existingColumns = new Set(
    Array.isArray(tableRows) ? tableRows.map((row) => String(row?.name || '').trim()).filter(Boolean) : []
  )

  if (existingColumns.size === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AccountingHead" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "companyId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT '',
        "amount" REAL NOT NULL DEFAULT 0,
        "value" REAL NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
  } else {
    const statements: string[] = []
    if (!existingColumns.has('category')) {
      statements.push(`ALTER TABLE "AccountingHead" ADD COLUMN "category" TEXT NOT NULL DEFAULT ''`)
    }
    if (!existingColumns.has('amount')) {
      statements.push('ALTER TABLE "AccountingHead" ADD COLUMN "amount" REAL NOT NULL DEFAULT 0')
    }
    if (!existingColumns.has('value')) {
      statements.push('ALTER TABLE "AccountingHead" ADD COLUMN "value" REAL NOT NULL DEFAULT 0')
    }

    for (const statement of statements) {
      try {
        await prisma.$executeRawUnsafe(statement)
      } catch (error) {
        if (!isAlreadyAppliedError(error)) {
          throw error
        }
      }
    }
  }

  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "uniq_accounting_heads_company_name" ON "AccountingHead" ("companyId", "name")'
  )
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_accounting_heads_company_category" ON "AccountingHead" ("companyId", "category")'
  )
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS "idx_accounting_heads_company_name" ON "AccountingHead" ("companyId", "name")'
  )
}

export async function ensureAccountingHeadSchema(prisma: AccountingHeadSchemaClient) {
  if (schemaReady) return

  if (!schemaPromise) {
    schemaPromise = applyAccountingHeadSchema(prisma)
      .then(() => {
        schemaReady = true
      })
      .catch((error) => {
        schemaPromise = null
        throw error
      })
  }

  await schemaPromise
}
