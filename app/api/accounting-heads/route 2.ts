import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { ensureAccountingHeadSchema } from '@/lib/accounting-head-schema'
import { cleanString, parseNonNegativeNumber } from '@/lib/field-validation'
import { prisma } from '@/lib/prisma'

function normalizeCompanyId(raw: string | null): string | null {
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

const postSchema = z.object({
  name: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  amount: z.union([z.number(), z.string()]).optional().nullable(),
  value: z.union([z.number(), z.string()]).optional().nullable()
}).strict()

const putSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().trim().min(1),
  amount: z.union([z.number(), z.string()]).optional().nullable(),
  value: z.union([z.number(), z.string()]).optional().nullable()
}).strict()

export async function GET(request: NextRequest) {
  try {
    await ensureAccountingHeadSchema(prisma)

    const companyId =
      normalizeCompanyId(new URL(request.url).searchParams.get('companyId')) ||
      getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const rows = await prisma.accountingHead.findMany({
      where: { companyId },
      orderBy: [{ name: 'asc' }, { category: 'asc' }]
    })

    return NextResponse.json(rows)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureAccountingHeadSchema(prisma)

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
    const value = parseNonNegativeNumber(parsed.data.value) ?? 0

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

    const created = await prisma.accountingHead.create({
      data: {
        companyId,
        name,
        category,
        amount,
        value
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Accounting head stored successfully',
      accountingHead: created
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureAccountingHeadSchema(prisma)

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

    const updated = await prisma.accountingHead.updateMany({
      where: { id, companyId },
      data: {
        name: parsed.data.name.trim(),
        category: parsed.data.category.trim(),
        amount: parseNonNegativeNumber(parsed.data.amount) ?? 0,
        value: parseNonNegativeNumber(parsed.data.value) ?? 0
      }
    })

    if (updated.count === 0) {
      return NextResponse.json({ error: 'Accounting head not found' }, { status: 404 })
    }

    const accountingHead = await prisma.accountingHead.findFirst({
      where: { id, companyId }
    })

    return NextResponse.json({
      success: true,
      message: 'Accounting head updated successfully',
      accountingHead
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureAccountingHeadSchema(prisma)

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
