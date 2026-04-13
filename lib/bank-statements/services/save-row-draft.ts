import type { RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { logBankStatementEvent } from '../audit'
import { BankStatementError } from '../errors'
import { resolveBankStatementActorUser } from '../security/require-bank-statement-access'
import type { BankStatementVoucherType } from '../types'

export async function saveBankStatementRowDraft(input: {
  auth: RequestAuthContext
  rowId: string
  payload: {
    accountingHeadId?: string | null
    partyId?: string | null
    supplierId?: string | null
    voucherType?: BankStatementVoucherType | null
    paymentMode?: string | null
    remarks?: string | null
  }
}) {
  const actorUser = await resolveBankStatementActorUser(input.auth)
  const row = await prisma.bankStatementRow.findUnique({
    where: { id: input.rowId }
  })

  if (!row) {
    throw new BankStatementError('ROW_NOT_FOUND', 'Bank statement row was not found.', { status: 404 })
  }

  const [head, party, supplier, paymentMode] = await Promise.all([
    input.payload.accountingHeadId
      ? prisma.accountingHead.findFirst({ where: { id: input.payload.accountingHeadId, companyId: row.companyId } })
      : Promise.resolve(null),
    input.payload.partyId
      ? prisma.party.findFirst({ where: { id: input.payload.partyId, companyId: row.companyId } })
      : Promise.resolve(null),
    input.payload.supplierId
      ? prisma.supplier.findFirst({ where: { id: input.payload.supplierId, companyId: row.companyId } })
      : Promise.resolve(null),
    input.payload.paymentMode
      ? prisma.paymentMode.findFirst({ where: { id: input.payload.paymentMode, companyId: row.companyId, isActive: true } })
      : Promise.resolve(null)
  ])

  if (input.payload.accountingHeadId && !head) {
    throw new BankStatementError('FORBIDDEN', 'Selected accounting head is not available for this company.', { status: 403 })
  }
  if (input.payload.partyId && !party) {
    throw new BankStatementError('FORBIDDEN', 'Selected party is not available for this company.', { status: 403 })
  }
  if (input.payload.supplierId && !supplier) {
    throw new BankStatementError('FORBIDDEN', 'Selected supplier is not available for this company.', { status: 403 })
  }
  if (input.payload.paymentMode && !paymentMode) {
    throw new BankStatementError('FORBIDDEN', 'Selected payment mode is not available for this company.', { status: 403 })
  }

  const updated = await prisma.bankStatementRow.update({
    where: { id: row.id },
    data: {
      draftAccountingHeadId: head?.id || null,
      draftPartyId: party?.id || null,
      draftSupplierId: supplier?.id || null,
      draftVoucherType: input.payload.voucherType || null,
      draftPaymentMode: paymentMode?.id || null,
      draftRemarks: input.payload.remarks?.trim() || null,
      reviewedByUserId: actorUser?.id || null,
      reviewedAt: new Date(),
      reviewStatus: row.reviewStatus === 'pending' ? 'rejected' : row.reviewStatus
    }
  })

  await logBankStatementEvent({
    batchId: row.uploadBatchId,
    companyId: row.companyId,
    actor: input.auth,
    eventType: 'row_reviewed',
    stage: 'draft',
    note: 'Saved reconciliation draft mapping.',
    payload: {
      rowId: row.id,
      accountingHeadId: updated.draftAccountingHeadId,
      partyId: updated.draftPartyId,
      supplierId: updated.draftSupplierId,
      voucherType: updated.draftVoucherType
    }
  })

  return updated
}
