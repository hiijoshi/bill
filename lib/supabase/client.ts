export function isSupabaseConfigured(): boolean {
  return false
}

export function createSupabaseBrowserClient(): never {
  throw new Error('Supabase has been disabled for this deployment')
}
