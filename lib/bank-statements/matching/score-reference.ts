import { normalizeCompact } from './utils'

export function scoreReference(statementReference: string | null | undefined, candidateReference: string | null | undefined) {
  const left = normalizeCompact(statementReference)
  const right = normalizeCompact(candidateReference)
  if (!left || !right) return 0
  if (left === right) return 20
  if (left.length >= 6 && right.length >= 6 && (left.includes(right) || right.includes(left))) return 12
  return 0
}
