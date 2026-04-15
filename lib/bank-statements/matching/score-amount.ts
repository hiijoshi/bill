export function scoreAmount(statementAmount: number, candidateAmount: number) {
  const difference = Math.abs(Number(statementAmount || 0) - Number(candidateAmount || 0))
  if (difference <= 0.009) return 35

  const base = Math.max(Math.abs(statementAmount), Math.abs(candidateAmount), 1)
  const ratio = difference / base

  if (difference <= 1 || ratio <= 0.005) return 26
  if (difference <= 5 || ratio <= 0.015) return 18
  if (difference <= 20 || ratio <= 0.03) return 9
  return 0
}
