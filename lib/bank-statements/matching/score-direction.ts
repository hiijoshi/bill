export function scoreDirection(
  statementDirection: 'debit' | 'credit',
  candidateDirection: 'debit' | 'credit'
) {
  return statementDirection === candidateDirection ? 20 : 0
}
