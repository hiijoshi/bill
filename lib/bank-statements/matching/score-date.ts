import { dateDistanceInDays } from './utils'

export function scoreDate(statementDate: Date | string | null | undefined, candidateDate: Date | string | null | undefined) {
  const distance = dateDistanceInDays(statementDate, candidateDate)
  if (distance === 0) return 15
  if (distance <= 1) return 12
  if (distance <= 2) return 8
  if (distance <= 3) return 4
  return 0
}
