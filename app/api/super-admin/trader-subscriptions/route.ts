import { NextRequest, NextResponse } from 'next/server'

import { parseBooleanParam, requireRoles } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import {
  getSuperAdminTraderSubscriptionRows
} from '@/lib/super-admin-subscription-data'
import {
  buildSubscriptionSchemaHeaders,
  isSubscriptionManagementSchemaMismatchError
} from '@/lib/subscription-schema'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = new URL(request.url).searchParams
    const expiringWithinDaysParam = String(searchParams.get('expiringWithinDays') || '').trim()
    const expiringWithinDays = expiringWithinDaysParam.length > 0 ? Number(expiringWithinDaysParam) : null
    const result = await getSuperAdminTraderSubscriptionRows(prisma, {
      query: String(searchParams.get('query') || '').trim(),
      state: String(searchParams.get('state') || '').trim(),
      expiringWithinDays,
      includeLocked: parseBooleanParam(searchParams.get('includeLocked'))
    })

    return NextResponse.json(result.rows, {
      headers: buildSubscriptionSchemaHeaders(result.schemaReady)
    })
  } catch (error) {
    if (isSubscriptionManagementSchemaMismatchError(error)) {
      return NextResponse.json([], {
        headers: buildSubscriptionSchemaHeaders(false)
      })
    }

    console.error('trader-subscriptions GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch trader subscriptions' }, { status: 500 })
  }
}
