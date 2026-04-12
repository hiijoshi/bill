export function normalizeText(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeCompact(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function dateDistanceInDays(left: Date | string | null | undefined, right: Date | string | null | undefined) {
  if (!left || !right) return Number.POSITIVE_INFINITY
  const leftDate = left instanceof Date ? left : new Date(left)
  const rightDate = right instanceof Date ? right : new Date(right)
  if (!Number.isFinite(leftDate.getTime()) || !Number.isFinite(rightDate.getTime())) return Number.POSITIVE_INFINITY
  const leftUtc = Date.UTC(leftDate.getUTCFullYear(), leftDate.getUTCMonth(), leftDate.getUTCDate())
  const rightUtc = Date.UTC(rightDate.getUTCFullYear(), rightDate.getUTCMonth(), rightDate.getUTCDate())
  return Math.abs(leftUtc - rightUtc) / 86_400_000
}

export function computeNarrationSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeText(left).split(/[^a-z0-9]+/).filter((token) => token.length >= 3))
  const rightTokens = new Set(normalizeText(right).split(/[^a-z0-9]+/).filter((token) => token.length >= 3))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0

  let hits = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) hits += 1
  }

  return hits / Math.max(leftTokens.size, rightTokens.size, 1)
}
