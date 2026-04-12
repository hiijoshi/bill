import { NextRequest, NextResponse } from 'next/server'
import { finalizeBankStatementBatchSchema } from '@/lib/bank-statements/schemas'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { finalizeBankStatementBatch } from '@/lib/bank-statements/services/finalize-batch'
import {
  assertBatchBelongsToCompany,
  assertCompanyScope,
  requireBankStatementAccess
} from '@/lib/bank-statements/security/require-bank-statement-access'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  const authResult = await requireBankStatementAccess(request, 'write')
  if (!authResult.ok) return authResult.response

  try {
    const { batchId } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = finalizeBankStatementBatchSchema.safeParse(body)
    const companyId = String(body?.companyId || '').trim()

    if (!companyId) {
      return NextResponse.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Company ID is required.' } }, { status: 400 })
    }

    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Finalize confirmation is required.' } }, { status: 400 })
    }

    await assertCompanyScope(request, companyId, 'write')
    await assertBatchBelongsToCompany(companyId, batchId)

    const result = await finalizeBankStatementBatch({
      auth: authResult.auth,
      batchId
    })

    return NextResponse.json({
      ok: true,
      data: result
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
