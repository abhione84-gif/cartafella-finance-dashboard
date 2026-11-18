// Connection settings. Fill in the two Supabase values from:
// Supabase → Project Settings → API → "Project URL" and the "anon public" key.
// The anon key is meant to be public; the data is protected by the login and
// the database rules in supabase/schema.sql.
// While these are empty the site runs in demo mode (data stays in your browser).
window.APP_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  TITLE: 'Cartafella Analytics · Finance Dashboard',
  EXPORT_NAME: 'Cartafella-Finance-Dashboard'
};
