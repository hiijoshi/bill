import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseBooleanParam, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { normalizeTraderLimitInput } from '@/lib/trader-limits'
import { normalizePrismaApiError } from '@/lib/prisma-errors'
import { createTraderInitialSubscription, traderInitialSubscriptionSchema } from '@/lib/trader-subscription-assignment'
import { SubscriptionMutationError } from '@/lib/subscription-mutations'
import { markSuperAdminLiveUpdate } from '@/lib/live-update-state'

const createTraderSchema = z
  .object({
    name: z.string().trim().min(1, 'Trader name is required').max(100),
    maxCompanies: z.union([z.number().int().min(0), z.string().trim().regex(/^\d+$/)]).optional().nullable(),
    maxUsers: z.union([z.number().int().min(0), z.string().trim().regex(/^\d+$/)]).optional().nullable(),
    locked: z.boolean().optional(),
    subscription: traderInitialSubscriptionSchema.optional().nullable()
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
        _count: {
          select: {
            companies: includeDeleted ? true : { where: { deletedAt: null } },
            users: includeDeleted ? true : { where: { deletedAt: null } }
          }
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
        companies: trader._count.companies,
        users: trader._count.users
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

    const actorId = authResult.auth.userDbId || authResult.auth.userId
    const created = await prisma.$transaction(async (tx) => {
      const trader = await tx.trader.create({
        data: {
          name,
          maxCompanies,
          maxUsers,
          locked: parsed.data.locked ?? false
        }
      })

      const subscription = parsed.data.subscription
        ? await createTraderInitialSubscription(tx, {
            traderId: trader.id,
            actorId,
            subscription: parsed.data.subscription
          })
        : null

      return {
        trader,
        subscription
      }
    })

    await writeAuditLog({
      actor: {
        id: actorId,
        role: authResult.auth.role
      },
      action: created.trader.locked ? 'LOCK' : 'CREATE',
      resourceType: 'TRADER',
      resourceId: created.trader.id,
      scope: { traderId: created.trader.id },
      after: created.trader,
      requestMeta: getAuditRequestMeta(request)
    })

    if (created.subscription) {
      await writeAuditLog({
        actor: {
          id: actorId,
          role: authResult.auth.role
        },
        action: 'CREATE',
        resourceType: 'TRADER_SUBSCRIPTION',
        resourceId: created.subscription.subscription.id,
        scope: {
          traderId: created.trader.id
        },
        after: created.subscription.subscription,
        requestMeta: getAuditRequestMeta(request)
      })

      if (created.subscription.payment) {
        await writeAuditLog({
          actor: {
            id: actorId,
            role: authResult.auth.role
          },
          action: 'CREATE',
          resourceType: 'SUBSCRIPTION_PAYMENT',
          resourceId: created.subscription.payment.id,
          scope: {
            traderId: created.trader.id
          },
          after: created.subscription.payment,
          requestMeta: getAuditRequestMeta(request)
        })
      }
    }
    markSuperAdminLiveUpdate()

    return NextResponse.json(
      {
        ...created.trader,
        currentSubscription: created.subscription?.subscription || null,
        _count: { companies: 0, users: 0 }
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof SubscriptionMutationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    const apiError = normalizePrismaApiError(error, 'Failed to create trader', {
      uniqueMessages: {
        name: 'Trader with this name already exists'
      }
    })
    return NextResponse.json({ error: apiError.message }, { status: apiError.status })
  }
}
