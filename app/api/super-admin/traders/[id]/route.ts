import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseBooleanParam, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'

const idParamsSchema = z.object({ id: z.string().trim().min(1, 'Trader ID is required') })

const updateTraderSchema = z
  .object({
    name: z.string().trim().min(1, 'Trader name is required').max(100).optional(),
    locked: z.boolean().optional()
  })
  .strict()
  .refine((value) => value.name !== undefined || value.locked !== undefined, {
    message: 'At least one field is required'
  })

async function getTraderById(id: string, includeDeleted: boolean) {
  const trader = await prisma.trader.findFirst({
    where: {
      id,
      ...(includeDeleted ? {} : { deletedAt: null })
    },
    select: {
      id: true,
      name: true,
      locked: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      companies: {
        where: includeDeleted ? undefined : { deletedAt: null },
        select: { id: true, name: true, locked: true, createdAt: true }
      },
      users: {
        where: includeDeleted ? undefined : { deletedAt: null },
        select: { id: true, userId: true, name: true, role: true, locked: true, createdAt: true }
      }
    }
  })

  if (!trader) return null

  return {
    id: trader.id,
    name: trader.name,
    locked: trader.locked,
    deletedAt: trader.deletedAt,
    createdAt: trader.createdAt,
    updatedAt: trader.updatedAt,
    companies: trader.companies,
    users: trader.users,
    _count: {
      companies: trader.companies.length,
      users: trader.users.length
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
      return NextResponse.json({ error: 'Invalid trader ID' }, { status: 400 })
    }

    const includeDeleted = parseBooleanParam(new URL(request.url).searchParams.get('includeDeleted'))
    const trader = await getTraderById(parsedParams.data.id, includeDeleted)

    if (!trader) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    return NextResponse.json(trader)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch trader' }, { status: 500 })
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
      return NextResponse.json({ error: 'Invalid trader ID' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    const parsedBody = updateTraderSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsedBody.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const traderId = parsedParams.data.id
    const existingTrader = await prisma.trader.findFirst({
      where: { id: traderId, deletedAt: null }
    })

    if (!existingTrader) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    if (parsedBody.data.locked === true && authResult.auth.traderId === traderId) {
      return NextResponse.json({ error: 'Cannot lock current session trader' }, { status: 403 })
    }

    const nextName = parsedBody.data.name?.trim()
    if (nextName && nextName !== existingTrader.name) {
      const duplicate = await prisma.trader.findFirst({
        where: {
          id: { not: traderId },
          name: nextName,
          deletedAt: null
        },
        select: { id: true }
      })

      if (duplicate) {
        return NextResponse.json({ error: 'Trader with this name already exists' }, { status: 409 })
      }
    }

    const updatedTrader = await prisma.$transaction(async (tx) => {
      const updated = await tx.trader.update({
        where: { id: traderId },
        data: {
          ...(nextName !== undefined ? { name: nextName } : {}),
          ...(parsedBody.data.locked !== undefined ? { locked: parsedBody.data.locked } : {})
        }
      })

      if (parsedBody.data.locked !== undefined && parsedBody.data.locked !== existingTrader.locked) {
        await tx.company.updateMany({
          where: {
            traderId,
            deletedAt: null
          },
          data: {
            locked: parsedBody.data.locked
          }
        })

        await tx.user.updateMany({
          where: {
            traderId,
            deletedAt: null
          },
          data: {
            locked: parsedBody.data.locked
          }
        })
      }

      return updated
    })

    const action =
      parsedBody.data.locked !== undefined && parsedBody.data.locked !== existingTrader.locked
        ? parsedBody.data.locked
          ? 'LOCK'
          : 'UNLOCK'
        : 'UPDATE'

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action,
      resourceType: 'TRADER',
      resourceId: traderId,
      scope: { traderId },
      before: existingTrader,
      after: updatedTrader,
      requestMeta: getAuditRequestMeta(request)
    })

    const response = await getTraderById(traderId, false)
    return NextResponse.json(response)
  } catch {
    return NextResponse.json({ error: 'Failed to update trader' }, { status: 500 })
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
      return NextResponse.json({ error: 'Invalid trader ID' }, { status: 400 })
    }

    const traderId = parsedParams.data.id
    if (traderId === 'system') {
      return NextResponse.json({ error: 'Cannot delete system trader' }, { status: 403 })
    }

    const existingTrader = await prisma.trader.findFirst({
      where: { id: traderId, deletedAt: null }
    })

    if (!existingTrader) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    const deletedAt = new Date()

    const deletedSnapshot = await prisma.$transaction(async (tx) => {
      const trader = await tx.trader.update({
        where: { id: traderId },
        data: {
          locked: true,
          deletedAt
        }
      })

      await tx.company.updateMany({
        where: {
          traderId,
          deletedAt: null
        },
        data: {
          locked: true,
          deletedAt
        }
      })

      await tx.user.updateMany({
        where: {
          traderId,
          deletedAt: null
        },
        data: {
          locked: true,
          deletedAt
        }
      })

      return trader
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: 'DELETE',
      resourceType: 'TRADER',
      resourceId: traderId,
      scope: { traderId },
      before: existingTrader,
      after: deletedSnapshot,
      requestMeta: getAuditRequestMeta(request)
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete trader' }, { status: 500 })
  }
}
