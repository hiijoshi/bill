import type { RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { logBankStatementEvent } from '../audit'
import { BankStatementError } from '../errors'
import { resolveBankStatementActorUser } from '../security/require-bank-statement-access'
import {
  normalizeCandidateName,
  resolveQuickCreateTargetType,
  uniqueNameFromExisting,
  type QuickCreateRequestedTarget,
  type QuickCreateResolvedTarget
} from './quick-create-utils'

type CreatedTarget = {
  targetType: QuickCreateResolvedTarget
  targetId: string
  targetName: string
  created: boolean
}

function defaultVoucherForDirection(direction: 'debit' | 'credit') {
  return direction === 'credit' ? 'cash_bank_receipt' : 'cash_bank_payment'
}

async function ensureAccountingHead(companyId: string, baseName: string, direction: 'debit' | 'credit'): Promise<CreatedTarget> {
  const all = await prisma.accountingHead.findMany({
    where: { companyId },
    select: { id: true, name: true }
  })

  const matched = all.find((row) => row.name.trim().toLowerCase() === baseName.trim().toLowerCase())
  if (matched) {
    return {
      targetType: 'accounting_head',
      targetId: matched.id,
      targetName: matched.name,
      created: false
    }
  }

  const created = await prisma.accountingHead.create({
    data: {
      companyId,
      name: uniqueNameFromExisting(baseName, all.map((row) => row.name)),
      category: direction === 'credit' ? 'Bank Receipt' : 'Bank Payment',
      amount: 0,
      value: 0
    }
  })

  return {
    targetType: 'accounting_head',
    targetId: created.id,
    targetName: created.name,
    created: true
  }
}

async function ensureParty(companyId: string, baseName: string, direction: 'debit' | 'credit'): Promise<CreatedTarget> {
  const all = await prisma.party.findMany({
    where: { companyId },
    select: { id: true, name: true }
  })

  const matched = all.find((row) => row.name.trim().toLowerCase() === baseName.trim().toLowerCase())
  if (matched) {
    return {
      targetType: 'party',
      targetId: matched.id,
      targetName: matched.name,
      created: false
    }
  }

  const created = await prisma.party.create({
    data: {
      companyId,
      type: direction === 'credit' ? 'buyer' : 'farmer',
      name: uniqueNameFromExisting(baseName, all.map((row) => row.name))
    }
  })

  return {
    targetType: 'party',
    targetId: created.id,
    targetName: created.name,
    created: true
  }
}

async function ensureSupplier(companyId: string, baseName: string): Promise<CreatedTarget> {
  const all = await prisma.supplier.findMany({
    where: { companyId },
    select: { id: true, name: true }
  })

  const matched = all.find((row) => row.name.trim().toLowerCase() === baseName.trim().toLowerCase())
  if (matched) {
    return {
      targetType: 'supplier',
      targetId: matched.id,
      targetName: matched.name,
      created: false
    }
  }

  const created = await prisma.supplier.create({
    data: {
      companyId,
      name: uniqueNameFromExisting(baseName, all.map((row) => row.name))
    }
  })

  return {
    targetType: 'supplier',
    targetId: created.id,
    targetName: created.name,
    created: true
  }
}

export async function quickCreateBankStatementTarget(input: {
  auth: RequestAuthContext
  companyId: string
  rowId: string
  targetType?: QuickCreateRequestedTarget | null
  preferredName?: string | null
}) {
  const actorUser = await resolveBankStatementActorUser(input.auth)
  const row = await prisma.bankStatementRow.findFirst({
    where: {
      id: input.rowId,
      companyId: input.companyId
    }
  })

  if (!row) {
    throw new BankStatementError('ROW_NOT_FOUND', 'Bank statement row was not found.', { status: 404 })
  }

  if (row.postedAt || row.postedPaymentId || row.postedLedgerEntryId || row.finalLinkId) {
    throw new BankStatementError('VALIDATION_FAILED', 'This row is already posted and cannot be auto-created again.', { status: 409 })
  }

  const normalizedTargetType = resolveQuickCreateTargetType({
    requestedType: input.targetType,
    direction: row.direction as 'debit' | 'credit',
    description: row.description
  })

  const normalizedName = normalizeCandidateName({
    preferredName: input.preferredName,
    description: row.description,
    referenceNumber: row.referenceNumber
  })

  let target: CreatedTarget
  if (normalizedTargetType === 'accounting_head') {
    target = await ensureAccountingHead(row.companyId, normalizedName, row.direction as 'debit' | 'credit')
  } else if (normalizedTargetType === 'party') {
    target = await ensureParty(row.companyId, normalizedName, row.direction as 'debit' | 'credit')
  } else {
    target = await ensureSupplier(row.companyId, normalizedName)
  }

  await prisma.bankStatementRow.update({
    where: { id: row.id },
    data: {
      draftAccountingHeadId: target.targetType === 'accounting_head' ? target.targetId : null,
      draftPartyId: target.targetType === 'party' ? target.targetId : null,
      draftSupplierId: target.targetType === 'supplier' ? target.targetId : null,
      draftVoucherType: row.draftVoucherType || defaultVoucherForDirection(row.direction as 'debit' | 'credit'),
      draftRemarks: row.draftRemarks || `Auto-selected ${target.targetType.replace('_', ' ')}: ${target.targetName}`,
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
    note: target.created
      ? `Created ${target.targetType.replace('_', ' ')} from reconciliation row and linked as draft target.`
      : `Linked existing ${target.targetType.replace('_', ' ')} as reconciliation draft target.`,
    payload: {
      rowId: row.id,
      targetType: target.targetType,
      targetId: target.targetId,
      targetName: target.targetName,
      created: target.created
    }
  })

  return {
    rowId: row.id,
    targetType: target.targetType,
    targetId: target.targetId,
    targetName: target.targetName,
    created: target.created
  }
}
