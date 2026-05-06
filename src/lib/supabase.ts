import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://jomlceougvxmnlztppms.supabase.co";

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvbWxjZW91Z3Z4bW5senRwcG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5OTIzMjAsImV4cCI6MjA5MzU2ODMyMH0.nvflZjGbg4gCSHVaE1H3ATxUc561YDtetXvcpWViGd8";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
  },
});
