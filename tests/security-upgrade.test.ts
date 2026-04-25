import test from 'node:test'
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { normalizeAppRole, requireRoles, hasCompanyAccess, ensureCompanyAccess } from '../lib/api-security'
import { authenticateUser, generateToken } from '../lib/auth'
import { proxy as middleware } from '../proxy'
import { writeAuditLog } from '../lib/audit-logging'
import { getTraderCapacitySnapshot } from '../lib/trader-limits'
import { isPrismaSchemaMismatchError } from '../lib/prisma-schema-guard'
import { buildSubscriptionSchemaHeaders, readSubscriptionSchemaState } from '../lib/subscription-schema'
import { GET as getPayments } from '../app/api/payments/route'
import { POST as postCompanies, PUT as putCompanies } from '../app/api/companies/route'
import { POST as postSuperAdminTraders } from '../app/api/super-admin/traders/route'
import { POST as postSuperAdminUsers } from '../app/api/super-admin/users/route'
import { PUT as putSuperAdminUserById } from '../app/api/super-admin/users/[id]/route'
import { POST as postTraderSubscriptionAction } from '../app/api/super-admin/trader-subscriptions/[traderId]/actions/route'

function makeRequest(
  url: string,
  init?: { headers?: Record<string, string>; method?: string; body?: unknown }
) {
  const hasBody = init?.body !== undefined
  return new NextRequest(
    new Request(url, {
      method: init?.method || 'GET',
      headers: hasBody
        ? {
            'content-type': 'application/json',
            ...(init?.headers || {})
          }
        : init?.headers,
      body: hasBody ? JSON.stringify(init?.body) : undefined
    })
  )
}

function makeAuthHeaders(role: string) {
  return {
    'x-user-id': 'test-super-admin',
    'x-trader-id': 'system',
    'x-user-role': role,
    'x-user-role-normalized': role,
    'x-user-db-id': 'test-super-admin-id',
    'x-request-id': `req-${Date.now()}`
  }
}

async function callTraderSubscriptionAction(
  traderId: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = makeAuthHeaders('super_admin')
) {
  return postTraderSubscriptionAction(
    makeRequest(`http://localhost/api/super-admin/trader-subscriptions/${traderId}/actions`, {
      method: 'POST',
      headers,
      body
    }),
    { params: Promise.resolve({ traderId }) }
  )
}

test('RBAC requireRoles allow/deny works per role', async () => {
  const deniedRequest = makeRequest('http://localhost/api/example', {
    headers: {
      ...makeAuthHeaders('company_user')
    }
  })

  const denied = requireRoles(deniedRequest, ['super_admin'])
  assert.equal(denied.ok, false)
  if (!denied.ok) {
    assert.equal(denied.response.status, 403)
  }

  const allowedRequest = makeRequest('http://localhost/api/example', {
    headers: {
      ...makeAuthHeaders('super_admin')
    }
  })

  const allowed = requireRoles(allowedRequest, ['super_admin'])
  assert.equal(allowed.ok, true)
})

test('Legacy admin role normalizes to company_admin', () => {
  assert.equal(normalizeAppRole('admin'), 'company_admin')
  assert.equal(normalizeAppRole('company_admin'), 'company_admin')
})

test('Schema guard detects optional-table mismatches cleanly', () => {
  assert.equal(
    isPrismaSchemaMismatchError(
      new Error('SQLITE_UNKNOWN: SQLite error: no such table: main.TraderSubscription'),
      ['TraderSubscription']
    ),
    true
  )

  assert.equal(
    isPrismaSchemaMismatchError(new Error('Invalid credentials'), ['TraderSubscription']),
    false
  )
})

test('Subscription schema headers expose warning state consistently', () => {
  const headers = buildSubscriptionSchemaHeaders(false)
  const parsed = readSubscriptionSchemaState(headers)

  assert.equal(parsed.schemaReady, false)
  assert.ok(parsed.schemaWarning)
})

test('Trader create API can assign initial trial subscription in one request', async () => {
  const suffix = Date.now().toString()
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: `Create Trial Plan ${suffix}`,
      billingCycle: 'yearly',
      amount: 0,
      currency: 'INR',
      isActive: true,
      isTrialCapable: true,
      defaultTrialDays: 21
    }
  })

  let traderId = ''

  try {
    const response = await postSuperAdminTraders(
      makeRequest('http://localhost/api/super-admin/traders', {
        method: 'POST',
        headers: makeAuthHeaders('super_admin'),
        body: {
          name: `create-trader-with-subscription-${suffix}`,
          maxCompanies: 3,
          maxUsers: 12,
          subscription: {
            mode: 'trial',
            planId: plan.id,
            trialDays: 21
          }
        }
      })
    )

    assert.equal(response.status, 201)

    const payload = await response.json()
    traderId = String(payload?.id || '')
    assert.ok(traderId)
    assert.equal(payload?.currentSubscription?.subscriptionType, 'trial')

    const createdSubscription = await prisma.traderSubscription.findFirst({
      where: { traderId },
      orderBy: [{ createdAt: 'desc' }]
    })

    assert.equal(createdSubscription?.planId, plan.id)
    assert.equal(createdSubscription?.subscriptionType, 'trial')
    assert.equal(createdSubscription?.status, 'active')
    assert.equal(createdSubscription?.trialDays, 21)
  } finally {
    await prisma.subscriptionPayment.deleteMany({ where: { traderId } })
    await prisma.traderSubscription.deleteMany({ where: { traderId } })
    if (traderId) {
      await prisma.trader.deleteMany({ where: { id: traderId } })
    }
    await prisma.subscriptionPlanFeature.deleteMany({ where: { planId: plan.id } })
    await prisma.subscriptionPlan.deleteMany({ where: { id: plan.id } })
  }
})

test('Scope checks block out-of-scope company access', async () => {
  const suffix = Date.now().toString()
  const traderA = await prisma.trader.create({ data: { name: `scope-trader-a-${suffix}` } })
  const traderB = await prisma.trader.create({ data: { name: `scope-trader-b-${suffix}` } })
  const companyA = await prisma.company.create({ data: { name: `scope-company-a-${suffix}`, traderId: traderA.id } })
  const companyB = await prisma.company.create({ data: { name: `scope-company-b-${suffix}`, traderId: traderB.id } })

  try {
    const traderAdminAuth = {
      userId: 'a',
      traderId: traderA.id,
      role: 'trader_admin' as const,
      companyId: null,
      userDbId: null
    }

    const companyAdminAuth = {
      userId: 'b',
      traderId: traderA.id,
      role: 'company_admin' as const,
      companyId: companyA.id,
      userDbId: null
    }

    assert.equal(await hasCompanyAccess(companyA.id, traderAdminAuth), true)
    assert.equal(await hasCompanyAccess(companyB.id, traderAdminAuth), false)

    assert.equal(await hasCompanyAccess(companyA.id, companyAdminAuth), true)
    assert.equal(await hasCompanyAccess(companyB.id, companyAdminAuth), false)
  } finally {
    await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } })
    await prisma.trader.deleteMany({ where: { id: { in: [traderA.id, traderB.id] } } })
  }
})

test('Privilege matrix denies access without module permission and allows after grant', async () => {
  const suffix = Date.now().toString()
  const trader = await prisma.trader.create({ data: { name: `perm-trader-${suffix}` } })
  const company = await prisma.company.create({ data: { name: `perm-company-${suffix}`, traderId: trader.id } })
  const user = await prisma.user.create({
    data: {
      traderId: trader.id,
      companyId: company.id,
      userId: `perm-user-${suffix}`,
      password: 'hashed-password',
      role: 'company_user'
    }
  })
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: `Perm Plan ${suffix}`,
      billingCycle: 'yearly',
      amount: 0,
      currency: 'INR',
      isActive: true,
      isTrialCapable: true
    }
  })

  try {
    await prisma.subscriptionPlanFeature.createMany({
      data: [
        {
          planId: plan.id,
          featureKey: 'dashboard',
          featureLabel: 'Dashboard Access',
          enabled: true,
          sortOrder: 0
        },
        {
          planId: plan.id,
          featureKey: 'masters',
          featureLabel: 'Master Data',
          enabled: true,
          sortOrder: 1
        }
      ]
    })

    await prisma.traderSubscription.create({
      data: {
        traderId: trader.id,
        planId: plan.id,
        subscriptionType: 'paid',
        status: 'active',
        billingCycle: 'yearly',
        amount: 0,
        currency: 'INR',
        planNameSnapshot: plan.name,
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 10 * 86_400_000),
        activatedAt: new Date()
      }
    })

    const request = makeRequest(`http://localhost/api/products?companyId=${company.id}`, {
      headers: {
        'x-user-id': user.userId,
        'x-trader-id': trader.id,
        'x-user-role': 'company_user',
        'x-user-role-normalized': 'company_user',
        'x-user-db-id': user.id,
        'x-company-id': company.id
      }
    })

    const denied = await ensureCompanyAccess(request, company.id)
    assert.ok(denied)
    assert.equal(denied?.status, 403)

    await prisma.userPermission.create({
      data: {
        userId: user.id,
        companyId: company.id,
        module: 'MASTER_PRODUCTS',
        canRead: true,
        canWrite: false
      }
    })

    const allowed = await ensureCompanyAccess(request, company.id)
    assert.equal(allowed, null)
  } finally {
    await prisma.subscriptionPayment.deleteMany({ where: { traderId: trader.id } })
    await prisma.traderSubscription.deleteMany({ where: { traderId: trader.id } })
    await prisma.subscriptionPlanFeature.deleteMany({ where: { planId: plan.id } })
    await prisma.subscriptionPlan.deleteMany({ where: { id: plan.id } })
    await prisma.userPermission.deleteMany({ where: { userId: user.id } })
    await prisma.user.deleteMany({ where: { id: user.id } })
    await prisma.company.deleteMany({ where: { id: company.id } })
    await prisma.trader.deleteMany({ where: { id: trader.id } })
  }
})

test('Expired subscription allows reads but blocks writes in read-only mode', async () => {
  const suffix = Date.now().toString()
  const trader = await prisma.trader.create({ data: { name: `readonly-trader-${suffix}` } })
  const company = await prisma.company.create({ data: { name: `readonly-company-${suffix}`, traderId: trader.id } })
  const user = await prisma.user.create({
    data: {
      traderId: trader.id,
      companyId: company.id,
      userId: `readonly-user-${suffix}`,
      password: 'hashed-password',
      role: 'company_user'
    }
  })
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: `Readonly Plan ${suffix}`,
      billingCycle: 'yearly',
      amount: 0,
      currency: 'INR',
      isActive: true
    }
  })

  try {
    await prisma.subscriptionPlanFeature.createMany({
      data: [
        {
          planId: plan.id,
          featureKey: 'masters',
          featureLabel: 'Master Data',
          enabled: true,
          sortOrder: 0
        },
        {
          planId: plan.id,
          featureKey: 'dashboard',
          featureLabel: 'Dashboard',
          enabled: true,
          sortOrder: 1
        }
      ]
    })

    await prisma.traderSubscription.create({
      data: {
        traderId: trader.id,
        planId: plan.id,
        subscriptionType: 'paid',
        status: 'expired',
        billingCycle: 'yearly',
        amount: 0,
        currency: 'INR',
        planNameSnapshot: plan.name,
        startDate: new Date(Date.now() - 20 * 86_400_000),
        endDate: new Date(Date.now() - 2 * 86_400_000),
        expiredAt: new Date()
      }
    })

    await prisma.userPermission.create({
      data: {
        userId: user.id,
        companyId: company.id,
        module: 'MASTER_PRODUCTS',
        canRead: true,
        canWrite: true
      }
    })

    const readRequest = makeRequest(`http://localhost/api/products?companyId=${company.id}`, {
      headers: {
        'x-user-id': user.userId,
        'x-trader-id': trader.id,
        'x-user-role': 'company_user',
        'x-user-role-normalized': 'company_user',
        'x-user-db-id': user.id,
        'x-company-id': company.id
      }
    })

    const writeRequest = makeRequest(`http://localhost/api/products?companyId=${company.id}`, {
      method: 'POST',
      headers: {
        'x-user-id': user.userId,
        'x-trader-id': trader.id,
        'x-user-role': 'company_user',
        'x-user-role-normalized': 'company_user',
        'x-user-db-id': user.id,
        'x-company-id': company.id
      }
    })

    const readAllowed = await ensureCompanyAccess(readRequest, company.id)
    assert.equal(readAllowed, null)

    const writeDenied = await ensureCompanyAccess(writeRequest, company.id)
    assert.ok(writeDenied)
    assert.equal(writeDenied?.status, 403)
    const payload = await writeDenied?.json()
    assert.match(String(payload?.error || ''), /read-only/i)
  } finally {
    await prisma.subscriptionPayment.deleteMany({ where: { traderId: trader.id } })
    await prisma.traderDataBackup.deleteMany({ where: { traderId: trader.id } })
    await prisma.traderDataLifecycle.deleteMany({ where: { traderId: trader.id } })
    await prisma.traderSubscription.deleteMany({ where: { traderId: trader.id } })
    await prisma.subscriptionPlanFeature.deleteMany({ where: { planId: plan.id } })
    await prisma.subscriptionPlan.deleteMany({ where: { id: plan.id } })
    await prisma.userPermission.deleteMany({ where: { userId: user.id } })
    await prisma.user.deleteMany({ where: { id: user.id } })
    await prisma.company.deleteMany({ where: { id: company.id } })
    await prisma.trader.deleteMany({ where: { id: trader.id } })
  }
})

test('Final deletion requires ready backup and deletion-pending confirmation', async () => {
  const suffix = Date.now().toString()
  const trader = await prisma.trader.create({ data: { name: `closure-trader-${suffix}` } })
  const company = await prisma.company.create({ data: { name: `closure-company-${suffix}`, traderId: trader.id } })
  const user = await prisma.user.create({
    data: {
      traderId: trader.id,
      companyId: company.id,
      userId: `closure-user-${suffix}`,
      password: 'hashed-password',
      role: 'company_admin'
    }
  })

  let backupStoragePath: string | null = null

  try {
    const missingBackupResponse = await callTraderSubscriptionAction(trader.id, {
      action: 'confirm_final_deletion',
      backupId: 'missing-backup',
      confirmDeletion: true
    })
    assert.equal(missingBackupResponse.status, 404)

    const createBackupResponse = await callTraderSubscriptionAction(trader.id, {
      action: 'request_backup',
      notes: 'Prepare final export'
    })
    assert.equal(createBackupResponse.status, 200)
    const createBackupPayload = await createBackupResponse.json()
    const createdBackupId = String(createBackupPayload?.backups?.[0]?.id || '')
    assert.ok(createdBackupId)

    const createdBackup = await prisma.traderDataBackup.findUnique({
      where: { id: createdBackupId }
    })
    assert.ok(createdBackup)
    assert.equal(createdBackup?.status, 'ready')
    backupStoragePath = createdBackup?.storagePath || null

    const beforePendingResponse = await callTraderSubscriptionAction(trader.id, {
      action: 'confirm_final_deletion',
      backupId: createdBackupId,
      confirmDeletion: true
    })
    assert.equal(beforePendingResponse.status, 409)

    const pendingResponse = await callTraderSubscriptionAction(trader.id, {
      action: 'mark_deletion_pending',
      backupId: createdBackupId,
      retentionDays: 30,
      notes: 'Backup verified'
    })
    assert.equal(pendingResponse.status, 200)

    const lifecycle = await prisma.traderDataLifecycle.findUnique({
      where: { traderId: trader.id }
    })
    assert.equal(lifecycle?.state, 'deletion_pending')

    const finalDeleteResponse = await callTraderSubscriptionAction(trader.id, {
      action: 'confirm_final_deletion',
      backupId: createdBackupId,
      confirmDeletion: true,
      notes: 'Approved for final delete'
    })
    assert.equal(finalDeleteResponse.status, 200)

    const [deletedTrader, remainingCompanies, remainingUsers, persistedBackup, finalLifecycle] = await Promise.all([
      prisma.trader.findUnique({ where: { id: trader.id } }),
      prisma.company.count({ where: { traderId: trader.id } }),
      prisma.user.count({ where: { traderId: trader.id } }),
      prisma.traderDataBackup.findUnique({ where: { id: createdBackupId } }),
      prisma.traderDataLifecycle.findUnique({ where: { traderId: trader.id } })
    ])

    assert.ok(deletedTrader?.deletedAt)
    assert.equal(deletedTrader?.locked, true)
    assert.equal(remainingCompanies, 0)
    assert.equal(remainingUsers, 0)
    assert.equal(persistedBackup?.status, 'ready')
    assert.equal(finalLifecycle?.state, 'deleted')
  } finally {
    if (backupStoragePath) {
      await rm(backupStoragePath, { force: true }).catch(() => undefined)
    }
    await prisma.traderDataBackup.deleteMany({ where: { traderId: trader.id } })
    await prisma.traderDataLifecycle.deleteMany({ where: { traderId: trader.id } })
    await prisma.subscriptionPayment.deleteMany({ where: { traderId: trader.id } })
    await prisma.traderSubscription.deleteMany({ where: { traderId: trader.id } })
    await prisma.userPermission.deleteMany({ where: { userId: user.id } })
    await prisma.user.deleteMany({ where: { traderId: trader.id } })
    await prisma.company.deleteMany({ where: { traderId: trader.id } })
    await prisma.trader.deleteMany({ where: { id: trader.id } })
  }
})

test('Middleware denies locked users on protected API', async () => {
  const suffix = Date.now().toString()
  const trader = await prisma.trader.create({ data: { name: `lock-trader-${suffix}` } })
  const company = await prisma.company.create({
    data: {
      name: `lock-company-${suffix}`,
      traderId: trader.id
    }
  })

  const user = await prisma.user.create({
    data: {
      traderId: trader.id,
      companyId: company.id,
      userId: `lock-user-${suffix}`,
      password: 'hashed-password',
      role: 'admin',
      locked: true
    }
  })

  try {
    const token = generateToken({
      userId: user.userId,
      traderId: trader.id,
      role: 'admin'
    })

    const request = makeRequest(`http://localhost/api/companies?companyId=${company.id}`, {
      headers: {
        cookie: `auth-token=${token}`,
        'x-forwarded-for': `203.0.113.${Number(suffix.slice(-2)) % 200}`
      }
    })

    const response = await middleware(request)
    assert.equal(response.status, 403)
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } })
    await prisma.company.deleteMany({ where: { id: company.id } })
    await prisma.trader.deleteMany({ where: { id: trader.id } })
  }
})

test('Audit log stores masked before/after payload snapshots', async () => {
  const resourceId = `audit-resource-${Date.now()}`

  await writeAuditLog({
    actor: {
      id: 'audit-actor',
      role: 'super_admin'
    },
    action: 'UPDATE',
    resourceType: 'USER',
    resourceId,
    scope: {
      traderId: 'audit-trader',
      companyId: 'audit-company'
    },
    before: {
      password: 'secret',
      accountNo: '1234567890',
      name: 'Old Name'
    },
    after: {
      password: 'new-secret',
      token: 'jwt-token',
      name: 'New Name'
    }
  })

  const row = await prisma.auditLog.findFirst({
    where: { resourceId },
    orderBy: { createdAt: 'desc' }
  })

  assert.ok(row)
  const beforePayload = JSON.parse(row?.before || '{}')
  const afterPayload = JSON.parse(row?.after || '{}')

  assert.equal(beforePayload.password, '[REDACTED]')
  assert.equal(beforePayload.accountNo, '[REDACTED]')
  assert.equal(afterPayload.password, '[REDACTED]')
  assert.equal(afterPayload.token, '[REDACTED]')

  await prisma.auditLog.deleteMany({ where: { resourceId } })
})

test('Soft-deleted payments are hidden by default and visible with includeDeleted=true', async () => {
  const suffix = Date.now().toString()
  const trader = await prisma.trader.create({ data: { name: `pay-trader-${suffix}` } })
  const company = await prisma.company.create({ data: { name: `pay-company-${suffix}`, traderId: trader.id } })

  const activePayment = await prisma.payment.create({
    data: {
      companyId: company.id,
      billType: 'purchase',
      billId: `BILL-A-${suffix}`,
      billDate: new Date(),
      payDate: new Date(),
      amount: 100,
      mode: 'cash',
      status: 'paid'
    }
  })

  const deletedPayment = await prisma.payment.create({
    data: {
      companyId: company.id,
      billType: 'purchase',
      billId: `BILL-D-${suffix}`,
      billDate: new Date(),
      payDate: new Date(),
      amount: 50,
      mode: 'cash',
      status: 'pending',
      deletedAt: new Date()
    }
  })

  try {
    const requestDefault = makeRequest(`http://localhost/api/payments?companyId=${company.id}`, {
      headers: makeAuthHeaders('super_admin')
    })
    const responseDefault = await getPayments(requestDefault)
    const payloadDefault = await responseDefault.json()

    assert.equal(responseDefault.status, 200)
    assert.equal(Array.isArray(payloadDefault), true)
    assert.equal(payloadDefault.some((payment: { id: string }) => payment.id === activePayment.id), true)
    assert.equal(payloadDefault.some((payment: { id: string }) => payment.id === deletedPayment.id), false)

    const requestIncludeDeleted = makeRequest(
      `http://localhost/api/payments?companyId=${company.id}&includeDeleted=true`,
      {
        headers: makeAuthHeaders('super_admin')
      }
    )
    const responseIncludeDeleted = await getPayments(requestIncludeDeleted)
    const payloadIncludeDeleted = await responseIncludeDeleted.json()

    assert.equal(responseIncludeDeleted.status, 200)
    assert.equal(payloadIncludeDeleted.some((payment: { id: string }) => payment.id === deletedPayment.id), true)
  } finally {
    await prisma.payment.deleteMany({ where: { id: { in: [activePayment.id, deletedPayment.id] } } })
    await prisma.company.deleteMany({ where: { id: company.id } })
    await prisma.trader.deleteMany({ where: { id: trader.id } })
  }
})

test('Middleware returns 429 when global rate limit is exceeded', async () => {
  const rateLimitDisabled = process.env.DISABLE_RATE_LIMIT === 'true'
  const ip = `198.51.100.${Math.floor(Math.random() * 100) + 50}`
  const globalRateLimitMax = 120

  let lastStatus = 200
  for (let i = 0; i < globalRateLimitMax + 1; i += 1) {
    const request = makeRequest('http://localhost/api/auth', {
      method: 'POST',
      headers: {
        'x-forwarded-for': ip
      }
    })

    const response = await middleware(request)
    lastStatus = response.status
  }

  assert.equal(lastStatus, rateLimitDisabled ? 200 : 429)
})

test('Login enforces provided trader scope and blocks soft-deleted users', async () => {
  const suffix = Date.now().toString()
  const password = 'StrongTest#123'
  const hashedPassword = await bcrypt.hash(password, 12)
  const sharedUserId = `shared-login-${suffix}`

  const traderA = await prisma.trader.create({ data: { name: `login-trader-a-${suffix}` } })
  const traderB = await prisma.trader.create({ data: { name: `login-trader-b-${suffix}` } })

  const companyA = await prisma.company.create({ data: { name: `login-company-a-${suffix}`, traderId: traderA.id } })
  const companyB = await prisma.company.create({ data: { name: `login-company-b-${suffix}`, traderId: traderB.id } })

  const deletedUser = await prisma.user.create({
    data: {
      traderId: traderA.id,
      companyId: companyA.id,
      userId: sharedUserId,
      password: hashedPassword,
      role: 'company_user',
      deletedAt: new Date()
    }
  })

  const activeUser = await prisma.user.create({
    data: {
      traderId: traderB.id,
      companyId: companyB.id,
      userId: sharedUserId,
      password: hashedPassword,
      role: 'company_user'
    }
  })

  try {
    const withWrongTrader = await authenticateUser({
      traderId: traderA.id,
      userId: sharedUserId,
      password
    })
    assert.equal(withWrongTrader.success, false)
    assert.equal(withWrongTrader.error, 'Invalid credentials')

    const withCorrectTrader = await authenticateUser({
      traderId: traderB.id,
      userId: sharedUserId,
      password
    })
    assert.equal(withCorrectTrader.success, true)
    assert.equal(withCorrectTrader.user?.traderId, traderB.id)
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [deletedUser.id, activeUser.id] } } })
    await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } })
    await prisma.trader.deleteMany({ where: { id: { in: [traderA.id, traderB.id] } } })
  }
})

test('Login accepts trader scope by trader ID and trader name alias', async () => {
  const suffix = Date.now().toString()
  const password = 'StrictTraderId#123'
  const hashedPassword = await bcrypt.hash(password, 12)
  const traderId = `H${suffix}`
  const legacyTraderName = `demo-Treader-${suffix}`
  const userId = `strict-trader-${suffix}`

  const trader = await prisma.trader.create({
    data: {
      id: traderId,
      name: legacyTraderName
    }
  })
  const company = await prisma.company.create({
    data: {
      name: `strict-trader-company-${suffix}`,
      traderId
    }
  })
  const user = await prisma.user.create({
    data: {
      traderId,
      companyId: company.id,
      userId,
      password: hashedPassword,
      role: 'company_user'
    }
  })

  try {
    const withLegacyName = await authenticateUser({
      traderId: legacyTraderName,
      userId,
      password
    })
    assert.equal(withLegacyName.success, true)
    assert.equal(withLegacyName.user?.traderId, traderId)

    const withCurrentTraderId = await authenticateUser({
      traderId,
      userId,
      password
    })
    assert.equal(withCurrentTraderId.success, true)
    assert.equal(withCurrentTraderId.user?.traderId, traderId)
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } })
    await prisma.company.deleteMany({ where: { id: company.id } })
    await prisma.trader.deleteMany({ where: { id: trader.id } })
  }
})

test('Company mutation RBAC blocks company_user and out-of-scope trader_admin', async () => {
  const suffix = Date.now().toString()
  const traderA = await prisma.trader.create({ data: { name: `company-rbac-a-${suffix}` } })
  const traderB = await prisma.trader.create({ data: { name: `company-rbac-b-${suffix}` } })
  const companyB = await prisma.company.create({
    data: {
      name: `company-rbac-target-${suffix}`,
      traderId: traderB.id
    }
  })

  try {
    const companyUserCreateReq = makeRequest('http://localhost/api/companies', {
      method: 'POST',
      headers: {
        'x-user-id': `company-user-${suffix}`,
        'x-trader-id': traderA.id,
        'x-user-role': 'company_user',
        'x-user-role-normalized': 'company_user',
        'x-user-db-id': `company-user-db-${suffix}`,
        'x-company-id': companyB.id
      },
      body: {
        traderId: traderA.id,
        name: `forbidden-create-${suffix}`
      }
    })

    const companyUserCreateRes = await postCompanies(companyUserCreateReq)
    assert.equal(companyUserCreateRes.status, 403)

    const traderAdminUpdateReq = makeRequest(`http://localhost/api/companies?id=${companyB.id}`, {
      method: 'PUT',
      headers: {
        'x-user-id': `trader-admin-${suffix}`,
        'x-trader-id': traderA.id,
        'x-user-role': 'trader_admin',
        'x-user-role-normalized': 'trader_admin',
        'x-user-db-id': `trader-admin-db-${suffix}`
      },
      body: {
        name: `blocked-update-${suffix}`
      }
    })

    const traderAdminUpdateRes = await putCompanies(traderAdminUpdateReq)
    assert.equal(traderAdminUpdateRes.status, 403)
  } finally {
    await prisma.company.deleteMany({ where: { id: companyB.id } })
    await prisma.trader.deleteMany({ where: { id: { in: [traderA.id, traderB.id] } } })
  }
})

test('Super admin user role is auto-assigned and role field is rejected on update', async () => {
  const suffix = Date.now().toString()
  const trader = await prisma.trader.create({ data: { name: `sa-user-role-trader-${suffix}` } })
  const company = await prisma.company.create({
    data: {
      name: `sa-user-role-company-${suffix}`,
      traderId: trader.id
    }
  })

  try {
    const createReq = makeRequest('http://localhost/api/super-admin/users', {
      method: 'POST',
      headers: makeAuthHeaders('super_admin'),
      body: {
        traderId: trader.id,
        companyId: company.id,
        userId: `auto-role-user-${suffix}`,
        password: 'Strong#Pass123',
        name: 'Auto Role User'
      }
    })

    const createRes = await postSuperAdminUsers(createReq)
    assert.equal(createRes.status, 201)
    const createdUser = await createRes.json()
    assert.equal(createdUser.role, 'company_user')

    const updateWithRoleReq = makeRequest(`http://localhost/api/super-admin/users/${createdUser.id}`, {
      method: 'PUT',
      headers: makeAuthHeaders('super_admin'),
      body: {
        role: 'trader_admin',
        name: 'Should Fail'
      }
    })

    const updateWithRoleRes = await putSuperAdminUserById(updateWithRoleReq, {
      params: Promise.resolve({ id: createdUser.id })
    })
    assert.equal(updateWithRoleRes.status, 400)
  } finally {
    await prisma.user.deleteMany({
      where: {
        traderId: trader.id
      }
    })
    await prisma.company.deleteMany({ where: { id: company.id } })
    await prisma.trader.deleteMany({ where: { id: trader.id } })
  }
})

test('Subscription feature gating blocks company APIs when plan feature is disabled', async () => {
  const suffix = Date.now().toString()
  const trader = await prisma.trader.create({ data: { name: `sub-feature-trader-${suffix}` } })
  const company = await prisma.company.create({ data: { name: `sub-feature-company-${suffix}`, traderId: trader.id } })
  const user = await prisma.user.create({
    data: {
      traderId: trader.id,
      companyId: company.id,
      userId: `sub-feature-user-${suffix}`,
      password: 'hashed-password',
      role: 'company_user'
    }
  })
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: `Sub Feature Plan ${suffix}`,
      billingCycle: 'yearly',
      amount: 0,
      currency: 'INR',
      isActive: true,
      isTrialCapable: true
    }
  })

  try {
    await prisma.subscriptionPlanFeature.createMany({
      data: [
        {
          planId: plan.id,
          featureKey: 'dashboard',
          featureLabel: 'Dashboard Access',
          enabled: true,
          sortOrder: 0
        },
        {
          planId: plan.id,
          featureKey: 'masters',
          featureLabel: 'Master Data',
          enabled: false,
          sortOrder: 1
        }
      ]
    })

    await prisma.traderSubscription.create({
      data: {
        traderId: trader.id,
        planId: plan.id,
        subscriptionType: 'paid',
        status: 'active',
        billingCycle: 'yearly',
        amount: 0,
        currency: 'INR',
        planNameSnapshot: plan.name,
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 10 * 86_400_000),
        activatedAt: new Date()
      }
    })

    await prisma.userPermission.create({
      data: {
        userId: user.id,
        companyId: company.id,
        module: 'MASTER_PRODUCTS',
        canRead: true,
        canWrite: true
      }
    })

    const request = makeRequest(`http://localhost/api/products?companyId=${company.id}`, {
      headers: {
        'x-user-id': user.userId,
        'x-trader-id': trader.id,
        'x-user-role': 'company_user',
        'x-user-role-normalized': 'company_user',
        'x-user-db-id': user.id,
        'x-company-id': company.id
      }
    })

    const denied = await ensureCompanyAccess(request, company.id)
    assert.ok(denied)
    assert.equal(denied?.status, 403)
  } finally {
    await prisma.userPermission.deleteMany({ where: { userId: user.id } })
    await prisma.subscriptionPayment.deleteMany({ where: { traderId: trader.id } })
    await prisma.traderSubscription.deleteMany({ where: { traderId: trader.id } })
    await prisma.subscriptionPlanFeature.deleteMany({ where: { planId: plan.id } })
    await prisma.subscriptionPlan.deleteMany({ where: { id: plan.id } })
    await prisma.user.deleteMany({ where: { id: user.id } })
    await prisma.company.deleteMany({ where: { id: company.id } })
    await prisma.trader.deleteMany({ where: { id: trader.id } })
  }
})

test('Trader capacity snapshot uses active subscription limits', async () => {
  const suffix = Date.now().toString()
  const trader = await prisma.trader.create({
    data: {
      name: `sub-limit-trader-${suffix}`,
      maxCompanies: 10,
      maxUsers: 25
    }
  })
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: `Sub Limit Plan ${suffix}`,
      billingCycle: 'yearly',
      amount: 0,
      currency: 'INR',
      maxCompanies: 2,
      maxUsers: 4,
      isActive: true,
      isTrialCapable: false
    }
  })
  const companyA = await prisma.company.create({ data: { name: `sub-limit-company-a-${suffix}`, traderId: trader.id } })
  const companyB = await prisma.company.create({ data: { name: `sub-limit-company-b-${suffix}`, traderId: trader.id } })
  const user = await prisma.user.create({
    data: {
      traderId: trader.id,
      companyId: companyA.id,
      userId: `sub-limit-user-${suffix}`,
      password: 'hashed-password',
      role: 'company_user'
    }
  })

  try {
    await prisma.traderSubscription.create({
      data: {
        traderId: trader.id,
        planId: plan.id,
        subscriptionType: 'paid',
        status: 'active',
        billingCycle: 'yearly',
        amount: 0,
        currency: 'INR',
        planNameSnapshot: plan.name,
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 30 * 86_400_000),
        activatedAt: new Date()
      }
    })

    const snapshot = await getTraderCapacitySnapshot(prisma, trader.id)
    assert.ok(snapshot)
    assert.equal(snapshot?.maxCompanies, 2)
    assert.equal(snapshot?.maxUsers, 4)
    assert.equal(snapshot?.currentCompanies, 2)
    assert.equal(snapshot?.currentUsers, 1)
    assert.equal(snapshot?.limitSource, 'hybrid')
  } finally {
    await prisma.subscriptionPayment.deleteMany({ where: { traderId: trader.id } })
    await prisma.traderSubscription.deleteMany({ where: { traderId: trader.id } })
    await prisma.subscriptionPlan.deleteMany({ where: { id: plan.id } })
    await prisma.user.deleteMany({ where: { id: user.id } })
    await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } })
    await prisma.trader.deleteMany({ where: { id: trader.id } })
  }
})
