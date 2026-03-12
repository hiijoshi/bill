import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting comprehensive database seeding...')

  // Clean existing data
  console.log('🧹 Cleaning existing data...')
  await prisma.payment.deleteMany()
  await prisma.stockLedger.deleteMany()
  await prisma.salesItem.deleteMany()
  await prisma.salesBill.deleteMany()
  await prisma.specialPurchaseItem.deleteMany()
  await prisma.specialPurchaseBill.deleteMany()
  await prisma.purchaseItem.deleteMany()
  await prisma.purchaseBill.deleteMany()
  await prisma.salesItemMaster.deleteMany()
  await prisma.product.deleteMany()
  await prisma.transport.deleteMany()
  await prisma.unit.deleteMany()
  await prisma.supplier.deleteMany()
  await prisma.farmer.deleteMany()
  await prisma.party.deleteMany()
  await prisma.company.deleteMany()
  await prisma.user.deleteMany()
  await prisma.trader.deleteMany()

  // Create Traders
  console.log('👥 Creating traders...')
  const trader1 = await prisma.trader.create({
    data: { id: 'KR', name: 'KR Traders' }
  })

  const trader2 = await prisma.trader.create({
    data: { id: 'trader1', name: 'Trader One Enterprises' }
  })

  // System trader for super-admin user
  const systemTrader = await prisma.trader.create({
    data: { id: 'system', name: 'System' }
  })

  // Create Users with hashed passwords
  console.log('🔐 Creating users...')
  const password1 = await bcrypt.hash('user1234', 10)
  const password2 = await bcrypt.hash('password', 10)

  const user1 = await prisma.user.create({
    data: {
      userId: 'demo_user_1',
      password: password1,
      name: 'Demo User One',
      role: 'company_user',
      traderId: trader1.id,
    },
  })

  const user2 = await prisma.user.create({
    data: {
      userId: 'demo_user_2',
      password: password2,
      name: 'Demo User Two',
      role: 'company_user',
      traderId: trader2.id,
    },
  })

  const user3 = await prisma.user.create({
    data: {
      userId: 'operator',
      password: await bcrypt.hash('operator123', 10),
      name: 'Operator User',
      role: 'company_user',
      traderId: trader1.id,
    },
  })

  // Super-admin user
  console.log('🔑 Creating super-admin user...')
  const superAdminUserId = process.env.SUPER_ADMIN_USER_ID || 'superadmin'
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'super-admin-2026-secure'
  const hashedSuper = await bcrypt.hash(superAdminPassword, 10)
  const superUser = await prisma.user.create({
    data: {
      userId: superAdminUserId,
      password: hashedSuper,
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      traderId: systemTrader.id,
    }
  })

  // Create Companies
  console.log('🏢 Creating companies...')
  const company1 = await prisma.company.create({
    data: {
      name: 'KR Enterprises',
      address: '123 Main Street, Mumbai, Maharashtra 400001',
      phone: '+91-22-23456789',
      traderId: trader1.id,
    },
  })

  const company2 = await prisma.company.create({
    data: {
      name: 'Trader One Company',
      address: '456 Oak Avenue, Pune, Maharashtra 411001',
      phone: '+91-20-34567890',
      traderId: trader2.id,
    },
  })

  // Create Units
  console.log('📏 Creating units...')
  const units = await Promise.all([
    prisma.unit.create({
      data: { companyId: company1.id, name: 'Kilogram', symbol: 'kg', description: 'Kilogram' }
    }),
    prisma.unit.create({
      data: { companyId: company1.id, name: 'Quintal', symbol: 'qt', description: 'Quintal (100 kg)' }
    }),
    prisma.unit.create({
      data: { companyId: company1.id, name: 'Ton', symbol: 'ton', description: 'Metric Ton' }
    }),
    prisma.unit.create({
      data: { companyId: company1.id, name: 'Bag', symbol: 'bag', description: 'Bag (50 kg)' }
    }),
    prisma.unit.create({
      data: { companyId: company2.id, name: 'Kilogram', symbol: 'kg', description: 'Kilogram' }
    }),
    prisma.unit.create({
      data: { companyId: company2.id, name: 'Quintal', symbol: 'qt', description: 'Quintal (100 kg)' }
    }),
  ])

  // Create Products
  console.log('🌾 Creating products...')
  const products = await Promise.all([
    prisma.product.create({
      data: {
        companyId: company1.id,
        name: 'Wheat',
        unitId: units[0].id, // kg
        hsnCode: '1001',
        gstRate: 5,
        sellingPrice: 25.50,
        description: 'Premium quality wheat',
        isActive: true,
      },
    }),
    prisma.product.create({
      data: {
        companyId: company1.id,
        name: 'Rice',
        unitId: units[0].id, // kg
        hsnCode: '1006',
        gstRate: 5,
        sellingPrice: 45.00,
        description: 'Basmati rice',
        isActive: true,
      },
    }),
    prisma.product.create({
      data: {
        companyId: company1.id,
        name: 'Cotton',
        unitId: units[1].id, // qt
        hsnCode: '5201',
        gstRate: 18,
        sellingPrice: 5500.00,
        description: 'Premium cotton',
        isActive: true,
      },
    }),
    prisma.product.create({
      data: {
        companyId: company2.id,
        name: 'Soybean',
        unitId: units[4].id, // kg
        hsnCode: '1201',
        gstRate: 5,
        sellingPrice: 35.75,
        description: 'Soybean seeds',
        isActive: true,
      },
    }),
    prisma.product.create({
      data: {
        companyId: company2.id,
        name: 'Maize',
        unitId: units[5].id, // qt
        hsnCode: '1005',
        gstRate: 5,
        sellingPrice: 2200.00,
        description: 'Yellow maize',
        isActive: true,
      },
    }),
  ])

  // Create Sales Item Masters
  console.log('📋 Creating sales item masters...')
  await Promise.all([
    prisma.salesItemMaster.create({
      data: {
        companyId: company1.id,
        productId: products[0].id, // Wheat
        salesItemName: 'Premium Wheat',
        hsnCode: '1001',
        gstRate: 5,
        sellingPrice: 25.50,
        description: 'Premium quality wheat for direct sale',
        isActive: true,
      },
    }),
    prisma.salesItemMaster.create({
      data: {
        companyId: company1.id,
        productId: products[1].id, // Rice
        salesItemName: 'Basmati Rice Grade A',
        hsnCode: '1006',
        gstRate: 5,
        sellingPrice: 45.00,
        description: 'Premium basmati rice',
        isActive: true,
      },
    }),
    prisma.salesItemMaster.create({
      data: {
        companyId: company2.id,
        productId: products[3].id, // Soybean
        salesItemName: 'Organic Soybean',
        hsnCode: '1201',
        gstRate: 5,
        sellingPrice: 35.75,
        description: 'Certified organic soybean',
        isActive: true,
      },
    }),
  ])

  // Create Farmers
  console.log('👨‍🌾 Creating farmers...')
  const farmers = await Promise.all([
    prisma.farmer.create({
      data: {
        companyId: company1.id,
        name: 'Ramesh Kumar Patel',
        address: 'Village: Amravati, Dist: Ahmedabad, Gujarat',
        phone1: '+91-9876543210',
        phone2: '+91-8765432109',
        ifscCode: 'SBIN0001234',
        bankName: 'State Bank of India',
        accountNo: '1234567890123456',
        krashakAnubandhNumber: 'KA2024001234',
      },
    }),
    prisma.farmer.create({
      data: {
        companyId: company1.id,
        name: 'Sita Devi Sharma',
        address: 'Village: Bhopal, Dist: Bhopal, Madhya Pradesh',
        phone1: '+91-9876543211',
        ifscCode: 'HDFC0005678',
        bankName: 'HDFC Bank',
        accountNo: '5678901234567890',
        krashakAnubandhNumber: 'KA2024005678',
      },
    }),
    prisma.farmer.create({
      data: {
        companyId: company2.id,
        name: 'Mohammed Ali Khan',
        address: 'Village: Hyderabad, Dist: Hyderabad, Telangana',
        phone1: '+91-9876543212',
        phone2: '+91-7654321098',
        ifscCode: 'ICIC0009012',
        bankName: 'ICICI Bank',
        accountNo: '9012345678901234',
        krashakAnubandhNumber: 'KA2024009012',
      },
    }),
  ])

  // Create Parties (Buyers)
  console.log('🏪 Creating parties...')
  const parties = await Promise.all([
    prisma.party.create({
      data: {
        companyId: company1.id,
        type: 'buyer',
        name: 'Mumbai Grain Traders',
        address: 'Market Yard, Mumbai, Maharashtra 400001',
        phone1: '+91-22-23456788',
        phone2: '+91-22-23456789',
        ifscCode: 'UBIN0003456',
        bankName: 'Union Bank of India',
        accountNo: '3456789012345678',
      },
    }),
    prisma.party.create({
      data: {
        companyId: company1.id,
        type: 'buyer',
        name: 'Delhi Wholesale Market',
        address: 'Azadpur Mandi, Delhi 110033',
        phone1: '+91-11-23456789',
        ifscCode: 'PUNB0007890',
        bankName: 'Punjab National Bank',
        accountNo: '7890123456789012',
      },
    }),
    prisma.party.create({
      data: {
        companyId: company2.id,
        type: 'buyer',
        name: 'Bangalore Food Processing',
        address: 'Industrial Area, Bangalore, Karnataka 560001',
        phone1: '+91-80-23456789',
        ifscCode: 'CORP0001234',
        bankName: 'Corporation Bank',
        accountNo: '1234567890123456',
      },
    }),
  ])

  // Create Suppliers
  console.log('🚚 Creating suppliers...')
  const suppliers = await Promise.all([
    prisma.supplier.create({
      data: {
        companyId: company1.id,
        name: 'National Seeds Corporation',
        address: 'New Delhi, Delhi 110001',
        phone1: '+91-11-23456787',
        phone2: '+91-11-23456788',
        ifscCode: 'CANB0001234',
        bankName: 'Canara Bank',
        accountNo: '2345678901234567',
        gstNumber: '07AAACN1234C1ZV',
      },
    }),
    prisma.supplier.create({
      data: {
        companyId: company2.id,
        name: 'Agro Chemicals Ltd',
        address: 'Pune, Maharashtra 411001',
        phone1: '+91-20-23456789',
        ifscCode: 'MAHB0005678',
        bankName: 'Bank of Maharashtra',
        accountNo: '5678901234567890',
        gstNumber: '27AAACG5678C1ZV',
      },
    }),
  ])

  // Create Transport
  console.log('🚛 Creating transport vehicles...')
  const transports = await Promise.all([
    prisma.transport.create({
      data: {
        companyId: company1.id,
        vehicleNumber: 'MH12AB1234',
        transporterName: 'Maharashtra Transport Co.',
        driverName: 'Rajesh Kumar',
        driverPhone: '+91-9876543213',
        capacity: 10,
        freightRate: 5000,
      },
    }),
    prisma.transport.create({
      data: {
        companyId: company1.id,
        vehicleNumber: 'GJ01CD5678',
        transporterName: 'Gujarat Logistics',
        driverName: 'Ahmed Patel',
        driverPhone: '+91-9876543214',
        capacity: 2,
        freightRate: 2000,
      },
    }),
    prisma.transport.create({
      data: {
        companyId: company2.id,
        vehicleNumber: 'KA03EF9012',
        transporterName: 'Karnataka Transport',
        driverName: 'Venkatesh',
        driverPhone: '+91-9876543215',
        capacity: 8,
        freightRate: 4000,
      },
    }),
  ])

  // Create Purchase Bills
  console.log('📄 Creating purchase bills...')
  const purchaseBills = await Promise.all([
    prisma.purchaseBill.create({
      data: {
        companyId: company1.id,
        billNo: 'PUR-2024-001',
        billDate: new Date('2024-01-15'),
        farmerId: farmers[0].id,
        totalAmount: 25500.00,
        paidAmount: 15000.00,
        balanceAmount: 10500.00,
        status: 'partial',
        createdBy: user1.id,
      },
    }),
    prisma.purchaseBill.create({
      data: {
        companyId: company1.id,
        billNo: 'PUR-2024-002',
        billDate: new Date('2024-01-20'),
        farmerId: farmers[1].id,
        totalAmount: 18000.00,
        paidAmount: 0.00,
        balanceAmount: 18000.00,
        status: 'unpaid',
        createdBy: user1.id,
      },
    }),
    prisma.purchaseBill.create({
      data: {
        companyId: company2.id,
        billNo: 'PUR-2024-003',
        billDate: new Date('2024-01-25'),
        farmerId: farmers[2].id,
        totalAmount: 35750.00,
        paidAmount: 35750.00,
        balanceAmount: 0.00,
        status: 'paid',
        createdBy: user2.id,
      },
    }),
  ])

  // Create Purchase Items
  console.log('📦 Creating purchase items...')
  await Promise.all([
    prisma.purchaseItem.create({
      data: {
        purchaseBillId: purchaseBills[0].id,
        productId: products[0].id, // Wheat
        qty: 1000.0, // kg
        rate: 25.50,
        hammali: 500.00,
        bags: 20,
        markaNo: 'MK001',
        amount: 25500.00,
      },
    }),
    prisma.purchaseItem.create({
      data: {
        purchaseBillId: purchaseBills[1].id,
        productId: products[1].id, // Rice
        qty: 400.0, // kg
        rate: 45.00,
        hammali: 0.00,
        bags: 8,
        markaNo: 'MK002',
        amount: 18000.00,
      },
    }),
    prisma.purchaseItem.create({
      data: {
        purchaseBillId: purchaseBills[2].id,
        productId: products[3].id, // Soybean
        qty: 1000.0, // kg
        rate: 35.75,
        hammali: 0.00,
        bags: 20,
        markaNo: 'MK003',
        amount: 35750.00,
      },
    }),
  ])

  // Create Special Purchase Bills
  console.log('📋 Creating special purchase bills...')
  const specialPurchaseBills = await Promise.all([
    prisma.specialPurchaseBill.create({
      data: {
        companyId: company1.id,
        supplierInvoiceNo: 'SUP-2024-001',
        billDate: new Date('2024-01-10'),
        supplierId: suppliers[0].id,
        totalAmount: 55000.00,
        paidAmount: 27500.00,
        balanceAmount: 27500.00,
        status: 'partial',
        createdBy: user1.id,
      },
    }),
    prisma.specialPurchaseBill.create({
      data: {
        companyId: company2.id,
        supplierInvoiceNo: 'SUP-2024-002',
        billDate: new Date('2024-01-22'),
        supplierId: suppliers[1].id,
        totalAmount: 44000.00,
        paidAmount: 0.00,
        balanceAmount: 44000.00,
        status: 'unpaid',
        createdBy: user2.id,
      },
    }),
  ])

  // Create Special Purchase Items
  console.log('📦 Creating special purchase items...')
  await Promise.all([
    prisma.specialPurchaseItem.create({
      data: {
        specialPurchaseBillId: specialPurchaseBills[0].id,
        productId: products[2].id, // Cotton
        noOfBags: 10,
        weight: 10.0, // qt
        rate: 5500.00,
        netAmount: 55000.00,
        otherAmount: 0.00,
        grossAmount: 55000.00,
      },
    }),
    prisma.specialPurchaseItem.create({
      data: {
        specialPurchaseBillId: specialPurchaseBills[1].id,
        productId: products[4].id, // Maize
        noOfBags: 20,
        weight: 20.0, // qt
        rate: 2200.00,
        netAmount: 44000.00,
        otherAmount: 0.00,
        grossAmount: 44000.00,
      },
    }),
  ])

  // Create Sales Bills
  console.log('💰 Creating sales bills...')
  const salesBills = await Promise.all([
    prisma.salesBill.create({
      data: {
        companyId: company1.id,
        billNo: 'SAL-2024-001',
        billDate: new Date('2024-01-18'),
        partyId: parties[0].id,
        totalAmount: 30000.00,
        receivedAmount: 15000.00,
        balanceAmount: 15000.00,
        status: 'partial',
        createdBy: user1.id,
      },
    }),
    prisma.salesBill.create({
      data: {
        companyId: company1.id,
        billNo: 'SAL-2024-002',
        billDate: new Date('2024-01-25'),
        partyId: parties[1].id,
        totalAmount: 22500.00,
        receivedAmount: 22500.00,
        balanceAmount: 0.00,
        status: 'paid',
        createdBy: user1.id,
      },
    }),
    prisma.salesBill.create({
      data: {
        companyId: company2.id,
        billNo: 'SAL-2024-003',
        billDate: new Date('2024-01-28'),
        partyId: parties[2].id,
        totalAmount: 35750.00,
        receivedAmount: 0.00,
        balanceAmount: 35750.00,
        status: 'unpaid',
        createdBy: user2.id,
      },
    }),
  ])

  // Create Sales Items
  console.log('📦 Creating sales items...')
  await Promise.all([
    prisma.salesItem.create({
      data: {
        salesBillId: salesBills[0].id,
        productId: products[0].id, // Wheat
        weight: 1200.0, // kg
        bags: 24,
        rate: 25.00,
        amount: 30000.00,
      },
    }),
    prisma.salesItem.create({
      data: {
        salesBillId: salesBills[1].id,
        productId: products[1].id, // Rice
        weight: 500.0, // kg
        bags: 10,
        rate: 45.00,
        amount: 22500.00,
      },
    }),
    prisma.salesItem.create({
      data: {
        salesBillId: salesBills[2].id,
        productId: products[3].id, // Soybean
        weight: 1000.0, // kg
        bags: 20,
        rate: 35.75,
        amount: 35750.00,
      },
    }),
  ])

  // Create Stock Ledger Entries
  console.log('📊 Creating stock ledger entries...')
  await Promise.all([
    // Purchase entries (stock in)
    prisma.stockLedger.create({
      data: {
        companyId: company1.id,
        entryDate: new Date('2024-01-15'),
        productId: products[0].id, // Wheat
        type: 'purchase',
        qtyIn: 1000.0,
        qtyOut: 0.0,
        refTable: 'purchase_bills',
        refId: purchaseBills[0].id,
      },
    }),
    prisma.stockLedger.create({
      data: {
        companyId: company1.id,
        entryDate: new Date('2024-01-20'),
        productId: products[1].id, // Rice
        type: 'purchase',
        qtyIn: 400.0,
        qtyOut: 0.0,
        refTable: 'purchase_bills',
        refId: purchaseBills[1].id,
      },
    }),
    // Sales entries (stock out)
    prisma.stockLedger.create({
      data: {
        companyId: company1.id,
        entryDate: new Date('2024-01-18'),
        productId: products[0].id, // Wheat
        type: 'sales',
        qtyIn: 0.0,
        qtyOut: 1200.0,
        refTable: 'sales_bills',
        refId: salesBills[0].id,
      },
    }),
    prisma.stockLedger.create({
      data: {
        companyId: company1.id,
        entryDate: new Date('2024-01-25'),
        productId: products[1].id, // Rice
        type: 'sales',
        qtyIn: 0.0,
        qtyOut: 500.0,
        refTable: 'sales_bills',
        refId: salesBills[1].id,
      },
    }),
  ])

  // Create Payments
  console.log('💳 Creating payments...')
  await Promise.all([
    // Purchase payments
    prisma.payment.create({
      data: {
        companyId: company1.id,
        farmerId: farmers[0].id,
        billType: 'purchase',
        billId: purchaseBills[0].id,
        billDate: purchaseBills[0].billDate,
        payDate: new Date('2024-01-16'),
        amount: 15000.00,
        mode: 'bank',
        txnRef: 'NEFT/R/20240116/001',
        note: 'Partial payment for wheat purchase',
      },
    }),
    prisma.payment.create({
      data: {
        companyId: company2.id,
        farmerId: farmers[2].id,
        billType: 'purchase',
        billId: purchaseBills[2].id,
        billDate: purchaseBills[2].billDate,
        payDate: new Date('2024-01-26'),
        amount: 35750.00,
        mode: 'cash',
        note: 'Full payment for soybean purchase',
      },
    }),
    // Sales receipts
    prisma.payment.create({
      data: {
        companyId: company1.id,
        partyId: parties[0].id,
        billType: 'sales',
        billId: salesBills[0].id,
        billDate: salesBills[0].billDate,
        payDate: new Date('2024-01-19'),
        amount: 15000.00,
        mode: 'online',
        txnRef: 'UPI/20240119/001',
        note: 'Partial payment received',
      },
    }),
    prisma.payment.create({
      data: {
        companyId: company1.id,
        partyId: parties[1].id,
        billType: 'sales',
        billId: salesBills[1].id,
        billDate: salesBills[1].billDate,
        payDate: new Date('2024-01-26'),
        amount: 22500.00,
        mode: 'bank',
        txnRef: 'RTGS/20240126/001',
        note: 'Full payment received',
      },
    }),
  ])

  console.log('✅ Database seeding completed successfully!')
  console.log('\n📊 Summary of created records:')
  console.log(`👥 Traders: 2`)
  console.log(`🔐 Users: 3`)
  console.log(`🏢 Companies: 2`)
  console.log(`📏 Units: 6`)
  console.log(`🌾 Products: 5`)
  console.log(`📋 Sales Item Masters: 3`)
  console.log(`👨‍🌾 Farmers: 3`)
  console.log(`🏪 Parties: 3`)
  console.log(`🚚 Suppliers: 2`)
  console.log(`🚛 Transport Vehicles: 3`)
  console.log(`📄 Purchase Bills: 3`)
  console.log(`📦 Purchase Items: 3`)
  console.log(`📋 Special Purchase Bills: 2`)
  console.log(`📦 Special Purchase Items: 2`)
  console.log(`💰 Sales Bills: 3`)
  console.log(`📦 Sales Items: 3`)
  console.log(`📊 Stock Ledger Entries: 4`)
  console.log(`💳 Payments: 4`)
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
