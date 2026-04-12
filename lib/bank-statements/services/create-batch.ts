import { createHash } from 'crypto'
import type { RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { BANK_STATEMENT_DUPLICATE_LOOKBACK_DAYS } from '../constants'
import type { BankStatementCreateBatchRequest } from '../contracts'
import { BankStatementError } from '../errors'
import { serializeBankStatementBatch } from '../serializers'
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
  validateBankStatementFileInfo({
    fileName: input.request.fileName,
    fileMimeType: input.request.fileMimeType,
    fileSizeBytes: input.request.fileSizeBytes
  })

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
      companyId: input.request.companyId,
      bankId: input.request.bankId,
      uploadedByUserId: input.auth.userId,
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
        metadataChecksum: checksum
      })
    }
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
