import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function inspectAccountSummary() {
  try {
    const [traderCount, companyCount, userCount] = await Promise.all([
      prisma.trader.count({ where: { deletedAt: null } }),
      prisma.company.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null } })
    ])

    console.log('Account summary')
    console.log(`  - Active traders: ${traderCount}`)
    console.log(`  - Active companies: ${companyCount}`)
    console.log(`  - Active users: ${userCount}`)
    console.log('  - Passwords are stored as hashes and are not printed by this script.')
  } catch (error) {
    console.error('Account summary failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

void inspectAccountSummary()
