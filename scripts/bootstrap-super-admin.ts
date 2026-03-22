import 'dotenv/config'

import bcrypt from 'bcryptjs'

import { prisma } from '../lib/prisma'

function printUsage() {
  console.log('Usage:')
  console.log('  npx tsx scripts/bootstrap-super-admin.ts <userId> <password> [name]')
  console.log('')
  console.log('Example:')
  console.log('  npx tsx scripts/bootstrap-super-admin.ts superadmin "StrongPass@123" "Super Admin"')
}

async function main() {
  const [, , rawUserId, rawPassword, rawName] = process.argv

  const userId = String(rawUserId || '').trim()
  const password = String(rawPassword || '')
  const name = String(rawName || 'Super Admin').trim() || 'Super Admin'

  if (!userId || !password) {
    printUsage()
    process.exit(1)
  }

  if (password.length < 6) {
    console.error('Password must be at least 6 characters.')
    process.exit(1)
  }

  const hashedPassword = await bcrypt.hash(password, 12)

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
  } else {
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

  console.log('')
  console.log('Login URL:')
  console.log('  /super-admin/login')
  console.log('')
  console.log(`User ID: ${userId}`)
  console.log('Password: <the password you just entered>')
  console.log('')
  console.log('If your deployment has SUPER_ADMIN_SECOND_SECRET set, enter that on the login screen too.')
}

main()
  .catch((error) => {
    console.error('Failed to bootstrap super admin:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
