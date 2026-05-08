import type { PrismaClient } from '@prisma/client'

type SalesItemSchemaClient = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>

let schemaReady = false
let schemaPromise: Promise<void> | null = null

function isSqliteLikeDatabase(): boolean {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim().toLowerCase()

  return Boolean(databaseUrl.startsWith('file:'))
}

function isAlreadyAppliedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  const normalized = message.toLowerCase()
  return normalized.includes('already exists') || normalized.includes('duplicate column')
}

async function applySalesItemSchema(prisma: SalesItemSchemaClient) {
  if (!isSqliteLikeDatabase()) {
    return
  }

  const tableRows = await prisma.$queryRawUnsafe<Array<{ name?: string }>>('PRAGMA table_info("SalesItem")')
  const existingColumns = new Set(
    Array.isArray(tableRows) ? tableRows.map((row) => String(row?.name || '').trim()).filter(Boolean) : []
  )

  if (existingColumns.size === 0) {
    return
  }

  const statements: string[] = []
  if (!existingColumns.has('salesItemName')) {
    statements.push('ALTER TABLE "SalesItem" ADD COLUMN "salesItemName" TEXT')
  }
  if (!existingColumns.has('markaNo')) {
    statements.push('ALTER TABLE "SalesItem" ADD COLUMN "markaNo" TEXT')
  }
  if (!existingColumns.has('bags')) {
    statements.push('ALTER TABLE "SalesItem" ADD COLUMN "bags" INTEGER')
  }
  if (!existingColumns.has('taxableAmount')) {
    statements.push('ALTER TABLE "SalesItem" ADD COLUMN "taxableAmount" REAL NOT NULL DEFAULT 0')
  }
  if (!existingColumns.has('gstRateSnapshot')) {
    statements.push('ALTER TABLE "SalesItem" ADD COLUMN "gstRateSnapshot" REAL')
  }
  if (!existingColumns.has('gstAmount')) {
    statements.push('ALTER TABLE "SalesItem" ADD COLUMN "gstAmount" REAL NOT NULL DEFAULT 0')
  }
  if (!existingColumns.has('lineTotal')) {
    statements.push('ALTER TABLE "SalesItem" ADD COLUMN "lineTotal" REAL NOT NULL DEFAULT 0')
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

export async function ensureSalesItemSchema(prisma: SalesItemSchemaClient) {
  if (schemaReady) return

  if (!schemaPromise) {
    schemaPromise = applySalesItemSchema(prisma)
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
