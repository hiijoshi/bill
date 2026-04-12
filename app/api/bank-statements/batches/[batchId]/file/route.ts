import { NextRequest, NextResponse } from 'next/server'
import { toBankStatementErrorResponse } from '@/lib/bank-statements/errors'
import { uploadBankStatementBatchFile } from '@/lib/bank-statements/services/upload-batch-file'
import {
  assertBatchBelongsToCompany,
  assertCompanyScope,
  requireBankStatementAccess
} from '@/lib/bank-statements/security/require-bank-statement-access'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  const authResult = await requireBankStatementAccess(request, 'write')
  if (!authResult.ok) return authResult.response

  try {
    const { batchId } = await context.params
    const formData = await request.formData()
    const companyId = String(formData.get('companyId') || '').trim()
    const file = formData.get('file')

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

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'FILE_INVALID',
            message: 'Bank statement file is required.'
          }
        },
        { status: 400 }
      )
    }

    await assertCompanyScope(request, companyId, 'write')
    await assertBatchBelongsToCompany(companyId, batchId)

    const result = await uploadBankStatementBatchFile({
      auth: authResult.auth,
      batchId,
      file
    })

    return NextResponse.json({
      ok: true,
      data: result
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
