const { PrismaClient } = require('@prisma/client')

;(async () => {
  const prisma = new PrismaClient()
  try {
    console.log('🔄 Clearing all data...')
    await prisma.$transaction([
      prisma.payment.deleteMany(),
      prisma.stockLedger.deleteMany(),
      prisma.salesItem.deleteMany(),
      prisma.purchaseItem.deleteMany(),
      prisma.specialPurchaseItem.deleteMany(),
      prisma.specialPurchaseBill.deleteMany(),
      prisma.salesBill.deleteMany(),
      prisma.purchaseBill.deleteMany(),
      prisma.salesItemMaster.deleteMany(),
      prisma.transport.deleteMany(),
      prisma.product.deleteMany(),
      prisma.party.deleteMany(),
      prisma.farmer.deleteMany(),
      prisma.supplier.deleteMany(),
      prisma.company.deleteMany(),
      prisma.unit.deleteMany(),
      prisma.user.deleteMany(),
      prisma.trader.deleteMany()
    ])
    console.log('✅ All tables truncated.')
  } catch (error) {
    console.error('❌ Failed to clear data:', error)
  } finally {
    await prisma.$disconnect()
  }
})()
