import 'dotenv/config'

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function ensureSystemTrader() {
  await prisma.trader.upsert({
    where: { id: 'system' },
    update: {
      name: 'System',
      locked: false,
      deletedAt: null
    },
    create: {
      id: 'system',
      name: 'System',
      locked: false
    }
  })
}

async function ensureOptionalSuperAdmin() {
  const userId = String(process.env.SUPER_ADMIN_USER_ID || '').trim()
  const password = String(process.env.SUPER_ADMIN_PASSWORD || '')
  const name = String(process.env.SUPER_ADMIN_NAME || 'Super Admin').trim() || 'Super Admin'

  if (!userId || !password) {
    console.log('No SUPER_ADMIN_USER_ID / SUPER_ADMIN_PASSWORD provided. Skipping super admin bootstrap.')
    return
  }

  const hashedPassword = await bcrypt.hash(password, 12)
  const existingUser = await prisma.user.findFirst({
    where: {
      traderId: 'system',
      userId
    },
    select: {
      id: true
    }
  })

  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        password: hashedPassword,
        name,
        role: 'SUPER_ADMIN',
        locked: false,
        deletedAt: null,
        companyId: null
      }
    })
    console.log(`Updated super admin: ${userId}`)
    return
  }

  await prisma.user.create({
    data: {
      traderId: 'system',
      userId,
      password: hashedPassword,
      name,
      role: 'SUPER_ADMIN',
      locked: false,
      companyId: null
    }
  })
  console.log(`Created super admin: ${userId}`)
}

async function main() {
  console.log('Running safe database bootstrap...')
  console.log('No business rows will be inserted automatically.')

  await ensureSystemTrader()
  await ensureOptionalSuperAdmin()

  console.log('Bootstrap complete.')
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
