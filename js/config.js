// Connection to the division's central database (Supabase).
// Fill these in from Supabase → Project Settings → API (or "Connect" → App Frameworks).
// The anon/publishable key is designed to be public: every table is protected by
// row-level security, so only signed-in Kalinga staff can read or change data.
// Never put the "service_role" / secret key here.

export const SUPABASE_URL = '';       // e.g. 'https://abcdefghijkl.supabase.co'
export const SUPABASE_ANON_KEY = '';  // e.g. 'eyJhbGciOi...' or 'sb_publishable_...'
