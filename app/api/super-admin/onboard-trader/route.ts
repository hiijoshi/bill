import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { normalizeOptionalString, normalizePhone, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { generateUniqueMandiAccountNumber } from '@/lib/mandi-account-number'

const onboardingSchema = z
  .object({
    trader: z
      .object({
        name: z.string().trim().min(1, 'Trader name is required').max(100),
        locked: z.boolean().optional()
      })
      .strict(),
    users: z
      .array(
        z
          .object({
            userId: z.string().trim().min(1, 'User ID is required').max(50),
            name: z.string().trim().min(1, 'Name is required').max(100),
            password: z.string().min(6, 'Password must be at least 6 characters'),
            companyName: z.string().trim().optional()
          })
          .strict()
      )
      .min(1, 'At least one user is required'),
    companies: z
      .array(
        z
          .object({
            name: z.string().trim().min(1, 'Company name is required').max(100),
            address: z.string().trim().max(400).optional().nullable(),
            phone: z.string().optional().nullable(),
            locked: z.boolean().optional()
          })
          .strict()
      )
      .min(1, 'At least one company is required')
  })
  .strict()

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const body = await request.json().catch(() => null)
    const parsed = onboardingSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const traderName = parsed.data.trader.name.trim()

    const duplicateTrader = await prisma.trader.findFirst({
      where: {
        name: traderName,
        deletedAt: null
      },
      select: { id: true }
    })

    if (duplicateTrader) {
      return NextResponse.json({ error: 'Trader with this name already exists' }, { status: 409 })
    }

    const companyNames = new Set<string>()
    for (const company of parsed.data.companies) {
      const normalizedName = company.name.trim().toLowerCase()
      if (companyNames.has(normalizedName)) {
        return NextResponse.json({ error: `Duplicate company name: ${company.name}` }, { status: 400 })
      }
      companyNames.add(normalizedName)

      if (company.phone) {
        const phone = normalizePhone(company.phone)
        if (!phone) {
          return NextResponse.json(
            { error: `Company phone must be 10 digits: ${company.name}` },
            { status: 400 }
          )
        }
      }
    }

    const userIds = new Set<string>()
    for (const user of parsed.data.users) {
      const normalized = user.userId.trim().toLowerCase()
      if (userIds.has(normalized)) {
        return NextResponse.json({ error: `Duplicate user ID in payload: ${user.userId}` }, { status: 400 })
      }
      userIds.add(normalized)
    }

    const result = await prisma.$transaction(async (tx) => {
      const trader = await tx.trader.create({
        data: {
          name: traderName,
          locked: parsed.data.trader.locked ?? false
        }
      })

      const createdCompanies: Array<{ id: string; name: string; traderId: string | null; locked: boolean }> = []
      for (const company of parsed.data.companies) {
        const mandiAccountNumber = await generateUniqueMandiAccountNumber(tx)
        const created = await tx.company.create({
          data: {
            traderId: trader.id,
            name: company.name.trim(),
            address: normalizeOptionalString(company.address),
            phone: company.phone ? normalizePhone(company.phone) : null,
            mandiAccountNumber,
            locked: company.locked ?? false
          }
        })
        createdCompanies.push(created)
      }

      const companyByName = new Map(createdCompanies.map((company) => [company.name.toLowerCase(), company]))
      const defaultCompany = createdCompanies[0] || null

      const createdUsers: Array<{
        id: string
        traderId: string
        companyId: string | null
        userId: string
        name: string | null
        role: string | null
        locked: boolean
      }> = []

      for (const user of parsed.data.users) {
        const normalizedUserId = user.userId.trim().toLowerCase()

        const existing = await tx.user.findFirst({
          where: {
            traderId: trader.id,
            userId: normalizedUserId,
            deletedAt: null
          },
          select: { id: true }
        })
        if (existing) {
          throw new Error(`User with ID ${normalizedUserId} already exists`)
        }

        const companyFromName = user.companyName
          ? companyByName.get(user.companyName.trim().toLowerCase()) || null
          : null

        const hashedPassword = await bcrypt.hash(user.password, 12)

        const created = await tx.user.create({
          data: {
            traderId: trader.id,
            companyId: companyFromName?.id || defaultCompany?.id || null,
            userId: normalizedUserId,
            password: hashedPassword,
            name: normalizeOptionalString(user.name),
            role: 'company_user',
            locked: parsed.data.trader.locked ?? false
          }
        })

        createdUsers.push({
          id: created.id,
          traderId: created.traderId,
          companyId: created.companyId,
          userId: created.userId,
          name: created.name,
          role: created.role,
          locked: created.locked
        })
      }

      return {
        trader,
        companies: createdCompanies,
        users: createdUsers
      }
    })

    const actor = {
      id: authResult.auth.userDbId || authResult.auth.userId,
      role: authResult.auth.role
    }
    const requestMeta = getAuditRequestMeta(request)

    await writeAuditLog({
      actor,
      action: result.trader.locked ? 'LOCK' : 'CREATE',
      resourceType: 'TRADER',
      resourceId: result.trader.id,
      scope: { traderId: result.trader.id },
      after: result.trader,
      requestMeta
    })

    for (const company of result.companies) {
      await writeAuditLog({
        actor,
        action: company.locked ? 'LOCK' : 'CREATE',
        resourceType: 'COMPANY',
        resourceId: company.id,
        scope: {
          traderId: company.traderId,
          companyId: company.id
        },
        after: company,
        requestMeta
      })
    }

    for (const user of result.users) {
      await writeAuditLog({
        actor,
        action: user.locked ? 'LOCK' : 'CREATE',
        resourceType: 'USER',
        resourceId: user.id,
        scope: {
          traderId: user.traderId,
          companyId: user.companyId
        },
        after: user,
        requestMeta
      })
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Trader setup created successfully',
        data: {
          trader: result.trader,
          users: result.users,
          companies: result.companies
        }
      },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create trader setup'
      },
      { status: 500 }
    )
  }
}
