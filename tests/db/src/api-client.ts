import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';
import type { DbClient } from '@erp/data';
import { JWT_SECRET, POSTGREST_PORT } from './env';

const BASE = `http://127.0.0.1:${POSTGREST_PORT}`;

export async function signJwt(sub: string | null): Promise<string> {
  const jwt = new SignJWT(sub ? { role: 'authenticated', sub } : { role: 'anon' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m');
  return jwt.sign(new TextEncoder().encode(JWT_SECRET));
}

/**
 * A real supabase-js client talking to a real PostgREST. The only difference from production:
 * PostgREST is served at the root, so the `/rest/v1` prefix (added by Supabase's API gateway)
 * is stripped in a fetch wrapper. Auth (GoTrue) is not involved: the test signs the JWT itself.
 */
export async function clientFor(userId: string | null, deviceId?: string): Promise<DbClient> {
  const token = await signJwt(userId);
  return createClient(BASE, token, {
    accessToken: async () => token,
    global: {
      fetch: (input, init) => fetch(String(input instanceof Request ? input.url : input).replace('/rest/v1', ''), init),
      ...(deviceId ? { headers: { 'x-device-id': deviceId } } : {}),
    },
  });
}
