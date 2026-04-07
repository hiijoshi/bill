import { NextRequest, NextResponse } from 'next/server'

import { requireRoles } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import {
  buildSubscriptionSchemaHeaders,
  ensureSubscriptionManagementSchemaReady
} from '@/lib/subscription-schema'
import { getTraderSubscriptionHistory, getTraderSubscriptionPayments } from '@/lib/subscription-core'
import { getTraderBackupHistory } from '@/lib/trader-retention'

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['trader_admin', 'company_admin', 'company_user'])
  if (!authResult.ok) return authResult.response

  try {
    const schemaReady = await ensureSubscriptionManagementSchemaReady(prisma)
    const [history, payments, backups] = schemaReady
      ? await Promise.all([
          getTraderSubscriptionHistory(prisma, authResult.auth.traderId),
          getTraderSubscriptionPayments(prisma, authResult.auth.traderId),
          getTraderBackupHistory(prisma, authResult.auth.traderId)
        ])
      : await Promise.all([Promise.resolve([]), Promise.resolve([]), Promise.resolve([])])

    return NextResponse.json({
      history,
      backups,
      payments
    }, {
      headers: buildSubscriptionSchemaHeaders(schemaReady)
    })
  } catch (error) {
    console.error('subscription/history GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription history' }, { status: 500 })
  }
}
