import { afterAll, describe, expect, it } from 'vitest';
import { asAdmin, asUser, expectDbError, pool, unitId, type Sql } from '../db';
import { DEMO_ORG, USERS } from '../env';

afterAll(() => pool.end());

const switchTo = (sql: Sql, user: string) =>
  sql(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })]);

async function refs(sql: Sql) {
  return {
    product: (await sql(`select id from public.products where org_id = $1 and sku = 'FST-WS-4X40'`, [DEMO_ORG])).rows[0].id as string,
    pcs: await unitId(sql, 'pcs'),
    box: await unitId(sql, 'box'),
    kg: await unitId(sql, 'kg'),
  };
}

const save = (sql: Sql, product: string, tiers: unknown[]) =>
  sql('select public.save_product_prices($1, $2, $3::jsonb) as n', [DEMO_ORG, product, JSON.stringify(tiers)]);

describe('price tiers', () => {
  it('owners save tiers and resolve the best price for a quantity', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      await save(sql, r.product, [
        { unit_id: r.pcs, price_level: 'wholesale', min_quantity: '100', price: '0.17' },
        { unit_id: r.pcs, price_level: 'wholesale', min_quantity: '1000', price: '0.15' },
        { unit_id: r.box, price_level: 'trade', min_quantity: '10', price: '22' },
      ]);
      const price = async (unit: string, qty: string, level = 'wholesale') =>
        (await sql('select public.resolve_sale_price($1, $2, $3, $4) as p', [r.product, unit, qty, level])).rows[0].p;
      expect(await price(r.pcs, '50')).toBe('0.15');          // no wholesale break yet: base retail (seed)
      expect(await price(r.pcs, '100')).toBe('0.17');
      expect(await price(r.pcs, '5000')).toBe('0.15');
      expect(await price(r.box, '3', 'trade')).toBe('25');     // no trade break: retail base
      expect(await price(r.box, '10', 'trade')).toBe('22');
    });
  });

  it('re-saving unchanged tiers does not rewrite them (storekeepers may save products)', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      await save(sql, r.product, [{ unit_id: r.pcs, price_level: 'wholesale', min_quantity: '100', price: '0.17' }]);
      await switchTo(sql, USERS.storekeeper);
      const { rows } = await sql('select id, unit_id, price_level, min_quantity::text, price::text from public.product_prices where product_id = $1', [r.product]);
      expect(rows).toHaveLength(1);
      const n = await save(sql, r.product, rows.map((x) => ({ ...x })));
      expect(n.rows[0].n).toBe(1);
    });
  });

  it('storekeepers may not change or delete tiers, nor clear them', async () => {
    const r = await asAdmin(refs);
    await asUser(USERS.owner, async (sql) => {
      await save(sql, r.product, [{ unit_id: r.pcs, price_level: 'trade', min_quantity: '50', price: '0.12' }]);
      await switchTo(sql, USERS.storekeeper);
      const { rows } = await sql(`select id from public.product_prices where product_id = $1 and price_level = 'trade'`, [r.product]);
      await sql('savepoint s1');
      await expectDbError(save(sql, r.product, [{ id: rows[0].id, unit_id: r.pcs, price_level: 'trade', min_quantity: '50', price: '0.10' }]), 'forbidden');
      await sql('rollback to savepoint s1');
      await expectDbError(save(sql, r.product, []), 'forbidden');
    });
  });

  it('cashiers and other organizations cannot save tiers', async () => {
    const r = await asAdmin(refs);
    await expectDbError(asUser(USERS.cashier, (sql) => save(sql, r.product, [])), 'forbidden');
    await expectDbError(asUser(USERS.outsider, (sql) => save(sql, r.product, [])), 'forbidden');
  });

  it('tiers must reference a unit configured on the product', async () => {
    const r = await asAdmin(refs);
    await expectDbError(asUser(USERS.owner, (sql) =>
      save(sql, r.product, [{ unit_id: r.kg, price_level: 'retail', min_quantity: '1', price: '1' }])),
      /product_prices_product_id_unit_id_fkey|foreign key/);
  });

  it('tier levels are constrained', async () => {
    const r = await asAdmin(refs);
    await expectDbError(asUser(USERS.owner, (sql) =>
      save(sql, r.product, [{ unit_id: r.pcs, price_level: 'vip', min_quantity: '1', price: '1' }])),
      /product_prices_price_level_check/);
  });
});

describe('product images (Supabase Storage policies, test shim)', () => {
  const PRODUCT = '50000000-0000-4000-8000-000000000099';
  const path = `${DEMO_ORG}/${PRODUCT}/front.jpg`;

  it('image_path must follow the org/product/file layout', async () => {
    await expectDbError(asUser(USERS.owner, (sql) =>
      sql(`update public.products set image_path = '../../etc/passwd' where sku = 'FST-WS-4X40'`)), /products_image_path_check/);
  });

  it('catalog writers upload, catalog readers view, everyone else is refused', async () => {
    await asUser(USERS.manager, async (sql) => {
      await sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [path]);
      const own = await sql(`select count(*)::int as n from storage.objects where bucket_id = 'product-images' and name = $1`, [path]);
      expect(own.rows[0].n).toBe(1);

      await sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [`${DEMO_ORG}/${PRODUCT}/x.jpg`]);

      await switchTo(sql, USERS.cashier);
      const cashierView = await sql(`select count(*)::int as n from storage.objects where bucket_id = 'product-images' and name = $1`, [path]);
      expect(cashierView.rows[0].n).toBe(1);
      await sql('savepoint s2');
      await expectDbError(sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [`${DEMO_ORG}/${PRODUCT}/z.jpg`]), /row-level security/);
      await sql('rollback to savepoint s2');

      await switchTo(sql, USERS.outsider);
      const outsiderView = await sql(`select count(*)::int as n from storage.objects where name = $1`, [path]);
      expect(outsiderView.rows[0].n).toBe(0);
      await sql('savepoint s3');
      await expectDbError(sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`, [`${DEMO_ORG}/${PRODUCT}/y.jpg`]), /row-level security/);
      await sql('rollback to savepoint s3');
    });
  });

  it('objects outside the org/product layout are never writable', async () => {
    await expectDbError(asUser(USERS.owner, (sql) => sql(
      `insert into storage.objects (bucket_id, name) values ('product-images', 'not-a-uuid/file.jpg')`)), /row-level security/);
  });
});

describe('search by brand', () => {
  it('filters by brand and keeps the four-argument form working', async () => {
    await asUser(USERS.cashier, async (sql) => {
      const brand = (await sql(`select id from public.brands where org_id = $1 and name = 'Najd Fasteners'`, [DEMO_ORG])).rows[0].id;
      const byBrand = await sql('select sku from public.search_products($1, null, null, false, $2) order by sku', [DEMO_ORG, brand]);
      expect(byBrand.rows.map((r) => r.sku)).toEqual(['FST-HB-M10X50', 'FST-WS-4X40']);
      const legacy = await sql('select count(*)::int as n from public.search_products($1, null, null, false)', [DEMO_ORG]);
      expect(legacy.rows[0].n).toBe(12);
    });
  });
});
