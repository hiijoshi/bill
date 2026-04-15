export type QuickCreateRequestedTarget = 'auto' | 'accounting_head' | 'party' | 'supplier'
export type QuickCreateResolvedTarget = Exclude<QuickCreateRequestedTarget, 'auto'>

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeCandidateName(input: {
  preferredName?: string | null
  description: string
  referenceNumber?: string | null
}) {
  const preferred = collapseWhitespace(String(input.preferredName || ''))
  if (preferred.length >= 2) return preferred

  const cleanedDescription = collapseWhitespace(
    String(input.description || '')
      .replace(/\b(?:upi|imps|neft|rtgs|utr|txn|transaction|ref|reference|chq|cheque)\b/gi, ' ')
      .replace(/[^a-z0-9\s&./()-]/gi, ' ')
  ).replace(/^[^a-z0-9]+/i, '').replace(/[^a-z0-9)]+$/i, '')

  if (cleanedDescription.length >= 2) {
    return cleanedDescription.slice(0, 80)
  }

  const cleanedReference = collapseWhitespace(String(input.referenceNumber || '').replace(/[^a-z0-9\s&./()-]/gi, ' '))
    .replace(/^[^a-z0-9]+/i, '')
    .replace(/[^a-z0-9)]+$/i, '')
  if (cleanedReference.length >= 2) {
    return cleanedReference.slice(0, 80)
  }

  return 'Bank Statement Entry'
}

export function resolveQuickCreateTargetType(input: {
  requestedType?: QuickCreateRequestedTarget | null
  direction: 'debit' | 'credit'
  description: string
}): QuickCreateResolvedTarget {
  if (input.requestedType && input.requestedType !== 'auto') {
    return input.requestedType
  }

  const text = String(input.description || '').toLowerCase()
  const accountingHeadHint = /(salary|rent|electricity|utility|gst|tds|interest|charge|commission|insurance|expense|tax)/i.test(text)
  const supplierHint = /(supplier|purchase|vendor|raw|material|transport|freight)/i.test(text)
  const partyHint = /(party|customer|receipt|sales|deposit|collection)/i.test(text)

  if (accountingHeadHint) return 'accounting_head'
  if (supplierHint) return 'supplier'
  if (partyHint) return 'party'
  return input.direction === 'credit' ? 'party' : 'supplier'
}

export function uniqueNameFromExisting(baseName: string, existingNames: string[]) {
  const base = collapseWhitespace(baseName) || 'Bank Statement Entry'
  const lowerSet = new Set(existingNames.map((name) => collapseWhitespace(String(name)).toLowerCase()))
  if (!lowerSet.has(base.toLowerCase())) return base

  for (let index = 2; index <= 2000; index += 1) {
    const candidate = `${base} (${index})`
    if (!lowerSet.has(candidate.toLowerCase())) {
      return candidate
    }
  }

  return `${base} (${Date.now()})`
}
