import { normalizeNonNegative, roundCurrency } from '@/lib/billing-calculations'

export const PARTY_OPENING_BALANCE_REFERENCE_PREFIX = 'party-opening:'

export type PartyOpeningBalanceType = 'receivable' | 'payable'

export function normalizePartyOpeningBalanceType(value: unknown): PartyOpeningBalanceType {
  return String(value || '').trim().toLowerCase() === 'payable' ? 'payable' : 'receivable'
}

export function normalizePartyOpeningBalanceAmount(value: unknown): number {
  return roundCurrency(normalizeNonNegative(value))
}

export function getSignedPartyOpeningBalance(amount: unknown, type: unknown): number {
  const normalizedAmount = normalizePartyOpeningBalanceAmount(amount)
  return normalizePartyOpeningBalanceType(type) === 'payable' ? -normalizedAmount : normalizedAmount
}

export function getPartyOpeningBalanceReference(partyId: string): string {
  return `${PARTY_OPENING_BALANCE_REFERENCE_PREFIX}${String(partyId || '').trim()}`
}

export function isPartyOpeningBalanceReference(value: unknown): boolean {
  return String(value || '').trim().startsWith(PARTY_OPENING_BALANCE_REFERENCE_PREFIX)
}

export function formatSignedPartyBalanceLabel(amount: number): string {
  const normalized = roundCurrency(Number(amount || 0))
  if (normalized < 0) {
    return `Payable ${Math.abs(normalized).toFixed(2)}`
  }
  return `Receivable ${normalized.toFixed(2)}`
}
