import type { MatchDecision, MatchScoredCandidate } from './types'

export function resolveMatchDecision(candidates: MatchScoredCandidate[]): MatchDecision {
  if (candidates.length === 0) {
    return {
      status: 'unsettled',
      reason: 'No same-company bank movement candidates matched this statement row.'
    }
  }

  const sorted = [...candidates].sort((left, right) => right.totalScore - left.totalScore)
  const [best, second] = sorted

  if (best.totalScore >= 85 && (!second || best.totalScore - second.totalScore >= 8)) {
    return {
      status: 'settled',
      candidate: best,
      reason: best.reasons.join('; ')
    }
  }

  if (best.totalScore >= 70) {
    return {
      status: 'ambiguous',
      candidates: sorted.slice(0, 3),
      reason: second && best.totalScore - second.totalScore < 8
        ? 'Multiple bank movement candidates are similarly likely.'
        : 'Candidate requires manual review before settlement.'
    }
  }

  return {
    status: 'unsettled',
    reason: 'No candidate crossed the settlement confidence threshold.'
  }
}
