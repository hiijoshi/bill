import { NextRequest, NextResponse } from 'next/server'
import { createBankStatementBatchSchema } from '@/lib/bank-statements/schemas'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { createBankStatementBatch } from '@/lib/bank-statements/services/create-batch'
import {
  assertBankBelongsToCompany,
  assertCompanyScope,
  requireBankStatementAccess
} from '@/lib/bank-statements/security/require-bank-statement-access'

export async function POST(request: NextRequest) {
  const authResult = await requireBankStatementAccess(request, 'write')
  if (!authResult.ok) return authResult.response

  try {
    const body = await request.json().catch(() => null)
    const parsed = createBankStatementBatchSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Invalid bank statement batch payload.',
            details: parsed.error.flatten()
          }
        },
        { status: 400 }
      )
    }

    await assertCompanyScope(request, parsed.data.companyId, 'write')
    await assertBankBelongsToCompany(parsed.data.companyId, parsed.data.bankId)

    const result = await createBankStatementBatch({
      auth: authResult.auth,
      request: parsed.data
    })

    return NextResponse.json({
      ok: true,
      data: result
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
