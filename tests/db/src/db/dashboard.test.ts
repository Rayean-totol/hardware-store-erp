import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asAdmin, asUser, expectDbError, pool, unitId, type Sql } from '../db';
import { DEMO_ORG, USERS } from '../env';

afterAll(() => pool.end());

async function ids(sql: Sql) {
  const wh = async (code: string) =>
    (await sql('select id from public.warehouses where org_id = $1 and code = $2', [DEMO_ORG, code])).rows[0].id as string;
  return {
    ruh: await wh('RUH'),
    jed: await wh('JED'),
    screw: (await sql(`select id from public.products where org_id = $1 and sku = 'FST-WS-4X40'`, [DEMO_ORG])).rows[0].id as string,
    pcs: await unitId(sql, 'pcs'),
  };
}

async function receive(sql: Sql, warehouse: string, product: string, unit: string, qty: string, cost: string) {
  await sql('select public.apply_stock_movements($1, $2, $3::jsonb)', [DEMO_ORG, 'DASH', JSON.stringify([{
    client_id: randomUUID(), warehouse_id: warehouse, product_id: product, movement_type: 'stock_in',
    unit_id: unit, quantity: qty, unit_cost: cost, reason_code: 'purchase', occurred_at: '2026-11-20T10:00:00Z',
  }])]);
}

async function summary(sql: Sql, branch: string | null = null) {
  const { rows } = await sql('select public.dashboard_inventory_summary($1, $2) as s', [DEMO_ORG, branch]);
  return rows[0].s as Record<string, unknown>;
}

describe('dashboard inventory summary', () => {
  it('values positive balances at average cost and counts positions', async () => {
    await asUser(USERS.owner, async (sql) => {
      const r = await ids(sql);
      await receive(sql, r.ruh, r.screw, r.pcs, '10', '2');   // value 20
      const s = await summary(sql);
      expect(s.stock_value).toBe('20');
      expect(s.stock_positions).toBe(1);
    });
  });

  it('excludes negative balances from value and counts them as out of stock', async () => {
    await asUser(USERS.owner, async (sql) => {
      const r = await ids(sql);
      await receive(sql, r.ruh, r.screw, r.pcs, '10', '2');
      await sql('select public.apply_stock_movements($1, $2, $3::jsonb)', [DEMO_ORG, 'DASH', JSON.stringify([{
        client_id: randomUUID(), warehouse_id: r.ruh, product_id: r.screw, movement_type: 'stock_out',
        unit_id: r.pcs, quantity: '15', occurred_at: '2026-11-20T10:00:00Z',
      }])]);
      const s = await summary(sql);
      expect(s.stock_value).toBe('0');
      expect(s.out_of_stock_count).toBe(1);
    });
  });

  it('counts products and low-stock items consistently with list_low_stock', async () => {
    await asUser(USERS.owner, async (sql) => {
      const s = await summary(sql);
      const expectedProducts = (await asAdmin((a) => a(
        `select count(*)::int as n from public.products where org_id = $1 and product_type = 'stock' and archived_at is null`,
        [DEMO_ORG]))).rows[0].n;
      expect(s.product_count).toBe(expectedProducts);
      const low = (await sql('select count(*)::int as n from public.list_low_stock($1, null)', [DEMO_ORG])).rows[0].n;
      expect(s.low_stock_count).toBe(low);
    });
  });

  it('respects branch scope: a branch-restricted manager sees only their branch', async () => {
    await asUser(USERS.owner, async (sql) => {
      const r = await ids(sql);
      await receive(sql, r.ruh, r.screw, r.pcs, '10', '2');   // RUH: 20
      await receive(sql, r.jed, r.screw, r.pcs, '5', '4');    // JED: 20
      expect((await summary(sql)).stock_value).toBe('40');
    });
    await asUser(USERS.owner, async (sql) => {
      const r = await ids(sql);
      await receive(sql, r.ruh, r.screw, r.pcs, '10', '2');
      await receive(sql, r.jed, r.screw, r.pcs, '5', '4');
      await sql('select set_config(\'request.jwt.claims\', $1, true)', [JSON.stringify({ sub: USERS.manager, role: 'authenticated' })]);
      expect((await summary(sql)).stock_value).toBe('20');
      expect((await summary(sql, r.jed)).stock_value).toBe('0');
    });
  });

  it('cashiers (inventory.read) may view the summary of their branch', async () => {
    await asUser(USERS.owner, async (sql) => {
      const r = await ids(sql);
      await receive(sql, r.ruh, r.screw, r.pcs, '10', '2');
      await sql('select set_config(\'request.jwt.claims\', $1, true)', [JSON.stringify({ sub: USERS.cashier, role: 'authenticated' })]);
      expect((await summary(sql)).stock_value).toBe('20');
    });
  });

  it('users of another organization are refused with a clear code', async () => {
    await expectDbError(asUser(USERS.outsider, (sql) =>
      sql('select public.dashboard_inventory_summary($1, null)', [DEMO_ORG])), 'forbidden');
  });

  it('anonymous callers cannot call it', async () => {
    await expectDbError(asUser(null, (sql) =>
      sql('select public.dashboard_inventory_summary($1, null)', [DEMO_ORG])), /permission denied/);
  });
});
