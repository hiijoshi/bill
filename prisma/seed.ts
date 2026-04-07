import 'dotenv/config'

import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { buildDefaultSubscriptionFeatureInputs } from '../lib/subscription-config'

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

async function ensureOptionalSampleSubscriptionPlans() {
  if (String(process.env.SEED_SAMPLE_SUBSCRIPTION_PLANS || '').trim().toLowerCase() !== 'true') {
    return
  }

  const featureRows = buildDefaultSubscriptionFeatureInputs()
  const plans = [
    {
      name: 'Trial Plan',
      description: 'Starter trial plan for onboarding new traders.',
      amount: 0,
      maxCompanies: 1,
      maxUsers: 3,
      defaultTrialDays: 15,
      isTrialCapable: true,
      sortOrder: 1
    },
    {
      name: 'Standard Yearly',
      description: 'Default yearly plan for active mandi ERP operations.',
      amount: 0,
      maxCompanies: 3,
      maxUsers: 10,
      defaultTrialDays: 15,
      isTrialCapable: true,
      sortOrder: 2
    }
  ]

  for (const plan of plans) {
    const existing = await prisma.subscriptionPlan.findFirst({
      where: {
        name: plan.name
      },
      select: {
        id: true
      }
    })

    const record = existing
      ? await prisma.subscriptionPlan.update({
          where: {
            id: existing.id
          },
          data: {
            description: plan.description,
            billingCycle: 'yearly',
            amount: plan.amount,
            currency: 'INR',
            maxCompanies: plan.maxCompanies,
            maxUsers: plan.maxUsers,
            defaultTrialDays: plan.defaultTrialDays,
            isActive: true,
            isTrialCapable: plan.isTrialCapable,
            sortOrder: plan.sortOrder
          }
        })
      : await prisma.subscriptionPlan.create({
          data: {
            name: plan.name,
            description: plan.description,
            billingCycle: 'yearly',
            amount: plan.amount,
            currency: 'INR',
            maxCompanies: plan.maxCompanies,
            maxUsers: plan.maxUsers,
            defaultTrialDays: plan.defaultTrialDays,
            isActive: true,
            isTrialCapable: plan.isTrialCapable,
            sortOrder: plan.sortOrder
          }
        })

    await prisma.subscriptionPlanFeature.deleteMany({
      where: {
        planId: record.id
      }
    })

    await prisma.subscriptionPlanFeature.createMany({
      data: featureRows.map((feature) => ({
        planId: record.id,
        featureKey: feature.featureKey,
        featureLabel: feature.featureLabel,
        description: feature.description,
        enabled: feature.enabled,
        sortOrder: feature.sortOrder
      }))
    })
  }

  console.log('Optional sample subscription plans ensured.')
}

async function main() {
  console.log('Running safe database bootstrap...')
  console.log('No business rows will be inserted automatically.')

  await ensureSystemTrader()
  await ensureOptionalSuperAdmin()
  await ensureOptionalSampleSubscriptionPlans()

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
