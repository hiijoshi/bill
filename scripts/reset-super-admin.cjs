#!/usr/bin/env node

const bcrypt = require('bcryptjs')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

function usage() {
  console.log('Usage:')
  console.log('  node scripts/reset-super-admin.cjs <userId> <password> [name]')
  console.log('')
  console.log('Example:')
  console.log('  node scripts/reset-super-admin.cjs superadmin "MyLivePassword@123" "Super Admin"')
}

async function main() {
  const [, , rawUserId, rawPassword, rawName] = process.argv
  const userId = String(rawUserId || '').trim()
  const password = String(rawPassword || '')
  const name = String(rawName || 'Super Admin').trim() || 'Super Admin'

  if (!userId || !password) {
    usage()
    process.exit(1)
  }

  if (password.length < 6) {
    console.error('Password must be at least 6 characters.')
    process.exit(1)
  }

  const hash = await bcrypt.hash(password, 12)

  await prisma.trader.upsert({
    where: { id: 'system' },
    update: { name: 'System', locked: false, deletedAt: null },
    create: { id: 'system', name: 'System', locked: false }
  })

  const existing = await prisma.user.findFirst({
    where: { traderId: 'system', userId },
    select: { id: true }
  })

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        password: hash,
        name,
        role: 'SUPER_ADMIN',
        locked: false,
        deletedAt: null,
        companyId: null,
        twoFactorEnabled: false,
        twoFactorSecret: null
      }
    })
    console.log(`Updated super admin: ${userId}`)
  } else {
    await prisma.user.create({
      data: {
        traderId: 'system',
        userId,
        password: hash,
        name,
        role: 'SUPER_ADMIN',
        locked: false,
        companyId: null,
        twoFactorEnabled: false,
        twoFactorSecret: null
      }
    })
    console.log(`Created super admin: ${userId}`)
  }

  console.log('2FA state reset for fresh setup (twoFactorEnabled=false).')
}

main()
  .catch((error) => {
    console.error('Failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
