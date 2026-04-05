import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { prisma } from '@/lib/prisma'
import {
  normalizeSubscriptionBillingCycle,
  normalizeSubscriptionFeatureInputs
} from '@/lib/subscription-config'
import { replaceSubscriptionPlanFeatures } from '@/lib/subscription-mutations'
import { markSuperAdminLiveUpdate } from '@/lib/live-update-state'

const paramsSchema = z.object({
  id: z.string().trim().min(1)
})

const planFeatureSchema = z
  .object({
    featureKey: z.string().trim().min(1).max(80),
    featureLabel: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(400).optional().nullable(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional().nullable()
  })
  .strict()

const updatePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(400).optional().nullable(),
    billingCycle: z.string().trim().min(1).optional(),
    amount: z.number().min(0).optional(),
    currency: z.string().trim().min(1).max(10).optional(),
    maxCompanies: z.number().int().min(0).optional().nullable(),
    maxUsers: z.number().int().min(0).optional().nullable(),
    defaultTrialDays: z.number().int().min(1).max(365).optional().nullable(),
    isActive: z.boolean().optional(),
    isTrialCapable: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
    features: z.array(planFeatureSchema).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  })

function normalizePlanForResponse(plan: {
  id: string
  name: string
  description: string | null
  billingCycle: string
  amount: number
  currency: string
  maxCompanies: number | null
  maxUsers: number | null
  defaultTrialDays: number | null
  isActive: boolean
  isTrialCapable: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  features: Array<{
    id: string
    featureKey: string
    featureLabel: string
    description: string | null
    enabled: boolean
    sortOrder: number
  }>
  _count?: {
    subscriptions: number
  }
}) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    billingCycle: plan.billingCycle,
    amount: plan.amount,
    currency: plan.currency,
    maxCompanies: plan.maxCompanies,
    maxUsers: plan.maxUsers,
    defaultTrialDays: plan.defaultTrialDays,
    isActive: plan.isActive,
    isTrialCapable: plan.isTrialCapable,
    sortOrder: plan.sortOrder,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    features: plan.features.map((feature) => ({
      id: feature.id,
      featureKey: feature.featureKey,
      featureLabel: feature.featureLabel,
      description: feature.description,
      enabled: feature.enabled,
      sortOrder: feature.sortOrder
    })),
    subscriptionCount: plan._count?.subscriptions ?? 0
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = paramsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid plan ID' }, { status: 400 })
    }

    const plan = await prisma.subscriptionPlan.findUnique({
      where: {
        id: parsedParams.data.id
      },
      include: {
        features: {
          orderBy: [{ sortOrder: 'asc' }, { featureLabel: 'asc' }]
        },
        _count: {
          select: {
            subscriptions: true
          }
        }
      }
    })

    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    return NextResponse.json(normalizePlanForResponse(plan))
  } catch (error) {
    console.error('subscription-plan GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription plan' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = paramsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid plan ID' }, { status: 400 })
    }

    const body = await request.json().catch(() => null)
    const parsed = updatePlanSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const existing = await prisma.subscriptionPlan.findUnique({
      where: {
        id: parsedParams.data.id
      },
      include: {
        features: {
          orderBy: [{ sortOrder: 'asc' }, { featureLabel: 'asc' }]
        },
        _count: {
          select: {
            subscriptions: true
          }
        }
      }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const nextName = parsed.data.name?.trim() || existing.name
    if (nextName !== existing.name) {
      const duplicate = await prisma.subscriptionPlan.findFirst({
        where: {
          id: {
            not: existing.id
          },
          name: {
            equals: nextName
          }
        },
        select: { id: true }
      })

      if (duplicate) {
        return NextResponse.json({ error: 'Plan with this name already exists' }, { status: 409 })
      }
    }

    const plan = await prisma.$transaction(async (tx) => {
      await tx.subscriptionPlan.update({
        where: {
          id: existing.id
        },
        data: {
          ...(parsed.data.name !== undefined ? { name: nextName } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description?.trim() || null } : {}),
          ...(parsed.data.billingCycle !== undefined
            ? { billingCycle: normalizeSubscriptionBillingCycle(parsed.data.billingCycle) }
            : {}),
          ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
          ...(parsed.data.currency !== undefined
            ? { currency: String(parsed.data.currency || 'INR').trim().toUpperCase() || 'INR' }
            : {}),
          ...(parsed.data.maxCompanies !== undefined ? { maxCompanies: parsed.data.maxCompanies } : {}),
          ...(parsed.data.maxUsers !== undefined ? { maxUsers: parsed.data.maxUsers } : {}),
          ...(parsed.data.defaultTrialDays !== undefined ? { defaultTrialDays: parsed.data.defaultTrialDays } : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(parsed.data.isTrialCapable !== undefined ? { isTrialCapable: parsed.data.isTrialCapable } : {}),
          ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {})
        }
      })

      if (parsed.data.features !== undefined) {
        await replaceSubscriptionPlanFeatures(tx, existing.id, normalizeSubscriptionFeatureInputs(parsed.data.features))
      }

      return tx.subscriptionPlan.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          features: {
            orderBy: [{ sortOrder: 'asc' }, { featureLabel: 'asc' }]
          },
          _count: {
            select: {
              subscriptions: true
            }
          }
        }
      })
    })

    await writeAuditLog({
      actor: {
        id: authResult.auth.userDbId || authResult.auth.userId,
        role: authResult.auth.role
      },
      action: 'UPDATE',
      resourceType: 'SUBSCRIPTION_PLAN',
      resourceId: plan.id,
      scope: {
        traderId: authResult.auth.traderId
      },
      before: existing,
      after: plan,
      requestMeta: getAuditRequestMeta(request)
    })
    markSuperAdminLiveUpdate()

    return NextResponse.json(normalizePlanForResponse(plan))
  } catch (error) {
    console.error('subscription-plan PUT failed:', error)
    return NextResponse.json({ error: 'Failed to update subscription plan' }, { status: 500 })
  }
}
