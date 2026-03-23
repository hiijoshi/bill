import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { normalizeAppRole, requireRoles, hasCompanyAccess, ensureCompanyAccess } from '../lib/api-security'
import { authenticateUser, generateToken } from '../lib/auth'
import { middleware } from '../middleware.ts'
import { writeAuditLog } from '../lib/audit-logging'
import { GET as getPayments } from '../app/api/payments/route'
import { POST as postCompanies, PUT as putCompanies } from '../app/api/companies/route'
import { POST as postSuperAdminUsers } from '../app/api/super-admin/users/route'
import { PUT as putSuperAdminUserById } from '../app/api/super-admin/users/[id]/route'

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

  try {
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
    await prisma.userPermission.deleteMany({ where: { userId: user.id } })
    await prisma.user.deleteMany({ where: { id: user.id } })
    await prisma.company.deleteMany({ where: { id: company.id } })
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

  let lastStatus = 200
  for (let i = 0; i < 61; i += 1) {
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
