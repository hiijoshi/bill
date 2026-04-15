import { NextRequest, NextResponse } from 'next/server'
import { quickCreateBankStatementTargetSchema } from '@/lib/bank-statements/schemas'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { quickCreateBankStatementTarget } from '@/lib/bank-statements/services/quick-create-target'
import {
  assertCompanyScope,
  assertRowBelongsToCompany,
  requireBankStatementAccess
} from '@/lib/bank-statements/security/require-bank-statement-access'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ rowId: string }> }
) {
  const authResult = await requireBankStatementAccess(request, 'write')
  if (!authResult.ok) return authResult.response

  try {
    const { rowId } = await context.params
    const body = await request.json().catch(() => null)
    const parsed = quickCreateBankStatementTargetSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid quick-create payload.',
          details: parsed.error.flatten()
        }
      }, { status: 400 })
    }

    await assertCompanyScope(request, parsed.data.companyId, 'write')
    await assertRowBelongsToCompany(parsed.data.companyId, rowId)

    const target = await quickCreateBankStatementTarget({
      auth: authResult.auth,
      companyId: parsed.data.companyId,
      rowId,
      targetType: parsed.data.targetType || 'auto',
      preferredName: parsed.data.preferredName || null
    })

    return NextResponse.json({
      ok: true,
      data: target
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
