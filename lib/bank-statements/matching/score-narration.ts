import { computeNarrationSimilarity } from './utils'

export function scoreNarration(statementDescription: string, candidateDescription: string) {
  const similarity = computeNarrationSimilarity(statementDescription, candidateDescription)
  if (similarity >= 0.85) return 10
  if (similarity >= 0.65) return 8
  if (similarity >= 0.45) return 5
  if (similarity >= 0.3) return 3
  return 0
}
