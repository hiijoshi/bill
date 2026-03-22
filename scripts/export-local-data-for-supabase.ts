import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const exportedAt = new Date().toISOString()
  const stamp = exportedAt.replace(/[:.]/g, '-')
  const outputDir = path.join(process.cwd(), 'migration-data')
  await mkdir(outputDir, { recursive: true })

  const [
    traders,
    companies,
    users,
    userPermissions,
    parties,
    farmers,
    suppliers,
    units,
    products,
    salesItemMasters,
    purchaseBills,
    purchaseItems,
    specialPurchaseBills,
    specialPurchaseItems,
    salesBills,
    salesItems,
    stockLedger,
    payments,
    auditLogs,
    transports,
    banks,
    markas,
    paymentModes,
    transportBills
  ] = await Promise.all([
    prisma.trader.findMany(),
    prisma.company.findMany(),
    prisma.user.findMany(),
    prisma.userPermission.findMany(),
    prisma.party.findMany(),
    prisma.farmer.findMany(),
    prisma.supplier.findMany(),
    prisma.unit.findMany(),
    prisma.product.findMany(),
    prisma.salesItemMaster.findMany(),
    prisma.purchaseBill.findMany(),
    prisma.purchaseItem.findMany(),
    prisma.specialPurchaseBill.findMany(),
    prisma.specialPurchaseItem.findMany(),
    prisma.salesBill.findMany(),
    prisma.salesItem.findMany(),
    prisma.stockLedger.findMany(),
    prisma.payment.findMany(),
    prisma.auditLog.findMany(),
    prisma.transport.findMany(),
    prisma.bank.findMany(),
    prisma.marka.findMany(),
    prisma.paymentMode.findMany(),
    prisma.transportBill.findMany()
  ])

  const payload = {
    meta: {
      exportedAt,
      source: 'local-prisma-sqlite',
      note: 'One-time export from the current local Prisma database before Supabase import.',
      counts: {
        traders: traders.length,
        companies: companies.length,
        users: users.length,
        userPermissions: userPermissions.length,
        parties: parties.length,
        farmers: farmers.length,
        suppliers: suppliers.length,
        units: units.length,
        products: products.length,
        salesItemMasters: salesItemMasters.length,
        purchaseBills: purchaseBills.length,
        purchaseItems: purchaseItems.length,
        specialPurchaseBills: specialPurchaseBills.length,
        specialPurchaseItems: specialPurchaseItems.length,
        salesBills: salesBills.length,
        salesItems: salesItems.length,
        stockLedger: stockLedger.length,
        payments: payments.length,
        auditLogs: auditLogs.length,
        transports: transports.length,
        banks: banks.length,
        markas: markas.length,
        paymentModes: paymentModes.length,
        transportBills: transportBills.length
      }
    },
    data: {
      traders,
      companies,
      users,
      userPermissions,
      parties,
      farmers,
      suppliers,
      units,
      products,
      salesItemMasters,
      purchaseBills,
      purchaseItems,
      specialPurchaseBills,
      specialPurchaseItems,
      salesBills,
      salesItems,
      stockLedger,
      payments,
      auditLogs,
      transports,
      banks,
      markas,
      paymentModes,
      transportBills
    }
  }

  const outputPath = path.join(outputDir, `sqlite-export-for-supabase-${stamp}.json`)
  await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8')

  console.log(`Export complete: ${outputPath}`)
  console.log(JSON.stringify(payload.meta.counts, null, 2))
}

main()
  .catch((error) => {
    console.error('Failed to export local data for Supabase migration')
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
