import type { PrismaClient } from '@prisma/client'

type MandiSchemaClient = Pick<PrismaClient, '$executeRawUnsafe'>

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

async function applyMandiSchema(prisma: MandiSchemaClient) {
  if (!isSqliteLikeDatabase()) {
    return
  }

  const statements = [
    `
      CREATE TABLE IF NOT EXISTS "MandiType" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "companyId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS "PartyMandiProfile" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "partyId" TEXT NOT NULL UNIQUE,
        "mandiTypeId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY ("mandiTypeId") REFERENCES "MandiType" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS "FarmerMandiProfile" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "farmerId" TEXT NOT NULL UNIQUE,
        "mandiTypeId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("farmerId") REFERENCES "Farmer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY ("mandiTypeId") REFERENCES "MandiType" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS "AccountingHeadMandiConfig" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "accountingHeadId" TEXT NOT NULL UNIQUE,
        "mandiTypeId" TEXT,
        "isMandiCharge" BOOLEAN NOT NULL DEFAULT false,
        "calculationBasis" TEXT,
        "defaultValue" REAL NOT NULL DEFAULT 0,
        "accountGroup" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("accountingHeadId") REFERENCES "AccountingHead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY ("mandiTypeId") REFERENCES "MandiType" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS "BillCharge" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "companyId" TEXT NOT NULL,
        "billType" TEXT NOT NULL,
        "billId" TEXT NOT NULL,
        "accountingHeadId" TEXT,
        "mandiTypeId" TEXT,
        "nameSnapshot" TEXT NOT NULL,
        "categorySnapshot" TEXT,
        "calculationBasis" TEXT,
        "basisValue" REAL NOT NULL DEFAULT 0,
        "chargeAmount" REAL NOT NULL DEFAULT 0,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY ("accountingHeadId") REFERENCES "AccountingHead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        FOREIGN KEY ("mandiTypeId") REFERENCES "MandiType" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS "LedgerEntry" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "companyId" TEXT NOT NULL,
        "entryDate" DATETIME NOT NULL,
        "billType" TEXT NOT NULL,
        "billId" TEXT NOT NULL,
        "direction" TEXT NOT NULL,
        "amount" REAL NOT NULL DEFAULT 0,
        "partyId" TEXT,
        "farmerId" TEXT,
        "accountingHeadId" TEXT,
        "accountHeadNameSnapshot" TEXT,
        "accountGroupSnapshot" TEXT,
        "counterpartyNameSnapshot" TEXT,
        "note" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        FOREIGN KEY ("farmerId") REFERENCES "Farmer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        FOREIGN KEY ("accountingHeadId") REFERENCES "AccountingHead" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `,
    'CREATE UNIQUE INDEX IF NOT EXISTS "uniq_mandi_types_company_name" ON "MandiType" ("companyId", "name")',
    'CREATE INDEX IF NOT EXISTS "idx_mandi_types_company_active" ON "MandiType" ("companyId", "isActive")',
    'CREATE INDEX IF NOT EXISTS "idx_party_mandi_profiles_mandi_type" ON "PartyMandiProfile" ("mandiTypeId")',
    'CREATE INDEX IF NOT EXISTS "idx_farmer_mandi_profiles_mandi_type" ON "FarmerMandiProfile" ("mandiTypeId")',
    'CREATE INDEX IF NOT EXISTS "idx_accounting_head_mandi_config_type_charge" ON "AccountingHeadMandiConfig" ("mandiTypeId", "isMandiCharge")',
    'CREATE INDEX IF NOT EXISTS "idx_bill_charges_company_bill" ON "BillCharge" ("companyId", "billType", "billId")',
    'CREATE INDEX IF NOT EXISTS "idx_bill_charges_head" ON "BillCharge" ("accountingHeadId")',
    'CREATE INDEX IF NOT EXISTS "idx_ledger_entries_company_date" ON "LedgerEntry" ("companyId", "entryDate")',
    'CREATE INDEX IF NOT EXISTS "idx_ledger_entries_bill" ON "LedgerEntry" ("billType", "billId")',
    'CREATE INDEX IF NOT EXISTS "idx_ledger_entries_party" ON "LedgerEntry" ("partyId")',
    'CREATE INDEX IF NOT EXISTS "idx_ledger_entries_farmer" ON "LedgerEntry" ("farmerId")',
    'CREATE INDEX IF NOT EXISTS "idx_ledger_entries_head" ON "LedgerEntry" ("accountingHeadId")'
  ]

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement)
  }
}

export async function ensureMandiSchema(prisma: MandiSchemaClient) {
  if (schemaReady) return

  if (!schemaPromise) {
    schemaPromise = applyMandiSchema(prisma)
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
