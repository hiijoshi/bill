import { prisma } from '@/lib/prisma'
import type { RequestAuthContext } from '@/lib/api-security'
import { logBankStatementEvent } from '../audit'
import { BankStatementError } from '../errors'
import { serializeBankStatementBatch } from '../serializers'
import { loadBankStatementFile } from '../storage/statement-storage-service'
import { resolveStatementParser } from '../parsing/parser-registry'
import { normalizeStatementRow } from '../normalization/normalize-row'

function detectKind(value: string) {
  if (value === 'csv' || value === 'excel' || value === 'pdf' || value === 'image') {
    return value
  }

  throw new BankStatementError('UNSUPPORTED_FILE_TYPE', 'Unsupported bank statement document kind.', {
    status: 400
  })
}

function maskAccountNumber(value: string | null | undefined) {
  const raw = String(value || '').replace(/\s+/g, '')
  if (raw.length <= 4) return raw || null
  return `${'*'.repeat(Math.max(0, raw.length - 4))}${raw.slice(-4)}`
}

function normalizeParseFailure(error: unknown) {
  if (error instanceof BankStatementError) {
    return error
  }

  const rawMessage = error instanceof Error ? error.message.trim() : 'Failed to parse bank statement.'

  const knownUserCorrectableIssues = [
    {
      pattern: /could not detect any transaction rows/i,
      message: 'No transaction rows were detected in the uploaded statement. Upload an actual bank statement export with transaction rows.'
    },
    {
      pattern: /uploaded (csv|excel|statement text) statement is empty/i,
      message: 'The uploaded statement file is empty. Upload a file that contains transaction rows.'
    },
    {
      pattern: /excel statement does not contain any worksheet/i,
      message: 'The uploaded Excel file does not contain any worksheet data.'
    },
    {
      pattern: /could not recognize text from statement image/i,
      message: 'The uploaded statement image could not be read clearly. Upload a clearer image or use CSV / Excel for the fastest import.'
    },
    {
      pattern: /could not be recognized into readable statement rows/i,
      message: 'The uploaded PDF could not be read into transaction rows. Upload a clearer PDF or use CSV / Excel for the fastest import.'
    }
  ]

  const matchedIssue = knownUserCorrectableIssues.find((issue) => issue.pattern.test(rawMessage))
  if (matchedIssue) {
    return new BankStatementError('VALIDATION_FAILED', matchedIssue.message, {
      status: 422,
      details: {
        parseFailure: rawMessage
      },
      cause: error
    })
  }

  return new BankStatementError('INTERNAL_ERROR', rawMessage || 'Failed to parse bank statement.', {
    status: 500,
    cause: error
  })
}

export async function parseBankStatementBatch(input: {
  auth: RequestAuthContext
  batchId: string
}) {
  const batch = await prisma.bankStatementBatch.findUnique({
    where: { id: input.batchId },
    include: {
      bank: true
    }
  })

  if (!batch) {
    throw new BankStatementError('BATCH_NOT_FOUND', 'Bank statement batch was not found.', {
      status: 404
    })
  }

  if (!batch.storageKey) {
    throw new BankStatementError('UPLOAD_FAILED', 'Upload the bank statement file before parsing.', {
      status: 400
    })
  }

  await prisma.bankStatementBatch.update({
    where: { id: batch.id },
    data: {
      batchStatus: 'parsing',
      parseStatus: 'processing',
      errorCode: null,
      errorMessage: null
    }
  })

  await logBankStatementEvent({
    batchId: batch.id,
    companyId: batch.companyId,
    actor: input.auth,
    eventType: 'parse_started',
    stage: 'parse',
    note: 'Started parsing uploaded bank statement.'
  })

  try {
    const { bytes } = await loadBankStatementFile({
      batchId: batch.id,
      storageKey: batch.storageKey
    })
    console.info('[bank-statements] parse-batch:file-loaded', {
      batchId: batch.id,
      storageKey: batch.storageKey,
      bytes: bytes.byteLength,
      documentKind: batch.documentKind,
      fileName: batch.fileName
    })
    const parser = resolveStatementParser(detectKind(batch.documentKind))
    const file = new File([bytes], batch.fileName, {
      type: batch.fileMimeType
    })

    const extracted = await parser.extract(file, batch.bankId || '')
    console.info('[bank-statements] parse-batch:extracted', {
      batchId: batch.id,
      parser: extracted.document.parser,
      entries: extracted.entries.length
    })
    const normalizedRows = extracted.entries.map((entry) =>
      normalizeStatementRow({
        bankId: batch.bankId || null,
        row: entry
      })
    )

    const existingFingerprints = new Map<string, string>()
    const rowsForCreate = normalizedRows.map((row) => {
      const duplicateOfRowId = existingFingerprints.get(row.duplicateFingerprint) || null
      if (!duplicateOfRowId) {
        existingFingerprints.set(row.duplicateFingerprint, `row-${row.sourceRowIndex}`)
      }

      return {
        companyId: batch.companyId,
        uploadBatchId: batch.id,
        bankId: batch.bankId,
        sourceRowIndex: row.sourceRowIndex,
        transactionDate: row.transactionDate,
        valueDate: row.valueDate,
        description: row.description,
        descriptionNormalized: row.descriptionNormalized,
        debit: row.debit,
        credit: row.credit,
        amount: row.amount,
        direction: row.direction,
        referenceNumber: row.referenceNumber,
        referenceNormalized: row.referenceNormalized,
        chequeNumber: row.chequeNumber,
        balance: row.balance,
        transactionType: row.transactionType,
        rawRowJson: row.rawRowJson,
        parserType: extracted.document.parser,
        parserConfidence: row.parserConfidence,
        extractionStatus: row.extractionStatus,
        duplicateFingerprint: row.duplicateFingerprint,
        duplicateState: duplicateOfRowId ? 'same_batch_duplicate' : 'unique',
        duplicateOfRowId,
        matchStatus: 'unsettled',
        reviewStatus: 'pending'
      }
    })

    await prisma.$transaction(async (tx) => {
      await tx.bankStatementMatchCandidate.deleteMany({
        where: {
          statementRow: {
            uploadBatchId: batch.id
          }
        }
      })
      await tx.bankStatementRow.deleteMany({
        where: {
          uploadBatchId: batch.id
        }
      })
      if (rowsForCreate.length > 0) {
        await tx.bankStatementRow.createMany({
          data: rowsForCreate
        })
      }

      const parsedRows = rowsForCreate.filter((row) => row.extractionStatus === 'parsed').length
      const invalidRows = rowsForCreate.filter((row) => row.extractionStatus === 'invalid').length
      const warningCount = rowsForCreate.filter((row) => row.extractionStatus === 'partial').length

      await tx.bankStatementBatch.update({
        where: { id: batch.id },
        data: {
          batchStatus: 'parsed',
          parseStatus: 'completed',
          totalRows: rowsForCreate.length,
          parsedRows,
          invalidRows,
          warningCount,
          parserType: extracted.document.parser,
          parserVersion: 'v1',
          parserConfidence:
            rowsForCreate.length > 0
              ? Number((rowsForCreate.reduce((sum, row) => sum + Number(row.parserConfidence || 0), 0) / rowsForCreate.length).toFixed(4))
              : null,
          bankNameDetected: batch.bank?.name || null,
          accountNumberMasked: maskAccountNumber(batch.bank?.accountNumber),
          parsedAt: new Date()
        }
      })
    })

    await logBankStatementEvent({
      batchId: batch.id,
      companyId: batch.companyId,
      actor: input.auth,
      eventType: 'parse_completed',
      stage: 'parse',
      note: 'Bank statement parsed successfully.',
      payload: {
        rows: rowsForCreate.length,
        parsedRows: rowsForCreate.filter((row) => row.extractionStatus === 'parsed').length
      }
    })

    const updated = await prisma.bankStatementBatch.findUnique({ where: { id: batch.id } })
    if (!updated) {
      throw new BankStatementError('INTERNAL_ERROR', 'Parsed batch could not be reloaded.', { status: 500 })
    }

    return {
      batch: serializeBankStatementBatch(updated)
    }
  } catch (error) {
    console.error('[bank-statements] parse-batch:failed', {
      batchId: batch.id,
      documentKind: batch.documentKind,
      fileName: batch.fileName,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    const normalizedError = normalizeParseFailure(error)

    await prisma.bankStatementBatch.update({
      where: { id: batch.id },
      data: {
        batchStatus: 'failed',
        parseStatus: 'failed',
        errorCode: normalizedError.code,
        errorMessage: normalizedError.message
      }
    })

    await logBankStatementEvent({
      batchId: batch.id,
      companyId: batch.companyId,
      actor: input.auth,
      eventType: 'parse_failed',
      stage: 'parse',
      note: normalizedError.message,
      payload: normalizedError.details
    })

    throw normalizedError
  }
}
