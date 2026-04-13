export type BankMovementCandidate = {
  paymentId: string | null
  ledgerEntryId: string | null
  targetType: 'payment' | 'ledger_entry'
  companyId: string
  amount: number
  payDate: Date
  direction: 'debit' | 'credit'
  referenceNumber: string | null
  description: string
  bankName: string | null
  accountNumber: string | null
  ifscCode: string | null
  counterpartyName: string | null
}

export type MatchScoredCandidate = {
  paymentId: string | null
  ledgerEntryId: string | null
  targetType: 'payment' | 'ledger_entry'
  totalScore: number
  amountScore: number
  directionScore: number
  dateScore: number
  referenceScore: number
  narrationScore: number
  balanceScore: number
  reasons: string[]
}

export type MatchDecision =
  | {
      status: 'settled'
      candidate: MatchScoredCandidate
      reason: string
    }
  | {
      status: 'ambiguous'
      candidates: MatchScoredCandidate[]
      reason: string
    }
  | {
      status: 'unsettled'
      reason: string
    }
