import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { parseBooleanParam, requireRoles } from '@/lib/api-security'
import { getAuditRequestMeta, writeAuditLog } from '@/lib/audit-logging'
import { markSuperAdminLiveUpdate } from '@/lib/live-update-state'
import { prisma } from '@/lib/prisma'
import {
  getSuperAdminSubscriptionPlans,
  normalizeSubscriptionPlanForResponse
} from '@/lib/super-admin-subscription-data'
import {
  normalizeSubscriptionBillingCycle,
  normalizeSubscriptionFeatureInputs
} from '@/lib/subscription-config'
import {
  buildSubscriptionSchemaHeaders,
  ensureSubscriptionManagementSchemaReady,
  isSubscriptionManagementSchemaMismatchError,
  SUBSCRIPTION_SCHEMA_WARNING_MESSAGE
} from '@/lib/subscription-schema'
import { replaceSubscriptionPlanFeatures } from '@/lib/subscription-mutations'

const planFeatureSchema = z
  .object({
    featureKey: z.string().trim().min(1).max(80),
    featureLabel: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(400).optional().nullable(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional().nullable()
  })
  .strict()

const createPlanSchema = z
  .object({
    name: z.string().trim().min(1, 'Plan name is required').max(120),
    description: z.string().trim().max(400).optional().nullable(),
    billingCycle: z.string().trim().min(1).optional().default('yearly'),
    amount: z.number().min(0, 'Amount must be 0 or above'),
    currency: z.string().trim().min(1).max(10).optional().default('INR'),
    maxCompanies: z.number().int().min(0).optional().nullable(),
    maxUsers: z.number().int().min(0).optional().nullable(),
    defaultTrialDays: z.number().int().min(1).max(365).optional().nullable(),
    isActive: z.boolean().optional(),
    isTrialCapable: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
    features: z.array(planFeatureSchema).optional()
  })
  .strict()

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const includeInactive = parseBooleanParam(new URL(request.url).searchParams.get('includeInactive'))
    const result = await getSuperAdminSubscriptionPlans(prisma, { includeInactive })

    return NextResponse.json(result.plans, {
      headers: buildSubscriptionSchemaHeaders(result.schemaReady)
    })
  } catch (error) {
    if (isSubscriptionManagementSchemaMismatchError(error)) {
      return NextResponse.json([], {
        headers: buildSubscriptionSchemaHeaders(false)
      })
    }

    console.error('subscription-plans GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription plans' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const schemaReady = await ensureSubscriptionManagementSchemaReady(prisma)
    if (!schemaReady) {
      return NextResponse.json(
        { error: SUBSCRIPTION_SCHEMA_WARNING_MESSAGE },
        { status: 503, headers: buildSubscriptionSchemaHeaders(false) }
      )
    }

    const body = await request.json().catch(() => null)
    const parsed = createPlanSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
        },
        { status: 400 }
      )
    }

    const data = parsed.data
    const name = data.name.trim()

    const duplicate = await prisma.subscriptionPlan.findFirst({
      where: {
        name: {
          equals: name
        }
      },
      select: { id: true }
    })

    if (duplicate) {
      return NextResponse.json({ error: 'Plan with this name already exists' }, { status: 409 })
    }

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.subscriptionPlan.create({
        data: {
          name,
          description: data.description?.trim() || null,
          billingCycle: normalizeSubscriptionBillingCycle(data.billingCycle),
          amount: data.amount,
          currency: String(data.currency || 'INR').trim().toUpperCase() || 'INR',
          maxCompanies: data.maxCompanies ?? null,
          maxUsers: data.maxUsers ?? null,
          defaultTrialDays: data.defaultTrialDays ?? null,
          isActive: data.isActive ?? true,
          isTrialCapable: data.isTrialCapable ?? false,
          sortOrder: data.sortOrder ?? 0
        }
      })

      await replaceSubscriptionPlanFeatures(tx, created.id, normalizeSubscriptionFeatureInputs(data.features))

      return tx.subscriptionPlan.findUniqueOrThrow({
        where: { id: created.id },
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
      action: 'CREATE',
      resourceType: 'SUBSCRIPTION_PLAN',
      resourceId: plan.id,
      scope: {
        traderId: authResult.auth.traderId
      },
      after: plan,
      requestMeta: getAuditRequestMeta(request)
    })
    markSuperAdminLiveUpdate()

    return NextResponse.json(normalizeSubscriptionPlanForResponse(plan), { status: 201 })
  } catch (error) {
    if (isSubscriptionManagementSchemaMismatchError(error)) {
      return NextResponse.json(
        { error: SUBSCRIPTION_SCHEMA_WARNING_MESSAGE },
        { status: 503, headers: buildSubscriptionSchemaHeaders(false) }
      )
    }

    console.error('subscription-plans POST failed:', error)
    return NextResponse.json({ error: 'Failed to create subscription plan' }, { status: 500 })
  }
}
