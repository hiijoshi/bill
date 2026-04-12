export function scoreAmount(statementAmount: number, candidateAmount: number) {
  return Math.abs(statementAmount - candidateAmount) <= 0.009 ? 35 : 0
}
