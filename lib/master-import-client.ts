type MasterImportResult = {
  error?: string
  imported?: number
  updated?: number
  skipped?: number
  errors?: number
  errorDetails?: string[]
}

export async function uploadMasterCsv(
  endpoint: string,
  file: File,
  companyId?: string
): Promise<{ ok: boolean; result: MasterImportResult }> {
  const formData = new FormData()
  formData.append('file', file)

  const suffix = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''
  const response = await fetch(`${endpoint}${suffix}`, {
    method: 'POST',
    body: formData,
  })
  const result = (await response.json().catch(() => ({}))) as MasterImportResult
  return { ok: response.ok, result }
}

export function formatMasterImportSummary(entityLabel: string, result: MasterImportResult): string {
  const lines = [
    `${entityLabel} import completed.`,
    `Imported: ${Number(result.imported || 0)}`,
    `Updated: ${Number(result.updated || 0)}`,
    `Skipped: ${Number(result.skipped || 0)}`,
    `Errors: ${Number(result.errors || 0)}`
  ]

  if (Array.isArray(result.errorDetails) && result.errorDetails.length > 0) {
    lines.push('', ...result.errorDetails.slice(0, 5))
    if (result.errorDetails.length > 5) {
      lines.push(`...and ${result.errorDetails.length - 5} more`)
    }
  }

  return lines.join('\n')
}
