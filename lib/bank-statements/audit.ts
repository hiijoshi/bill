import { prisma } from '@/lib/prisma'
import type { RequestAuthContext } from '@/lib/api-security'
import type { BankStatementEventType } from './types'
import { resolveBankStatementActorUser } from './security/require-bank-statement-access'

export async function logBankStatementEvent(input: {
  batchId: string
  companyId: string
  actor?: RequestAuthContext | null
  eventType: BankStatementEventType
  stage?: string | null
  note?: string | null
  payload?: Record<string, unknown> | null
}) {
  const actorUser = input.actor ? await resolveBankStatementActorUser(input.actor) : null

  return prisma.bankStatementBatchEvent.create({
    data: {
      batchId: input.batchId,
      companyId: input.companyId,
      actorUserId: actorUser?.id || null,
      eventType: input.eventType,
      stage: input.stage || null,
      note: input.note || null,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null
    }
  })
}
