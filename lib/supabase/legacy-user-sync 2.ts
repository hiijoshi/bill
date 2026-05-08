import { prisma } from '@/lib/prisma'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getAccessibleCompanies, normalizeAppRole } from '@/lib/api-security'
import type { RequestAuthContext } from '@/lib/api-security'

type LegacyUserRecord = {
  id: string
  userId: string
  traderId: string
  companyId: string | null
  name: string | null
  role: string | null
  locked: boolean
  deletedAt: Date | null
  trader: {
    id: string
    name: string
    locked: boolean
    deletedAt: Date | null
  } | null
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

const DEFAULT_MUTATION_SYNC_TIMEOUT_MS = 2500

// We intentionally use a loose client shape here until generated Supabase database
// types are added; this bootstrap path only runs in the privileged auth bridge.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdminClient(): any {
  return createSupabaseAdminClient()
}

function cleanEmailPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'user'
}

export function buildSupabaseLoginEmail(input: {
  legacyUserId: string
  traderId: string
  userId: string
}): string {
  const traderPart = cleanEmailPart(input.traderId).slice(0, 32)
  const userPart = cleanEmailPart(input.userId).slice(0, 32)
  return `${traderPart}--${userPart}--${input.legacyUserId}@billing.local`
}

export async function loadLegacyUserForSupabaseSync(legacyUserId: string): Promise<LegacyUserRecord | null> {
  const user = await prisma.user.findFirst({
    where: {
      id: legacyUserId,
      deletedAt: null
    },
    select: {
      id: true,
      userId: true,
      traderId: true,
      companyId: true,
      name: true,
      role: true,
      locked: true,
      deletedAt: true,
      trader: {
        select: {
          id: true,
          name: true,
          locked: true,
          deletedAt: true
        }
      }
    }
  })

  if (!user || !user.trader || user.locked || user.deletedAt || user.trader.locked || user.trader.deletedAt) {
    return null
  }

  return user
}

async function syncProfileAccessGraph(params: {
  authUserId: string
  legacyUser: LegacyUserRecord
  loginEmail: string
}) {
  const admin = getAdminClient()
  const role = normalizeAppRole(params.legacyUser.role)
  const authContext: RequestAuthContext = {
    userId: params.legacyUser.userId,
    traderId: params.legacyUser.traderId,
    role,
    companyId: params.legacyUser.companyId,
    userDbId: params.legacyUser.id
  }

  const accessibleCompanies = await getAccessibleCompanies(authContext)
  const accessibleCompanyIds = Array.from(new Set(accessibleCompanies.map((row) => row.id)))
  const defaultCompanyId =
    accessibleCompanies.find((row) => row.id === params.legacyUser.companyId && !row.locked)?.id ||
    accessibleCompanies.find((row) => !row.locked)?.id ||
    accessibleCompanies[0]?.id ||
    null

  // Upsert on both 'id' and the unique (trader_id, user_code) constraint
  // to avoid duplicate key errors when the same user is synced multiple times.
  const { error: profileError } = await admin.from('profiles').upsert(
  {
    id: params.authUserId,
    legacy_user_id: params.legacyUser.id,

    // required/new columns
    traderId: params.legacyUser.traderId,
    userId: params.legacyUser.userId,
    role,
    email: params.loginEmail,

    // existing/legacy columns still present in your table
    full_name: params.legacyUser.name,
    default_company_id: defaultCompanyId,
    is_active: true,
    login_email: params.loginEmail,
    trader_id: params.legacyUser.traderId,
    user_code: params.legacyUser.userId,
    app_role: role
  },
  {
    onConflict: 'id'
  }
)

  if (profileError) {
    // If upsert fails due to (trader_id, user_code) unique conflict,
    // try to find the existing profile and update it instead.
    if (profileError.code === '23505') {
      const { data: conflictProfile } = await admin
        .from('profiles')
        .select('id')
        .eq('trader_id', params.legacyUser.traderId)
        .eq('user_code', params.legacyUser.userId)
        .maybeSingle()
      if (conflictProfile?.id && conflictProfile.id !== params.authUserId) {
        // Another auth user owns this trader+user_code — skip profile sync
        const safeConflictId = String(conflictProfile.id).replace(/[\r\n\t]/g, '_')
        const safeTraderId = String(params.legacyUser.traderId).replace(/[\r\n\t]/g, '_')
        const safeUserId = String(params.legacyUser.userId).replace(/[\r\n\t]/g, '_')
        console.warn(`Profile conflict: trader=${safeTraderId} user=${safeUserId} already owned by ${safeConflictId}`)
      } else {
        throw new Error(`Failed to sync Supabase profile: ${profileError.message}`)
      }
    } else {
      throw new Error(`Failed to sync Supabase profile: ${profileError.message}`)
    }
  }

  // Deactivate existing access rows — ignore error if none exist yet
  await admin
    .from('profile_company_access')
    .update({ is_active: false, is_default: false })
    .eq('profile_id', params.authUserId)
    .then(() => null) // swallow error — no rows is fine

  if (accessibleCompanyIds.length > 0) {
    const { error: accessUpsertError } = await admin.from('profile_company_access').upsert(
      accessibleCompanyIds.map((companyId) => ({
        profile_id: params.authUserId,
        company_id: companyId,
        is_default: companyId === defaultCompanyId,
        is_active: true
      })),
      {
        onConflict: 'profile_id,company_id'
      }
    )

    if (accessUpsertError) {
      throw new Error(`Failed to sync company access: ${accessUpsertError.message}`)
    }
  }

  const permissionRows = await prisma.userPermission.findMany({
    where: {
      userId: params.legacyUser.id
    },
    select: {
      companyId: true,
      module: true,
      canRead: true,
      canWrite: true
    }
  })

  const { error: deletePermissionsError } = await admin
    .from('profile_company_permissions')
    .delete()
    .eq('profile_id', params.authUserId)

  if (deletePermissionsError) {
    throw new Error(`Failed to refresh company permissions: ${deletePermissionsError.message}`)
  }

  if (permissionRows.length > 0) {
    const { error: permissionInsertError } = await admin.from('profile_company_permissions').insert(
      permissionRows.map((row) => ({
        profile_id: params.authUserId,
        company_id: row.companyId,
        module: row.module,
        can_read: row.canRead,
        can_write: row.canWrite
      }))
    )

    if (permissionInsertError) {
      throw new Error(`Failed to sync company permissions: ${permissionInsertError.message}`)
    }
  }

  return {
    defaultCompanyId
  }
}

export async function ensureSupabaseIdentityForLegacyUser(params: {
  legacyUser: LegacyUserRecord
  password: string
}): Promise<SyncedSupabaseUser> {
  const admin = getAdminClient()
  const fallbackEmail = buildSupabaseLoginEmail({
    legacyUserId: params.legacyUser.id,
    traderId: params.legacyUser.traderId,
    userId: params.legacyUser.userId
  })

  const { data: existingProfile, error: profileLookupError } = await admin
    .from('profiles')
    .select('id, login_email')
    .eq('legacy_user_id', params.legacyUser.id)
    .maybeSingle()

  if (profileLookupError) {
    throw new Error(`Failed to lookup Supabase profile: ${profileLookupError.message}`)
  }

  let authUserId = existingProfile?.id || null
  let loginEmail = existingProfile?.login_email || fallbackEmail

  const userMetadata = {
    legacy_user_id: params.legacyUser.id,
    trader_id: params.legacyUser.traderId,
    userId: params.legacyUser.userId,
    full_name: params.legacyUser.name || '',
    app_role: normalizeAppRole(params.legacyUser.role),
    login_email: loginEmail,
    default_company_id: params.legacyUser.companyId || ''
  }

  if (!authUserId) {
    const created = await admin.auth.admin.createUser({
      email: loginEmail,
      password: params.password,
      email_confirm: true,
      user_metadata: userMetadata
    })

    if (created.error) {
      // Email already exists in auth.users — find the user by email
      const { data: listData } = await admin.auth.admin.listUsers()
      const existingAuthUser = listData?.users?.find(
        (u: { email?: string; id: string }) => u.email === loginEmail
      )

      if (existingAuthUser?.id) {
        authUserId = existingAuthUser.id
        loginEmail = existingAuthUser.email || loginEmail
      } else {
        // Try profile lookup as fallback
        const { data: recoveredProfile } = await admin
          .from('profiles')
          .select('id, login_email')
          .eq('login_email', loginEmail)
          .maybeSingle()

        if (!recoveredProfile?.id) {
          throw new Error(`Failed to provision Supabase auth user: ${created.error.message}`)
        }

        authUserId = recoveredProfile.id
        loginEmail = recoveredProfile.login_email || loginEmail
      }
    } else {
      authUserId = created.data.user.id
      loginEmail = created.data.user.email || loginEmail
    }
  }

  const updatedAuthUser = await admin.auth.admin.updateUserById(authUserId, {
    email: loginEmail,
    password: params.password,
    user_metadata: userMetadata
  })

  if (updatedAuthUser.error) {
    throw new Error(`Failed to sync Supabase auth user: ${updatedAuthUser.error.message}`)
  }

  const graph = await syncProfileAccessGraph({
    authUserId,
    legacyUser: params.legacyUser,
    loginEmail
  })

  return {
    authUserId,
    loginEmail,
    defaultCompanyId: graph.defaultCompanyId
  }
}

export async function syncSupabaseForLegacyUserMutation(params: {
  legacyUserId: string
  password?: string | null
}): Promise<SyncedLegacyMutationResult> {
  const legacyUser = await loadLegacyUserForSupabaseSync(params.legacyUserId)
  if (!legacyUser) {
    return {
      synced: false,
      defaultCompanyId: null,
      reason: 'Legacy user is locked or inactive'
    }
  }

  if (params.password && params.password.trim().length > 0) {
    const syncedIdentity = await ensureSupabaseIdentityForLegacyUser({
      legacyUser,
      password: params.password
    })

    return {
      synced: true,
      defaultCompanyId: syncedIdentity.defaultCompanyId
    }
  }

  const admin = getAdminClient()
  const fallbackEmail = buildSupabaseLoginEmail({
    legacyUserId: legacyUser.id,
    traderId: legacyUser.traderId,
    userId: legacyUser.userId
  })

  const { data: existingProfile, error: profileLookupError } = await admin
    .from('profiles')
    .select('id, login_email')
    .eq('legacy_user_id', legacyUser.id)
    .maybeSingle()

  if (profileLookupError) {
    throw new Error(`Failed to lookup Supabase profile: ${profileLookupError.message}`)
  }

  if (!existingProfile?.id) {
    return {
      synced: false,
      defaultCompanyId: null,
      reason: 'Supabase identity not provisioned yet'
    }
  }

  const loginEmail = existingProfile.login_email || fallbackEmail
  const userMetadata = {
    legacy_user_id: legacyUser.id,
    trader_id: legacyUser.traderId,
    user_code: legacyUser.userId,
    full_name: legacyUser.name || '',
    app_role: normalizeAppRole(legacyUser.role),
    login_email: loginEmail,
    default_company_id: legacyUser.companyId || ''
  }

  const updatedAuthUser = await admin.auth.admin.updateUserById(existingProfile.id, {
    email: loginEmail,
    user_metadata: userMetadata
  })

  if (updatedAuthUser.error) {
    throw new Error(`Failed to sync Supabase auth user: ${updatedAuthUser.error.message}`)
  }

  const graph = await syncProfileAccessGraph({
    authUserId: existingProfile.id,
    legacyUser,
    loginEmail
  })

  return {
    synced: true,
    defaultCompanyId: graph.defaultCompanyId
  }
}

export async function syncSupabaseForLegacyUserMutationWithTimeout(
  params: {
    legacyUserId: string
    password?: string | null
  },
  timeoutMs = DEFAULT_MUTATION_SYNC_TIMEOUT_MS
): Promise<SyncedLegacyMutationResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<SyncedLegacyMutationResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({
        synced: false,
        defaultCompanyId: null,
        reason: 'Cloud sync timed out. Data was saved and login fallback will recover the cloud session.'
      })
    }, timeoutMs)
  })

  const syncPromise = syncSupabaseForLegacyUserMutation(params).catch((error) => ({
    synced: false,
    defaultCompanyId: null,
    reason: error instanceof Error ? error.message : 'Failed to sync cloud identity'
  }))

  try {
    return await Promise.race([syncPromise, timeoutPromise])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}
