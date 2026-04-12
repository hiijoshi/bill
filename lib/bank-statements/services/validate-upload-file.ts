import { bankStatementUploadFileInfoSchema } from '../schemas'
import { BankStatementError } from '../errors'

export function validateBankStatementFileInfo(input: {
  fileName: string
  fileMimeType: string
  fileSizeBytes: number
}) {
  const fileExtension = input.fileName.trim().toLowerCase().split('.').at(-1) || ''
  const parsed = bankStatementUploadFileInfoSchema.safeParse({
    ...input,
    fileExtension
  })

  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    const fieldErrors = Object.values(flattened.fieldErrors).flat().filter(Boolean)
    const message = fieldErrors[0] || 'Invalid bank statement file.'

    throw new BankStatementError(
      message.toLowerCase().includes('mime') || message.toLowerCase().includes('extension')
        ? 'UNSUPPORTED_FILE_TYPE'
        : 'FILE_INVALID',
      message,
      {
        status: 400,
        details: flattened
      }
    )
  }

  return parsed.data
}
