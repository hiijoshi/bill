import { normalizeCompact } from './utils'

export function scoreReference(statementReference: string | null | undefined, candidateReference: string | null | undefined) {
  const left = normalizeCompact(statementReference)
  const right = normalizeCompact(candidateReference)
  if (!left || !right) return 0
  return left === right ? 20 : 0
}
