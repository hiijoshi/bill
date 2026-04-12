function cleanup(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function extractReferenceNumber(input: {
  reference?: string | null
  description: string
}) {
  const explicit = cleanup(String(input.reference || ''))
  if (explicit) return explicit

  const description = cleanup(input.description)
  const patterns = [
    /\b(?:utr|ref|reference|txn|transaction|imps|neft|rtgs)[:\s-]*([A-Z0-9]{6,})\b/i,
    /\b([A-Z0-9]{10,24})\b/
  ]

  for (const pattern of patterns) {
    const match = description.match(pattern)
    if (match?.[1]) {
      return cleanup(match[1])
    }
  }

  return null
}

export function extractChequeNumber(description: string) {
  const match = description.match(/\b(?:cheque|chq|check)[\s#:.-]*([A-Z0-9]{4,})\b/i)
  return match?.[1] ? cleanup(match[1]) : null
}
