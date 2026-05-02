import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Creating sample data for testing...')

  try {
    // Upsert Trader (avoid duplicates on re-run)
    const trader = await prisma.trader.upsert({
      where: { id: 'mandi-trader-seed' },
      update: {
        name: 'Mandi Trader'
      },
      create: {
        id: 'mandi-trader-seed',
        name: 'Mandi Trader'
      }
    })

    console.log('✅ Trader upserted:', trader.name)

    // Upsert Company
    const company = await prisma.company.upsert({
      where: { id: 'mandi-traders-seed' },
      update: {
        traderId: trader.id,
        name: 'Mandi Traders Ltd',
        address: 'Shop No. 1, Grain Market',
        phone: '022-2345-6789'
      },
      create: {
        id: 'mandi-traders-seed',
        traderId: trader.id,
        name: 'Mandi Traders Ltd',
        address: 'Shop No. 1, Grain Market',
        phone: '022-2345-6789'
      }
    })

    console.log('✅ Company upserted:', company.name)

    // Upsert Units (unique constraint: companyId, symbol)
    const unitQt = await prisma.unit.upsert({
      where: {
        companyId_symbol: {
          companyId: company.id,
          symbol: 'Qt'
        }
      },
      update: {
        name: 'Quintal',
        description: '100 kg unit'
      },
      create: {
        companyId: company.id,
        name: 'Quintal',
        symbol: 'Qt',
        description: '100 kg unit'
      }
    })

    await prisma.unit.upsert({
      where: {
        companyId_symbol: {
          companyId: company.id,
          symbol: 'Kg'
        }
      },
      update: {
        name: 'Kilogram',
        description: 'Weight unit'
      },
      create: {
        companyId: company.id,
        name: 'Kilogram',
        symbol: 'Kg',
        description: 'Weight unit'
      }
    })

    console.log('✅ Units upserted')

    // Upsert Products (unique constraint: companyId, name)
    const productWheat = await prisma.product.upsert({
      where: {
        companyId_name: {
          companyId: company.id,
          name: 'Wheat'
        }
      },
      update: {
        unitId: unitQt.id,
        hsnCode: '1001',
        gstRate: 5,
        sellingPrice: 2500,
        description: 'Premium Wheat'
      },
      create: {
        companyId: company.id,
        name: 'Wheat',
        unitId: unitQt.id,
        hsnCode: '1001',
        gstRate: 5,
        sellingPrice: 2500,
        description: 'Premium Wheat'
      }
    })

    const productRice = await prisma.product.upsert({
      where: {
        companyId_name: {
          companyId: company.id,
          name: 'Rice'
        }
      },
      update: {
        unitId: unitQt.id,
        hsnCode: '1006',
        gstRate: 5,
        sellingPrice: 3000,
        description: 'Basmati Rice'
      },
      create: {
        companyId: company.id,
        name: 'Rice',
        unitId: unitQt.id,
        hsnCode: '1006',
        gstRate: 5,
        sellingPrice: 3000,
        description: 'Basmati Rice'
      }
    })

    console.log('✅ Products upserted:', productWheat.name, productRice.name)

    // Upsert Sales Item Masters
    await prisma.salesItemMaster.upsert({
      where: {
        companyId_salesItemName: {
          companyId: company.id,
          salesItemName: 'Wheat - Premium'
        }
      },
      update: {
        productId: productWheat.id,
        hsnCode: '1001',
        gstRate: 5,
        sellingPrice: 2500,
        description: 'Premium quality wheat'
      },
      create: {
        companyId: company.id,
        productId: productWheat.id,
        salesItemName: 'Wheat - Premium',
        hsnCode: '1001',
        gstRate: 5,
        sellingPrice: 2500,
        description: 'Premium quality wheat'
      }
    })

    await prisma.salesItemMaster.upsert({
      where: {
        companyId_salesItemName: {
          companyId: company.id,
          salesItemName: 'Rice - Basmati'
        }
      },
      update: {
        productId: productRice.id,
        hsnCode: '1006',
        gstRate: 5,
        sellingPrice: 3000,
        description: 'Premium basmati rice'
      },
      create: {
        companyId: company.id,
        productId: productRice.id,
        salesItemName: 'Rice - Basmati',
        hsnCode: '1006',
        gstRate: 5,
        sellingPrice: 3000,
        description: 'Premium basmati rice'
      }
    })

    console.log('✅ Sales Item Masters upserted')

    // Upsert Parties (unique constraint: companyId, name)
    const party1 = await prisma.party.upsert({
      where: {
        companyId_name: {
          companyId: company.id,
          name: 'ABC Grain Merchants'
        }
      },
      update: {
        type: 'buyer',
        address: '123 Market Street, Shop No. 5',
        phone1: '9876543211',
        phone2: '9876543212',
        ifscCode: 'ABCD0123456',
        bankName: 'State Bank of India',
        accountNo: '1234567890'
      },
      create: {
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

    const party2 = await prisma.party.upsert({
      where: {
        companyId_name: {
          companyId: company.id,
          name: 'XYZ Traders'
        }
      },
      update: {
        type: 'buyer',
        address: '456 Market Road, Warehouse Area',
        phone1: '9876543213',
        ifscCode: 'EFGH7890123',
        bankName: 'Punjab National Bank',
        accountNo: '9876543210'
      },
      create: {
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

    console.log('✅ Parties upserted:', party1.name, party2.name)

    // Upsert Sample Sales Bill (unique constraint: companyId, billNo)
    const salesBill = await prisma.salesBill.upsert({
      where: {
        companyId_billNo: {
          companyId: company.id,
          billNo: 'SAL-001'
        }
      },
      update: {
        billDate: new Date('2024-02-11'),
        partyId: party1.id,
        totalAmount: 50000,
        receivedAmount: 0,
        balanceAmount: 50000,
        status: 'unpaid'
      },
      create: {
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

    console.log('✅ Sales Bill upserted:', salesBill.billNo)

    // Delete existing sales items for this bill to avoid duplicates on re-run
    await prisma.salesItem.deleteMany({
      where: {
        salesBillId: salesBill.id
      }
    })

    // Create Sales Items for the bill (these are transactional, no unique constraint)
    await prisma.salesItem.create({
      data: {
        salesBillId: salesBill.id,
        productId: productWheat.id,
        weight: 20,
        bags: 100,
        rate: 2500,
        amount: 50000
      }
    })

    await prisma.salesItem.create({
      data: {
        salesBillId: salesBill.id,
        productId: productRice.id,
        weight: 10,
        bags: 50,
        rate: 3000,
        amount: 30000
      }
    })

    console.log('✅ Sales Items created')

    // Upsert Transport Bill
    const existingTransport = await prisma.transportBill.findFirst({
      where: {
        salesBillId: salesBill.id
      }
    })

    if (existingTransport) {
      await prisma.transportBill.update({
        where: {
          id: existingTransport.id
        },
        data: {
          transportName: 'Fast Transport Services',
          lorryNo: 'MH12AB1234',
          freightPerQt: 50,
          freightAmount: 1500,
          advance: 5000,
          toPay: -3500
        }
      })
    } else {
      await prisma.transportBill.create({
        data: {
          salesBillId: salesBill.id,
          transportName: 'Fast Transport Services',
          lorryNo: 'MH12AB1234',
          freightPerQt: 50,
          freightAmount: 1500,
          advance: 5000,
          toPay: -3500
        }
      })
    }

    console.log('✅ Transport Bill upserted')

    console.log('✅ Sample data created successfully!')
    console.log('📊 Summary:')
    console.log(`  - Trader: ${trader.name}`)
    console.log(`  - Company: ${company.name}`)
    console.log(`  - Products: ${productWheat.name}, ${productRice.name}`)
    console.log(`  - Parties: ${party1.name}, ${party2.name}`)
    console.log(`  - Sales Bill: ${salesBill.billNo} (₹${salesBill.totalAmount})`)
    console.log(`  - Sales Items: 2 items`)
    console.log(`  - Transport Bill: MH12AB1234`)
    console.log('\n💡 Re-running this seed will update existing records (no duplicates)')

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
