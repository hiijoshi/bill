type PrismaLikeError = Error & {
  code?: string
  meta?: unknown
}

const SCHEMA_MISMATCH_PATTERNS = [
  'no such table',
  'no such column',
  'unknown column',
  'inconsistent query result',
  'does not exist'
] as const

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function buildErrorText(error: PrismaLikeError) {
  const parts = [error.message]

  if (typeof error.stack === 'string' && error.stack.length > 0) {
    parts.push(error.stack)
  }

  if (typeof error.code === 'string' && error.code.length > 0) {
    parts.push(error.code)
  }

  if (error.meta) {
    try {
      parts.push(JSON.stringify(error.meta))
    } catch {
      // Ignore non-serializable metadata and continue with the message text.
    }
  }

  return parts.join(' ').toLowerCase()
}

export function isPrismaSchemaMismatchError(
  error: unknown,
  identifiers: readonly string[] = []
): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const prismaError = error as PrismaLikeError
  const text = buildErrorText(prismaError)
  const code = typeof prismaError.code === 'string' ? prismaError.code.toLowerCase() : ''
  const matchesSchemaPattern =
    code === 'p2021' ||
    code === 'p2022' ||
    SCHEMA_MISMATCH_PATTERNS.some((pattern) => text.includes(pattern))

  if (!matchesSchemaPattern) {
    return false
  }

  if (identifiers.length === 0) {
    return true
  }

  const normalizedText = normalizeIdentifier(text)
  return identifiers.some((identifier) => normalizedText.includes(normalizeIdentifier(identifier)))
}
