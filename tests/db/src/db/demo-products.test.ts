import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { planProductImport, type ProductCsvLookups, type UnitDef } from '@erp/domain';
import { toSaveProductParams } from '@erp/data';
import { describe, expect, it } from 'vitest';
import { asUser, type Sql } from '../db';
import { DEMO_ORG, USERS } from '../env';

/**
 * The DEMO product import, run through the same planner and the same save_product function the app
 * uses, as the owner user. Everything happens in one transaction that is always rolled back, so the
 * shared test database is left exactly as it was.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CSV = readFileSync(join(ROOT, 'docs/demo-products/demo-products.csv'), 'utf8');
const DEMO_SKUS = 10;

async function lookupsFor(sql: Sql): Promise<ProductCsvLookups> {
  const units = (await sql(
    'select id, code, dimension, ratio_to_dimension_base, allow_fraction, decimal_places from public.units where org_id is null or org_id = $1',
    [DEMO_ORG],
  )).rows as Array<{ id: string; code: string; dimension: UnitDef['dimension']; ratio_to_dimension_base: string | null; allow_fraction: boolean; decimal_places: number }>;
  const categories = (await sql('select id, name_en from public.product_categories where org_id = $1', [DEMO_ORG])).rows as Array<{ id: string; name_en: string }>;
  const existing = (await sql("select id, sku, row_version from public.products where org_id = $1", [DEMO_ORG])).rows as Array<{ id: string; sku: string; row_version: number }>;
  return {
    unitsByCode: new Map(units.map((u) => [u.code, {
      id: u.id, code: u.code, dimension: u.dimension, ratioToDimensionBase: u.ratio_to_dimension_base,
      allowFraction: u.allow_fraction, decimalPlaces: u.decimal_places,
    } as UnitDef & { id: string }])),
    categoryIdByName: new Map(categories.map((c) => [c.name_en.trim().toLowerCase(), c.id])),
    brandIdByName: new Map(),
    existingBySku: new Map(existing.map((p) => [p.sku, { id: p.id, rowVersion: Number(p.row_version) }])),
  };
}

describe('DEMO product import (repeatable, non-destructive)', () => {
  it('creates the ten demo products, re-runs as updates, keeps images, and touches no stock or other product', async () => {
    await asUser(USERS.owner, async (sql) => {
      const snapshotOthers = async () => (await sql(
        "select sku, name_en, row_version from public.products where org_id = $1 and sku not like 'DEMO-%' order by sku", [DEMO_ORG],
      )).rows;
      const counts = async () => ({
        stock: Number((await sql('select count(*) as n from public.stock_levels')).rows[0].n),
        movements: Number((await sql('select count(*) as n from public.stock_movements')).rows[0].n),
        demo: Number((await sql("select count(*) as n from public.products where sku like 'DEMO-%'")).rows[0].n),
      });

      const beforeOthers = await snapshotOthers();
      const before = await counts();
      expect(before.demo).toBe(0);

      // 1. First run: every row is a create.
      const plan1 = planProductImport(CSV, DEMO_ORG, await lookupsFor(sql));
      expect(plan1.counts).toEqual({ create: DEMO_SKUS, update: 0, invalid: 0 });
      for (const p of plan1.products) {
        await sql('select public.save_product($1::jsonb, $2::jsonb, $3::bigint)', [
          JSON.stringify(toSaveProductParams(p.draft!, null).p_product),
          JSON.stringify(toSaveProductParams(p.draft!, null).p_units),
          null,
        ]);
      }
      expect((await counts()).demo).toBe(DEMO_SKUS);

      // 2. An image is set on one demo product (what the app's upload does after storing the file).
      const onePath = `${DEMO_ORG}/`;
      const one = (await sql("select id from public.products where sku = 'DEMO-HAMMER' and org_id = $1", [DEMO_ORG])).rows[0] as { id: string };
      await sql('update public.products set image_path = $1 where id = $2', [`${onePath}${one.id}/1700000000000.png`, one.id]);

      // 3. Second run: same file. Must update, never duplicate, and must keep the image.
      const plan2 = planProductImport(CSV, DEMO_ORG, await lookupsFor(sql));
      expect(plan2.counts).toEqual({ create: 0, update: DEMO_SKUS, invalid: 0 });
      for (const p of plan2.products) {
        const expected = p.existing ? p.existing.rowVersion : null;
        const params = toSaveProductParams(p.draft!, expected);
        await sql('select public.save_product($1::jsonb, $2::jsonb, $3::bigint)', [
          JSON.stringify(params.p_product), JSON.stringify(params.p_units), params.p_expected_version,
        ]);
      }
      const hammer = (await sql("select sku, image_path from public.products where sku = 'DEMO-HAMMER' and org_id = $1", [DEMO_ORG])).rows[0] as { image_path: string | null };
      expect(hammer.image_path).toBe(`${onePath}${one.id}/1700000000000.png`);
      expect((await counts()).demo).toBe(DEMO_SKUS);

      // 4. Nothing else changed: no stock, no movements, and every other product is identical.
      const after = await counts();
      expect(after.stock).toBe(before.stock);
      expect(after.movements).toBe(before.movements);
      expect(await snapshotOthers()).toEqual(beforeOthers);

      // 5. The prices, categories and units landed as planned (base unit and sale price).
      const check = (await sql(`
        select p.sku, p.name_en, c.name_en as category, u.code as unit, pu.sale_price
        from public.products p
        join public.product_categories c on c.id = p.category_id
        join public.units u on u.id = p.base_unit_id
        join public.product_units pu on pu.product_id = p.id and pu.is_base
        where p.sku like 'DEMO-%' and p.org_id = $1 order by p.sku`, [DEMO_ORG])).rows as Array<Record<string, string>>;
      expect(check.map((r) => [r.sku, r.sale_price, r.unit])).toEqual([
        ['DEMO-ADJ-WRENCH', '22.0000', 'pcs'],
        ['DEMO-BOLT-NUT', '2.0000', 'pcs'],
        ['DEMO-CEMENT-BAG', '18.0000', 'bag'],
        ['DEMO-ELEC-CABLE', '45.0000', 'm'],
        ['DEMO-HAMMER', '15.0000', 'pcs'],
        ['DEMO-LED-BULB', '8.0000', 'pcs'],
        ['DEMO-MEAS-TAPE', '10.0000', 'pcs'],
        ['DEMO-PL-BUCKET', '9.0000', 'bucket'],
        ['DEMO-PVC-ELBOW', '3.0000', 'pcs'],
        ['DEMO-PVC-PIPE', '12.0000', 'm'],
      ]);
    });
  }, 120_000);
});
