import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function addPerformanceIndexes() {
  try {
    console.log('Adding performance indexes to database...')

    // Companies indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_companies_trader_id ON companies(traderId)`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name)`

    // Transactions indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_purchase_bills_company_date ON purchase_bills(companyId, billDate)`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_sales_bills_company_date ON sales_bills(companyId, billDate)`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_payments_bill_type ON payments(billType, billId)`

    // Stock indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_stock_ledger_product_date ON stock_ledger(productId, entryDate)`

    // Party/Farmer indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_parties_company_type ON parties(companyId, type)`
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_farmers_company ON farmers(companyId)`

    // Product indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_products_company_active ON products(companyId, isActive)`

    // Payment indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_payments_company_date ON payments(companyId, payDate)`

    // Transport indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_transport_bills_sales_bill ON transport_bills(salesBillId)`

    console.log('✅ All performance indexes added successfully!')
  } catch (error) {
    console.error('❌ Error adding indexes:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run if called directly
if (require.main === module) {
  addPerformanceIndexes()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
}

export { addPerformanceIndexes }
