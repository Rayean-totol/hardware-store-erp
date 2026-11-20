import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type DbClient = SupabaseClient;

export type SupabaseConfig =
  | { ok: true; url: string; anonKey: string }
  | { ok: false; missing: string[] };

/** Decodes the payload of a JWT-shaped key without verifying it (format check only). */
function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='));
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Read Supabase configuration. Missing or invalid values are reported, never defaulted:
 * the app shows a configuration error instead of pretending to work.
 *
 * NEXT_PUBLIC_SUPABASE_URL must be only the project base URL. The client appends /auth/v1,
 * /rest/v1 and /storage/v1 itself, so a value that already contains a path produces requests
 * such as /rest/v1/auth/v1/token, which Supabase rejects with "Invalid path specified".
 * Secret keys are refused because anything the browser receives is public.
 */
export function readSupabaseConfig(env: { url?: string | undefined; anonKey?: string | undefined }): SupabaseConfig {
  const missing: string[] = [];
  if (!env.url) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!env.anonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length > 0 || !env.url || !env.anonKey) return { ok: false, missing };

  const urlProblem = checkProjectUrl(env.url);
  if (urlProblem) return { ok: false, missing: [urlProblem] };

  const key = env.anonKey.trim();
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
    return { ok: false, missing: ['NEXT_PUBLIC_SUPABASE_ANON_KEY (a secret or service_role key must never be used in the browser; use the publishable key)'] };
  }
  return { ok: true, url: new URL(env.url.trim()).origin, anonKey: key };
}

/** Returns a message describing what is wrong with the project URL, or null when it is valid. */
export function checkProjectUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'NEXT_PUBLIC_SUPABASE_URL (invalid URL)';
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return 'NEXT_PUBLIC_SUPABASE_URL (must start with https://)';
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return `NEXT_PUBLIC_SUPABASE_URL (must be only the project URL such as https://<project-ref>.supabase.co; remove the path "${url.pathname}")`;
  }
  if (url.search || url.hash) {
    return 'NEXT_PUBLIC_SUPABASE_URL (must not contain a query string or #fragment)';
  }
  return null;
}

/** Browser client. `deviceId` is sent as x-device-id and recorded in the audit log. */
export function createBrowserClient(config: { url: string; anonKey: string }, deviceId?: string): DbClient {
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: deviceId ? { headers: { 'x-device-id': deviceId } } : {},
  });
}
