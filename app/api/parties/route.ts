import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { cleanString, normalizeTenDigitPhone } from '@/lib/field-validation'
import { buildPaginationMeta, parsePaginationParams } from '@/lib/pagination'

const DUMMY_PARTIES = [
  {
    type: 'farmer',
    name: 'Ramesh Patel',
    address: 'Village Rampura, Neemuch',
    phone1: '9876543210',
    phone2: '9822001144',
    bankName: 'State Bank of India',
    accountNo: '123456789012',
    ifscCode: 'SBIN0001234'
  },
  {
    type: 'buyer',
    name: 'Shree Traders',
    address: 'Mandi Road, Ujjain',
    phone1: '9898989898',
    phone2: '',
    bankName: 'HDFC Bank',
    accountNo: '001122334455',
    ifscCode: 'HDFC0000123'
  },
  {
    type: 'farmer',
    name: 'Suresh Yadav',
    address: 'Village Borkhedi, Mandsaur',
    phone1: '9765432109',
    phone2: '',
    bankName: 'Bank of Baroda',
    accountNo: '556677889900',
    ifscCode: 'BARB0MDSAUR'
  },
  {
    type: 'buyer',
    name: 'Mahalaxmi Foods',
    address: 'Industrial Area, Indore',
    phone1: '9001100223',
    phone2: '9001100224',
    bankName: 'ICICI Bank',
    accountNo: '667788990011',
    ifscCode: 'ICIC0000456'
  }
] as const

function normalizeCompanyId(raw: string | null): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value === 'null' || value === 'undefined') return null
  return value
}

const postSchema = z.object({
  type: z.enum(['farmer', 'buyer']).optional(),
  name: z.string().trim().min(1).optional(),
  address: z.string().optional().nullable(),
  phone1: z.string().optional().nullable(),
  phone2: z.string().optional().nullable(),
  ifscCode: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  accountNo: z.string().optional().nullable(),
  seed: z.boolean().optional()
}).strict()

const putSchema = z.object({
  type: z.enum(['farmer', 'buyer']),
  name: z.string().trim().min(1),
  address: z.string().optional().nullable(),
  phone1: z.string().optional().nullable(),
  phone2: z.string().optional().nullable(),
  ifscCode: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  accountNo: z.string().optional().nullable()
}).strict()

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = normalizeCompanyId(searchParams.get('companyId'))

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

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
    const companyId = normalizeCompanyId(searchParams.get('companyId'))

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (parsed.data.seed === true) {
      const created = await prisma.$transaction(
        DUMMY_PARTIES.map((item) =>
          prisma.party.create({
            data: {
              companyId,
              type: item.type,
              name: item.name,
              address: cleanString(item.address),
              phone1: normalizeTenDigitPhone(item.phone1),
              phone2: normalizeTenDigitPhone(item.phone2),
              ifscCode: cleanString(item.ifscCode)?.toUpperCase(),
              bankName: cleanString(item.bankName),
              accountNo: cleanString(item.accountNo)
            }
          })
        )
      )

      return NextResponse.json({
        success: true,
        message: `${created.length} dummy parties added successfully`,
        count: created.length
      })
    }

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
    const companyId = normalizeCompanyId(searchParams.get('companyId'))

    if (!id) {
      return NextResponse.json({ error: 'Party ID is required' }, { status: 400 })
    }

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
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
    const companyId = normalizeCompanyId(searchParams.get('companyId'))

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

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
