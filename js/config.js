// Connection to the division's central database (Supabase).
// Fill these in from Supabase → Project Settings → API (or "Connect" → App Frameworks).
// The anon/publishable key is designed to be public: every table is protected by
// row-level security, so only signed-in Kalinga staff can read or change data.
// Never put the "service_role" / secret key here.

export const SUPABASE_URL = 'https://fjavapairckpvxrfilid.supabase.co';       // e.g. 'https://abcdefghijkl.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_GM49Di1G6550sG-z0slCnQ_ycK5p4sF';  // e.g. 'eyJhbGciOi...' or 'sb_publishable_...'
