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
  companyId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  address: z.string().optional().nullable(),
  phone1: z.string().optional().nullable(),
}).passthrough()

const putSchema = z.object({
  name: z.string().trim().min(1).optional(),
  address: z.string().optional().nullable(),
  phone1: z.string().optional().nullable(),
}).passthrough()

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
              { phone1: { contains: pagination.search } },
              { phone2: { contains: pagination.search } },
              { gstNumber: { contains: pagination.search } },
              { bankName: { contains: pagination.search } },
              { address: { contains: pagination.search } }
            ]
          }
        : {})
    }

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        select: {
          id: true,
          name: true,
          address: true,
          phone1: true,
          phone2: true,
          ifscCode: true,
          bankName: true,
          accountNo: true,
          gstNumber: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { name: 'asc' },
        ...(pagination.enabled ? { skip: pagination.skip, take: pagination.pageSize } : {})
      }),
      pagination.enabled ? prisma.supplier.count({ where }) : Promise.resolve(0)
    ])

    if (pagination.enabled) {
      return NextResponse.json({
        data: suppliers,
        meta: buildPaginationMeta(total, pagination)
      })
    }

    return NextResponse.json(suppliers)
  } catch (error) {
    console.error('Error fetching suppliers:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, postSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const companyId =
      normalizeCompanyId(searchParams.get('companyId') || parsed.data.companyId || null) ||
      getCompanyIdFromAuthenticatedRequest(request)
    const name = cleanString(parsed.data.name)
    const address = cleanString(parsed.data.address)
    const phone1 = normalizeTenDigitPhone(parsed.data.phone1)
    const phone2 = null
    const ifscCode = null
    const bankName = null
    const accountNo = null
    const gstNumber = null

    if (parsed.data.phone1 !== undefined && parsed.data.phone1 !== null && !phone1) {
      return NextResponse.json({ error: 'Primary phone must be exactly 10 digits' }, { status: 400 })
    }
    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (!name) {
      return NextResponse.json({ error: 'Company ID and name are required' }, { status: 400 })
    }

    const existingSupplier = await prisma.supplier.findFirst({
      where: {
        companyId,
        name,
      },
    })

    if (existingSupplier) {
      return NextResponse.json({ error: 'Supplier with this name already exists' }, { status: 400 })
    }

    const supplier = await prisma.supplier.create({
      data: {
        companyId,
        name,
        address,
        phone1,
        phone2,
        ifscCode,
        bankName,
        accountNo,
        gstNumber,
      },
    })

    return NextResponse.json({ success: true, message: 'Supplier data stored successfully', supplier })
  } catch (error) {
    console.error('Error creating supplier:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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
      return NextResponse.json({ error: 'Supplier ID and Company ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existingSupplier = await prisma.supplier.findFirst({
      where: {
        id,
        companyId,
      },
    })

    if (!existingSupplier) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }

    const name = cleanString(parsed.data.name)

    if (name && name !== existingSupplier.name) {
      const nameConflict = await prisma.supplier.findFirst({
        where: {
          companyId,
          name,
          id: { not: id },
        },
      })

      if (nameConflict) {
        return NextResponse.json({ error: 'Supplier with this name already exists' }, { status: 400 })
      }
    }

    const phone1 = normalizeTenDigitPhone(parsed.data.phone1)
    if (parsed.data.phone1 !== undefined && parsed.data.phone1 !== null && !phone1) {
      return NextResponse.json({ error: 'Primary phone must be exactly 10 digits' }, { status: 400 })
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        name: name || existingSupplier.name,
        address: parsed.data.address !== undefined ? cleanString(parsed.data.address) : existingSupplier.address,
        phone1: parsed.data.phone1 !== undefined ? phone1 : existingSupplier.phone1,
        phone2: existingSupplier.phone2,
        ifscCode: existingSupplier.ifscCode,
        bankName: existingSupplier.bankName,
        accountNo: existingSupplier.accountNo,
        gstNumber: existingSupplier.gstNumber,
      },
    })

    return NextResponse.json(supplier)
  } catch (error) {
    console.error('Error updating supplier:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const companyId = normalizeCompanyId(searchParams.get('companyId')) || getCompanyIdFromAuthenticatedRequest(request)
    const all = searchParams.get('all') === 'true'

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (all) {
      const result = await prisma.supplier.deleteMany({ where: { companyId } })
      return NextResponse.json({ success: true, message: `${result.count} suppliers deleted successfully`, count: result.count })
    }

    if (!id) {
      return NextResponse.json({ error: 'Supplier ID is required' }, { status: 400 })
    }

    const existingSupplier = await prisma.supplier.findFirst({
      where: {
        id,
        companyId,
      },
    })

    if (!existingSupplier) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }

    const specialPurchaseBillsCount = await prisma.specialPurchaseBill.count({
      where: {
        supplierId: id,
      },
    })

    if (specialPurchaseBillsCount > 0) {
      return NextResponse.json({ error: 'Cannot delete supplier with existing special purchase bills' }, { status: 400 })
    }

    await prisma.supplier.delete({
      where: { id },
    })

    return NextResponse.json({ success: true, message: 'Supplier deleted successfully' })
  } catch (error) {
    console.error('Error deleting supplier:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
