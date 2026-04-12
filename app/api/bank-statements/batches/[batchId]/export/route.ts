import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logBankStatementEvent } from '@/lib/bank-statements/audit'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import {
  assertBatchBelongsToCompany,
  assertCompanyScope,
  requireBankStatementAccess
} from '@/lib/bank-statements/security/require-bank-statement-access'

function csvEscape(value: unknown) {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  const authResult = await requireBankStatementAccess(request, 'read')
  if (!authResult.ok) return authResult.response

  try {
    const { batchId } = await context.params
    const body = await request.json().catch(() => ({}))
    const companyId = String(body?.companyId || '').trim()

    if (!companyId) {
      return NextResponse.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Company ID is required.' } }, { status: 400 })
    }

    await assertCompanyScope(request, companyId, 'read')
    const batch = await assertBatchBelongsToCompany(companyId, batchId)

    const rows = await prisma.bankStatementRow.findMany({
      where: {
        uploadBatchId: batchId,
        companyId
      },
      orderBy: [{ transactionDate: 'asc' }, { sourceRowIndex: 'asc' }]
    })

    const header = [
      'Row No',
      'Transaction Date',
      'Description',
      'Reference',
      'Amount',
      'Direction',
      'Match Status',
      'Matched Payment Id',
      'Match Confidence',
      'Match Reason'
    ]

    const lines = [
      header.join(','),
      ...rows.map((row) => ([
        row.sourceRowIndex,
        row.transactionDate?.toISOString() || '',
        csvEscape(row.description),
        csvEscape(row.referenceNumber || ''),
        row.amount.toFixed(2),
        row.direction,
        row.matchStatus,
        row.matchedPaymentId || '',
        row.matchConfidence ?? '',
        csvEscape(row.matchReason || '')
      ].join(',')))
    ]

    await logBankStatementEvent({
      batchId,
      companyId,
      actor: authResult.auth,
      eventType: 'batch_exported',
      stage: 'export',
      note: 'Exported bank statement reconciliation rows.'
    })

    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${batch.fileName.replace(/\.[^.]+$/, '') || 'bank-statement'}-reconciliation.csv"`
      }
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
