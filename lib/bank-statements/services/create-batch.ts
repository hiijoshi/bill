import { createHash } from 'crypto'
import type { RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { BANK_STATEMENT_DUPLICATE_LOOKBACK_DAYS } from '../constants'
import type { BankStatementCreateBatchRequest } from '../contracts'
import { BankStatementError } from '../errors'
import { serializeBankStatementBatch } from '../serializers'
import {
  assertBankBelongsToCompany,
  assertCompanyExists,
  resolveBankStatementActorUser
} from '../security/require-bank-statement-access'
import { validateBankStatementFileInfo } from './validate-upload-file'

function resolveDocumentKind(fileName: string, mimeType: string) {
  const extension = fileName.trim().toLowerCase().split('.').at(-1) || ''
  const normalizedMimeType = mimeType.trim().toLowerCase()

  if (extension === 'csv' || normalizedMimeType.includes('csv')) return 'csv' as const
  if (extension === 'xls' || extension === 'xlsx' || normalizedMimeType.includes('excel') || normalizedMimeType.includes('spreadsheet')) return 'excel' as const
  if (extension === 'pdf' || normalizedMimeType.includes('pdf')) return 'pdf' as const
  return 'image' as const
}

function normalizeExtension(fileName: string) {
  return fileName.trim().toLowerCase().split('.').at(-1) || ''
}

function createMetadataChecksum(input: BankStatementCreateBatchRequest) {
  return createHash('sha256')
    .update([
      input.companyId,
      input.bankId,
      input.fileName.trim().toLowerCase(),
      input.fileMimeType.trim().toLowerCase(),
      String(input.fileSizeBytes)
    ].join('|'))
    .digest('hex')
}

function subDays(value: Date, days: number) {
  return new Date(value.getTime() - days * 24 * 60 * 60 * 1000)
}

export async function createBankStatementBatch(input: {
  auth: RequestAuthContext
  request: BankStatementCreateBatchRequest
}) {
  console.info('[bank-statements] create-batch:start', {
    companyId: input.request.companyId,
    bankId: input.request.bankId,
    authUserId: input.auth.userId,
    authUserDbId: input.auth.userDbId
  })

  validateBankStatementFileInfo({
    fileName: input.request.fileName,
    fileMimeType: input.request.fileMimeType,
    fileSizeBytes: input.request.fileSizeBytes
  })

  const [company, bank, actorUser] = await Promise.all([
    assertCompanyExists(input.request.companyId),
    assertBankBelongsToCompany(input.request.companyId, input.request.bankId),
    resolveBankStatementActorUser(input.auth)
  ])

  if (actorUser && actorUser.traderId !== company.traderId) {
    throw new BankStatementError('FORBIDDEN', 'Authenticated user does not belong to the selected company tenant.', {
      status: 403,
      details: {
        actorUserId: actorUser.id,
        actorTraderId: actorUser.traderId,
        companyTraderId: company.traderId
      }
    })
  }

  if (
    actorUser &&
    input.auth.role !== 'super_admin' &&
    actorUser.companyId &&
    actorUser.companyId !== input.request.companyId
  ) {
    throw new BankStatementError('FORBIDDEN', 'Authenticated user is not assigned to the selected company.', {
      status: 403,
      details: {
        actorUserId: actorUser.id,
        actorCompanyId: actorUser.companyId,
        requestCompanyId: input.request.companyId
      }
    })
  }

  const checksum = createMetadataChecksum(input.request)
  const duplicateSince = subDays(new Date(), BANK_STATEMENT_DUPLICATE_LOOKBACK_DAYS)

  const existingDuplicate = await prisma.bankStatementBatch.findFirst({
    where: {
      companyId: input.request.companyId,
      bankId: input.request.bankId,
      uploadChecksum: checksum,
      createdAt: {
        gte: duplicateSince
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  })

  const batch = await prisma.bankStatementBatch.create({
    data: {
      companyId: company.id,
      bankId: bank.id,
      uploadedByUserId: actorUser?.id || null,
      fileName: input.request.fileName,
      originalFileName: input.request.fileName,
      fileMimeType: input.request.fileMimeType,
      fileSizeBytes: input.request.fileSizeBytes,
      fileExtension: normalizeExtension(input.request.fileName),
      documentKind: resolveDocumentKind(input.request.fileName, input.request.fileMimeType),
      uploadChecksum: checksum,
      uploadStatus: 'created',
      batchStatus: 'uploaded',
      parseStatus: 'pending',
      matchStatus: 'pending',
      finalizeStatus: 'pending',
      duplicateBatchId: existingDuplicate?.id || null,
      duplicateConfidence: existingDuplicate ? 0.92 : null,
      sourceMetadataJson: JSON.stringify({
        createdFrom: 'api',
        metadataChecksum: checksum,
        actorUserId: actorUser?.id || null
      })
    }
  })

  console.info('[bank-statements] create-batch:resolved', {
    batchId: batch.id,
    companyId: company.id,
    bankId: bank.id,
    actorUserId: actorUser?.id || null
  })

  if (!batch) {
    throw new BankStatementError('INTERNAL_ERROR', 'Failed to create bank statement batch.', {
      status: 500
    })
  }

  return {
    batch: serializeBankStatementBatch(batch),
    duplicateOfBatchId: existingDuplicate?.id || null
  }
}
