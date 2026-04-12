import { prisma } from '@/lib/prisma'
import type { RequestAuthContext } from '@/lib/api-security'
import type { BankStatementEventType } from './types'

export async function logBankStatementEvent(input: {
  batchId: string
  companyId: string
  actor?: Pick<RequestAuthContext, 'userId'> | null
  eventType: BankStatementEventType
  stage?: string | null
  note?: string | null
  payload?: Record<string, unknown> | null
}) {
  return prisma.bankStatementBatchEvent.create({
    data: {
      batchId: input.batchId,
      companyId: input.companyId,
      actorUserId: input.actor?.userId || null,
      eventType: input.eventType,
      stage: input.stage || null,
      note: input.note || null,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null
    }
  })
}
