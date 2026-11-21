import { randomUUID } from 'node:crypto';
import { calculateLine } from '@erp/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, asUser, pool, unitId, type Sql } from '../db';
import { DEMO_ORG, USERS } from '../env';

/**
 * Audit of the POS migration: every refusal path, exclusive VAT, zero-rating, branch isolation on
 * replay and cancel, and cost preservation. Each case runs in a transaction that is rolled back.
 */
afterAll(() => pool.end());

interface Refs {
  ruh: { id: string; branch_id: string };
  jed: { id: string; branch_id: string };
  screw: string;
  pcs: string;
  price: string;
  pricesIncludeVat: boolean;
}

async function loadRefs(sql: Sql): Promise<Refs> {
  const wh = async (code: string) =>
    (await sql('select id, branch_id from public.warehouses where org_id = $1 and code = $2', [DEMO_ORG, code])).rows[0] as Refs['ruh'];
  const screw = (await sql(`select id from public.products where org_id = $1 and sku = 'FST-WS-4X40'`, [DEMO_ORG])).rows[0].id as string;
  const pcs = await unitId(sql, 'pcs');
  const price = (await sql('select sale_price from public.product_units where product_id = $1 and unit_id = $2', [screw, pcs])).rows[0]
    .sale_price as string;
  const org = (await sql('select prices_include_vat from public.organizations where id = $1', [DEMO_ORG])).rows[0] as {
    prices_include_vat: boolean;
  };
  return { ruh: await wh('RUH'), jed: await wh('JED'), screw, pcs, price, pricesIncludeVat: org.prices_include_vat };
}

let R: Refs;
beforeAll(async () => {
  R = await asAdmin(loadRefs);
});

async function actAs(sql: Sql, userId: string) {
  await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
}

/** Stock in at a given unit cost (per piece). */
async function stockInAt(sql: Sql, warehouse: string, quantity: string, unitCost: string) {
  await sql('select public.apply_stock_movements($1, $2, $3::jsonb) as r', [
    DEMO_ORG,
    'POS-AUDIT',
    JSON.stringify([
      {
        client_id: randomUUID(),
        warehouse_id: warehouse,
        product_id: R.screw,
        movement_type: 'stock_in',
        unit_id: R.pcs,
        quantity,
        unit_cost: unitCost,
        occurred_at: '2026-11-20T10:00:00Z',
      },
    ]),
  ]);
}

async function stockRow(sql: Sql, warehouse: string) {
  const { rows } = await sql('select quantity::text, average_cost::text from public.stock_levels where warehouse_id = $1 and product_id = $2', [
    warehouse,
    R.screw,
  ]);
  return rows[0] ?? { quantity: '0', average_cost: '0' };
}

async function sell(sql: Sql, p: { client?: string; branch?: string; warehouse?: string; customer?: string | null; lines: unknown[]; payments?: unknown[] }) {
  const { rows } = await sql('select public.finalize_sale($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb) as r', [
    DEMO_ORG,
    p.client ?? randomUUID(),
    p.branch ?? R.ruh.branch_id,
    p.warehouse ?? R.ruh.id,
    'POS-AUDIT',
    p.customer ?? null,
    null,
    JSON.stringify(p.lines),
    JSON.stringify(p.payments ?? []),
  ]);
  return rows[0].r as Record<string, string>;
}

const line = (quantity: string, extra: Record<string, unknown> = {}) => ({ product_id: R.screw, unit_id: R.pcs, quantity, ...extra });
const cash = (amount: string) => [{ method: 'cash', amount }];
/** Exact VAT-inclusive total for a quantity of the screw, paid in cash. */
const full = (quantity: string) => cash(calculateLine({ unitPrice: R.price, quantity, taxCategory: 'S', pricesIncludeVat: R.pricesIncludeVat }).gross.toFixed(2));

/** Expected refusal, inside a savepoint so the transaction stays usable. */
async function refused(sql: Sql, fn: () => Promise<unknown>, code: string) {
  await sql('savepoint r');
  try {
    await expect(fn()).rejects.toThrow(new RegExp(code));
  } finally {
    await sql('rollback to savepoint r');
  }
}

describe('POS audit: VAT-exclusive pricing', () => {
  it('exclusive prices: net is the list price, VAT is added on top, totals equal the domain rule', async () => {
    await asUser(USERS.owner, async (sql) => {
      await sql('update public.organizations set prices_include_vat = false where id = $1', [DEMO_ORG]);
      await stockInAt(sql, R.ruh.id, '100', '2');
      const expected = calculateLine({ unitPrice: R.price, quantity: '3', taxCategory: 'S', pricesIncludeVat: false });
      const sale = await sell(sql, { lines: [line('3')], payments: [{ method: 'cash', amount: expected.gross.toFixed(2) }] });
      expect(sale.net_total).toBe(expected.net.toFixed(2));
      expect(sale.vat_total).toBe(expected.vat.toFixed(2));
      expect(sale.gross_total).toBe(expected.gross.toFixed(2));
      const { rows } = await sql('select prices_include_vat from public.sales where id = $1', [sale.sale_id]);
      expect(rows[0].prices_include_vat).toBe(false);
    });
  });
});

describe('POS audit: zero-rated product', () => {
  it('a zero-rated product carries no VAT and its gross equals its net', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockInAt(sql, R.ruh.id, '100', '2');
      await sql(`update public.products set tax_category = 'Z', tax_exemption_reason_code = 'VATEX-SA-32' where id = $1`, [R.screw]);
      const expected = calculateLine({ unitPrice: R.price, quantity: '2', taxCategory: 'Z', pricesIncludeVat: R.pricesIncludeVat });
      expect(expected.vat.toFixed(2)).toBe('0.00');
      const sale = await sell(sql, { lines: [line('2')], payments: [{ method: 'cash', amount: expected.gross.toFixed(2) }] });
      expect(sale.vat_total).toBe('0.00');
      expect(sale.gross_total).toBe(expected.gross.toFixed(2));
      expect(sale.net_total).toBe(expected.gross.toFixed(2));
    });
  });
});

describe('POS audit: every refusal path refuses, writes nothing, and changes no stock', () => {
  const cases: Array<{ name: string; code: string; run: (sql: Sql) => Promise<unknown> }> = [
    { name: 'empty cart', code: 'validation', run: (sql) => sell(sql, { lines: [] }) },
    { name: 'unknown product', code: 'product.not_found', run: (sql) => sell(sql, { lines: [{ product_id: randomUUID(), unit_id: R.pcs, quantity: '1' }] }) },
    { name: 'unit not a sale unit', code: 'unit.not_sale_unit', run: async (sql) => {
        await sql('update public.product_units set is_sale_unit = false where product_id = $1 and unit_id = $2', [R.screw, R.pcs]);
        return sell(sql, { lines: [line('1')], payments: cash('1') });
      } },
    { name: 'no selling price', code: 'price.missing', run: async (sql) => {
        await sql('update public.product_units set sale_price = null where product_id = $1 and unit_id = $2', [R.screw, R.pcs]);
        return sell(sql, { lines: [line('1')], payments: cash('1') });
      } },
    { name: 'negative override price', code: 'price.negative', run: (sql) => sell(sql, { lines: [line('1', { unit_price: '-1' })], payments: cash('1') }) },
    { name: 'discount over 100%', code: 'discount.invalid', run: (sql) => sell(sql, { lines: [line('1', { discount_type: 'percent', discount_value: '150' })], payments: cash('1') }) },
    { name: 'zero quantity', code: 'quantity.invalid', run: (sql) => sell(sql, { lines: [line('0')], payments: cash('1') }) },
    { name: 'quantity with 7 decimals', code: 'quantity.precision', run: (sql) => sell(sql, { lines: [line('1.0000001')], payments: cash('1') }) },
    { name: 'fraction of a piece', code: 'quantity.fraction_not_allowed', run: (sql) => sell(sql, { lines: [line('0.5')], payments: cash('1') }) },
    { name: 'inactive warehouse', code: 'warehouse.inactive', run: async (sql) => {
        await sql('update public.warehouses set is_active = false where id = $1', [R.ruh.id]);
        return sell(sql, { lines: [line('1')], payments: cash('1') });
      } },
    { name: 'warehouse of another branch', code: 'warehouse.not_found', run: (sql) => sell(sql, { warehouse: R.jed.id, lines: [line('1')], payments: cash('1') }) },
    { name: 'unknown customer', code: 'customer.not_found', run: (sql) => sell(sql, { customer: randomUUID(), lines: [line('1')], payments: cash('1') }) },
    { name: 'unknown payment method', code: 'payment.method', run: (sql) => sell(sql, { lines: [line('1')], payments: [{ method: 'bitcoin', amount: '1' }] }) },
    { name: 'zero payment', code: 'payment.amount', run: (sql) => sell(sql, { lines: [line('1')], payments: [{ method: 'cash', amount: '0' }] }) },
    { name: 'tendered above amount on card', code: 'payment.tendered_not_cash', run: (sql) => sell(sql, { lines: [line('1')], payments: [{ method: 'card', amount: '1', tendered: '2' }] }) },
    { name: 'archived product', code: 'product.archived', run: async (sql) => {
        await sql('update public.products set archived_at = now() where id = $1', [R.screw]);
        return sell(sql, { lines: [line('1')], payments: cash('1') });
      } },
  ];

  it.each(cases)('$name → $code', async ({ code, run }) => {
    await asUser(USERS.owner, async (sql) => {
      await stockInAt(sql, R.ruh.id, '50', '2');
      const client = randomUUID();
      const before = await stockRow(sql, R.ruh.id);
      await sql('savepoint refusal_case');
      try {
        await expect(run(sql)).rejects.toThrow(new RegExp(code));
      } finally {
        await sql('rollback to savepoint refusal_case');
      }
      const after = await stockRow(sql, R.ruh.id);
      expect(after).toEqual(before);
      const { rows } = await sql('select count(*)::int as n from public.sales where client_id = $1', [client]);
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('POS audit: branch isolation on replay and cancel', () => {
  it('a manager without JED access cannot read a JED sale by replaying its client id', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockInAt(sql, R.jed.id, '20', '2');
      const client = randomUUID();
      const sale = await sell(sql, { client, branch: R.jed.branch_id, warehouse: R.jed.id, lines: [line('1')], payments: full('1') });
      expect(sale.status).toBe('created');
      // The attack: the manager sends a branch they may use (RUH) together with the JED sale's client id.
      await actAs(sql, USERS.manager);
      await refused(sql, () => sell(sql, { client, branch: R.ruh.branch_id, warehouse: R.ruh.id, lines: [line('1')], payments: full('1') }), 'forbidden');
    });
  });

  it('a manager without JED access cannot cancel a JED sale', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockInAt(sql, R.jed.id, '20', '2');
      const sale = await sell(sql, { branch: R.jed.branch_id, warehouse: R.jed.id, lines: [line('1')], payments: full('1') });
      await actAs(sql, USERS.manager);
      await refused(sql, () => sql('select public.cancel_sale($1, $2, $3, $4)', [DEMO_ORG, sale.sale_id, 'nope', 'POS-AUDIT']), 'forbidden');
    });
  });

  it('cancelling an unknown sale and cancelling without a reason are refused', async () => {
    await asUser(USERS.owner, async (sql) => {
      await refused(sql, () => sql('select public.cancel_sale($1, $2, $3, $4)', [DEMO_ORG, randomUUID(), 'x', 'POS-AUDIT']), 'sale.not_found');
      await stockInAt(sql, R.ruh.id, '5', '2');
      const sale = await sell(sql, { lines: [line('1')], payments: full('1') });
      await refused(sql, () => sql('select public.cancel_sale($1, $2, $3, $4)', [DEMO_ORG, sale.sale_id, '   ', 'POS-AUDIT']), 'validation');
    });
  });
});

describe('POS audit: cost handling on sale and cancellation', () => {
  it('a sale records the average cost; sale and cancel leave the average unchanged; quantity returns', async () => {
    await asUser(USERS.owner, async (sql) => {
      // Two cost layers: 10 at 2.00 and 10 at 4.00 -> average 3.00
      await stockInAt(sql, R.ruh.id, '10', '2');
      await stockInAt(sql, R.ruh.id, '10', '4');
      const beforeSale = await stockRow(sql, R.ruh.id);
      expect(Number(beforeSale.average_cost)).toBeCloseTo(3, 4);

      const sale = await sell(sql, { lines: [line('4')], payments: full('4') });
      const { rows } = await sql('select unit_cost::text from public.sale_lines where sale_id = $1', [sale.sale_id]);
      expect(Number(rows[0].unit_cost)).toBeCloseTo(3, 4);

      const afterSale = await stockRow(sql, R.ruh.id);
      expect(Number(afterSale.quantity)).toBe(Number(beforeSale.quantity) - 4);
      expect(Number(afterSale.average_cost)).toBeCloseTo(3, 4);

      await sql('select public.cancel_sale($1, $2, $3, $4)', [DEMO_ORG, sale.sale_id, 'reversal check', 'POS-AUDIT']);
      const afterCancel = await stockRow(sql, R.ruh.id);
      expect(Number(afterCancel.quantity)).toBe(Number(beforeSale.quantity));
      expect(Number(afterCancel.average_cost)).toBeCloseTo(3, 4);
    });
  });
});
