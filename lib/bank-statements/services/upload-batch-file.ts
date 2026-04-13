import type { RequestAuthContext } from '@/lib/api-security'
import { prisma } from '@/lib/prisma'
import { logBankStatementEvent } from '../audit'
import { BankStatementError } from '../errors'
import { serializeBankStatementBatch } from '../serializers'
import { saveBankStatementFile } from '../storage/statement-storage-service'
import { validateBankStatementFileInfo } from './validate-upload-file'

export async function uploadBankStatementBatchFile(input: {
  auth: RequestAuthContext
  batchId: string
  fileName: string
  fileMimeType: string
  fileSizeBytes: number
  bytes: Uint8Array
}) {
  const batch = await prisma.bankStatementBatch.findUnique({
    where: {
      id: input.batchId
    }
  })

  if (!batch) {
    throw new BankStatementError('BATCH_NOT_FOUND', 'Bank statement batch was not found.', {
      status: 404
    })
  }

  const fileInfo = validateBankStatementFileInfo({
    fileName: input.fileName || batch.fileName,
    fileMimeType: input.fileMimeType || batch.fileMimeType,
    fileSizeBytes: input.fileSizeBytes
  })

  const saved = await saveBankStatementFile({
    companyId: batch.companyId,
    batchId: batch.id,
    fileName: fileInfo.fileName,
    fileMimeType: fileInfo.fileMimeType,
    bytes: input.bytes
  })

  const duplicateByContent = await prisma.bankStatementBatch.findFirst({
    where: {
      companyId: batch.companyId,
      bankId: batch.bankId,
      id: { not: batch.id },
      uploadChecksum: saved.checksum
    },
    orderBy: {
      createdAt: 'desc'
    }
  })

  const updated = await prisma.bankStatementBatch.update({
    where: {
      id: batch.id
    },
    data: {
      fileName: fileInfo.fileName,
      originalFileName: fileInfo.fileName,
      fileMimeType: fileInfo.fileMimeType,
      fileExtension: fileInfo.fileExtension,
      fileSizeBytes: saved.fileSizeBytes,
      uploadChecksum: saved.checksum,
      storageDisk: saved.storageDisk,
      storageBucket: saved.storageBucket,
      storageKey: saved.storageKey,
      uploadStatus: 'uploaded',
      uploadedAt: new Date(),
      duplicateBatchId: duplicateByContent?.id || batch.duplicateBatchId,
      duplicateConfidence: duplicateByContent ? 0.98 : batch.duplicateConfidence
    }
  })

  await logBankStatementEvent({
    batchId: batch.id,
    companyId: batch.companyId,
    actor: input.auth,
    eventType: 'upload_completed',
    stage: 'upload',
    note: 'Bank statement file uploaded successfully.',
    payload: {
      fileName: updated.fileName,
      fileSizeBytes: updated.fileSizeBytes,
      storageKey: updated.storageKey,
      duplicateBatchId: updated.duplicateBatchId
    }
  })

  return {
    batch: serializeBankStatementBatch(updated)
  }
}
