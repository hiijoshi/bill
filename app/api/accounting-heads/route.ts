import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { ensureAccountingHeadSchema } from '@/lib/accounting-head-schema'
import { ensureDefaultAccountingHeads } from '@/lib/default-accounting-heads'
import { cleanString, parseNonNegativeNumber } from '@/lib/field-validation'
import { ensureMandiSchema } from '@/lib/mandi-schema'
import { assertMandiTypeBelongsToCompany, normalizeOptionalMandiTypeId } from '@/lib/mandi-type-utils'
import { prisma } from '@/lib/prisma'

type AccountingHeadWithConfig = Prisma.AccountingHeadGetPayload<{
  include: {
    mandiConfig: {
      include: {
        mandiType: {
          select: {
            id: true
            name: true
          }
        }
      }
    }
  }
}>

function normalizeCompanyId(raw: string | null): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value === 'null' || value === 'undefined') return null
  return value
}

function normalizeOptionalId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value === 'null' || value === 'undefined') return null
  return value
}

function readCompanyIdFromAuth(request: NextRequest): string | null {
  const req = request as NextRequest & {
    user?: { companyId?: string | null; defaultCompanyId?: string | null }
    auth?: { companyId?: string | null; defaultCompanyId?: string | null }
  }
  const candidates = [
    req.user?.companyId,
    req.user?.defaultCompanyId,
    req.auth?.companyId,
    req.auth?.defaultCompanyId,
    request.headers.get('x-auth-company-id'),
    request.headers.get('x-company-id')
  ]
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (value && value !== 'null' && value !== 'undefined') return value
  }
  return null
}

function getCompanyIdFromAuthenticatedRequest(request: NextRequest): string {
  const companyId = readCompanyIdFromAuth(request)
  if (!companyId) {
    throw new Error('No company assigned to this user')
  }
  return companyId
}

const accountingHeadSchema = z.object({
  name: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  amount: z.union([z.number(), z.string()]).optional().nullable(),
  value: z.union([z.number(), z.string()]).optional().nullable(),
  mandiTypeId: z.string().optional().nullable(),
  isMandiCharge: z.boolean().optional(),
  calculationBasis: z.string().optional().nullable(),
  defaultValue: z.union([z.number(), z.string()]).optional().nullable(),
  accountGroup: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

const postSchema = accountingHeadSchema
const putSchema = accountingHeadSchema.extend({
  name: z.string().trim().min(1),
  category: z.string().trim().min(1)
}).strict()

function normalizeAccountingHeadResponse(head: AccountingHeadWithConfig | null) {
  if (!head) return null
  return {
    id: head.id,
    companyId: head.companyId,
    name: head.name,
    category: head.category,
    amount: Number(head.amount || 0),
    value: Number(head.value || 0),
    mandiTypeId: head.mandiConfig?.mandiTypeId || null,
    mandiTypeName: head.mandiConfig?.mandiType?.name || null,
    isMandiCharge: Boolean(head.mandiConfig?.isMandiCharge),
    calculationBasis: head.mandiConfig?.calculationBasis || null,
    defaultValue: Number(head.mandiConfig?.defaultValue ?? head.value ?? 0),
    accountGroup: head.mandiConfig?.accountGroup || null,
    isActive: head.mandiConfig?.isActive !== false,
    createdAt: head.createdAt,
    updatedAt: head.updatedAt
  }
}

export async function GET(request: NextRequest) {
  try {
    await ensureAccountingHeadSchema(prisma)
    await ensureMandiSchema(prisma)

    const companyId =
      normalizeCompanyId(new URL(request.url).searchParams.get('companyId')) ||
      getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    await ensureDefaultAccountingHeads(prisma, companyId)

    const rows = await prisma.accountingHead.findMany({
      where: { companyId },
      include: {
        mandiConfig: {
          include: {
            mandiType: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: [{ name: 'asc' }, { category: 'asc' }]
    })

    return NextResponse.json(rows.map((row) => normalizeAccountingHeadResponse(row)))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureAccountingHeadSchema(prisma)
    await ensureMandiSchema(prisma)

    const parsed = await parseJsonWithSchema(request, postSchema)
    if (!parsed.ok) return parsed.response

    const companyId =
      normalizeCompanyId(new URL(request.url).searchParams.get('companyId')) ||
      getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const name = cleanString(parsed.data.name)
    const category = cleanString(parsed.data.category)
    const amount = parseNonNegativeNumber(parsed.data.amount) ?? 0
    const normalizedDefaultValue = parseNonNegativeNumber(parsed.data.defaultValue ?? parsed.data.value) ?? 0
    let mandiTypeId: string | null = null
    try {
      mandiTypeId = await assertMandiTypeBelongsToCompany(
        prisma,
        companyId,
        normalizeOptionalMandiTypeId(parsed.data.mandiTypeId)
      )
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid mandi type' }, { status: 400 })
    }
    const calculationBasis = cleanString(parsed.data.calculationBasis)?.toUpperCase() || null
    const accountGroup = cleanString(parsed.data.accountGroup)?.toUpperCase() || null
    const isMandiCharge = Boolean(parsed.data.isMandiCharge)
    const isActive = parsed.data.isActive !== false

    if (!name || !category) {
      return NextResponse.json({ error: 'Accounting head name and category are required' }, { status: 400 })
    }

    const duplicate = await prisma.accountingHead.findFirst({
      where: {
        companyId,
        name
      },
      select: { id: true }
    })

    if (duplicate) {
      return NextResponse.json({ error: 'Accounting head name already exists' }, { status: 400 })
    }

    const created = await prisma.$transaction(async (tx) => {
      const accountingHead = await tx.accountingHead.create({
        data: {
          companyId,
          name,
          category,
          amount,
          value: normalizedDefaultValue
        }
      })

      await tx.accountingHeadMandiConfig.create({
        data: {
          accountingHeadId: accountingHead.id,
          mandiTypeId,
          isMandiCharge,
          calculationBasis,
          defaultValue: normalizedDefaultValue,
          accountGroup,
          isActive
        }
      })

      return tx.accountingHead.findFirst({
        where: { id: accountingHead.id },
        include: {
          mandiConfig: {
            include: {
              mandiType: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        }
      })
    })

    return NextResponse.json({
      success: true,
      message: 'Accounting head stored successfully',
      accountingHead: normalizeAccountingHeadResponse(created)
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureAccountingHeadSchema(prisma)
    await ensureMandiSchema(prisma)

    const parsed = await parseJsonWithSchema(request, putSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const id = cleanString(searchParams.get('id'))
    if (!id) {
      return NextResponse.json({ error: 'Accounting head ID required' }, { status: 400 })
    }

    const companyId =
      normalizeCompanyId(searchParams.get('companyId')) ||
      getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const duplicate = await prisma.accountingHead.findFirst({
      where: {
        companyId,
        name: parsed.data.name.trim(),
        id: { not: id }
      },
      select: { id: true }
    })

    if (duplicate) {
      return NextResponse.json({ error: 'Accounting head name already exists' }, { status: 400 })
    }

    let mandiTypeId: string | null = null
    try {
      mandiTypeId = await assertMandiTypeBelongsToCompany(
        prisma,
        companyId,
        normalizeOptionalMandiTypeId(parsed.data.mandiTypeId)
      )
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid mandi type' }, { status: 400 })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.accountingHead.updateMany({
        where: { id, companyId },
        data: {
          name: parsed.data.name.trim(),
          category: parsed.data.category.trim(),
          amount: parseNonNegativeNumber(parsed.data.amount) ?? 0,
          value: parseNonNegativeNumber(parsed.data.defaultValue ?? parsed.data.value) ?? 0
        }
      })

      if (changed.count === 0) {
        return null
      }

      await tx.accountingHeadMandiConfig.upsert({
        where: { accountingHeadId: id },
        create: {
          accountingHeadId: id,
          mandiTypeId,
          isMandiCharge: Boolean(parsed.data.isMandiCharge),
          calculationBasis: cleanString(parsed.data.calculationBasis)?.toUpperCase() || null,
          defaultValue: parseNonNegativeNumber(parsed.data.defaultValue ?? parsed.data.value) ?? 0,
          accountGroup: cleanString(parsed.data.accountGroup)?.toUpperCase() || null,
          isActive: parsed.data.isActive !== false
        },
        update: {
          mandiTypeId,
          isMandiCharge: Boolean(parsed.data.isMandiCharge),
          calculationBasis: cleanString(parsed.data.calculationBasis)?.toUpperCase() || null,
          defaultValue: parseNonNegativeNumber(parsed.data.defaultValue ?? parsed.data.value) ?? 0,
          accountGroup: cleanString(parsed.data.accountGroup)?.toUpperCase() || null,
          isActive: parsed.data.isActive !== false
        }
      })

      return tx.accountingHead.findFirst({
        where: { id, companyId },
        include: {
          mandiConfig: {
            include: {
              mandiType: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        }
      })
    })

    if (!updated) {
      return NextResponse.json({ error: 'Accounting head not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: 'Accounting head updated successfully',
      accountingHead: normalizeAccountingHeadResponse(updated)
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureAccountingHeadSchema(prisma)
    await ensureMandiSchema(prisma)

    const { searchParams } = new URL(request.url)
    const id = cleanString(searchParams.get('id'))
    const all = searchParams.get('all') === 'true'

    const companyId =
      normalizeCompanyId(searchParams.get('companyId')) ||
      getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (all) {
      const deleted = await prisma.accountingHead.deleteMany({
        where: { companyId }
      })

      return NextResponse.json({
        success: true,
        message: `${deleted.count} accounting heads deleted successfully`,
        count: deleted.count
      })
    }

    if (!id) {
      return NextResponse.json({ error: 'Accounting head ID required' }, { status: 400 })
    }

    const deleted = await prisma.accountingHead.deleteMany({
      where: { id, companyId }
    })

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Accounting head not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Accounting head deleted successfully' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
