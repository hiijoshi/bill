import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function getCredentials() {
  try {
    // Get trader
    const trader = await prisma.trader.findFirst()
    if (!trader) {
      console.log('❌ No trader found')
      return null
    }

    // Get company
    const company = await prisma.company.findFirst({
      where: { traderId: trader.id }
    })
    if (!company) {
      console.log('❌ No company found')
      return null
    }

    // Get admin user
    const user = await prisma.user.findFirst({
      where: { traderId: trader.id }
    })
    if (!user) {
      console.log('❌ No user found')
      return null
    }

    console.log('✅ Credentials Found:')
    console.log(`  - Trader ID: ${trader.id}`)
    console.log(`  - Company ID: ${company.id}`)
    console.log(`  - User Email: ${user.userId}`)
    console.log(`  - User Password: (hashed)`)

    return {
      traderId: trader.id,
      companyId: company.id,
      userEmail: user.userId,
      userPassword: 'admin123' // For testing
    }
  } catch (error) {
    console.error('❌ Error:', error)
    return null
  } finally {
    await prisma.$disconnect()
  }
}

getCredentials()
  .then((credentials) => {
    if (credentials) {
      console.log('🎯 Login Credentials:')
      console.log(`  - URL: http://localhost:3000/sales/entry?companyId=${credentials.companyId}`)
      console.log(`  - Email: ${credentials.userEmail}`)
      console.log(`  - Password: ${credentials.userPassword}`)
    } else {
      console.log('❌ No credentials found')
    }
  })
