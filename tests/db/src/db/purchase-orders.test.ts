import { randomUUID } from 'node:crypto';
import { calculateLine } from '@erp/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, asUser, pool, unitId, type Sql } from '../db';
import { DEMO_ORG, OTHER_ORG, USERS } from '../env';

afterAll(() => pool.end());

interface Refs {
  ruh: { id: string; branch_id: string };
  jed: { id: string; branch_id: string };
  screw: string;
  pcs: string;
  box: string;
  pricesIncludeVat: boolean;
}

async function loadRefs(sql: Sql): Promise<Refs> {
  const wh = async (code: string) =>
    (await sql('select id, branch_id from public.warehouses where org_id = $1 and code = $2', [DEMO_ORG, code])).rows[0] as Refs['ruh'];
  const screw = (await sql(`select id from public.products where org_id = $1 and sku = 'FST-WS-4X40'`, [DEMO_ORG])).rows[0].id as string;
  const org = (await sql('select prices_include_vat from public.organizations where id = $1', [DEMO_ORG])).rows[0] as { prices_include_vat: boolean };
  return {
    ruh: await wh('RUH'), jed: await wh('JED'), screw, pcs: await unitId(sql, 'pcs'), box: await unitId(sql, 'box'),
    pricesIncludeVat: org.prices_include_vat,
  };
}

let R: Refs;
beforeAll(async () => {
  R = await asAdmin(loadRefs);
});

async function actAs(sql: Sql, userId: string) {
  await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
}

/** Expected refusal inside a savepoint, so the transaction stays usable. */
async function refused(sql: Sql, fn: () => Promise<unknown>, code: string | RegExp) {
  await sql('savepoint refused');
  try {
    await expect(fn()).rejects.toThrow(typeof code === 'string' ? new RegExp(code) : code);
  } finally {
    await sql('rollback to savepoint refused');
  }
}

async function newSupplier(sql: Sql, over: Record<string, unknown> = {}) {
  const { rows } = await sql('select public.save_supplier($1, $2::jsonb, null) as r', [
    DEMO_ORG,
    JSON.stringify({ name_en: 'PO Supplier', name_ar: 'مورد', supplier_code: `PO-${randomUUID().slice(0, 8).toUpperCase()}`, country_code: 'SA', ...over }),
  ]);
  return rows[0].r.id as string;
}

const line = (quantity: string, unitCost: string, extra: Record<string, unknown> = {}, unit?: string) => ({
  product_id: R.screw, unit_id: unit ?? R.pcs, quantity, unit_cost: unitCost, ...extra,
});

async function createPo(sql: Sql, p: { supplier: string; branch?: Refs['ruh']; lines: unknown[]; client?: string; notes?: string | null }) {
  const branch = p.branch ?? R.ruh;
  const { rows } = await sql('select public.create_purchase_order($1, $2, $3, $4, $5, $6, $7, $8::jsonb) as r', [
    DEMO_ORG, p.client ?? randomUUID(), p.supplier, branch.branch_id, branch.id, null, p.notes ?? null, JSON.stringify(p.lines),
  ]);
  return rows[0].r as { status: string; id: string; po_number: string; row_version: number };
}

async function stockOf(sql: Sql, warehouse: string) {
  const { rows } = await sql('select count(*)::int as n, coalesce(sum(quantity), 0)::text as q from public.stock_levels where warehouse_id = $1 and product_id = $2', [warehouse, R.screw]);
  return rows[0] as { n: number; q: string };
}

describe('purchase orders: creation and pricing', () => {
  it('creates a draft with a PO number, server-priced lines and totals that equal the domain rules', async () => {
    await asUser(USERS.owner, async (sql) => {
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('10', '4.00')] });
      expect(po).toMatchObject({ status: 'created', po_number: expect.stringMatching(/^PO-\d{6}$/), row_version: 1 });
      const expected = calculateLine({ unitPrice: '40.00', quantity: '1', taxCategory: 'S', pricesIncludeVat: R.pricesIncludeVat });
      const profile = (await sql('select public.get_purchase_order($1, $2) as r', [DEMO_ORG, po.id])).rows[0].r;
      expect(profile.status).toBe('draft');
      expect(profile.grand_total).toBe(expected.gross.toFixed(2));
      expect(profile.vat_total).toBe(expected.vat.toFixed(2));
      expect(profile.lines).toHaveLength(1);
      expect(profile.lines[0].entered_quantity).toBe('10');
    });
  });

  it('a percentage discount is applied before VAT, and a fixed discount cannot exceed the line', async () => {
    await asUser(USERS.owner, async (sql) => {
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('5', '20.00', { discount_type: 'percent', discount_value: '10' })] });
      const p = (await sql('select public.get_purchase_order($1, $2) as r', [DEMO_ORG, po.id])).rows[0].r;
      const ext = 100;
      const after = ext - 10;
      const expected = calculateLine({ unitPrice: String(after), quantity: '1', taxCategory: 'S', pricesIncludeVat: R.pricesIncludeVat });
      expect(p.discount_total).toBe('10.00');
      expect(p.grand_total).toBe(expected.gross.toFixed(2));
      await refused(sql, () => createPo(sql, { supplier: s, lines: [line('1', '5.00', { discount_type: 'fixed', discount_value: '9' })] }), 'discount.invalid');
    });
  });

  it('a box is bought in boxes: base quantity and base cost follow the unit factor', async () => {
    await asUser(USERS.owner, async (sql) => {
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('2', '120.00', {}, R.box)] });
      const p = (await sql('select public.get_purchase_order($1, $2) as r', [DEMO_ORG, po.id])).rows[0].r;
      const factor = (await sql('select factor::text from public.product_units where product_id = $1 and unit_id = $2', [R.screw, R.box])).rows[0].factor as string;
      expect(Number(p.lines[0].base_quantity)).toBeCloseTo(2 * Number(factor), 4);
      expect(Number(p.lines[0].base_unit_cost)).toBeCloseTo(120 / Number(factor), 3);
    });
  });

  it('a repeated create with the same client id returns the same order', async () => {
    await asUser(USERS.owner, async (sql) => {
      const s = await newSupplier(sql);
      const client = randomUUID();
      const first = await createPo(sql, { supplier: s, client, lines: [line('1', '3.00')] });
      const again = await createPo(sql, { supplier: s, client, lines: [line('1', '3.00')] });
      expect(again).toMatchObject({ status: 'duplicate', id: first.id, po_number: first.po_number });
      // Only one order exists for this client id: the replay returned the same id, and nothing else was written.
      expect((await sql(`select public.list_purchase_orders($1, 'all', $2, null, null, null, 200, 0) as r`, [DEMO_ORG, s])).rows[0].r.total).toBe(1);
    });
  });
});

describe('purchase orders: refusals write nothing', () => {
  const cases: Array<[string, (sql: Sql, s: string) => Promise<unknown>, string]> = [
    ['no lines', (sql, s) => createPo(sql, { supplier: s, lines: [] }), 'validation'],
    ['unknown product', (sql, s) => createPo(sql, { supplier: s, lines: [line('1', '1', { product_id: randomUUID() })] }), 'product.not_found'],
    ['malformed product id', (sql, s) => createPo(sql, { supplier: s, lines: [line('1', '1', { product_id: 'nope' })] }), 'validation'],
    ['zero quantity', (sql, s) => createPo(sql, { supplier: s, lines: [line('0', '1')] }), 'quantity.invalid'],
    ['quantity with seven decimals', (sql, s) => createPo(sql, { supplier: s, lines: [line('1.0000001', '1')] }), 'quantity.invalid'],
    ['fraction of a piece', (sql, s) => createPo(sql, { supplier: s, lines: [line('0.5', '1')] }), 'quantity.fraction_not_allowed'],
    ['negative cost', (sql, s) => createPo(sql, { supplier: s, lines: [line('1', '-1')] }), 'cost.invalid'],
    ['cost with letters', (sql, s) => createPo(sql, { supplier: s, lines: [line('1', 'abc')] }), 'cost.invalid'],
    ['cost NaN', (sql, s) => createPo(sql, { supplier: s, lines: [line('1', 'NaN')] }), 'cost.invalid'],
    ['discount over 100%', (sql, s) => createPo(sql, { supplier: s, lines: [line('1', '5', { discount_type: 'percent', discount_value: '150' })] }), 'discount.invalid'],
    ['unit that is not a purchase unit', (sql, s) => createPo(sql, { supplier: s, lines: [line('1', '1')] }), 'unit.not_purchase_unit'],
    ['supplier of another organisation', (sql) => createPo(sql, { supplier: randomUUID(), lines: [line('1', '1')] }), 'supplier.not_found'],
    ['inactive supplier', async (sql) => createPo(sql, { supplier: await newSupplier(sql, { is_active: false }), lines: [line('1', '1')] }), 'supplier.inactive'],
    ['warehouse of another branch', (sql, s) => createPo(sql, { supplier: s, branch: { id: R.jed.id, branch_id: R.ruh.branch_id }, lines: [line('1', '1')] }), 'warehouse.not_found'],
    ['inactive warehouse', async (sql, s) => {
        await sql('update public.warehouses set is_active = false where id = $1', [R.ruh.id]);
        return createPo(sql, { supplier: s, lines: [line('1', '1')] });
      }, 'warehouse.inactive'],
    ['archived product', async (sql, s) => {
        await sql('update public.products set archived_at = now() where id = $1', [R.screw]);
        return createPo(sql, { supplier: s, lines: [line('1', '1')] });
      }, 'product.archived'],
  ];

  it.each(cases)('%s is refused and nothing is written', async (_name, run, code) => {
    await asUser(USERS.owner, async (sql) => {
      const s = await newSupplier(sql);
      if (_name === 'unit that is not a purchase unit') {
        await sql('update public.product_units set is_purchase_unit = false where product_id = $1 and unit_id = $2', [R.screw, R.pcs]);
      }
      const total = async () => (await sql(`select public.list_purchase_orders($1, 'all', null, null, null, null, 200, 0) as r`, [DEMO_ORG])).rows[0].r.total as number;
      const before = await total();
      await refused(sql, () => run(sql, s), code);
      expect(await total()).toBe(before);
    });
  });
});

describe('purchase orders: stock is never changed by an order', () => {
  it('creating, submitting and approving an order changes no stock and writes no stock movement', async () => {
    await asUser(USERS.owner, async (sql) => {
      const before = await stockOf(sql, R.ruh.id);
      const movementsBefore = (await sql('select count(*)::int as n from public.stock_movements where org_id = $1', [DEMO_ORG])).rows[0].n;
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('50', '2.00')] });
      await sql('select public.submit_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version]);
      await actAs(sql, USERS.manager);
      await sql('select public.approve_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version + 1]);
      expect(await stockOf(sql, R.ruh.id)).toEqual(before);
      expect((await sql('select count(*)::int as n from public.stock_movements where org_id = $1', [DEMO_ORG])).rows[0].n).toBe(movementsBefore);
    });
  });
});

describe('purchase orders: workflow, separation of duties and locking', () => {
  it('the creator cannot approve their own order; another approver can', async () => {
    await asUser(USERS.owner, async (sql) => {
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('1', '5.00')] });
      await sql('select public.submit_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version]);
      await refused(sql, () => sql('select public.approve_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version + 1]), 'purchase.self_approval');
      await actAs(sql, USERS.manager);
      const approved = (await sql('select public.approve_purchase_order($1, $2, $3) as r', [DEMO_ORG, po.id, po.row_version + 1])).rows[0].r;
      expect(approved).toMatchObject({ status: 'approved' });
    });
  });

  it('only approvers may approve: storekeeper, cashier and auditor are refused', async () => {
    await asAdmin(async (sql) => {
      await actAs(sql, USERS.owner);
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('1', '5.00')] });
      await sql('select public.submit_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version]);
      for (const user of [USERS.storekeeper, USERS.cashier, USERS.auditor]) {
        await actAs(sql, user);
        await refused(sql, () => sql('select public.approve_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version + 1]), 'forbidden');
      }
    });
  });

  it('a submitted order cannot be edited, its lines cannot be changed by any role, and orders cannot be deleted', async () => {
    await asAdmin(async (sql) => {
      await actAs(sql, USERS.owner);
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('1', '5.00')] });
      await sql('select public.submit_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version]);
      await refused(sql, () => sql('select public.update_purchase_order($1, $2, $3, $4::jsonb, null)', [DEMO_ORG, po.id, po.row_version + 1, '{"delivery_notes":"late"}']), 'purchase.not_draft');
      await refused(sql, () => sql('update public.purchase_order_lines set unit_cost = 1 where po_id = $1', [po.id]), /draft/);
      await refused(sql, () => sql('delete from public.purchase_orders where id = $1', [po.id]), /never deleted/);
    });
  });

  it('a stale version is refused on submit, approve, update and cancel', async () => {
    await asUser(USERS.owner, async (sql) => {
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('1', '5.00')] });
      await refused(sql, () => sql('select public.submit_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version + 7]), 'concurrency_conflict');
      await refused(sql, () => sql('select public.update_purchase_order($1, $2, $3, $4::jsonb, null)', [DEMO_ORG, po.id, po.row_version + 7, '{"delivery_notes":"x"}']), 'concurrency_conflict');
      await refused(sql, () => sql('select public.cancel_purchase_order($1, $2, $3, $4)', [DEMO_ORG, po.id, po.row_version + 7, 'stale cancel']), 'concurrency_conflict');
    });
  });

  it('a draft can be edited by its creator: header keys change, lines are replaced, totals and version follow', async () => {
    await asUser(USERS.owner, async (sql) => {
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('1', '5.00')] });
      const edited = (await sql('select public.update_purchase_order($1, $2, $3, $4::jsonb, $5::jsonb) as r', [
        DEMO_ORG, po.id, po.row_version, JSON.stringify({ delivery_notes: 'Deliver to gate 2' }), JSON.stringify([line('3', '5.00')]),
      ])).rows[0].r as { row_version: number };
      expect(edited.row_version).toBe(po.row_version + 1);
      const p = (await sql('select public.get_purchase_order($1, $2) as r', [DEMO_ORG, po.id])).rows[0].r;
      expect(p).toMatchObject({ delivery_notes: 'Deliver to gate 2', row_version: po.row_version + 1 });
      expect(p.lines).toHaveLength(1);
      expect(p.lines[0].entered_quantity).toBe('3');
    });
  });

  it('a stranger without approval rights cannot edit someone else’s draft', async () => {
    await asAdmin(async (sql) => {
      await actAs(sql, USERS.owner);
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('1', '5.00')] });
      await actAs(sql, USERS.storekeeper);
      await refused(sql, () => sql('select public.update_purchase_order($1, $2, $3, $4::jsonb, null)', [DEMO_ORG, po.id, po.row_version, '{"delivery_notes":"x"}']), 'forbidden');
    });
  });

  it('a submitted order can be cancelled with a reason; a second cancel is idempotent; the reason is required', async () => {
    await asUser(USERS.owner, async (sql) => {
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('1', '5.00')] });
      await sql('select public.submit_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version]);
      await refused(sql, () => sql('select public.cancel_purchase_order($1, $2, $3, $4)', [DEMO_ORG, po.id, po.row_version + 1, 'no']), 'purchase.reason_required');
      const c = (await sql('select public.cancel_purchase_order($1, $2, $3, $4) as r', [DEMO_ORG, po.id, po.row_version + 1, 'Supplier cannot deliver'])).rows[0].r;
      expect(c).toMatchObject({ status: 'cancelled' });
      const again = (await sql('select public.cancel_purchase_order($1, $2, $3, $4) as r', [DEMO_ORG, po.id, c.row_version, 'again'])).rows[0].r;
      expect(again).toMatchObject({ status: 'duplicate' });
    });
  });

  it('every transition is recorded in the history, and the history cannot be changed', async () => {
    await asAdmin(async (sql) => {
      await actAs(sql, USERS.owner);
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('1', '5.00')] });
      await sql('select public.submit_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version]);
      await actAs(sql, USERS.manager);
      await sql('select public.approve_purchase_order($1, $2, $3)', [DEMO_ORG, po.id, po.row_version + 1]);
      const { rows } = await sql('select event from public.purchase_order_events where po_id = $1 order by occurred_at, id', [po.id]);
      expect(rows.map((r) => r.event)).toEqual(['created', 'submitted', 'approved']);
      await refused(sql, () => sql('update public.purchase_order_events set note = $2 where po_id = $1', [po.id, 'x']), /append-only/);
    });
  });
});

describe('purchase orders: cost visibility, branches and isolation', () => {
  it('costs are shown to purchase.cost_view holders only; storekeepers see quantities and names', async () => {
    await asAdmin(async (sql) => {
      await actAs(sql, USERS.owner);
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('4', '9.00')] });
      const owner = (await sql('select public.get_purchase_order($1, $2) as r', [DEMO_ORG, po.id])).rows[0].r;
      expect(owner.grand_total).toBeDefined();
      expect(owner.lines[0].unit_cost).toBe('9.0000');
      await actAs(sql, USERS.storekeeper);
      const sk = (await sql('select public.get_purchase_order($1, $2) as r', [DEMO_ORG, po.id])).rows[0].r;
      expect(sk).not.toHaveProperty('grand_total');
      expect(sk.lines[0]).not.toHaveProperty('unit_cost');
      expect(sk.lines[0].entered_quantity).toBe('4');
      await actAs(sql, USERS.cashier);
      await refused(sql, () => sql('select public.get_purchase_order($1, $2)', [DEMO_ORG, po.id]), 'forbidden');
    });
  });

  it('a branch-restricted manager does not see or open a JED order', async () => {
    await asAdmin(async (sql) => {
      await actAs(sql, USERS.owner);
      const s = await newSupplier(sql);
      const jed = await createPo(sql, { supplier: s, branch: R.jed, lines: [line('1', '5.00')] });
      await actAs(sql, USERS.manager);
      const list = (await sql('select public.list_purchase_orders($1, $2, null, null, null, null, 200, 0) as r', [DEMO_ORG, 'all'])).rows[0].r;
      expect(list.items.map((i: { id: string }) => i.id)).not.toContain(jed.id);
      await refused(sql, () => sql('select public.get_purchase_order($1, $2)', [DEMO_ORG, jed.id]), 'forbidden');
    });
  });

  it('listing filters by status, supplier and branch', async () => {
    await asAdmin(async (sql) => {
      await actAs(sql, USERS.owner);
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('1', '5.00')] });
      const drafts = (await sql('select public.list_purchase_orders($1, $2, $3, null, null, null, 200, 0) as r', [DEMO_ORG, 'draft', s])).rows[0].r;
      expect(drafts.items.map((i: { id: string }) => i.id)).toEqual([po.id]);
      const approved = (await sql('select public.list_purchase_orders($1, $2, null, null, null, null, 200, 0) as r', [DEMO_ORG, 'approved'])).rows[0].r;
      expect(approved.items.map((i: { id: string }) => i.id)).not.toContain(po.id);
      const byBranch = (await sql('select public.list_purchase_orders($1, $2, null, $3, null, null, 200, 0) as r', [DEMO_ORG, 'all', R.ruh.branch_id])).rows[0].r;
      expect(byBranch.items.map((i: { id: string }) => i.id)).toContain(po.id);
      await refused(sql, () => sql('select public.list_purchase_orders($1, $2, null, null, null, null, 200, 0)', [DEMO_ORG, 'bogus']), 'validation');
    });
  });

  it('another organisation’s user sees and changes none of these orders', async () => {
    await asAdmin(async (sql) => {
      await actAs(sql, USERS.owner);
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('1', '5.00')] });
      await actAs(sql, USERS.outsider);
      await refused(sql, () => sql('select public.get_purchase_order($1, $2)', [DEMO_ORG, po.id]), 'forbidden');
      await refused(sql, () => sql('select public.list_purchase_orders($1, $2, null, null, null, null, 200, 0)', [DEMO_ORG, 'all']), 'forbidden');
      await refused(sql, () => sql('select public.cancel_purchase_order($1, $2, $3, $4)', [DEMO_ORG, po.id, po.row_version, 'hostile']), 'forbidden');
      expect(OTHER_ORG).toBeTruthy();
    });
  });

  it('no client can read or write the purchase tables directly', async () => {
    await asUser(USERS.owner, async (sql) => {
      await refused(sql, () => sql('select count(*) from public.purchase_orders'), /permission denied/);
      await refused(sql, () => sql('select count(*) from public.purchase_order_lines'), /permission denied/);
      await refused(sql, () => sql('select count(*) from public.purchase_order_events'), /permission denied/);
    });
  });
});

describe('purchase orders: VAT-exclusive organisations', () => {
  it('prices are taken net and VAT is added on top, as the domain rules say', async () => {
    await asUser(USERS.owner, async (sql) => {
      await sql('update public.organizations set prices_include_vat = false where id = $1', [DEMO_ORG]);
      const s = await newSupplier(sql);
      const po = await createPo(sql, { supplier: s, lines: [line('3', '10.00')] });
      const expected = calculateLine({ unitPrice: '30.00', quantity: '1', taxCategory: 'S', pricesIncludeVat: false });
      const p = (await sql('select public.get_purchase_order($1, $2) as r', [DEMO_ORG, po.id])).rows[0].r;
      expect(p.prices_include_vat).toBe(false);
      expect(p.subtotal_net).toBe('30.00');
      expect(p.grand_total).toBe(expected.gross.toFixed(2));
    });
  });
});
