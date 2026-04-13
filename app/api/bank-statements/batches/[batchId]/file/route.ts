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
    const contentType = String(request.headers.get('content-type') || '').toLowerCase()
    let companyId = ''
    let fileName = ''
    let fileMimeType = ''
    let fileSizeBytes = 0
    let bytes = new Uint8Array()

    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => null) as
        | {
            companyId?: unknown
            fileName?: unknown
            fileMimeType?: unknown
            fileSizeBytes?: unknown
            fileBase64?: unknown
          }
        | null

      companyId = String(body?.companyId || '').trim()
      fileName = String(body?.fileName || '').trim()
      fileMimeType = String(body?.fileMimeType || '').trim()
      fileSizeBytes = Number(body?.fileSizeBytes || 0)
      const fileBase64 = String(body?.fileBase64 || '').trim()

      if (!fileBase64) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'FILE_INVALID',
              message: 'Bank statement file bytes are required.'
            }
          },
          { status: 400 }
        )
      }

      bytes = Uint8Array.from(Buffer.from(fileBase64, 'base64'))
    } else if (!contentType.includes('multipart/form-data')) {
      companyId = String(request.headers.get('x-company-id') || '').trim()
      fileName = decodeURIComponent(String(request.headers.get('x-file-name') || '').trim())
      fileMimeType = decodeURIComponent(
        String(request.headers.get('x-file-mime-type') || request.headers.get('content-type') || 'application/octet-stream').trim()
      )
      fileSizeBytes = Number(request.headers.get('x-file-size-bytes') || 0)
      bytes = new Uint8Array(await request.arrayBuffer())
    } else {
      const formData = await request.formData()
      companyId = String(formData.get('companyId') || '').trim()
      const file = formData.get('file')

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

      fileName = String(file.name || '').trim()
      fileMimeType = String(file.type || 'application/octet-stream').trim()
      fileSizeBytes = Number(file.size || 0)
      bytes = new Uint8Array(await file.arrayBuffer())
    }

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

    console.info('[bank-statements] POST /api/bank-statements/batches/[batchId]/file', {
      batchId,
      companyId,
      fileName,
      fileMimeType,
      fileSizeBytes
    })

    const result = await uploadBankStatementBatchFile({
      auth: authResult.auth,
      batchId,
      fileName,
      fileMimeType,
      fileSizeBytes,
      bytes
    })

    return NextResponse.json({
      ok: true,
      data: result
    })
  } catch (error) {
    return toBankStatementErrorResponse(error)
  }
}
