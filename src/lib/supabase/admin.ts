import { createClient } from '@supabase/supabase-js'

// Admin client using the secret key — bypasses RLS.
// Only use in server-side API routes, never in client components.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )
}
