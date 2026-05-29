const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const password = await bcrypt.hash('Pass@123', 12)

  await prisma.trader.upsert({
    where: { id: 'system' },
    update: { name: 'System', locked: false, deletedAt: null },
    create: { id: 'system', name: 'System', locked: false }
  })

  const existing = await prisma.user.findFirst({
    where: { traderId: 'system', userId: 'sa_test' },
    select: { id: true }
  })

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        password,
        name: 'SA Test',
        role: 'SUPER_ADMIN',
        locked: false,
        deletedAt: null,
        companyId: null,
        twoFactorEnabled: false,
        twoFactorSecret: null
      }
    })
    console.log('updated')
  } else {
    await prisma.user.create({
      data: {
        traderId: 'system',
        userId: 'sa_test',
        password,
        name: 'SA Test',
        role: 'SUPER_ADMIN',
        locked: false,
        companyId: null,
        twoFactorEnabled: false,
        twoFactorSecret: null
      }
    })
    console.log('created')
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
