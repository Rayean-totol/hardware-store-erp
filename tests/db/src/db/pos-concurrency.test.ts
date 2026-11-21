import { randomBytes, randomUUID } from 'node:crypto';
import { calculateLine } from '@erp/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { pool, unitId, type Sql } from '../db';
import { DEMO_ORG, USERS } from '../env';

/**
 * Real concurrency needs COMMITTED transactions: asUser() rolls back, so a second checkout
 * would never wait for the first. This file therefore commits. It creates its own product
 * (unique SKU) so no other suite's stock or counts are affected. Rows stay in the throwaway
 * test database, which global setup recreates on every run.
 */
afterAll(() => pool.end());

const poolSql: Sql = (text, params) => pool.query(text, params);

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

async function setup(price: string) {
  const pcs = await unitId(poolSql, 'pcs');
  const sku = `POSC-${randomBytes(3).toString('hex').toUpperCase()}`;
  // The base-unit rule is checked when the product is complete, so insert both rows in one transaction.
  const client = await pool.connect();
  let product: string;
  try {
    await client.query('begin');
    await client.query('set constraints all deferred');
    product = (
      await client.query(
        `insert into public.products (org_id, sku, name_en, name_ar, base_unit_id, tax_category)
         values ($1, $2, 'Concurrency test item', 'صنف اختبار', $3, 'S') returning id`,
        [DEMO_ORG, sku, pcs],
      )
    ).rows[0].id as string;
    await client.query(
      `insert into public.product_units (org_id, product_id, unit_id, factor, is_base, is_sale_unit, is_purchase_unit, sale_price)
       values ($1, $2, $3, 1, true, true, true, $4)`,
      [DEMO_ORG, product, pcs, price],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const wh = (await pool.query(`select id, branch_id from public.warehouses where org_id = $1 and code = 'RUH'`, [DEMO_ORG])).rows[0] as {
    id: string;
    branch_id: string;
  };
  const org = (await pool.query('select prices_include_vat from public.organizations where id = $1', [DEMO_ORG])).rows[0] as {
    prices_include_vat: boolean;
  };
  return { product, pcs, wh, pricesIncludeVat: org.prices_include_vat, sku };
}

async function stockIn(s: Awaited<ReturnType<typeof setup>>, quantity: string) {
  await commitAs(USERS.owner, (sql) =>
    sql('select public.apply_stock_movements($1, $2, $3::jsonb) as r', [
      DEMO_ORG,
      'POS-CONC',
      JSON.stringify([
        {
          client_id: randomUUID(),
          warehouse_id: s.wh.id,
          product_id: s.product,
          movement_type: 'stock_in',
          unit_id: s.pcs,
          quantity,
          unit_cost: '4',
          occurred_at: '2026-11-20T10:00:00Z',
        },
      ]),
    ]),
  );
}

function checkout(s: Awaited<ReturnType<typeof setup>>, quantity: string, client: string) {
  const gross = calculateLine({ unitPrice: '10', quantity, taxCategory: 'S', pricesIncludeVat: s.pricesIncludeVat }).gross.toFixed(2);
  return commitAs(USERS.owner, (sql) =>
    sql('select public.finalize_sale($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb) as r', [
      DEMO_ORG,
      client,
      s.wh.branch_id,
      s.wh.id,
      'POS-CONC',
      null,
      null,
      JSON.stringify([{ product_id: s.product, unit_id: s.pcs, quantity }]),
      JSON.stringify([{ method: 'cash', amount: gross }]),
    ]),
  )
    .then((r) => ({ ok: true as const, sale: r.rows[0].r as { status: string; invoice_number: string } }))
    .catch((error: { code?: string; message: string }) => ({ ok: false as const, code: error.code, message: error.message }));
}

async function stockOf(s: Awaited<ReturnType<typeof setup>>): Promise<number> {
  const { rows } = await pool.query('select quantity from public.stock_levels where warehouse_id = $1 and product_id = $2', [s.wh.id, s.product]);
  return Number(rows[0]?.quantity ?? 0);
}

describe('POS concurrency (committed)', () => {
  it('two simultaneous checkouts for the last units: exactly one succeeds and stock never goes negative', async () => {
    const s = await setup('10');
    await stockIn(s, '3');

    const results = await Promise.all([checkout(s, '2', randomUUID()), checkout(s, '2', randomUUID())]);
    const created = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);

    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ message: 'stock.insufficient' });
    expect(await stockOf(s)).toBe(1);
  });

  it('a simultaneous double-submit with the same client id creates one sale and deducts stock once', async () => {
    const s = await setup('10');
    await stockIn(s, '5');
    const client = randomUUID();

    const results = await Promise.all([checkout(s, '2', client), checkout(s, '2', client)]);
    const created = results.filter((r) => r.ok);
    expect(created.length).toBeGreaterThanOrEqual(1);
    // The other attempt is either the stored replay (duplicate) or a unique-key conflict; never a second sale.
    const other = results.find((r) => !r.ok);
    if (other) expect(other.code).toBe('23505');

    const { rows } = await pool.query('select count(*)::int as n from public.sales where client_id = $1', [client]);
    expect(rows[0].n).toBe(1);
    expect(await stockOf(s)).toBe(3);
  });

  it('invoice numbers stay unique when many checkouts run at once', async () => {
    const s = await setup('10');
    await stockIn(s, '20');

    const results = await Promise.all(Array.from({ length: 6 }, () => checkout(s, '1', randomUUID())));
    const numbers = results.filter((r) => r.ok).map((r) => (r as { sale: { invoice_number: string } }).sale.invoice_number);
    expect(numbers).toHaveLength(6);
    expect(new Set(numbers).size).toBe(6);
    expect(await stockOf(s)).toBe(14);
  });
});
