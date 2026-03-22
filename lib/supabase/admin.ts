import { createClient } from '@supabase/supabase-js'

import { getSupabaseBrowserConfig, getSupabaseServiceRoleKey } from './shared'

let adminClient: ReturnType<typeof createClient> | null = null

export function createSupabaseAdminClient() {
  if (adminClient) {
    return adminClient
  }

  const { url } = getSupabaseBrowserConfig()
  const serviceRoleKey = getSupabaseServiceRoleKey()

  adminClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })

  return adminClient
}
