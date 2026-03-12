import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { cleanString, normalizeTenDigitPhone } from '@/lib/field-validation'

function normalizeCompanyId(raw: string | null): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value === 'null' || value === 'undefined') return null
  return value
}

const postSchema = z.object({
  companyId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  address: z.string().optional().nullable(),
  phone1: z.string().optional().nullable(),
  krashakAnubandhNumber: z.string().optional().nullable(),
  seed: z.boolean().optional()
}).strict()

const putSchema = z.object({
  name: z.string().trim().min(1).optional(),
  address: z.string().optional().nullable(),
  phone1: z.string().optional().nullable(),
  krashakAnubandhNumber: z.string().optional().nullable()
}).strict()

const DUMMY_FARMERS = [
  { name: 'Ramesh Yadav', address: 'Rampura', phone1: '9876543210', krashakAnubandhNumber: 'KA-1001' },
  { name: 'Mohan Patidar', address: 'Mandsaur', phone1: '9890011122', krashakAnubandhNumber: 'KA-1002' }
] as const

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const companyId = normalizeCompanyId(searchParams.get('companyId'))

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const farmers = await prisma.farmer.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        address: true,
        phone1: true,
        krashakAnubandhNumber: true,
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json(farmers)
  } catch (error) {
    console.error('Error fetching farmers:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, postSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const companyId = normalizeCompanyId(searchParams.get('companyId') || parsed.data.companyId || null)
    const name = cleanString(parsed.data.name)
    const address = cleanString(parsed.data.address)
    const phone1 = normalizeTenDigitPhone(parsed.data.phone1)
    const krashakAnubandhNumber = cleanString(parsed.data.krashakAnubandhNumber)

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID and name are required' }, { status: 400 })
    }
    if (parsed.data.phone1 !== undefined && parsed.data.phone1 !== null && !phone1) {
      return NextResponse.json({ error: 'Phone must be exactly 10 digits' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (parsed.data.seed === true) {
      const created = await prisma.$transaction(
        DUMMY_FARMERS.map((row) =>
          prisma.farmer.create({
            data: {
              companyId,
              name: row.name,
              address: row.address,
              phone1: row.phone1,
              krashakAnubandhNumber: row.krashakAnubandhNumber
            }
          })
        )
      )
      return NextResponse.json({ success: true, message: `${created.length} dummy farmers added successfully`, count: created.length })
    }

    if (!name) {
      return NextResponse.json({ error: 'Company ID and name are required' }, { status: 400 })
    }

    const existingFarmer = await prisma.farmer.findFirst({
      where: {
        companyId,
        name,
      },
    })

    if (existingFarmer) {
      return NextResponse.json({ error: 'Farmer with this name already exists' }, { status: 400 })
    }

    const farmer = await prisma.farmer.create({
      data: {
        companyId,
        name,
        address,
        phone1,
        krashakAnubandhNumber,
      },
    })

    return NextResponse.json({ success: true, message: 'Farmer data stored successfully', farmer })
  } catch (error) {
    console.error('Error creating farmer:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, putSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const companyId = normalizeCompanyId(searchParams.get('companyId'))

    if (!id || !companyId) {
      return NextResponse.json({ error: 'Farmer ID and Company ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existingFarmer = await prisma.farmer.findFirst({
      where: {
        id,
        companyId,
      },
    })

    if (!existingFarmer) {
      return NextResponse.json({ error: 'Farmer not found' }, { status: 404 })
    }

    const name = cleanString(parsed.data.name)

    if (name && name !== existingFarmer.name) {
      const nameConflict = await prisma.farmer.findFirst({
        where: {
          companyId,
          name,
          id: { not: id },
        },
      })

      if (nameConflict) {
        return NextResponse.json({ error: 'Farmer with this name already exists' }, { status: 400 })
      }
    }

    const phone1 = normalizeTenDigitPhone(parsed.data.phone1)
    if (parsed.data.phone1 !== undefined && parsed.data.phone1 !== null && !phone1) {
      return NextResponse.json({ error: 'Phone must be exactly 10 digits' }, { status: 400 })
    }

    const farmer = await prisma.farmer.update({
      where: { id },
      data: {
        name: name || existingFarmer.name,
        address: parsed.data.address !== undefined ? cleanString(parsed.data.address) : existingFarmer.address,
        phone1: parsed.data.phone1 !== undefined ? phone1 : existingFarmer.phone1,
        krashakAnubandhNumber: parsed.data.krashakAnubandhNumber !== undefined ? cleanString(parsed.data.krashakAnubandhNumber) : existingFarmer.krashakAnubandhNumber,
      },
    })

    return NextResponse.json(farmer)
  } catch (error) {
    console.error('Error updating farmer:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const companyId = normalizeCompanyId(searchParams.get('companyId'))
    const all = searchParams.get('all') === 'true'

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    if (all) {
      const result = await prisma.farmer.deleteMany({ where: { companyId } })
      return NextResponse.json({ success: true, message: `${result.count} farmers deleted successfully`, count: result.count })
    }

    if (!id) {
      return NextResponse.json({ error: 'Farmer ID is required' }, { status: 400 })
    }

    const existingFarmer = await prisma.farmer.findFirst({
      where: {
        id,
        companyId,
      },
    })

    if (!existingFarmer) {
      return NextResponse.json({ error: 'Farmer not found' }, { status: 404 })
    }

    const purchaseBillsCount = await prisma.purchaseBill.count({
      where: {
        farmerId: id,
      },
    })

    if (purchaseBillsCount > 0) {
      return NextResponse.json({ error: 'Cannot delete farmer with existing purchase bills' }, { status: 400 })
    }

    await prisma.farmer.delete({
      where: { id },
    })

    return NextResponse.json({ success: true, message: 'Farmer deleted successfully' })
  } catch (error) {
    console.error('Error deleting farmer:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
