import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { cleanString, normalizeTenDigitPhone, parseNonNegativeNumber } from '@/lib/field-validation'
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
  transporterName: z.string().trim().min(1).optional(),
  vehicleNumber: z.string().optional().nullable(),
  driverName: z.string().optional().nullable(),
  driverPhone: z.string().optional().nullable(),
  vehicleType: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  capacity: z.union([z.number(), z.string()]).optional().nullable(),
  freightRate: z.union([z.number(), z.string()]).optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

const putSchema = z.object({
  transporterName: z.string().trim().min(1),
  vehicleNumber: z.string().optional().nullable(),
  driverName: z.string().optional().nullable(),
  driverPhone: z.string().optional().nullable(),
  vehicleType: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  capacity: z.union([z.number(), z.string()]).optional().nullable(),
  freightRate: z.union([z.number(), z.string()]).optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

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
              { transporterName: { contains: pagination.search } },
              { vehicleNumber: { contains: pagination.search } },
              { driverName: { contains: pagination.search } },
              { driverPhone: { contains: pagination.search } },
              { vehicleType: { contains: pagination.search } },
              { description: { contains: pagination.search } }
            ]
          }
        : {})
    }

    const [transports, total] = await Promise.all([
      prisma.transport.findMany({
        where,
        orderBy: { transporterName: 'asc' },
        ...(pagination.enabled ? { skip: pagination.skip, take: pagination.pageSize } : {})
      }),
      pagination.enabled ? prisma.transport.count({ where }) : Promise.resolve(0)
    ])

    if (pagination.enabled) {
      return NextResponse.json({
        data: transports,
        meta: buildPaginationMeta(total, pagination)
      })
    }

    return NextResponse.json(transports)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonWithSchema(request, postSchema)
    if (!parsed.ok) return parsed.response

    const companyId =
      normalizeCompanyId(new URL(request.url).searchParams.get('companyId') || parsed.data.companyId || null) ||
      getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const transporterName = cleanString(parsed.data.transporterName)
    if (!transporterName) {
      return NextResponse.json({ error: 'Transporter name is required' }, { status: 400 })
    }
    const driverPhone = normalizeTenDigitPhone(parsed.data.driverPhone)
    if (parsed.data.driverPhone !== undefined && parsed.data.driverPhone !== null && !driverPhone) {
      return NextResponse.json({ error: 'Driver phone must be exactly 10 digits' }, { status: 400 })
    }
    const capacity = parseNonNegativeNumber(parsed.data.capacity)
    if (parsed.data.capacity !== undefined && parsed.data.capacity !== null && capacity === null) {
      return NextResponse.json({ error: 'Capacity must be a non-negative number' }, { status: 400 })
    }
    const freightRate = parseNonNegativeNumber(parsed.data.freightRate)
    if (parsed.data.freightRate !== undefined && parsed.data.freightRate !== null && freightRate === null) {
      return NextResponse.json({ error: 'Freight rate must be a non-negative number' }, { status: 400 })
    }

    const transport = await prisma.transport.create({
      data: {
        companyId,
        transporterName,
        vehicleNumber: cleanString(parsed.data.vehicleNumber),
        driverName: cleanString(parsed.data.driverName),
        driverPhone,
        vehicleType: cleanString(parsed.data.vehicleType),
        description: cleanString(parsed.data.description),
        capacity,
        freightRate,
        isActive: parsed.data.isActive !== false
      }
    })

    return NextResponse.json({ success: true, message: 'Transport data stored successfully', transport })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
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
      return NextResponse.json({ error: 'Transport ID and Company ID are required' }, { status: 400 })
    }

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const existing = await prisma.transport.findFirst({ where: { id, companyId }, select: { id: true } })
    if (!existing) {
      return NextResponse.json({ error: 'Transport not found' }, { status: 404 })
    }

    const driverPhone = normalizeTenDigitPhone(parsed.data.driverPhone)
    if (parsed.data.driverPhone !== undefined && parsed.data.driverPhone !== null && !driverPhone) {
      return NextResponse.json({ error: 'Driver phone must be exactly 10 digits' }, { status: 400 })
    }
    const capacity = parseNonNegativeNumber(parsed.data.capacity)
    if (parsed.data.capacity !== undefined && parsed.data.capacity !== null && capacity === null) {
      return NextResponse.json({ error: 'Capacity must be a non-negative number' }, { status: 400 })
    }
    const freightRate = parseNonNegativeNumber(parsed.data.freightRate)
    if (parsed.data.freightRate !== undefined && parsed.data.freightRate !== null && freightRate === null) {
      return NextResponse.json({ error: 'Freight rate must be a non-negative number' }, { status: 400 })
    }

    const transport = await prisma.transport.update({
      where: { id },
      data: {
        transporterName: parsed.data.transporterName,
        vehicleNumber: cleanString(parsed.data.vehicleNumber),
        driverName: cleanString(parsed.data.driverName),
        driverPhone,
        vehicleType: cleanString(parsed.data.vehicleType),
        description: cleanString(parsed.data.description),
        capacity,
        freightRate,
        isActive: parsed.data.isActive
      }
    })
    return NextResponse.json({ success: true, message: 'Transport updated successfully', transport })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
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
      const result = await prisma.transport.deleteMany({ where: { companyId } })
      return NextResponse.json({ success: true, message: `${result.count} transports deleted successfully`, count: result.count })
    }

    if (!id) {
      return NextResponse.json({ error: 'Transport ID is required' }, { status: 400 })
    }

    const existing = await prisma.transport.findFirst({ where: { id, companyId }, select: { id: true } })
    if (!existing) {
      return NextResponse.json({ error: 'Transport not found' }, { status: 404 })
    }

    await prisma.transport.delete({ where: { id } })
    return NextResponse.json({ success: true, message: 'Transport deleted successfully' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
