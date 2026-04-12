function isValidDate(date: Date) {
  return Number.isFinite(date.getTime())
}

export function normalizeStatementDate(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return null

  const direct = new Date(raw)
  if (isValidDate(direct)) {
    return direct
  }

  const parts = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/)
  if (parts) {
    const day = Number(parts[1])
    const month = Number(parts[2]) - 1
    const year = Number(parts[3].length === 2 ? `20${parts[3]}` : parts[3])
    const parsed = new Date(Date.UTC(year, month, day))
    if (isValidDate(parsed)) return parsed
  }

  return null
}
