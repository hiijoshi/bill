import { NextRequest, NextResponse } from 'next/server'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { loadBankStatementBatchDetails } from '@/lib/bank-statements/queries/load-batch-details'
import {
  assertBatchBelongsToCompany,
  assertCompanyScope,
  requireBankStatementAccess
} from '@/lib/bank-statements/security/require-bank-statement-access'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  const authResult = await requireBankStatementAccess(request, 'read')
  if (!authResult.ok) return authResult.response

  try {
    const { batchId } = await context.params
    const companyId = request.nextUrl.searchParams.get('companyId')?.trim() || ''
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

    await assertCompanyScope(request, companyId, 'read')
    await assertBatchBelongsToCompany(companyId, batchId)

    const payload = await loadBankStatementBatchDetails(companyId, batchId)
    if (!payload) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'BATCH_NOT_FOUND',
            message: 'Bank statement batch was not found.'
          }
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: payload
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
