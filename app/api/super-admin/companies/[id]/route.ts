import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { normalizeOptionalString, normalizePhone, parseBooleanParam, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { generateUniqueMandiAccountNumber } from '@/lib/mandi-account-number'
import { getTraderCapacitySnapshot } from '@/lib/trader-limits'

const idParamsSchema = z.object({ id: z.string().trim().min(1, 'Company ID is required') })

const updateCompanySchema = z
  .object({
    name: z.string().trim().min(1, 'Company name is required').max(100).optional(),
    traderId: z.string().trim().min(1).optional().nullable(),
    address: z.string().trim().max(400).optional().nullable(),
    phone: z.string().optional().nullable(),
    mandiAccountNumber: z.string().trim().max(120).optional().nullable(),
    locked: z.boolean().optional()
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.traderId !== undefined ||
      value.address !== undefined ||
      value.phone !== undefined ||
      value.mandiAccountNumber !== undefined ||
      value.locked !== undefined,
    {
      message: 'At least one field is required'
    }
  )

function normalizeTraderId(input: string | null | undefined): string | null | undefined {
  if (input === undefined) return undefined
  if (input === null) return null
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeUpdatePayload(payload: z.infer<typeof updateCompanySchema>) {
  if (payload.phone !== undefined) {
    const normalizedPhone = payload.phone === null ? null : normalizePhone(payload.phone)
    if (payload.phone && !normalizedPhone) {
      return { error: 'Phone must contain exactly 10 digits' as const }
    }
  }

  return {
    name: payload.name?.trim(),
    traderId: normalizeTraderId(payload.traderId),
    address:
      payload.address === undefined
        ? undefined
        : payload.address === null
          ? null
          : normalizeOptionalString(payload.address),
    phone:
      payload.phone === undefined
        ? undefined
        : payload.phone === null
          ? null
          : normalizePhone(payload.phone),
    mandiAccountNumber:
      payload.mandiAccountNumber === undefined
        ? undefined
        : payload.mandiAccountNumber === null
          ? null
          : normalizeOptionalString(payload.mandiAccountNumber),
    locked: payload.locked
  }
}

async function getCompanyById(id: string, includeDeleted: boolean) {
  const company = await prisma.company.findFirst({
    where: {
      id,
      ...(includeDeleted ? {} : { deletedAt: null })
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
        select: { id: true, userId: true, role: true, locked: true }
      },
      parties: { select: { id: true } },
      farmers: { select: { id: true } },
      suppliers: { select: { id: true } },
      products: { select: { id: true } },
      purchaseBills: { select: { id: true } },
      salesBills: { select: { id: true } }
    }
  })

  if (!company) return null
  let mandiAccountNumber = company.mandiAccountNumber

  if (!company.deletedAt && (!mandiAccountNumber || !mandiAccountNumber.trim())) {
    mandiAccountNumber = await generateUniqueMandiAccountNumber(prisma)
    await prisma.company.update({
      where: { id: company.id },
      data: { mandiAccountNumber }
    })
  }

  return {
    id: company.id,
    name: company.name,
    traderId: company.traderId,
    address: company.address,
    phone: company.phone,
    mandiAccountNumber,
    locked: company.locked,
    deletedAt: company.deletedAt,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
    trader: company.trader,
    users: company.users,
    _count: {
      users: company.users.length,
      parties: company.parties.length,
      farmers: company.farmers.length,
      suppliers: company.suppliers.length,
      products: company.products.length,
      purchaseBills: company.purchaseBills.length,
      salesBills: company.salesBills.length
    }
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid company ID' }, { status: 400 })
    }

    const includeDeleted = parseBooleanParam(new URL(request.url).searchParams.get('includeDeleted'))
    const company = await getCompanyById(parsedParams.data.id, includeDeleted)

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    return NextResponse.json(company)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch company' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid company ID' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    const parsedBody = updateCompanySchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsedBody.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const normalized = normalizeUpdatePayload(parsedBody.data)
    if ('error' in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 })
    }

    const companyId = parsedParams.data.id
    const existingCompany = await prisma.company.findFirst({
      where: { id: companyId, deletedAt: null }
    })

    if (!existingCompany) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    if (normalized.locked === true && authResult.auth.companyId === companyId) {
      return NextResponse.json({ error: 'Cannot lock current session company' }, { status: 403 })
    }

    if (normalized.traderId !== undefined && normalized.traderId !== null) {
      const traderCapacity = await getTraderCapacitySnapshot(prisma, normalized.traderId)

      if (!traderCapacity) {
        return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
      }

      if (traderCapacity.locked) {
        return NextResponse.json({ error: 'Trader is locked' }, { status: 403 })
      }
    }

    const nextName = normalized.name ?? existingCompany.name
    const nextTraderId =
      normalized.traderId === undefined ? existingCompany.traderId : normalized.traderId

    if (nextTraderId && nextTraderId !== existingCompany.traderId) {
      const traderCapacity = await getTraderCapacitySnapshot(prisma, nextTraderId)
      if (!traderCapacity) {
        return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
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

      const movingUsers = await prisma.user.findMany({
        where: {
          companyId,
          deletedAt: null,
          NOT: [{ role: 'SUPER_ADMIN' }, { role: 'super_admin' }]
        },
        select: {
          id: true,
          userId: true
        }
      })

      if (
        traderCapacity.maxUsers !== null &&
        traderCapacity.currentUsers + movingUsers.length > traderCapacity.maxUsers
      ) {
        return NextResponse.json(
          { error: `Trader user limit reached (${traderCapacity.currentUsers}/${traderCapacity.maxUsers})` },
          { status: 409 }
        )
      }

      if (movingUsers.length > 0) {
        const duplicateUsers = await prisma.user.findMany({
          where: {
            traderId: nextTraderId,
            deletedAt: null,
            userId: {
              in: movingUsers.map((user) => user.userId)
            }
          },
          select: {
            userId: true
          },
          take: 1
        })

        if (duplicateUsers[0]) {
          return NextResponse.json(
            { error: `Cannot move company. User ID "${duplicateUsers[0].userId}" already exists in the target trader.` },
            { status: 409 }
          )
        }
      }
    }

    const duplicate = await prisma.company.findFirst({
      where: {
        id: { not: companyId },
        name: nextName,
        traderId: nextTraderId,
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

    let nextMandiAccountNumber: string | undefined
    if (normalized.mandiAccountNumber !== undefined) {
      if (normalized.mandiAccountNumber === null) {
        nextMandiAccountNumber = await generateUniqueMandiAccountNumber(prisma)
      } else {
        nextMandiAccountNumber = normalized.mandiAccountNumber
      }
    } else if (!existingCompany.mandiAccountNumber || !existingCompany.mandiAccountNumber.trim()) {
      nextMandiAccountNumber = await generateUniqueMandiAccountNumber(prisma)
    }

    if (nextMandiAccountNumber) {
      const duplicateMandiAccount = await prisma.company.findFirst({
        where: {
          id: { not: companyId },
          mandiAccountNumber: nextMandiAccountNumber,
          deletedAt: null
        },
        select: { id: true }
      })

      if (duplicateMandiAccount) {
        return NextResponse.json({ error: 'Mandi account number already exists' }, { status: 409 })
      }
    }

    const updatedCompany = await prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: companyId },
        data: {
          ...(normalized.name !== undefined ? { name: normalized.name } : {}),
          ...(normalized.traderId !== undefined ? { traderId: normalized.traderId } : {}),
          ...(normalized.address !== undefined ? { address: normalized.address } : {}),
          ...(normalized.phone !== undefined ? { phone: normalized.phone } : {}),
          ...(nextMandiAccountNumber !== undefined ? { mandiAccountNumber: nextMandiAccountNumber } : {}),
          ...(normalized.locked !== undefined ? { locked: normalized.locked } : {})
        }
      })

      if (normalized.locked !== undefined && normalized.locked !== existingCompany.locked) {
        await tx.user.updateMany({
          where: {
            companyId,
            deletedAt: null
          },
          data: {
            locked: normalized.locked
          }
        })
      }

      if (
        normalized.traderId !== undefined &&
        normalized.traderId !== null &&
        normalized.traderId !== existingCompany.traderId
      ) {
        await tx.user.updateMany({
          where: {
            companyId,
            deletedAt: null
          },
          data: {
            traderId: normalized.traderId
          }
        })
      }

      return updated
    })

    const action =
      normalized.locked !== undefined && normalized.locked !== existingCompany.locked
        ? normalized.locked
          ? 'LOCK'
          : 'UNLOCK'
        : 'UPDATE'

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action,
      resourceType: 'COMPANY',
      resourceId: companyId,
      scope: {
        traderId: updatedCompany.traderId,
        companyId
      },
      before: existingCompany,
      after: updatedCompany,
      requestMeta: getAuditRequestMeta(request)
    })

    const response = await getCompanyById(companyId, false)
    return NextResponse.json(response)
  } catch {
    return NextResponse.json({ error: 'Failed to update company' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = idParamsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid company ID' }, { status: 400 })
    }

    const companyId = parsedParams.data.id
    const existingCompany = await prisma.company.findFirst({
      where: {
        id: companyId,
        deletedAt: null
      }
    })

    if (!existingCompany) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    const deletedAt = new Date()

    const deletedSnapshot = await prisma.$transaction(async (tx) => {
      const company = await tx.company.update({
        where: { id: companyId },
        data: {
          locked: true,
          deletedAt
        }
      })

      await tx.user.updateMany({
        where: {
          companyId,
          deletedAt: null
        },
        data: {
          locked: true,
          deletedAt
        }
      })

      return company
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: 'DELETE',
      resourceType: 'COMPANY',
      resourceId: companyId,
      scope: {
        traderId: existingCompany.traderId,
        companyId
      },
      before: existingCompany,
      after: deletedSnapshot,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete company' }, { status: 500 })
  }
}
