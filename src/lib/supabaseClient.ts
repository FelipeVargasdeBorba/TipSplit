import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const TIPSPLIT_WORKSPACE_ID = import.meta.env.VITE_TIPSPLIT_WORKSPACE_ID?.trim() ?? ''
export const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey && TIPSPLIT_WORKSPACE_ID)

export const supabase = supabaseConfigured && supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null
