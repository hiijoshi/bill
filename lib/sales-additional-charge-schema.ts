import type { PrismaClient } from '@prisma/client'

type SalesAdditionalChargeSchemaClient = Pick<PrismaClient, '$executeRawUnsafe'>

let schemaReady = false
let schemaPromise: Promise<void> | null = null

async function applySalesAdditionalChargeSchema(prisma: SalesAdditionalChargeSchemaClient) {
  const statements = [
    `
      CREATE TABLE IF NOT EXISTS "SalesAdditionalCharge" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "companyId" TEXT NOT NULL,
        "salesBillId" TEXT NOT NULL,
        "transportBillId" TEXT,
        "chargeType" TEXT NOT NULL,
        "amount" REAL NOT NULL DEFAULT 0,
        "remark" TEXT,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY ("salesBillId") REFERENCES "SalesBill" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY ("transportBillId") REFERENCES "TransportBill" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `,
    'CREATE INDEX IF NOT EXISTS "idx_sales_additional_charges_company_bill" ON "SalesAdditionalCharge" ("companyId", "salesBillId")',
    'CREATE INDEX IF NOT EXISTS "idx_sales_additional_charges_transport" ON "SalesAdditionalCharge" ("transportBillId")',
    'CREATE INDEX IF NOT EXISTS "idx_sales_additional_charges_sort" ON "SalesAdditionalCharge" ("salesBillId", "sortOrder")'
  ]

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement)
  }
}

export async function ensureSalesAdditionalChargeSchema(prisma: SalesAdditionalChargeSchemaClient) {
  if (schemaReady) return

  if (!schemaPromise) {
    schemaPromise = applySalesAdditionalChargeSchema(prisma)
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
