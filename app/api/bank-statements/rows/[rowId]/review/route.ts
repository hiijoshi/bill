import { NextRequest, NextResponse } from 'next/server'
import { reviewBankStatementRowSchema } from '@/lib/bank-statements/schemas'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { reviewBankStatementRow } from '@/lib/bank-statements/services/review-row'
import {
  assertCompanyScope,
  assertRowBelongsToCompany,
  requireBankStatementAccess
} from '@/lib/bank-statements/security/require-bank-statement-access'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ rowId: string }> }
) {
  const authResult = await requireBankStatementAccess(request, 'write')
  if (!authResult.ok) return authResult.response

  try {
    const { rowId } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = reviewBankStatementRowSchema.safeParse(body)
    const companyId = String(body?.companyId || '').trim()

    if (!companyId) {
      return NextResponse.json({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Company ID is required.'
        }
      }, { status: 400 })
    }

    if (!parsed.success) {
      return NextResponse.json({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid review action payload.',
          details: parsed.error.flatten()
        }
      }, { status: 400 })
    }

    await assertCompanyScope(request, companyId, 'write')
    await assertRowBelongsToCompany(companyId, rowId)

    const row = await reviewBankStatementRow({
      auth: authResult.auth,
      rowId,
      action: parsed.data
    })

    return NextResponse.json({
      ok: true,
      data: {
        rowId: row.id,
        matchStatus: row.matchStatus,
        reviewStatus: row.reviewStatus,
        matchedPaymentId: row.matchedPaymentId
      }
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
