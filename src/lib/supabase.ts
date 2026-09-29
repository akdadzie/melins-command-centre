import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Set when the build has no Supabase settings; main.tsx shows it instead of the app. */
export const configError = !url || !anonKey
  ? 'This build has no Supabase settings. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (.env.local locally, Netlify environment variables when deployed).'
  : null

// The anon key is public by design; the service-role key never reaches the browser (brief §3).
export const supabase = createClient<Database>(url ?? 'http://invalid.local', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

// Untyped handle for the generic resource screens, which pick the table at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as ReturnType<typeof createClient<any>>

export const appEnv = (import.meta.env.VITE_APP_ENV as string | undefined) ?? 'staging'
