import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseBooleanParam, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { normalizeTraderLimitInput } from '@/lib/trader-limits'

const createTraderSchema = z
  .object({
    name: z.string().trim().min(1, 'Trader name is required').max(100),
    maxCompanies: z.union([z.number().int().min(0), z.string().trim().regex(/^\d+$/)]).optional().nullable(),
    maxUsers: z.union([z.number().int().min(0), z.string().trim().regex(/^\d+$/)]).optional().nullable(),
    locked: z.boolean().optional()
  })
  .strict()

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const includeDeleted = parseBooleanParam(new URL(request.url).searchParams.get('includeDeleted'))

    const traders = await prisma.trader.findMany({
      where: includeDeleted ? undefined : { deletedAt: null },
      select: {
        id: true,
        name: true,
        maxCompanies: true,
        maxUsers: true,
        locked: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        companies: {
          where: includeDeleted ? undefined : { deletedAt: null },
          select: { id: true }
        },
        users: {
          where: includeDeleted ? undefined : { deletedAt: null },
          select: { id: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    const response = traders.map((trader) => ({
      id: trader.id,
      name: trader.name,
      maxCompanies: trader.maxCompanies ?? 0,
      maxUsers: trader.maxUsers ?? 0,
      locked: trader.locked,
      deletedAt: trader.deletedAt,
      createdAt: trader.createdAt,
      updatedAt: trader.updatedAt,
      _count: {
        companies: trader.companies.length,
        users: trader.users.length
      }
    }))

    return NextResponse.json(response)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch traders' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const body = await request.json().catch(() => null)
    const parsed = createTraderSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const name = parsed.data.name.trim()
    const maxCompanies = normalizeTraderLimitInput(parsed.data.maxCompanies)
    const maxUsers = normalizeTraderLimitInput(parsed.data.maxUsers)
    if (maxCompanies === undefined || maxUsers === undefined) {
      return NextResponse.json({ error: 'Trader limits must be whole numbers 0 or above' }, { status: 400 })
    }
    const existing = await prisma.trader.findFirst({
      where: {
        name,
        deletedAt: null
      },
      select: { id: true }
    })

    if (existing) {
      return NextResponse.json({ error: 'Trader with this name already exists' }, { status: 409 })
    }

    const trader = await prisma.trader.create({
      data: {
        name,
        maxCompanies,
        maxUsers,
        locked: parsed.data.locked ?? false
      }
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: trader.locked ? 'LOCK' : 'CREATE',
      resourceType: 'TRADER',
      resourceId: trader.id,
      scope: { traderId: trader.id },
      after: trader,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json(
      {
        ...trader,
        _count: { companies: 0, users: 0 }
      },
      { status: 201 }
    )
  } catch {
    return NextResponse.json({ error: 'Failed to create trader' }, { status: 500 })
  }
}
