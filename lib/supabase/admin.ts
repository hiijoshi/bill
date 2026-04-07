import { createRequire } from 'node:module'

import { getSupabaseServiceRoleKey, getSupabaseBrowserConfig } from './shared'

type SupabaseModule = typeof import('@supabase/supabase-js')

const require = createRequire(import.meta.url)

let cachedCreateClient: SupabaseModule['createClient'] | null = null

function getSupabaseCreateClient(): SupabaseModule['createClient'] {
  if (!cachedCreateClient) {
    cachedCreateClient = (require('@supabase/supabase-js') as SupabaseModule).createClient
  }

  return cachedCreateClient
}

export function createSupabaseAdminClient() {
  const config = getSupabaseBrowserConfig()
  const serviceRoleKey = getSupabaseServiceRoleKey()

  if (!config || !serviceRoleKey) {
    throw new Error('Supabase admin client is not configured')
  }

  // Do NOT cache the admin client as a singleton — on Vercel serverless
  // each invocation should get a fresh client to avoid stale auth state.
  return getSupabaseCreateClient()(config.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}
