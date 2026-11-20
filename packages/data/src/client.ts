import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type DbClient = SupabaseClient;

export type SupabaseConfig =
  | { ok: true; url: string; anonKey: string }
  | { ok: false; missing: string[] };

/**
 * Read Supabase configuration. Missing values are reported, never defaulted:
 * the app shows a configuration error instead of pretending to work.
 */
export function readSupabaseConfig(env: { url?: string | undefined; anonKey?: string | undefined }): SupabaseConfig {
  const missing: string[] = [];
  if (!env.url) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!env.anonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length > 0 || !env.url || !env.anonKey) return { ok: false, missing };
  try {
    new URL(env.url);
  } catch {
    return { ok: false, missing: ['NEXT_PUBLIC_SUPABASE_URL (invalid URL)'] };
  }
  return { ok: true, url: env.url, anonKey: env.anonKey };
}

/** Browser client. `deviceId` is sent as x-device-id and recorded in the audit log. */
export function createBrowserClient(config: { url: string; anonKey: string }, deviceId?: string): DbClient {
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: deviceId ? { headers: { 'x-device-id': deviceId } } : {},
  });
}
