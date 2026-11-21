import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { pool, type Sql } from '../db';
import { DEMO_ORG, USERS } from '../env';

/**
 * Committed-transaction concurrency for suppliers. Runs in its own database
 * (vitest.concurrency.config.ts), because it commits rows.
 */
afterAll(() => pool.end());

async function commitAs<T>(userId: string, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    const result = await fn((text, params) => client.query(text, params));
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const payload = (code: string, extra: Record<string, unknown> = {}) => ({
  name_en: `Supplier ${code}`,
  name_ar: 'مورد اختبار',
  supplier_code: code,
  country_code: 'SA',
  ...extra,
});

const attempt = (fn: () => Promise<unknown>) =>
  fn()
    .then((value) => ({ ok: true as const, value }))
    .catch((error: { message: string }) => ({ ok: false as const, message: error.message }));

const uniq = () => randomBytes(3).toString('hex').toUpperCase();

describe('suppliers concurrency (committed)', () => {
  it('simultaneous creates each receive a distinct supplier number', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        attempt(() =>
          commitAs(USERS.owner, (sql) =>
            sql('select public.save_supplier($1, $2::jsonb, null) as r', [DEMO_ORG, JSON.stringify(payload(`CC-${uniq()}-${i}`))]),
          ).then((r) => r.rows[0].r as { supplier_no: string }),
        ),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const numbers = results.map((r) => (r as { value: { supplier_no: string } }).value.supplier_no);
    expect(new Set(numbers).size).toBe(6);
  });

  it('two simultaneous creates with the same code: one succeeds, the other is refused cleanly', async () => {
    const code = `DUPC-${uniq()}`;
    const results = await Promise.all([
      attempt(() => commitAs(USERS.owner, (sql) => sql('select public.save_supplier($1, $2::jsonb, null) as r', [DEMO_ORG, JSON.stringify(payload(code))]))),
      attempt(() => commitAs(USERS.owner, (sql) => sql('select public.save_supplier($1, $2::jsonb, null) as r', [DEMO_ORG, JSON.stringify(payload(code))]))),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failure = results.find((r) => !r.ok) as { message: string };
    expect(failure.message).toBe('supplier.code_taken');
  });

  it('two edits from the same version: one succeeds, the other gets concurrency_conflict', async () => {
    const created = (await commitAs(USERS.owner, (sql) =>
      sql('select public.save_supplier($1, $2::jsonb, null) as r', [DEMO_ORG, JSON.stringify(payload(`EDIT-${uniq()}`))]),
    )).rows[0].r as { id: string; row_version: number };

    const edit = (city: string) =>
      attempt(() =>
        commitAs(USERS.owner, (sql) =>
          sql('select public.save_supplier($1, $2::jsonb, $3) as r', [
            DEMO_ORG,
            JSON.stringify({ ...payload(`EDIT-${created.id.slice(0, 4)}`), id: created.id, city }),
            created.row_version,
          ]),
        ),
      );
    const results = await Promise.all([edit('Riyadh'), edit('Jeddah')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((results.find((r) => !r.ok) as { message: string }).message).toBe('concurrency_conflict');
  });
});
