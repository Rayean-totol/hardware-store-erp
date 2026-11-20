import pg from 'pg';
import { TEST_DB_URL } from './env';

export const pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 4 });

export type Sql = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

/**
 * Run `fn` inside a transaction as a Supabase API caller: role `authenticated` with the given
 * user id in the JWT claims (or `anon` when userId is null). Always rolled back, so tests
 * cannot leak state into each other.
 */
export async function asUser<T>(
  userId: string | null,
  fn: (sql: Sql) => Promise<T>,
  opts: { headers?: Record<string, string> } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' }),
    ]);
    if (opts.headers) {
      await client.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(opts.headers)]);
    }
    return await fn((text, params) => client.query(text, params));
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
}

/** Same, as the migration owner (superuser): bypasses RLS. Still rolled back. */
export async function asAdmin<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    return await fn((text, params) => client.query(text, params));
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
}

/** Assert that a query fails with the given app error code (MESSAGE of app.fail()). */
export async function expectDbError(promise: Promise<unknown>, messageOrPattern: string | RegExp): Promise<pg.DatabaseError> {
  try {
    await promise;
  } catch (error) {
    const e = error as pg.DatabaseError;
    const ok = typeof messageOrPattern === 'string' ? e.message === messageOrPattern : messageOrPattern.test(e.message);
    if (!ok) throw new Error(`Expected DB error ${String(messageOrPattern)}, got: ${e.message}`, { cause: error });
    return e;
  }
  throw new Error(`Expected DB error ${String(messageOrPattern)}, but the query succeeded`);
}

export async function unitId(sql: Sql, code: string): Promise<string> {
  const { rows } = await sql('select id from public.units where code = $1 and org_id is null', [code]);
  if (!rows[0]) throw new Error(`unit ${code} not found`);
  return rows[0].id as string;
}
