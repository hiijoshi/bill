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

    console.log('✅ Trader created:', trader.name)

    // Create Company
    const company = await prisma.company.create({
      data: {
        traderId: trader.id,
        name: 'Mandi Traders Ltd',
        address: 'Shop No. 1, Grain Market',
        phone: '022-2345-6789'
      }
    })

    console.log('✅ Company created:', company.name)

    console.log('🎉 Sample data created successfully!')
    console.log(`📊 Trader ID: ${trader.id}`)
    console.log(`🏢 Company ID: ${company.id}`)

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
