import type { PrismaClient } from '@prisma/client'

type PartyOpeningBalanceSchemaClient = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>

let schemaReady = false
let schemaPromise: Promise<void> | null = null

function isAlreadyAppliedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  const normalized = message.toLowerCase()
  return normalized.includes('duplicate column') || normalized.includes('already exists')
}

async function applyPartyOpeningBalanceSchema(prisma: PartyOpeningBalanceSchemaClient) {
  const rows = await prisma.$queryRawUnsafe<Array<{ name?: string }>>('PRAGMA table_info("Party")')
  const existingColumns = new Set(
    Array.isArray(rows) ? rows.map((row) => String(row?.name || '').trim()).filter(Boolean) : []
  )

  const statements: string[] = []
  if (!existingColumns.has('openingBalance')) {
    statements.push('ALTER TABLE "Party" ADD COLUMN "openingBalance" REAL NOT NULL DEFAULT 0')
  }
  if (!existingColumns.has('openingBalanceType')) {
    statements.push(`ALTER TABLE "Party" ADD COLUMN "openingBalanceType" TEXT NOT NULL DEFAULT 'receivable'`)
  }
  if (!existingColumns.has('openingBalanceDate')) {
    statements.push('ALTER TABLE "Party" ADD COLUMN "openingBalanceDate" DATETIME')
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

export async function ensurePartyOpeningBalanceSchema(prisma: PartyOpeningBalanceSchemaClient) {
  if (schemaReady) return

  if (!schemaPromise) {
    schemaPromise = applyPartyOpeningBalanceSchema(prisma)
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
