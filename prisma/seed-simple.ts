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

    console.log('🎉 Sample data created successfully!')
    console.log(`📊 Trader ID: ${trader.id}`)
    console.log(`🏢 Company ID: ${company.id}`)
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
