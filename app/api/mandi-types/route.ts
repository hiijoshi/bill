import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { ensureCompanyAccess, parseJsonWithSchema } from '@/lib/api-security'
import { cleanString } from '@/lib/field-validation'
import { ensureMandiSchema } from '@/lib/mandi-schema'
import { formatMandiTypeUsageMessage, getMandiTypeUsageMap } from '@/lib/mandi-type-utils'
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
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

const putSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
}).strict()

export async function GET(request: NextRequest) {
  try {
    await ensureMandiSchema(prisma)

    const companyId =
      normalizeCompanyId(new URL(request.url).searchParams.get('companyId')) ||
      getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const rows = await prisma.mandiType.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }]
    })

    const usageMap = await getMandiTypeUsageMap(
      prisma,
      rows.map((row) => row.id)
    )

    return NextResponse.json(
      rows.map((row) => {
        const usage = usageMap.get(row.id)
        return {
          ...row,
          linkedPartyCount: usage?.linkedPartyCount || 0,
          linkedFarmerCount: usage?.linkedFarmerCount || 0,
          linkedAccountingHeadCount: usage?.linkedAccountingHeadCount || 0,
          linkedBillChargeCount: usage?.linkedBillChargeCount || 0,
          totalLinkedCount: usage?.totalLinkedCount || 0
        }
      })
    )
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureMandiSchema(prisma)

    const parsed = await parseJsonWithSchema(request, postSchema)
    if (!parsed.ok) return parsed.response

    const companyId =
      normalizeCompanyId(new URL(request.url).searchParams.get('companyId')) ||
      getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const name = cleanString(parsed.data.name)
    const description = cleanString(parsed.data.description)

    if (!name) {
      return NextResponse.json({ error: 'Mandi type name is required' }, { status: 400 })
    }

    const duplicate = await prisma.mandiType.findFirst({
      where: {
        companyId,
        name
      },
      select: { id: true }
    })

    if (duplicate) {
      return NextResponse.json({ error: 'Mandi type name already exists' }, { status: 400 })
    }

    const mandiType = await prisma.mandiType.create({
      data: {
        companyId,
        name,
        description: description || null,
        isActive: parsed.data.isActive !== false
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Mandi type stored successfully',
      mandiType
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureMandiSchema(prisma)

    const parsed = await parseJsonWithSchema(request, putSchema)
    if (!parsed.ok) return parsed.response

    const { searchParams } = new URL(request.url)
    const id = cleanString(searchParams.get('id'))
    if (!id) {
      return NextResponse.json({ error: 'Mandi type ID required' }, { status: 400 })
    }

    const companyId =
      normalizeCompanyId(searchParams.get('companyId')) ||
      getCompanyIdFromAuthenticatedRequest(request)

    const denied = await ensureCompanyAccess(request, companyId)
    if (denied) return denied

    const duplicate = await prisma.mandiType.findFirst({
      where: {
        companyId,
        name: parsed.data.name.trim(),
        id: { not: id }
      },
      select: { id: true }
    })

    if (duplicate) {
      return NextResponse.json({ error: 'Mandi type name already exists' }, { status: 400 })
    }

    const updated = await prisma.mandiType.updateMany({
      where: { id, companyId },
      data: {
        name: parsed.data.name.trim(),
        description: cleanString(parsed.data.description) || null,
        isActive: parsed.data.isActive !== false
      }
    })

    if (updated.count === 0) {
      return NextResponse.json({ error: 'Mandi type not found' }, { status: 404 })
    }

    const mandiType = await prisma.mandiType.findFirst({
      where: { id, companyId }
    })

    return NextResponse.json({
      success: true,
      message: 'Mandi type updated successfully',
      mandiType
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
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
      const rows = await prisma.mandiType.findMany({
        where: { companyId },
        select: {
          id: true,
          name: true
        }
      })
      const usageMap = await getMandiTypeUsageMap(
        prisma,
        rows.map((row) => row.id)
      )
      const linkedRows = rows.filter((row) => (usageMap.get(row.id)?.totalLinkedCount || 0) > 0)
      if (linkedRows.length > 0) {
        return NextResponse.json(
          {
            error: `Some mandi types are linked and cannot be deleted: ${linkedRows.slice(0, 3).map((row) => row.name).join(', ')}`
          },
          { status: 400 }
        )
      }

      const deleted = await prisma.mandiType.deleteMany({
        where: { companyId }
      })

      return NextResponse.json({
        success: true,
        message: `${deleted.count} mandi types deleted successfully`,
        count: deleted.count
      })
    }

    if (!id) {
      return NextResponse.json({ error: 'Mandi type ID required' }, { status: 400 })
    }

    const mandiType = await prisma.mandiType.findFirst({
      where: {
        id,
        companyId
      },
      select: {
        id: true,
        name: true
      }
    })

    if (!mandiType) {
      return NextResponse.json({ error: 'Mandi type not found' }, { status: 404 })
    }

    const usageMap = await getMandiTypeUsageMap(prisma, [mandiType.id])
    const usage = usageMap.get(mandiType.id)
    if (usage && usage.totalLinkedCount > 0) {
      return NextResponse.json(
        {
          error: formatMandiTypeUsageMessage(mandiType.name, usage)
        },
        { status: 400 }
      )
    }

    const deleted = await prisma.mandiType.deleteMany({
      where: { id, companyId }
    })

    return NextResponse.json({ success: true, message: 'Mandi type deleted successfully' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
