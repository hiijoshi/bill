import type { NormalizedStatementTransaction } from '../types'
import { scoreAmount } from './score-amount'
import { scoreBalance } from './score-balance'
import { scoreDate } from './score-date'
import { scoreDirection } from './score-direction'
import { scoreNarration } from './score-narration'
import { scoreReference } from './score-reference'
import type { BankMovementCandidate, MatchScoredCandidate } from './types'

export function scoreBankStatementAgainstCandidates(input: {
  row: Pick<NormalizedStatementTransaction, 'transactionDate' | 'amount' | 'direction' | 'referenceNumber' | 'description'>
  candidates: BankMovementCandidate[]
}) {
  const scored: MatchScoredCandidate[] = []

  for (const candidate of input.candidates) {
    const amountScore = scoreAmount(input.row.amount, candidate.amount)
    if (amountScore === 0) continue

    const directionScore = scoreDirection(input.row.direction, candidate.direction)
    if (directionScore === 0) continue

    const dateScore = scoreDate(input.row.transactionDate, candidate.payDate)
    const referenceScore = scoreReference(input.row.referenceNumber, candidate.referenceNumber)
    const narrationScore = scoreNarration(input.row.description, `${candidate.description} ${candidate.counterpartyName || ''}`)
    const balanceScore = scoreBalance()

    const reasons: string[] = []
    if (amountScore > 0) reasons.push('exact amount')
    if (directionScore > 0) reasons.push('direction matched')
    if (dateScore >= 15) reasons.push('exact date')
    else if (dateScore > 0) reasons.push('nearby date')
    if (referenceScore > 0) reasons.push('reference matched')
    if (narrationScore >= 8) reasons.push('strong narration similarity')
    else if (narrationScore > 0) reasons.push('narration similarity')

    scored.push({
      paymentId: candidate.paymentId,
      totalScore: amountScore + directionScore + dateScore + referenceScore + narrationScore + balanceScore,
      amountScore,
      directionScore,
      dateScore,
      referenceScore,
      narrationScore,
      balanceScore,
      reasons
    })
  }

  return scored.sort((left, right) => right.totalScore - left.totalScore)
}
