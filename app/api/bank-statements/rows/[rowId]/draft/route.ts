import { NextRequest, NextResponse } from 'next/server'
import { saveBankStatementDraftSchema } from '@/lib/bank-statements/schemas'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { saveBankStatementRowDraft } from '@/lib/bank-statements/services/save-row-draft'
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
    const parsed = saveBankStatementDraftSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid reconciliation draft payload.',
          details: parsed.error.flatten()
        }
      }, { status: 400 })
    }

    await assertCompanyScope(request, parsed.data.companyId, 'write')
    await assertRowBelongsToCompany(parsed.data.companyId, rowId)

    const row = await saveBankStatementRowDraft({
      auth: authResult.auth,
      rowId,
      payload: parsed.data
    })

    return NextResponse.json({
      ok: true,
      data: {
        rowId: row.id
      }
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
