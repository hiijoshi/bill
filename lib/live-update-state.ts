type LiveUpdateState = {
  companyUpdates: Map<string, number>
  sessionUpdates: Map<string, number>
  superAdminUpdatedAt: number
}

declare global {
  var __mbillLiveUpdateState: LiveUpdateState | undefined
}

function getLiveUpdateState(): LiveUpdateState {
  if (!globalThis.__mbillLiveUpdateState) {
    globalThis.__mbillLiveUpdateState = {
      companyUpdates: new Map<string, number>(),
      sessionUpdates: new Map<string, number>(),
      superAdminUpdatedAt: 0
    }
  }

  return globalThis.__mbillLiveUpdateState
}

export function markCompanyLiveUpdate(companyId: string | null | undefined): number {
  const normalizedCompanyId = String(companyId || '').trim()
  if (!normalizedCompanyId) {
    return 0
  }

  const updatedAt = Date.now()
  getLiveUpdateState().companyUpdates.set(normalizedCompanyId, updatedAt)
  return updatedAt
}

export function markCompanyLiveUpdates(companyIds: Array<string | null | undefined>): number {
  let updatedAt = 0

  for (const companyId of companyIds) {
    updatedAt = Math.max(updatedAt, markCompanyLiveUpdate(companyId))
  }

  return updatedAt
}

export function getCompanyLiveUpdates(companyIds: string[]): Record<string, number> {
  const state = getLiveUpdateState()
  const result: Record<string, number> = {}

  for (const companyId of companyIds) {
    const normalizedCompanyId = String(companyId || '').trim()
    if (!normalizedCompanyId) continue
    result[normalizedCompanyId] = state.companyUpdates.get(normalizedCompanyId) || 0
  }

  return result
}

export function markSuperAdminLiveUpdate(): number {
  const updatedAt = Date.now()
  getLiveUpdateState().superAdminUpdatedAt = updatedAt
  return updatedAt
}

export function getSuperAdminLiveUpdate(): number {
  return getLiveUpdateState().superAdminUpdatedAt
}

type SessionSubject = {
  id?: string | null
  traderId?: string | null
  userId?: string | null
}

function getSessionUpdateKeys(subject: SessionSubject): string[] {
  const keys: string[] = []
  const normalizedId = String(subject.id || '').trim()
  const normalizedTraderId = String(subject.traderId || '').trim()
  const normalizedUserId = String(subject.userId || '').trim().toLowerCase()

  if (normalizedId) {
    keys.push(`id:${normalizedId}`)
  }

  if (normalizedTraderId && normalizedUserId) {
    keys.push(`session:${normalizedTraderId}:${normalizedUserId}`)
  }

  return keys
}

export function markUserSessionLiveUpdate(subject: SessionSubject): number {
  const keys = getSessionUpdateKeys(subject)
  if (keys.length === 0) {
    return 0
  }

  const updatedAt = Date.now()
  const state = getLiveUpdateState()
  for (const key of keys) {
    state.sessionUpdates.set(key, updatedAt)
  }

  return updatedAt
}

export function markUserSessionLiveUpdates(subjects: SessionSubject[]): number {
  let updatedAt = 0

  for (const subject of subjects) {
    updatedAt = Math.max(updatedAt, markUserSessionLiveUpdate(subject))
  }

  return updatedAt
}

export function getUserSessionLiveUpdate(subject: SessionSubject): number {
  const state = getLiveUpdateState()
  let updatedAt = 0

  for (const key of getSessionUpdateKeys(subject)) {
    updatedAt = Math.max(updatedAt, state.sessionUpdates.get(key) || 0)
  }

  return updatedAt
}
