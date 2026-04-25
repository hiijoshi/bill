const PLACEHOLDER_COMPANY_IDS = new Set([
  'demo-company',
  'demo_company',
  'company-id',
  'company_id',
  'null',
  'undefined',
  'na',
  'n/a'
])

export function sanitizeCompanyId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''

  const lowered = trimmed.toLowerCase()
  if (PLACEHOLDER_COMPANY_IDS.has(lowered)) {
    return ''
  }

  return trimmed
}

export function isPlaceholderCompanyId(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return PLACEHOLDER_COMPANY_IDS.has(value.trim().toLowerCase())
}
