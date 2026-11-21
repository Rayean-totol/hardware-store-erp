import { randomUUID } from 'node:crypto';
import { calculateLine } from '@erp/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, asUser, expectDbError, pool, unitId, type Sql } from '../db';
import { DEMO_ORG, USERS } from '../env';

afterAll(() => pool.end());

interface SaleResult {
  status: 'created' | 'duplicate';
  sale_id: string;
  invoice_number: string;
  sale_status: string;
  net_total: string;
  discount_total: string;
  vat_total: string;
  gross_total: string;
  paid_total: string;
  change_given: string;
  balance_due: string;
}

/** Reference data (seeded), read once as the migration owner so every role's view is not a factor. */
async function loadRefs(sql: Sql) {
  const wh = async (code: string) =>
    (await sql('select id, branch_id from public.warehouses where org_id = $1 and code = $2', [DEMO_ORG, code])).rows[0] as {
      id: string;
      branch_id: string;
    };
  const screw = (await sql(`select id from public.products where org_id = $1 and sku = 'FST-WS-4X40'`, [DEMO_ORG])).rows[0].id as string;
  const pcs = await unitId(sql, 'pcs');
  const price = (await sql('select sale_price from public.product_units where product_id = $1 and unit_id = $2', [screw, pcs])).rows[0]
    .sale_price as string;
  const org = (await sql('select prices_include_vat from public.organizations where id = $1', [DEMO_ORG])).rows[0] as {
    prices_include_vat: boolean;
  };
  return { ruh: await wh('RUH'), jed: await wh('JED'), screw, pcs, price, pricesIncludeVat: org.prices_include_vat };
}

/** Expected refusal, run inside a savepoint so the rest of the test transaction stays usable. */
async function refused(sql: Sql, fn: () => Promise<unknown>, msg: string | RegExp) {
  await sql('savepoint refused');
  try {
    await expectDbError(fn(), msg);
  } finally {
    await sql('rollback to savepoint refused');
  }
}

let R: Awaited<ReturnType<typeof loadRefs>>;
beforeAll(async () => {
  R = await asAdmin(loadRefs);
});

/** Ask the database to act as another user inside the current transaction (RLS reads the JWT claims). */
async function actAs(sql: Sql, userId: string) {
  await sql(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
}

async function stockIn(sql: Sql, warehouseId: string, productId: string, unitIdValue: string, quantity: string) {
  await sql('select public.apply_stock_movements($1, $2, $3::jsonb) as r', [
    DEMO_ORG,
    'POS-TEST',
    JSON.stringify([
      {
        client_id: randomUUID(),
        warehouse_id: warehouseId,
        product_id: productId,
        movement_type: 'stock_in',
        unit_id: unitIdValue,
        quantity,
        unit_cost: '2',
        occurred_at: '2026-11-20T10:00:00Z',
      },
    ]),
  ]);
}

async function stockOf(sql: Sql, warehouseId: string, productId: string): Promise<number> {
  const { rows } = await sql('select quantity from public.stock_levels where warehouse_id = $1 and product_id = $2', [warehouseId, productId]);
  return rows.length ? Number(rows[0].quantity) : 0;
}

async function sell(
  sql: Sql,
  p: {
    client?: string;
    branch?: string;
    warehouse?: string;
    customer?: string | null;
    lines: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
    note?: string | null;
  },
): Promise<SaleResult> {
  const { rows } = await sql('select public.finalize_sale($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb) as r', [
    DEMO_ORG,
    p.client ?? randomUUID(),
    p.branch ?? R.ruh.branch_id,
    p.warehouse ?? R.ruh.id,
    'POS-TEST',
    p.customer ?? null,
    p.note ?? null,
    JSON.stringify(p.lines),
    JSON.stringify(p.payments ?? []),
  ]);
  return rows[0].r as SaleResult;
}

const cash = (amount: string, tendered?: string) => ({ method: 'cash', amount, ...(tendered ? { tendered } : {}) });
/** Pay the exact VAT-inclusive total for `quantity` of the seeded screw (or another unit price). */
function full(quantity: string, unitPrice: string = R.price) {
  const gross = calculateLine({ unitPrice, quantity, taxCategory: 'S', pricesIncludeVat: R.pricesIncludeVat }).gross.toFixed(2);
  return [cash(gross)];
}

const line = (quantity: string, extra: Record<string, unknown> = {}) => ({ product_id: R.screw, unit_id: R.pcs, quantity, ...extra });

/** Quantity of the seeded screw whose VAT-inclusive total is at least `min` riyals. */
function qtyForAtLeast(min: number): string {
  return String(Math.ceil(min / Number(R.price)) + 1);
}

describe('POS: totals and VAT', () => {
  it('VAT-inclusive line totals equal the domain calculation (single source of tax rules)', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const expected = calculateLine({ unitPrice: R.price, quantity: '3', taxCategory: 'S', pricesIncludeVat: R.pricesIncludeVat });

      const sale = await sell(sql, { lines: [line('3')], payments: [cash(expected.gross.toFixed(2))] });

      expect(sale.status).toBe('created');
      expect(sale.gross_total).toBe(expected.gross.toFixed(2));
      expect(sale.net_total).toBe(expected.net.toFixed(2));
      expect(sale.vat_total).toBe(expected.vat.toFixed(2));
      expect(sale.balance_due).toBe('0.00');
      expect(sale.change_given).toBe('0.00');
    });
  });

  it('a percentage discount is applied before VAT, matching the domain rules', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const extended = (Math.round(Number(R.price) * 4 * 100) / 100).toFixed(2);
      const discount = ((Number(extended) * 10) / 100).toFixed(2);
      const afterDiscount = (Number(extended) - Number(discount)).toFixed(2);
      const expected = calculateLine({ unitPrice: afterDiscount, quantity: '1', taxCategory: 'S', pricesIncludeVat: R.pricesIncludeVat });

      const sale = await sell(sql, {
        lines: [line('4', { discount_type: 'percent', discount_value: '10' })],
        payments: [cash(expected.gross.toFixed(2))],
      });

      expect(sale.discount_total).toBe(discount);
      expect(sale.gross_total).toBe(expected.gross.toFixed(2));
      expect(sale.vat_total).toBe(expected.vat.toFixed(2));
    });
  });

  it('cash change is calculated from the amount tendered', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const expected = calculateLine({ unitPrice: R.price, quantity: '2', taxCategory: 'S', pricesIncludeVat: R.pricesIncludeVat });
      const total = Number(expected.gross.toFixed(2));
      const tendered = Math.ceil(total) + 5;

      const sale = await sell(sql, { lines: [line('2')], payments: [cash(total.toFixed(2), tendered.toFixed(2))] });

      expect(sale.change_given).toBe((tendered - total).toFixed(2));
      expect(sale.paid_total).toBe(total.toFixed(2));
    });
  });
});

describe('POS: stock, numbering and idempotency', () => {
  it('deducts stock from the selected warehouse with a traceable stock_out movement', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '50');
      const before = await stockOf(sql, R.ruh.id, R.screw);

      const sale = await sell(sql, { lines: [line('5')], payments: full('5') });
      expect(await stockOf(sql, R.ruh.id, R.screw)).toBe(before - 5);

      const { rows } = await sql(
        `select movement_type, reason_code, quantity_change::text from public.stock_movements
         where org_id = $1 and reference = $2`,
        [DEMO_ORG, sale.invoice_number],
      );
      expect(rows).toEqual([{ movement_type: 'stock_out', reason_code: null, quantity_change: '-5.000000' }]);
    });
  });

  it('issues unique, increasing invoice numbers in the branch sequence', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const a = await sell(sql, { lines: [line('1')], payments: full('1') });
      const b = await sell(sql, { lines: [line('1')], payments: full('1') });

      expect(a.invoice_number).toMatch(/^INV-RUH-\d{4}-\d{6,}$/);
      expect(b.invoice_number).not.toBe(a.invoice_number);
      expect(Number(b.invoice_number.split('-').at(-1))).toBe(Number(a.invoice_number.split('-').at(-1)) + 1);
    });
  });

  it('a replayed checkout with the same client id returns the same sale and writes nothing', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const client = randomUUID();
      const args = { client, lines: [line('2')], payments: full('2') };
      const first = await sell(sql, args);
      const stockAfterFirst = await stockOf(sql, R.ruh.id, R.screw);

      const replay = await sell(sql, args);
      expect(replay.status).toBe('duplicate');
      expect(replay.sale_id).toBe(first.sale_id);
      expect(replay.invoice_number).toBe(first.invoice_number);
      expect(await stockOf(sql, R.ruh.id, R.screw)).toBe(stockAfterFirst);
    });
  });

  it('refuses a sale that exceeds available stock and records nothing', async () => {
    await asUser(USERS.owner, async (sql) => {
      const client = randomUUID();
      await refused(sql, () => sell(sql, { client, lines: [line('999999')], payments: full('999999') }), 'stock.insufficient');
      const { rows } = await sql('select count(*)::int as n from public.sales where client_id = $1', [client]);
      expect(rows[0].n).toBe(0);
    });
  });

  it('two lines for the same product cannot together exceed the stock', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '10');
      const client = randomUUID();
      await refused(sql, () => sell(sql, { client, lines: [line('10'), line('1')], payments: [cash('1')] }), 'stock.insufficient');
      const { rows } = await sql('select count(*)::int as n from public.sales where client_id = $1', [client]);
      expect(rows[0].n).toBe(0);
    });
  });
});

describe('POS: payments and credit', () => {
  it('a split payment (cash and card) settles the invoice with no balance', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '1000');
      const qty = qtyForAtLeast(20);
      const expected = calculateLine({ unitPrice: R.price, quantity: qty, taxCategory: 'S', pricesIncludeVat: R.pricesIncludeVat });
      const total = Number(expected.gross.toFixed(2));
      const cardAmt = '2.00';
      const cashAmt = (total - 2).toFixed(2);

      const sale = await sell(sql, {
        lines: [line(qty)],
        payments: [cash(cashAmt), { method: 'card', amount: cardAmt, reference: 'AUTH-123' }],
      });
      expect(sale.paid_total).toBe(total.toFixed(2));
      expect(sale.balance_due).toBe('0.00');
    });
  });

  it('a partial payment on credit records the outstanding balance against the customer', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '1000');
      const customer = (
        await sql(`insert into public.customers (org_id, name, credit_allowed) values ($1, 'Al Tamimi Build', true) returning id`, [DEMO_ORG])
      ).rows[0].id as string;
      const qty = qtyForAtLeast(30);
      const expected = calculateLine({ unitPrice: R.price, quantity: qty, taxCategory: 'S', pricesIncludeVat: R.pricesIncludeVat });
      const total = Number(expected.gross.toFixed(2));

      const sale = await sell(sql, { customer, lines: [line(qty)], payments: [cash('10')] });
      expect(sale.paid_total).toBe('10.00');
      expect(sale.balance_due).toBe((total - 10).toFixed(2));

      const { rows } = await sql(`select method, amount::text from public.sale_payments where sale_id = $1 order by method`, [sale.sale_id]);
      expect(rows).toEqual([
        { method: 'cash', amount: '10.00' },
        { method: 'credit', amount: (total - 10).toFixed(2) },
      ]);
    });
  });

  it('refuses credit to a customer without credit allowed, and refuses a sale with no payment and no customer', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const cashOnly = (
        await sql(`insert into public.customers (org_id, name, credit_allowed) values ($1, 'Cash only', false) returning id`, [DEMO_ORG])
      ).rows[0].id as string;

      await refused(sql, () => sell(sql, { customer: cashOnly, lines: [line('1')], payments: [] }), 'forbidden');
      await refused(sql, () => sell(sql, { customer: null, lines: [line('1')], payments: [] }), 'payment.insufficient');
    });
  });

  it('a cashier does not hold the credit permission', async () => {
    await asUser(USERS.cashier, async (sql) => {
      const { rows } = await sql(`select app.has_permission($1, 'sales.credit') as ok`, [DEMO_ORG]);
      expect(rows[0].ok).toBe(false);
    });
  });

  it('refuses an overpayment by card (only cash may exceed the total, as change)', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      await refused(sql, () => sell(sql, { lines: [line('1')], payments: [{ method: 'card', amount: '999.00' }] }), 'payment.exceeds_total');
    });
  });
});

describe('POS: permissions and isolation', () => {
  it('a cashier cannot discount or override a price', async () => {
    await asUser(USERS.cashier, async (sql) => {
      await refused(sql, () => 
        sell(sql, { lines: [line('1', { discount_type: 'fixed', discount_value: '1' })], payments: [cash('100')] }),
        'forbidden',
      );
      await refused(sql, () => sell(sql, { lines: [line('1', { unit_price: '0.01' })], payments: [cash('100')] }), 'forbidden');
    });
  });

  it('an owner may override a price, and the sale records the override', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const sale = await sell(sql, { lines: [line('1', { unit_price: '0.50' })], payments: full('1', '0.50') });
      const { rows } = await sql('select price_overridden, list_price::text, unit_price::text from public.sale_lines where sale_id = $1', [
        sale.sale_id,
      ]);
      expect(rows[0].price_overridden).toBe(true);
      expect(rows[0].unit_price).toBe('0.5000');
      expect(rows[0].list_price).toBe(Number(R.price).toFixed(4));
    });
  });

  it('a manager assigned to RUH cannot ring up a sale at JED', async () => {
    await asUser(USERS.manager, async (sql) => {
      await refused(sql, () => 
        sell(sql, { branch: R.jed.branch_id, warehouse: R.jed.id, lines: [line('1')], payments: full('1') }),
        'forbidden',
      );
    });
  });

  it('an auditor can read sales in the org but cannot create them', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const sale = await sell(sql, { lines: [line('1')], payments: full('1') });

      await actAs(sql, USERS.auditor);
      const { rows } = await sql('select count(*)::int as n from public.sales where id = $1', [sale.sale_id]);
      expect(rows[0].n).toBe(1);
      await refused(sql, () => sell(sql, { lines: [line('1')], payments: full('1') }), 'forbidden');
    });
  });

  it('sales are isolated by organization and anonymous users have no table access', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const sale = await sell(sql, { lines: [line('1')], payments: full('1') });

      await actAs(sql, USERS.outsider);
      const { rows } = await sql('select count(*)::int as n from public.sales where id = $1', [sale.sale_id]);
      expect(rows[0].n).toBe(0);
      await refused(sql, () => 
        sell(sql, { branch: randomUUID(), warehouse: randomUUID(), lines: [line('1')], payments: full('1') }),
        'forbidden',
      );
    });
    await asUser(null, async (sql) => {
      await refused(sql, () => sql('select count(*) from public.sales'), /permission denied/);
    });
  });
});

describe('POS: cancellation and immutability', () => {
  it('cancelling returns the stock with a reversal movement and marks the sale voided', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const sale = await sell(sql, { lines: [line('4')], payments: full('4') });
      const beforeCancel = await stockOf(sql, R.ruh.id, R.screw);

      const { rows } = await sql('select public.cancel_sale($1, $2, $3, $4) as r', [DEMO_ORG, sale.sale_id, 'Customer changed mind', 'POS-TEST']);
      expect(rows[0].r.status).toBe('voided');
      expect(await stockOf(sql, R.ruh.id, R.screw)).toBe(beforeCancel + 4);

      const reversal = await sql(
        `select movement_type, reason_code from public.stock_movements where org_id = $1 and reference = $2 and movement_type = 'stock_in'`,
        [DEMO_ORG, sale.invoice_number],
      );
      expect(reversal.rows).toEqual([{ movement_type: 'stock_in', reason_code: 'return' }]);

      // A repeated cancel is idempotent: it returns the voided sale and reverses nothing again.
      const again = await sql('select public.cancel_sale($1, $2, $3, $4) as r', [DEMO_ORG, sale.sale_id, 'again', 'POS-TEST']);
      expect(again.rows[0].r).toMatchObject({ status: 'duplicate', sale_status: 'voided' });
      expect(await stockOf(sql, R.ruh.id, R.screw)).toBe(beforeCancel + 4);
    });
  });

  it('a cashier cannot cancel a sale', async () => {
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const sale = await sell(sql, { lines: [line('1')], payments: full('1') });
      await actAs(sql, USERS.cashier);
      await refused(sql, () => sql('select public.cancel_sale($1, $2, $3, $4)', [DEMO_ORG, sale.sale_id, 'nope', 'POS-TEST']), 'forbidden');
    });
  });

  it('sale lines are append-only (trigger, even for the owner role), and payments cannot be deleted by a signed-in user', async () => {
    // Trigger check: run as the migration owner (triggers still fire; privileges are bypassed).
    await asAdmin(async (sql) => {
      await actAs(sql, USERS.owner);
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const sale = await sell(sql, { lines: [line('1')], payments: full('1') });
      await refused(sql, () => sql('update public.sale_lines set discount_amount = 0 where sale_id = $1', [sale.sale_id]), /append-only/);
    });

    // Privilege check: a signed-in user has no DELETE on payments at all.
    await asUser(USERS.owner, async (sql) => {
      await stockIn(sql, R.ruh.id, R.screw, R.pcs, '100');
      const sale = await sell(sql, { lines: [line('1')], payments: full('1') });
      await refused(sql, () => sql('delete from public.sale_payments where sale_id = $1', [sale.sale_id]), /permission denied/);
    });
  });
});
