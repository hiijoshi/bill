import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { cleanString, normalizeTenDigitPhone } from '@/lib/field-validation'
import { buildPaginationMeta, parsePaginationParams } from '@/lib/pagination'

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
  type: z.enum(['farmer', 'buyer']).optional(),
  name: z.string().trim().min(1).optional(),
  address: z.string().optional().nullable(),
  phone1: z.string().optional().nullable(),
  phone2: z.string().optional().nullable(),
  creditLimit: z.union([z.number(), z.string()]).optional().nullable(),
  creditDays: z.union([z.number(), z.string()]).optional().nullable(),
  ifscCode: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  accountNo: z.string().optional().nullable()
}).strict()

const putSchema = z.object({
  type: z.enum(['farmer', 'buyer']),
  name: z.string().trim().min(1),
  address: z.string().optional().nullable(),
  phone1: z.string().optional().nullable(),
  phone2: z.string().optional().nullable(),
  creditLimit: z.union([z.number(), z.string()]).optional().nullable(),
  creditDays: z.union([z.number(), z.string()]).optional().nullable(),
  ifscCode: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  accountNo: z.string().optional().nullable()
}).strict()

function normalizeOptionalNonNegativeNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, parsed)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = normalizeCompanyId(searchParams.get('companyId')) || getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const pagination = parsePaginationParams(searchParams, { defaultPageSize: 50, maxPageSize: 200 })
    const where = {
      companyId,
      ...(pagination.search
        ? {
            OR: [
              { name: { contains: pagination.search } },
              { type: { contains: pagination.search } },
              { phone1: { contains: pagination.search } },
              { phone2: { contains: pagination.search } },
              { bankName: { contains: pagination.search } },
              { address: { contains: pagination.search } }
            ]
          }
        : {})
    }

    const [parties, total] = await Promise.all([
      prisma.party.findMany({
        where,
        orderBy: { name: 'asc' },
        ...(pagination.enabled ? { skip: pagination.skip, take: pagination.pageSize } : {})
      }),
      pagination.enabled ? prisma.party.count({ where }) : Promise.resolve(0)
    ])

    if (pagination.enabled) {
      return NextResponse.json({
        data: parties,
        meta: buildPaginationMeta(total, pagination)
      })
    }

    return NextResponse.json(parties)
  } catch (error) {
    console.error('Error fetching parties:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, postSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const companyId = normalizeCompanyId(searchParams.get('companyId')) || getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (!parsed.data.type || !parsed.data.name) {
      return NextResponse.json({ error: 'Party type and name are required' }, { status: 400 })
    }
    const phone1 = normalizeTenDigitPhone(parsed.data.phone1)
    const phone2 = normalizeTenDigitPhone(parsed.data.phone2)
    if (parsed.data.phone1 !== undefined && parsed.data.phone1 !== null && !phone1) {
      return NextResponse.json({ error: 'Primary phone must be exactly 10 digits' }, { status: 400 })
    }
    if (parsed.data.phone2 !== undefined && parsed.data.phone2 !== null && !phone2) {
      return NextResponse.json({ error: 'Secondary phone must be exactly 10 digits' }, { status: 400 })
    }

    const party = await prisma.party.create({
      data: {
        companyId,
        type: parsed.data.type,
        name: parsed.data.name,
        address: cleanString(parsed.data.address),
        phone1,
        phone2,
        creditLimit: normalizeOptionalNonNegativeNumber(parsed.data.creditLimit),
        creditDays: normalizeOptionalNonNegativeNumber(parsed.data.creditDays),
        ifscCode: cleanString(parsed.data.ifscCode)?.toUpperCase(),
        bankName: cleanString(parsed.data.bankName),
        accountNo: cleanString(parsed.data.accountNo)
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Party data stored successfully',
      party
    })
  } catch (error) {
    console.error('Error creating party:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, putSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const companyId = normalizeCompanyId(searchParams.get('companyId')) || getCompanyIdFromAuthenticatedRequest(request)

    if (!id) {
      return NextResponse.json({ error: 'Party ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existingParty = await prisma.party.findFirst({
      where: { id, companyId },
      select: { id: true }
    })

    if (!existingParty) {
      return NextResponse.json({ error: 'Party not found for this company' }, { status: 404 })
    }
    const phone1 = normalizeTenDigitPhone(parsed.data.phone1)
    const phone2 = normalizeTenDigitPhone(parsed.data.phone2)
    if (parsed.data.phone1 !== undefined && parsed.data.phone1 !== null && !phone1) {
      return NextResponse.json({ error: 'Primary phone must be exactly 10 digits' }, { status: 400 })
    }
    if (parsed.data.phone2 !== undefined && parsed.data.phone2 !== null && !phone2) {
      return NextResponse.json({ error: 'Secondary phone must be exactly 10 digits' }, { status: 400 })
    }

    const updatedParty = await prisma.party.update({
      where: { id },
      data: {
        type: parsed.data.type,
        name: parsed.data.name,
        address: cleanString(parsed.data.address),
        phone1,
        phone2,
        creditLimit: normalizeOptionalNonNegativeNumber(parsed.data.creditLimit),
        creditDays: normalizeOptionalNonNegativeNumber(parsed.data.creditDays),
        ifscCode: cleanString(parsed.data.ifscCode)?.toUpperCase(),
        bankName: cleanString(parsed.data.bankName),
        accountNo: cleanString(parsed.data.accountNo)
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Party updated successfully',
      party: updatedParty
    })
  } catch (error) {
    console.error('Error updating party:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const all = searchParams.get('all') === 'true'
    const companyId = normalizeCompanyId(searchParams.get('companyId')) || getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (all) {
      const result = await prisma.party.deleteMany({
        where: { companyId }
      })

      return NextResponse.json({
        success: true,
        message: `${result.count} parties deleted successfully`,
        count: result.count
      })
    }

    if (!id) {
      return NextResponse.json({ error: 'Party ID is required' }, { status: 400 })
    }

    const existingParty = await prisma.party.findFirst({
      where: { id, companyId },
      select: { id: true }
    })

    if (!existingParty) {
      return NextResponse.json({ error: 'Party not found for this company' }, { status: 404 })
    }

    await prisma.party.delete({ where: { id } })

    return NextResponse.json({ success: true, message: 'Party deleted successfully' })
  } catch (error) {
    console.error('Error deleting party:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    )
  }
}
