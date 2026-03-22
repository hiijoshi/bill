import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Creating sample data for testing...')

  try {
    // Create Trader
    const trader = await prisma.trader.create({
      data: {
        name: 'Mandi Trader'
      }
    })

    // Create Company
    const company = await prisma.company.create({
      data: {
        traderId: trader.id,
        name: 'Mandi Traders Ltd',
        address: 'Shop No. 1, Grain Market',
        phone: '022-2345-6789'
      }
    })

    // Create Units
    const unitQt = await prisma.unit.create({
      data: {
        companyId: company.id,
        name: 'Quintal',
        symbol: 'Qt',
        description: '100 kg unit'
      }
    })

    await prisma.unit.create({
      data: {
        companyId: company.id,
        name: 'Kilogram',
        symbol: 'Kg',
        description: 'Weight unit'
      }
    })

    // Create Products
    const productWheat = await prisma.product.create({
      data: {
        companyId: company.id,
        name: 'Wheat',
        unitId: unitQt.id,
        hsnCode: '1001',
        gstRate: 5,
        sellingPrice: 2500,
        description: 'Premium Wheat'
      }
    })

    const productRice = await prisma.product.create({
      data: {
        companyId: company.id,
        name: 'Rice',
        unitId: unitQt.id,
        hsnCode: '1006',
        gstRate: 5,
        sellingPrice: 3000,
        description: 'Basmati Rice'
      }
    })

    // Create Sales Item Masters
    await prisma.salesItemMaster.create({
      data: {
        companyId: company.id,
        productId: productWheat.id,
        salesItemName: 'Wheat - Premium',
        hsnCode: '1001',
        gstRate: 5,
        sellingPrice: 2500,
        description: 'Premium quality wheat'
      }
    })

    await prisma.salesItemMaster.create({
      data: {
        companyId: company.id,
        productId: productRice.id,
        salesItemName: 'Rice - Basmati',
        hsnCode: '1006',
        gstRate: 5,
        sellingPrice: 3000,
        description: 'Premium basmati rice'
      }
    })

    // Create Parties
    const party1 = await prisma.party.create({
      data: {
        companyId: company.id,
        type: 'buyer',
        name: 'ABC Grain Merchants',
        address: '123 Market Street, Shop No. 5',
        phone1: '9876543211',
        phone2: '9876543212',
        ifscCode: 'ABCD0123456',
        bankName: 'State Bank of India',
        accountNo: '1234567890'
      }
    })

    const party2 = await prisma.party.create({
      data: {
        companyId: company.id,
        type: 'buyer',
        name: 'XYZ Traders',
        address: '456 Market Road, Warehouse Area',
        phone1: '9876543213',
        ifscCode: 'EFGH7890123',
        bankName: 'Punjab National Bank',
        accountNo: '9876543210'
      }
    })

    // Create Sample Sales Bill
    const salesBill = await prisma.salesBill.create({
      data: {
        companyId: company.id,
        billNo: 'SAL-001',
        billDate: new Date('2024-02-11'),
        partyId: party1.id,
        totalAmount: 50000,
        receivedAmount: 0,
        balanceAmount: 50000,
        status: 'unpaid'
      }
    })

    // Create Sales Items for the bill
    await prisma.salesItem.create({
      data: {
        salesBillId: salesBill.id,
        productId: productWheat.id,
        weight: 20, // 20 Qt = 2000 kg
        bags: 100, // 100 bags
        rate: 2500, // ₹2500 per Qt
        amount: 50000 // 20 Qt × ₹2500 = ₹50000
      }
    })

    await prisma.salesItem.create({
      data: {
        salesBillId: salesBill.id,
        productId: productRice.id,
        weight: 10, // 10 Qt = 1000 kg
        bags: 50, // 50 bags
        rate: 3000, // ₹3000 per Qt
        amount: 30000 // 10 Qt × ₹3000 = ₹30000
      }
    })

    // Create Transport Bill for the sales bill
    await prisma.transportBill.create({
      data: {
        salesBillId: salesBill.id,
        transportName: 'Fast Transport Services',
        lorryNo: 'MH12AB1234',
        freightPerQt: 50, // ₹50 per Qt
        freightAmount: 1500, // 30 Qt × ₹50 = ₹1500
        advance: 5000, // ₹5000 advance
        toPay: -3500 // ₹1500 - ₹5000 = -₹3500 (negative means transport gets money)
      }
    })

    console.log('✅ Sample data created successfully!')
    console.log('📊 Created:')
    console.log(`  - Trader: ${trader.name}`)
    console.log(`  - Company: ${company.name}`)
    console.log(`  - Products: ${productWheat.name}, ${productRice.name}`)
    console.log(`  - Parties: ${party1.name}, ${party2.name}`)
    console.log(`  - Sales Bill: ${salesBill.billNo} (₹${salesBill.totalAmount})`)
    console.log(`  - Sales Items: 2 items (₹${salesBill.totalAmount})`)
    console.log(`  - Transport Bill: ${'MH12AB1234'}`)

  } catch (error) {
    console.error('❌ Error creating sample data:', error)
    throw error
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log('🔌 Database connection closed')
  })
