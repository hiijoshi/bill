import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { normalizeOptionalString, normalizePhone, parseBooleanParam, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { backfillMissingMandiAccountNumbers, generateUniqueMandiAccountNumber } from '@/lib/mandi-account-number'
import { getTraderCapacitySnapshot } from '@/lib/trader-limits'

const companyPayloadSchema = z
  .object({
    name: z.string().trim().min(1, 'Company name is required').max(100),
    traderId: z.string().trim().min(1).optional().nullable(),
    address: z.string().trim().max(400).optional().nullable(),
    phone: z.string().optional().nullable(),
    mandiAccountNumber: z.string().trim().max(120).optional().nullable(),
    locked: z.boolean().optional()
  })
  .strict()

function normalizeTraderId(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeCompanyPayload(payload: z.infer<typeof companyPayloadSchema>) {
  const normalizedPhone = payload.phone == null ? null : normalizePhone(payload.phone)
  if (payload.phone && !normalizedPhone) {
    return { error: 'Phone must contain exactly 10 digits' as const }
  }

  return {
    name: payload.name.trim(),
    traderId: normalizeTraderId(payload.traderId),
    address: normalizeOptionalString(payload.address),
    phone: normalizedPhone,
    mandiAccountNumber: normalizeOptionalString(payload.mandiAccountNumber),
    locked: payload.locked ?? false
  }
}

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    await backfillMissingMandiAccountNumbers(prisma)

    const searchParams = new URL(request.url).searchParams
    const includeDeleted = parseBooleanParam(searchParams.get('includeDeleted'))
    const traderIdFilter = normalizeTraderId(searchParams.get('traderId'))

    const companies = await prisma.company.findMany({
      where: {
        ...(includeDeleted ? {} : { deletedAt: null }),
        ...(traderIdFilter ? { traderId: traderIdFilter } : {})
      },
      select: {
        id: true,
        name: true,
        traderId: true,
        address: true,
        phone: true,
        mandiAccountNumber: true,
        locked: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        trader: {
          select: {
            id: true,
            name: true
          }
        },
        users: {
          where: includeDeleted ? undefined : { deletedAt: null },
          select: { id: true }
        },
        parties: { select: { id: true } },
        farmers: { select: { id: true } },
        suppliers: { select: { id: true } },
        products: { select: { id: true } },
        purchaseBills: { select: { id: true } },
        salesBills: { select: { id: true } }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    const response = companies.map((company) => ({
      id: company.id,
      name: company.name,
      traderId: company.traderId,
      address: company.address,
      phone: company.phone,
      mandiAccountNumber: company.mandiAccountNumber,
      locked: company.locked,
      deletedAt: company.deletedAt,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      trader: company.trader,
      _count: {
        users: company.users.length,
        parties: company.parties.length,
        farmers: company.farmers.length,
        suppliers: company.suppliers.length,
        products: company.products.length,
        purchaseBills: company.purchaseBills.length,
        salesBills: company.salesBills.length
      }
    }))

    return NextResponse.json(response)
  } catch (error) {
    console.error('super-admin companies GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch companies' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const body = await request.json().catch(() => null)
    const parsed = companyPayloadSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const normalized = normalizeCompanyPayload(parsed.data)
    if ('error' in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 })
    }

    if (normalized.traderId) {
      const traderCapacity = await getTraderCapacitySnapshot(prisma, normalized.traderId)

      if (!traderCapacity) {
        return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
      }

      if (traderCapacity.locked) {
        return NextResponse.json({ error: 'Trader is locked' }, { status: 403 })
      }

      if (
        traderCapacity.maxCompanies !== null &&
        traderCapacity.currentCompanies >= traderCapacity.maxCompanies
      ) {
        return NextResponse.json(
          { error: `Trader company limit reached (${traderCapacity.currentCompanies}/${traderCapacity.maxCompanies})` },
          { status: 409 }
        )
      }
    }

    const duplicate = await prisma.company.findFirst({
      where: {
        name: normalized.name,
        traderId: normalized.traderId,
        deletedAt: null
      },
      select: { id: true }
    })

    if (duplicate) {
      return NextResponse.json(
        { error: 'Company with this name already exists for the selected trader' },
        { status: 409 }
      )
    }

    let mandiAccountNumber = normalized.mandiAccountNumber
    if (!mandiAccountNumber) {
      mandiAccountNumber = await generateUniqueMandiAccountNumber(prisma)
    } else {
      const duplicateMandiAccount = await prisma.company.findFirst({
        where: {
          mandiAccountNumber,
          deletedAt: null
        },
        select: { id: true }
      })

      if (duplicateMandiAccount) {
        return NextResponse.json({ error: 'Mandi account number already exists' }, { status: 409 })
      }
    }

    const company = await prisma.company.create({
      data: {
        name: normalized.name,
        traderId: normalized.traderId,
        address: normalized.address,
        phone: normalized.phone,
        mandiAccountNumber,
        locked: normalized.locked
      },
      include: {
        trader: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: company.locked ? 'LOCK' : 'CREATE',
      resourceType: 'COMPANY',
      resourceId: company.id,
      scope: {
        traderId: company.traderId,
        companyId: company.id
      },
      after: company,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json(
      {
        ...company,
        _count: {
          users: 0,
          parties: 0,
          farmers: 0,
          suppliers: 0,
          products: 0,
          purchaseBills: 0,
          salesBills: 0
        }
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('super-admin companies POST failed:', error)
    return NextResponse.json({ error: 'Failed to create company' }, { status: 500 })
  }
}
