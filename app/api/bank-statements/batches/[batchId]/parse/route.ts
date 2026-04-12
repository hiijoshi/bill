import { NextRequest, NextResponse } from 'next/server'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { parseBankStatementBatch } from '@/lib/bank-statements/services/parse-batch'
import {
  assertBatchBelongsToCompany,
  assertCompanyScope,
  requireBankStatementAccess
} from '@/lib/bank-statements/security/require-bank-statement-access'

export const runtime = 'nodejs'
export const maxDuration = 180

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  const authResult = await requireBankStatementAccess(request, 'write')
  if (!authResult.ok) return authResult.response

  try {
    const { batchId } = await context.params
    const body = await request.json().catch(() => ({}))
    const companyId = String(body?.companyId || '').trim()

    if (!companyId) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Company ID is required.'
          }
        },
        { status: 400 }
      )
    }

    await assertCompanyScope(request, companyId, 'write')
    await assertBatchBelongsToCompany(companyId, batchId)

    const result = await parseBankStatementBatch({
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
