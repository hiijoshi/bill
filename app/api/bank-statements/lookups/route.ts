import { NextRequest, NextResponse } from 'next/server'
import { getBankStatementWorkspaceSchema } from '@/lib/bank-statements/schemas'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { loadBankStatementLookups } from '@/lib/bank-statements/services/load-lookups'
import { assertCompanyScope, requireBankStatementAccess } from '@/lib/bank-statements/security/require-bank-statement-access'

export async function GET(request: NextRequest) {
  const authResult = await requireBankStatementAccess(request, 'read')
  if (!authResult.ok) return authResult.response

  try {
    const parsed = getBankStatementWorkspaceSchema.safeParse({
      companyId: request.nextUrl.searchParams.get('companyId')
    })

    if (!parsed.success) {
      return NextResponse.json({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Company ID is required.',
          details: parsed.error.flatten()
        }
      }, { status: 400 })
    }

    await assertCompanyScope(request, parsed.data.companyId, 'read')
    const data = await loadBankStatementLookups(parsed.data.companyId)

    return NextResponse.json({
      ok: true,
      data
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
