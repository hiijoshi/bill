import { NextRequest, NextResponse } from 'next/server'
import { getBankStatementWorkspaceSchema } from '@/lib/bank-statements/schemas'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { loadBankStatementWorkspace } from '@/lib/bank-statements/queries/load-workspace'
import { assertCompanyScope, requireBankStatementAccess } from '@/lib/bank-statements/security/require-bank-statement-access'

export async function GET(request: NextRequest) {
  const authResult = await requireBankStatementAccess(request, 'read')
  if (!authResult.ok) return authResult.response

  try {
    const searchParams = request.nextUrl.searchParams
    const parsed = getBankStatementWorkspaceSchema.safeParse({
      companyId: searchParams.get('companyId')
    })

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Company ID is required to load the bank statement workspace.',
            details: parsed.error.flatten()
          }
        },
        { status: 400 }
      )
    }

    await assertCompanyScope(request, parsed.data.companyId, 'read')

    const workspace = await loadBankStatementWorkspace(parsed.data.companyId)
    return NextResponse.json({
      ok: true,
      data: workspace
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
