import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asAdmin, asUser, expectDbError, pool, unitId, type Sql } from '../db';
import { DEMO_ORG, OTHER_ORG, USERS } from '../env';

afterAll(() => pool.end());

type Result = { client_id: string; status: string; code?: string; balance_after?: string; average_cost_after?: string; warnings?: string[] };

async function refs(sql: Sql) {
  const wh = async (code: string) =>
    (await sql(`select id from public.warehouses where org_id = $1 and code = $2`, [DEMO_ORG, code])).rows[0].id as string;
  const product = async (sku: string) =>
    (await sql(`select id from public.products where org_id = $1 and sku = $2`, [DEMO_ORG, sku])).rows[0].id as string;
  return {
    ruh: await wh('RUH'),
    jed: await wh('JED'),
    screw: await product('FST-WS-4X40'),
    hexBolt: await product('FST-HB-M10X50'),
    cable: await product('ELC-CU-2.5'),
    pcs: await unitId(sql, 'pcs'),
    box: await unitId(sql, 'box'),
    m: await unitId(sql, 'm'),
    kg: await unitId(sql, 'kg'),
  };
}

async function apply(sql: Sql, items: Record<string, unknown>[], device = 'POS-TEST'): Promise<Result[]> {
  const { rows } = await sql('select public.apply_stock_movements($1, $2, $3::jsonb) as r', [DEMO_ORG, device, JSON.stringify(items)]);
  return rows[0].r as Result[];
}

const move = (r: { ruh?: string } & Record<string, string>, over: Record<string, unknown>) => ({
  client_id: randomUUID(),
  warehouse_id: r.ruh,
  product_id: over.product_id,
  movement_type: 'stock_in',
  unit_id: over.unit_id,
  quantity: '1',
  unit_cost: '1',
  occurred_at: '2026-11-20T10:00:00Z',
  ...over,
});

describe('warehouses', () => {
  it('every branch got a default warehouse with the branch code', async () => {
    const { rows } = await asUser(USERS.owner, (sql) =>
      sql('select code, branch_id from public.warehouses where org_id = $1 order by code', [DEMO_ORG]));
    expect(rows.map((r) => r.code)).toEqual(['JED', 'RUH']);
  });

  it('branch-restricted members only see their own warehouses', async () => {
    const { rows } = await asUser(USERS.manager, (sql) => sql('select code from public.warehouses order by code'));
    expect(rows.map((r) => r.code)).toEqual(['RUH']);
  });

  it('owners can create warehouses; managers (no warehouse.manage) cannot', async () => {
    await asUser(USERS.owner, async (sql) => {
      const branch = (await sql(`select id from public.branches where code = 'JED'`)).rows[0].id;
      const { rowCount } = await sql(
        `insert into public.warehouses (org_id, branch_id, code, name_en, name_ar) values ($1, $2, 'JED-YARD', 'Jeddah yard', 'ساحة جدة')`,
        [DEMO_ORG, branch]);
      expect(rowCount).toBe(1);
    });
    await expectDbError(
      asUser(USERS.manager, (sql) => sql(
        `insert into public.warehouses (org_id, branch_id, code, name_en, name_ar)
         select org_id, id, 'RUH-2', 'x', 'س' from public.branches where code = 'RUH'`)),
      /row-level security/,
    );
  });

  it('warehouse changes are audited', async () => {
    await asUser(USERS.owner, async (sql) => {
      await sql(`update public.warehouses set name_en = 'Riyadh – Central' where code = 'RUH'`);
      const { rows } = await sql(`select count(*)::int as n from public.audit_log where table_name = 'warehouses' and action = 'UPDATE'`);
      expect(rows[0].n).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('stock ledger: shared scenario (must equal packages/domain stock.test.ts)', () => {
  it('receipts re-average, issues cost at average, negative stock is flagged', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      
      const results = await apply(sql, [
        move(r, { product_id: r.screw, unit_id: r.box, quantity: '2', unit_cost: '25.00', movement_type: 'stock_in', reason_code: 'purchase' }),
        move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '50', movement_type: 'stock_out' }),
        move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '100', unit_cost: '0.20', movement_type: 'stock_in', reason_code: 'purchase' }),
        move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '500', movement_type: 'stock_out' }),
      ]);
      expect(results.map((x) => x.status)).toEqual(['applied', 'applied', 'applied', 'applied']);
      expect(results.map((x) => x.balance_after)).toEqual(['400', '350', '450', '-50']);
      expect(results.map((x) => x.average_cost_after)).toEqual(['0.125', '0.125', '0.1417', '0.1417']);
      expect(results[3]!.warnings).toEqual(['negative_stock']);

      const level = await sql(`select trim_scale(quantity)::text as quantity, trim_scale(average_cost)::text as average_cost from public.stock_levels where warehouse_id = $1 and product_id = $2`, [r.ruh, r.screw]);
      expect(level.rows[0]).toEqual({ quantity: '-50', average_cost: '0.1417' });
    });
  });

  it('blocks overdraw when the organization disallows negative stock', async () => {
    await asAdmin(async (sql) => {
      await sql(`update public.organizations set allow_negative_stock = false where id = $1`, [DEMO_ORG]);
      await sql('set local role authenticated');
      await sql(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USERS.owner, role: 'authenticated' })]);
      const r = await refs(sql);
      const [receipt, issue] = await apply(sql, [
        move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '10', unit_cost: '1' }),
        move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '11', movement_type: 'stock_out' }),
      ]);
      expect(receipt!.status).toBe('applied');
      expect(issue).toMatchObject({ status: 'rejected', code: 'stock.insufficient' });
      const level = await sql(`select trim_scale(quantity)::text as quantity from public.stock_levels where warehouse_id = $1 and product_id = $2`, [r.ruh, r.screw]);
      expect(level.rows[0].quantity).toBe('10');
    });
  });
});

describe('stock ledger: idempotency and batches', () => {
  it('re-sending an applied movement is a duplicate and changes nothing', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      
      const item = move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '30', unit_cost: '2' });
      const first = await apply(sql, [item]);
      const again = await apply(sql, [item, item]);
      expect(first[0]!.status).toBe('applied');
      expect(again.map((x) => x.status)).toEqual(['duplicate', 'duplicate']);
      expect(again[0]!.balance_after).toBe('30');
      const { rows } = await sql('select count(*)::int as n from public.stock_movements where client_id = $1', [item.client_id]);
      expect(rows[0].n).toBe(1);
    });
  });

  it('isolates failures per item: a bad item is rejected, the others still apply in order', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      
      const good1 = move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '5', unit_cost: '1' });
      const bad = move(r, { product_id: randomUUID(), unit_id: r.pcs, quantity: '1', unit_cost: '1' });
      const good2 = move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '5', unit_cost: '1' });
      const results = await apply(sql, [good1, bad, good2]);
      expect(results.map((x) => x.status)).toEqual(['applied', 'rejected', 'applied']);
      expect(results[1]).toMatchObject({ code: 'product.not_found' });
      expect(results[2]!.balance_after).toBe('10');
    });
  });

  it('rejects non-uuid and missing client ids with a visible code', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      
      const [res] = await apply(sql, [{ ...move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '1', unit_cost: '1' }), client_id: 'nope' }]);
      expect(res).toMatchObject({ status: 'rejected', sqlstate: '22P02' });
    });
  });
});

describe('stock ledger: validation rules', () => {
  const cases: Array<[string, (r: Awaited<ReturnType<typeof refs>>) => Record<string, unknown>, string]> = [
    ['cost.required', (r) => ({ product_id: r.screw, unit_id: r.pcs, quantity: '1', unit_cost: null }), 'cost.required'],
    ['quantity.fraction_not_allowed', (r) => ({ product_id: r.screw, unit_id: r.pcs, quantity: '1.5', unit_cost: '1' }), 'quantity.fraction_not_allowed'],
    ['unit.not_configured', (r) => ({ product_id: r.screw, unit_id: r.kg, quantity: '1', unit_cost: '1' }), 'unit.not_configured'],
    ['quantity.precision', (r) => ({ product_id: r.cable, unit_id: r.m, quantity: '0.0000001', unit_cost: '1' }), 'quantity.precision'],
    ['product.archived', (r) => ({ product_id: r.screw, unit_id: r.pcs, quantity: '1', unit_cost: '1', _archive: true }), 'product.archived'],
    ['stock.reason_required', (r) => ({ product_id: r.screw, unit_id: r.pcs, quantity: '-1', movement_type: 'adjustment' }), 'stock.reason_required'],
    ['stock.reason_invalid', (r) => ({ product_id: r.screw, unit_id: r.pcs, quantity: '1', unit_cost: '1', reason_code: 'magic' }), 'stock.reason_invalid'],
    ['quantity.not_positive', (r) => ({ product_id: r.screw, unit_id: r.pcs, quantity: '-1', movement_type: 'stock_out' }), 'quantity.not_positive'],
    ['cost.negative', (r) => ({ product_id: r.screw, unit_id: r.pcs, quantity: '1', unit_cost: '-1' }), 'cost.negative'],
    ['stock.invalid_type', (r) => ({ product_id: r.screw, unit_id: r.pcs, quantity: '1', movement_type: 'move' }), 'stock.invalid_type'],
  ];
  it.each(cases)('%s', async (_name, build, code) => {
    const r = await asAdmin(refs);
    const { _archive, ...fields } = build(r) as Record<string, unknown> & { _archive?: boolean };
    await asUser(USERS.owner, async (sql) => {
      if (_archive) await sql(`update public.products set archived_at = now() where id = $1`, [r.screw]);
      const item: Record<string, unknown> = {
        client_id: randomUUID(), warehouse_id: r.ruh, movement_type: 'stock_in',
        occurred_at: '2026-11-20T10:00:00Z', ...fields,
      };
      const [res] = await apply(sql, [item]);
      expect(res, JSON.stringify(res)).toMatchObject({ status: 'rejected', code });
    });
  });

  it('adjustments need inventory.adjust (storekeepers may move stock, not adjust it)', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.storekeeper, async (sql) => {
      
      const [adj, move1] = await apply(sql, [
        move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '-2', movement_type: 'adjustment', reason_code: 'damage' }),
        move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '2', unit_cost: '1' }),
      ]);
      expect(adj).toMatchObject({ status: 'rejected', code: 'forbidden' });
      expect(move1!.status).toBe('applied');
    });
  });

  it('cashiers (inventory.read only) cannot record movements', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.cashier, async (sql) => {
      
      const [res] = await apply(sql, [move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '1', unit_cost: '1' })]);
      expect(res).toMatchObject({ status: 'rejected', code: 'forbidden' });
    });
  });

  it('branch-restricted managers cannot post to another branch', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.manager, async (sql) => {
      
      const [inRuh, inJed] = await apply(sql, [
        move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '1', unit_cost: '1' }),
        move({ ruh: r.jed }, { product_id: r.screw, unit_id: r.pcs, quantity: '1', unit_cost: '1' }),
      ]);
      expect(inRuh!.status).toBe('applied');
      expect(inJed).toMatchObject({ status: 'rejected', code: 'forbidden' });
    });
  });

  it('other organizations cannot post at all', async () => {
    await expectDbError(
      asUser(USERS.outsider, async (sql) => {
        const r = await asAdmin(refs);
        await sql('select public.apply_stock_movements($1, $2, $3::jsonb)', [DEMO_ORG, 'x', JSON.stringify([move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '1', unit_cost: '1' })])]);
      }),
      'forbidden',
    );
    void OTHER_ORG;
  });
});

describe('stock ledger: history, immutability, read models', () => {
  it('movements are append-only, even for the database owner', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      await apply(sql, [move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '3', unit_cost: '1' })]);
      await sql('reset role');
      await sql('savepoint tamper');
      await expectDbError(sql('update public.stock_movements set note = $1', ['tamper']), 'stock_movements is append-only');
      await sql('rollback to savepoint tamper');
      await sql('savepoint wipe');
      await expectDbError(sql('delete from public.stock_movements'), 'stock_movements is append-only');
      await sql('rollback to savepoint wipe');
      const { rows } = await sql('select count(*)::int as n from public.stock_movements');
      expect(rows[0].n).toBeGreaterThan(0);
    });
  });

  it('clients cannot write stock tables directly', async () => {
    await expectDbError(
      asUser(USERS.owner, (sql) => sql(`insert into public.stock_levels (org_id, branch_id, warehouse_id, product_id, quantity) select w.org_id, w.branch_id, w.id, p.id, 999 from public.warehouses w join public.products p on p.org_id = w.org_id limit 1`)),
      /permission denied/,
    );
    await expectDbError(asUser(USERS.owner, (sql) => sql(`delete from public.stock_movements`)), /permission denied/);
  });

  it('every movement is audited with actor and device (from the x-device-id header)', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      const item = move(r, { product_id: r.screw, unit_id: r.pcs, quantity: '4', unit_cost: '1' });
      await apply(sql, [item], 'SCANNER-07');
      const { rows } = await sql(
        `select actor_id, device_id from public.audit_log where table_name = 'stock_movements' order by id desc limit 1`);
      expect(rows[0]).toEqual({ actor_id: USERS.owner, device_id: 'SCANNER-07' });
    }, { headers: { 'x-device-id': 'SCANNER-07' } });
  });

  it('list_stock_levels reports exact text quantities and the low-stock flag', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      
      await apply(sql, [move(r, { product_id: r.hexBolt, unit_id: r.pcs, quantity: '100', unit_cost: '0.5' })]);
      const { rows } = await sql('select sku, quantity, reorder_level, is_low from public.list_stock_levels($1) order by sku', [r.ruh]);
      expect(rows.find((x) => x.sku === 'FST-HB-M10X50')).toEqual({ sku: 'FST-HB-M10X50', quantity: '100', reorder_level: '500', is_low: true });
    });
  });

  it('low-stock alerts include never-stocked products and clear after restocking', async () => {
    await asUser(USERS.owner, async (sql) => {
      const before = await sql(`select product_id from public.list_low_stock($1, null)`, [DEMO_ORG]);
      const r = await refs(sql);
      expect(before.rows.map((x) => x.product_id)).toContain(r.hexBolt);
      await apply(sql, [move(r, { product_id: r.hexBolt, unit_id: r.pcs, quantity: '600', unit_cost: '0.5' })]);
      const ruh = await sql(`select product_id, shortage from public.list_low_stock($1, $2)`, [DEMO_ORG, (await sql(`select branch_id from public.warehouses where id = $1`, [r.ruh])).rows[0].branch_id]);
      expect(ruh.rows.find((x) => x.product_id === r.hexBolt)).toBeUndefined();
    });
  });

  it('movement history filters by warehouse and type and pages', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      
      await apply(sql, [
        move(r, { product_id: r.cable, unit_id: r.m, quantity: '12.5', unit_cost: '3.5' }),
        move(r, { product_id: r.cable, unit_id: r.m, quantity: '2.5', movement_type: 'stock_out' }),
      ]);
      const issues = await sql(`select quantity_change, entered_quantity from public.list_stock_movements($1, $2, 'stock_out', 10, 0)`, [r.ruh, r.cable]);
      expect(issues.rows).toEqual([{ quantity_change: '-2.5', entered_quantity: '2.5' }]);
      const page = await sql(`select count(*)::int as n from public.list_stock_movements($1, $2, null, 1, 0)`, [r.ruh, r.cable]);
      expect(page.rows[0].n).toBe(1);
      const jed = await sql(`select count(*)::int as n from public.list_stock_movements($1, null, null, 100, 0)`, [r.jed]);
      expect(jed.rows[0].n).toBe(0);
    });
  });

  it('branch-restricted users cannot read another branch stock', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.manager, async (sql) => {
      
      const { rows } = await sql('select count(*)::int as n from public.stock_levels where warehouse_id = $1', [r.jed]);
      expect(rows[0].n).toBe(0);
    });
  });
});
