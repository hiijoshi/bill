export async function createSupabaseServerClient(): Promise<never> {
  throw new Error('Supabase has been disabled for this deployment')
}
