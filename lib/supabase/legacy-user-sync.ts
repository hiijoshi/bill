type LegacyUserRecord = {
  id: string
  userId: string
  traderId: string
  companyId: string | null
  name: string | null
  role: string | null
  locked: boolean
  deletedAt: Date | null
}

type SyncedSupabaseUser = {
  authUserId: string
  loginEmail: string
  defaultCompanyId: string | null
}

type SyncedLegacyMutationResult = {
  synced: boolean
  defaultCompanyId: string | null
  reason?: string
}

const DISABLED_REASON = 'Supabase sync disabled in local-only mode'

export function buildSupabaseLoginEmail(input: {
  legacyUserId: string
  traderId: string
  userId: string
}): string {
  const trader = String(input.traderId || 'trader').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const user = String(input.userId || 'user').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const id = String(input.legacyUserId || 'legacy').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `${trader}--${user}--${id}@local.disabled`
}

export async function loadLegacyUserForSupabaseSync(legacyUserId: string): Promise<LegacyUserRecord | null> {
  void legacyUserId
  return null
}

export async function ensureSupabaseIdentityForLegacyUser(params: {
  legacyUser: LegacyUserRecord
  password?: string | null
}): Promise<SyncedSupabaseUser> {
  return {
    authUserId: params.legacyUser.id,
    loginEmail: buildSupabaseLoginEmail({
      legacyUserId: params.legacyUser.id,
      traderId: params.legacyUser.traderId,
      userId: params.legacyUser.userId
    }),
    defaultCompanyId: params.legacyUser.companyId || null
  }
}

export async function syncSupabaseForLegacyUserMutation(_params: {
  legacyUserId: string
  password?: string | null
}): Promise<SyncedLegacyMutationResult> {
  void _params
  return {
    synced: false,
    defaultCompanyId: null,
    reason: DISABLED_REASON
  }
}

export async function syncSupabaseForLegacyUserMutationWithTimeout(
  params: {
    legacyUserId: string
    password?: string | null
  },
  timeoutMs = 2500
): Promise<SyncedLegacyMutationResult> {
  void timeoutMs
  return syncSupabaseForLegacyUserMutation(params)
}
