const SEEDED_COMPANY_ADDRESS_PLACEHOLDER = 'seeded company for turso testing'

export function sanitizePrintCompanyAddress(value: unknown): string {
  const address = String(value || '').trim()
  if (!address) return ''
  if (address.toLowerCase() === SEEDED_COMPANY_ADDRESS_PLACEHOLDER) {
    return ''
  }
  return address
}

