import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { pool, unitId, type Sql } from '../db';
import { DEMO_ORG, USERS } from '../env';

/** Committed-transaction concurrency for purchase orders (own database; see vitest.concurrency.config.ts). */
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

const attempt = <T>(fn: () => Promise<T>) =>
  fn().then((value) => ({ ok: true as const, value })).catch((error: { message: string }) => ({ ok: false as const, message: error.message }));

async function setup() {
  const pcs = await unitId(async (t, p) => pool.query(t, p), 'pcs');
  const screw = (await pool.query(`select id from public.products where org_id = $1 and sku = 'FST-WS-4X40'`, [DEMO_ORG])).rows[0].id as string;
  const wh = (await pool.query(`select id, branch_id from public.warehouses where org_id = $1 and code = 'RUH'`, [DEMO_ORG])).rows[0] as { id: string; branch_id: string };
  const supplier = (await commitAs(USERS.owner, (sql) =>
    sql('select public.save_supplier($1, $2::jsonb, null) as r', [DEMO_ORG, JSON.stringify({ name_en: 'Concurrent', name_ar: 'متزامن', supplier_code: `POC-${randomBytes(3).toString('hex').toUpperCase()}` })]),
  )).rows[0].r.id as string;
  const lines = JSON.stringify([{ product_id: screw, unit_id: pcs, quantity: '2', unit_cost: '5.00' }]);
  return { wh, supplier, lines };
}

describe('purchase orders concurrency (committed)', () => {
  it('two approvers act on the same submitted order at once: exactly one approval lands', async () => {
    const s = await setup();
    const client = randomUUID();
    const po = (await commitAs(USERS.owner, (sql) =>
      sql('select public.create_purchase_order($1, $2, $3, $4, $5, null, null, $6::jsonb) as r', [DEMO_ORG, client, s.supplier, s.wh.branch_id, s.wh.id, s.lines]),
    )).rows[0].r as { id: string; row_version: number };
    await commitAs(USERS.owner, (sql) => sql('select public.submit_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version]));

    const approve = (user: string) => attempt(() => commitAs(user, (sql) =>
      sql('select public.approve_purchase_order($1, $2, $3) as r', [DEMO_ORG, po.id, po.row_version + 1])));
    const results = await Promise.all([approve(USERS.manager), approve(USERS.manager)]);
    const winners = results.filter((r) => r.ok && (r.value.rows[0]!.r as { status: string }).status === 'approved');
    expect(winners).toHaveLength(1);
    // The other approver gets a clean refusal or the stored "already approved" answer, never a second approval.
    const loser = results.find((r) => !r.ok || (r.value.rows[0]!.r as { status: string }).status !== 'approved');
    if (loser && !loser.ok) expect(['concurrency_conflict', 'purchase.bad_transition']).toContain(loser.message);
  });

  it('a simultaneous double submit of the same creation produces one order, not two', async () => {
    const s = await setup();
    const client = randomUUID();
    const create = () => attempt(() => commitAs(USERS.owner, (sql) =>
      sql('select public.create_purchase_order($1, $2, $3, $4, $5, null, null, $6::jsonb) as r', [DEMO_ORG, client, s.supplier, s.wh.branch_id, s.wh.id, s.lines])));
    const results = await Promise.all([create(), create()]);
    const oks = results.filter((r) => r.ok) as Array<{ value: { rows: Array<{ r: { status: string; po_number: string } }> } }>;
    expect(oks.length).toBeGreaterThanOrEqual(1);
    const numbers = new Set(oks.map((o) => o.value.rows[0]!.r.po_number));
    expect(numbers.size).toBe(1);
    const statuses = oks.map((o) => o.value.rows[0]!.r.status).sort();
    expect(statuses[0]).toBe('created');
  });

  it('simultaneous creates for one supplier each receive a distinct order number', async () => {
    const s = await setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => attempt(() => commitAs(USERS.owner, (sql) =>
      sql('select public.create_purchase_order($1, $2, $3, $4, $5, null, null, $6::jsonb) as r', [DEMO_ORG, randomUUID(), s.supplier, s.wh.branch_id, s.wh.id, s.lines])))));
    expect(results.every((r) => r.ok)).toBe(true);
    const numbers = results.map((r) => ((r as { value: { rows: Array<{ r: { po_number: string } }> } }).value.rows[0]!.r.po_number));
    expect(new Set(numbers).size).toBe(5);
  });
});
