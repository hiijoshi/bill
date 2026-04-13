import { NextRequest, NextResponse } from 'next/server'
import { postBankStatementRowsSchema } from '@/lib/bank-statements/schemas'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { postBankStatementRows } from '@/lib/bank-statements/services/post-rows'
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
    const parsed = postBankStatementRowsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid post-to-ledger payload.',
          details: parsed.error.flatten()
        }
      }, { status: 400 })
    }

    await assertCompanyScope(request, parsed.data.companyId, 'write')
    await assertBatchBelongsToCompany(parsed.data.companyId, batchId)

    const rows = await postBankStatementRows({
      auth: authResult.auth,
      companyId: parsed.data.companyId,
      batchId,
      rowIds: parsed.data.rowIds
    })

    return NextResponse.json({
      ok: true,
      data: {
        posted: rows
      }
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
