import { readSupabaseConfig } from '@erp/data';

// NEXT_PUBLIC_* values are inlined at build time; each must be referenced literally.
export const supabaseConfig = readSupabaseConfig({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
