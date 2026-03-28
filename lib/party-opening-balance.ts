import { normalizeNonNegative, roundCurrency } from '@/lib/billing-calculations'

export const PARTY_OPENING_BALANCE_REFERENCE_PREFIX = 'party-opening:'

export type PartyOpeningBalanceType = 'receivable' | 'payable'

export function normalizePartyOpeningBalanceType(_value: unknown): PartyOpeningBalanceType {
  return 'receivable'
}

export function normalizePartyOpeningBalanceAmount(value: unknown): number {
  return roundCurrency(normalizeNonNegative(value))
}

export function getSignedPartyOpeningBalance(amount: unknown, _type: unknown): number {
  return normalizePartyOpeningBalanceAmount(amount)
}

export function getPartyOpeningBalanceReference(partyId: string): string {
  return `${PARTY_OPENING_BALANCE_REFERENCE_PREFIX}${String(partyId || '').trim()}`
}

export function isPartyOpeningBalanceReference(value: unknown): boolean {
  return String(value || '').trim().startsWith(PARTY_OPENING_BALANCE_REFERENCE_PREFIX)
}

export function formatSignedPartyBalanceLabel(amount: number): string {
  const normalized = roundCurrency(Number(amount || 0))
  return `Receivable ${normalized.toFixed(2)}`
}
