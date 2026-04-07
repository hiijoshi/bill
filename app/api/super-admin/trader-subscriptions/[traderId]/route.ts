import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRoles } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { getSuperAdminTraderSubscriptionDetail } from '@/lib/super-admin-subscription-data'
import {
  buildSubscriptionSchemaHeaders,
  isSubscriptionManagementSchemaMismatchError
} from '@/lib/subscription-schema'

const paramsSchema = z.object({
  traderId: z.string().trim().min(1)
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ traderId: string }> }
) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const parsedParams = paramsSchema.safeParse(await params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid trader ID' }, { status: 400 })
    }

    const result = await getSuperAdminTraderSubscriptionDetail(prisma, parsedParams.data.traderId)
    if (!result.detail?.trader) {
      return NextResponse.json({ error: 'Trader not found' }, { status: 404 })
    }

    return NextResponse.json(result.detail, {
      headers: buildSubscriptionSchemaHeaders(result.schemaReady)
    })
  } catch (error) {
    if (isSubscriptionManagementSchemaMismatchError(error)) {
      return NextResponse.json(
        { error: 'Subscription management schema is not initialized yet.' },
        { status: 503, headers: buildSubscriptionSchemaHeaders(false) }
      )
    }

    console.error('trader-subscription detail GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch trader subscription detail' }, { status: 500 })
  }
}
