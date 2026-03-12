export function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeTenDigitPhone(value: unknown): string | null {
  const raw = cleanString(value)
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10) return null
  return digits
}

export function parseNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return null
  return num
}

