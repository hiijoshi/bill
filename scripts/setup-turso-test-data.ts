import 'dotenv/config'

import { execSync } from 'node:child_process'

import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'

import { prisma } from '../lib/prisma'
import { generateUniqueMandiAccountNumber } from '../lib/mandi-account-number'
import { PERMISSION_MODULES } from '../lib/permissions'

type SeedConfig = {
  superAdminUserId: string
  superAdminPassword: string
  superAdminName: string
  traderId: string
  traderName: string
  companyId: string
  companyName: string
  companyAddress: string
  companyPhone: string
  appUserId: string
  appUserPassword: string
  appUserName: string
  appUserRole: 'company_admin' | 'company_user'
}

const SEEDED_COMPANY_ADDRESS_PLACEHOLDER = 'Seeded company for Turso testing'

function requireEnv(name: string): string {
  const value = String(process.env[name] || '').trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function optionalEnv(name: string, fallback: string): string {
  const value = String(process.env[name] || '').trim()
  return value || fallback
}

function normalizeLoginId(value: string): string {
  return value.trim().toLowerCase()
}

function buildSeedConfig(): SeedConfig {
  const rawRole = optionalEnv('SEED_APP_USER_ROLE', 'company_admin').toLowerCase()
  if (rawRole !== 'company_admin' && rawRole !== 'company_user') {
    throw new Error('SEED_APP_USER_ROLE must be company_admin or company_user')
  }

  return {
    superAdminUserId: normalizeLoginId(requireEnv('SEED_SUPER_ADMIN_USER_ID')),
    superAdminPassword: requireEnv('SEED_SUPER_ADMIN_PASSWORD'),
    superAdminName: optionalEnv('SEED_SUPER_ADMIN_NAME', 'Super Admin'),
    traderId: optionalEnv('SEED_TRADER_ID', 'demo-trader'),
    traderName: optionalEnv('SEED_TRADER_NAME', 'Demo Trader'),
    companyId: optionalEnv('SEED_COMPANY_ID', 'demo-company'),
    companyName: optionalEnv('SEED_COMPANY_NAME', 'Demo Company'),
    companyAddress: optionalEnv('SEED_COMPANY_ADDRESS', 'Main Market, Mumbai'),
    companyPhone: optionalEnv('SEED_COMPANY_PHONE', '9876543215'),
    appUserId: normalizeLoginId(requireEnv('SEED_APP_USER_ID')),
    appUserPassword: requireEnv('SEED_APP_USER_PASSWORD'),
    appUserName: optionalEnv('SEED_APP_USER_NAME', 'Demo User'),
    appUserRole: rawRole
  }
}

function buildSeedId(companyId: string, suffix: string): string {
  return `seed-${companyId}-${suffix}`.replace(/[^a-zA-Z0-9-_]/g, '-')
}

async function ensureRemoteSchema() {
  const tursoUrl = String(process.env.TURSO_DATABASE_URL || '').trim()
  const authToken = String(process.env.TURSO_AUTH_TOKEN || '').trim()

  if (!tursoUrl) {
    throw new Error('TURSO_DATABASE_URL is required to initialize Turso')
  }

  const client = createClient({
    url: tursoUrl,
    ...(authToken ? { authToken } : {})
  })

  const existingTables = await client.execute(
    "select name from sqlite_master where type = 'table' and name in ('Trader', 'Company', 'User', 'UserPermission')"
  )
  const present = new Set(existingTables.rows.map((row) => String(row.name)))

  if (present.size === 4) {
    return
  }

  if (present.size > 0) {
    throw new Error(
      `Turso database has a partial schema (${Array.from(present).join(', ')}). Refusing automatic bootstrap.`
    )
  }

  const sql = execSync(
    'npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script',
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  if (!sql.trim()) {
    throw new Error('Prisma did not generate schema SQL for Turso bootstrap')
  }

  await client.executeMultiple(sql)
}

async function upsertMasterData(config: SeedConfig, appUserDbId: string) {
  const companyId = config.companyId
  const unitId = buildSeedId(companyId, 'unit')
  const productId = buildSeedId(companyId, 'product')

  await prisma.farmer.upsert({
    where: { id: buildSeedId(companyId, 'farmer') },
    update: {
      companyId,
      name: 'Demo Farmer',
      address: 'Village Sample',
      phone1: '9876543210',
      bankName: 'State Bank of India',
      accountNo: '12345678901',
      ifscCode: 'SBIN0001234',
      krashakAnubandhNumber: 'KA-001'
    },
    create: {
      id: buildSeedId(companyId, 'farmer'),
      companyId,
      name: 'Demo Farmer',
      address: 'Village Sample',
      phone1: '9876543210',
      bankName: 'State Bank of India',
      accountNo: '12345678901',
      ifscCode: 'SBIN0001234',
      krashakAnubandhNumber: 'KA-001'
    }
  })

  await prisma.supplier.upsert({
    where: { id: buildSeedId(companyId, 'supplier') },
    update: {
      companyId,
      name: 'Demo Supplier',
      address: 'Industrial Area',
      phone1: '9876543211',
      gstNumber: '27ABCDE1234F1Z5',
      bankName: 'HDFC Bank',
      accountNo: '998877665544',
      ifscCode: 'HDFC0001234'
    },
    create: {
      id: buildSeedId(companyId, 'supplier'),
      companyId,
      name: 'Demo Supplier',
      address: 'Industrial Area',
      phone1: '9876543211',
      gstNumber: '27ABCDE1234F1Z5',
      bankName: 'HDFC Bank',
      accountNo: '998877665544',
      ifscCode: 'HDFC0001234'
    }
  })

  await prisma.party.upsert({
    where: { id: buildSeedId(companyId, 'party') },
    update: {
      companyId,
      type: 'buyer',
      name: 'Demo Buyer',
      address: 'Main Market',
      phone1: '9876543212',
      creditLimit: 50000,
      creditDays: 15,
      bankName: 'ICICI Bank',
      accountNo: '556677889900',
      ifscCode: 'ICIC0001234'
    },
    create: {
      id: buildSeedId(companyId, 'party'),
      companyId,
      type: 'buyer',
      name: 'Demo Buyer',
      address: 'Main Market',
      phone1: '9876543212',
      creditLimit: 50000,
      creditDays: 15,
      bankName: 'ICICI Bank',
      accountNo: '556677889900',
      ifscCode: 'ICIC0001234'
    }
  })

  await prisma.transport.upsert({
    where: { id: buildSeedId(companyId, 'transport') },
    update: {
      companyId,
      transporterName: 'Demo Transport',
      vehicleNumber: 'MH12AB1234',
      driverName: 'Ramesh',
      driverPhone: '9876543213',
      capacity: 150,
      freightRate: 20
    },
    create: {
      id: buildSeedId(companyId, 'transport'),
      companyId,
      transporterName: 'Demo Transport',
      vehicleNumber: 'MH12AB1234',
      driverName: 'Ramesh',
      driverPhone: '9876543213',
      capacity: 150,
      freightRate: 20
    }
  })

  await prisma.unit.upsert({
    where: { id: unitId },
    update: {
      companyId,
      name: 'Kilogram',
      symbol: 'KG',
      kgEquivalent: 1,
      isUniversal: false,
      description: 'Default seeded unit'
    },
    create: {
      id: unitId,
      companyId,
      name: 'Kilogram',
      symbol: 'KG',
      kgEquivalent: 1,
      isUniversal: false,
      description: 'Default seeded unit'
    }
  })

  await prisma.product.upsert({
    where: { id: productId },
    update: {
      companyId,
      unitId,
      name: 'Wheat',
      hsnCode: '1001',
      gstRate: 5,
      sellingPrice: 2500,
      description: 'Seeded product for testing',
      isActive: true
    },
    create: {
      id: productId,
      companyId,
      unitId,
      name: 'Wheat',
      hsnCode: '1001',
      gstRate: 5,
      sellingPrice: 2500,
      description: 'Seeded product for testing',
      isActive: true
    }
  })

  await prisma.salesItemMaster.upsert({
    where: { id: buildSeedId(companyId, 'sales-item-master') },
    update: {
      companyId,
      productId,
      salesItemName: 'Wheat Retail',
      hsnCode: '1001',
      gstRate: 5,
      sellingPrice: 2550,
      description: 'Seeded sales item master',
      isActive: true
    },
    create: {
      id: buildSeedId(companyId, 'sales-item-master'),
      companyId,
      productId,
      salesItemName: 'Wheat Retail',
      hsnCode: '1001',
      gstRate: 5,
      sellingPrice: 2550,
      description: 'Seeded sales item master',
      isActive: true
    }
  })

  await prisma.bank.upsert({
    where: { id: buildSeedId(companyId, 'bank') },
    update: {
      companyId,
      name: 'State Bank of India',
      branch: 'Main Branch',
      ifscCode: 'SBIN0001234',
      accountNumber: '12345678901',
      address: 'Market Road',
      phone: '9876543214',
      isActive: true
    },
    create: {
      id: buildSeedId(companyId, 'bank'),
      companyId,
      name: 'State Bank of India',
      branch: 'Main Branch',
      ifscCode: 'SBIN0001234',
      accountNumber: '12345678901',
      address: 'Market Road',
      phone: '9876543214',
      isActive: true
    }
  })

  await prisma.marka.upsert({
    where: { id: buildSeedId(companyId, 'marka') },
    update: {
      companyId,
      markaNumber: 'MK001',
      description: 'Seeded marka',
      isActive: true
    },
    create: {
      id: buildSeedId(companyId, 'marka'),
      companyId,
      markaNumber: 'MK001',
      description: 'Seeded marka',
      isActive: true
    }
  })

  await prisma.paymentMode.upsert({
    where: { id: buildSeedId(companyId, 'payment-mode') },
    update: {
      companyId,
      name: 'Cash',
      code: 'CASH',
      description: 'Seeded payment mode',
      isActive: true
    },
    create: {
      id: buildSeedId(companyId, 'payment-mode'),
      companyId,
      name: 'Cash',
      code: 'CASH',
      description: 'Seeded payment mode',
      isActive: true
    }
  })

  await prisma.userPermission.deleteMany({
    where: {
      userId: appUserDbId,
      companyId
    }
  })

  await prisma.userPermission.createMany({
    data: PERMISSION_MODULES.map((module) => ({
      id: buildSeedId(companyId, `perm-${module.toLowerCase()}`),
      userId: appUserDbId,
      companyId,
      module,
      canRead: true,
      canWrite: true
    }))
  })
}

async function main() {
  const config = buildSeedConfig()

  await ensureRemoteSchema()

  const superAdminPasswordHash = await bcrypt.hash(config.superAdminPassword, 12)
  const appUserPasswordHash = await bcrypt.hash(config.appUserPassword, 12)

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

  const existingSuperAdmin = await prisma.user.findFirst({
    where: {
      traderId: 'system',
      userId: config.superAdminUserId
    },
    select: { id: true }
  })

  const superAdmin = existingSuperAdmin
    ? await prisma.user.update({
        where: { id: existingSuperAdmin.id },
        data: {
          password: superAdminPasswordHash,
          name: config.superAdminName,
          role: 'SUPER_ADMIN',
          companyId: null,
          locked: false,
          deletedAt: null
        }
      })
    : await prisma.user.create({
        data: {
          traderId: 'system',
          userId: config.superAdminUserId,
          password: superAdminPasswordHash,
          name: config.superAdminName,
          role: 'SUPER_ADMIN',
          companyId: null,
          locked: false
        }
      })

  await prisma.trader.upsert({
    where: { id: config.traderId },
    update: {
      name: config.traderName,
      locked: false,
      deletedAt: null
    },
    create: {
      id: config.traderId,
      name: config.traderName,
      locked: false
    }
  })

  const existingCompany = await prisma.company.findUnique({
    where: { id: config.companyId },
    select: {
      mandiAccountNumber: true,
      address: true,
      phone: true
    }
  })

  const resolvedCompanyAddress =
    existingCompany?.address && existingCompany.address.trim() && existingCompany.address.trim() !== SEEDED_COMPANY_ADDRESS_PLACEHOLDER
      ? existingCompany.address.trim()
      : config.companyAddress
  const resolvedCompanyPhone =
    existingCompany?.phone && existingCompany.phone.trim()
      ? existingCompany.phone.trim()
      : config.companyPhone

  const company = existingCompany
    ? await prisma.company.update({
        where: { id: config.companyId },
        data: {
          traderId: config.traderId,
          name: config.companyName,
          address: resolvedCompanyAddress,
          phone: resolvedCompanyPhone,
          mandiAccountNumber:
            existingCompany.mandiAccountNumber || (await generateUniqueMandiAccountNumber(prisma)),
          locked: false,
          deletedAt: null
        }
      })
    : await prisma.company.create({
        data: {
          id: config.companyId,
          traderId: config.traderId,
          name: config.companyName,
          address: resolvedCompanyAddress,
          phone: resolvedCompanyPhone,
          mandiAccountNumber: await generateUniqueMandiAccountNumber(prisma),
          locked: false
        }
      })

  const existingAppUser = await prisma.user.findFirst({
    where: {
      traderId: config.traderId,
      userId: config.appUserId
    },
    select: { id: true }
  })

  const appUser = existingAppUser
    ? await prisma.user.update({
        where: { id: existingAppUser.id },
        data: {
          companyId: company.id,
          password: appUserPasswordHash,
          name: config.appUserName,
          role: config.appUserRole,
          locked: false,
          deletedAt: null
        }
      })
    : await prisma.user.create({
        data: {
          traderId: config.traderId,
          companyId: company.id,
          userId: config.appUserId,
          password: appUserPasswordHash,
          name: config.appUserName,
          role: config.appUserRole,
          locked: false
        }
      })

  await upsertMasterData(config, appUser.id)

  console.log(JSON.stringify({
    success: true,
    login: {
      superAdmin: {
        path: '/super-admin/login',
        userId: config.superAdminUserId,
        password: config.superAdminPassword
      },
      appUser: {
        path: '/login',
        traderId: config.traderId,
        userId: config.appUserId,
        password: config.appUserPassword
      }
    },
    entities: {
      superAdminId: superAdmin.id,
      traderId: config.traderId,
      companyId: company.id,
      appUserId: appUser.id
    },
    seededMasters: [
      'Farmer',
      'Supplier',
      'Party',
      'Transport',
      'Unit',
      'Product',
      'SalesItemMaster',
      'Bank',
      'Marka',
      'PaymentMode'
    ]
  }, null, 2))
}

main()
  .catch((error) => {
    console.error('Failed to setup Turso test data:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
