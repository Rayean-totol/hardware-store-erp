import { describe, expect, it } from 'vitest';
import { asUser, expectDbError, unitId } from '../db';
import { DEMO_ORG, USERS } from '../env';

/**
 * Product size (products.size_label) and purchase price (product_unit_costs). Each test runs in one
 * transaction that is always rolled back, so the shared test database is left as it was.
 */
const SKU = 'SIZE-TEST';

async function save(sql: Parameters<Parameters<typeof asUser>[1]>[0], product: Record<string, unknown>, units: Array<Record<string, unknown>>, expectedVersion: number | null = null) {
  const { rows } = await sql('select public.save_product($1, $2, $3) as r', [
    JSON.stringify({ org_id: DEMO_ORG, product_type: 'stock', tax_category: 'S', ...product }),
    JSON.stringify(units),
    expectedVersion,
  ]);
  return rows[0].r as { id: string; row_version: number };
}

async function baseUnit(sql: Parameters<Parameters<typeof asUser>[1]>[0]) {
  const pcs = await unitId(sql, 'pcs');
  return { pcs, unit: { unit_id: pcs, factor: '1', is_base: true, sale_price: '10' } };
}

describe('product size', () => {
  it('saves a size and returns it with the product', async () => {
    await asUser(USERS.manager, async (sql) => {
      const { pcs, unit } = await baseUnit(sql);
      const r = await save(sql, { sku: SKU, name_en: 'Size item', name_ar: 'صنف', base_unit_id: pcs, size_label: ' 1/2 inch ' }, [unit]);
      const { rows } = await sql('select size_label from public.products where id = $1', [r.id]);
      expect(rows[0].size_label).toBe('1/2 inch');
    });
  });

  it('keeps the stored size when the key is absent (older callers and the CSV import)', async () => {
    await asUser(USERS.manager, async (sql) => {
      const { pcs, unit } = await baseUnit(sql);
      const first = await save(sql, { sku: SKU, name_en: 'Size item', name_ar: 'صنف', base_unit_id: pcs, size_label: '50 kg' }, [unit]);
      await save(sql, { id: first.id, sku: SKU, name_en: 'Size item', name_ar: 'صنف', base_unit_id: pcs }, [unit], first.row_version);
      const { rows } = await sql('select size_label from public.products where id = $1', [first.id]);
      expect(rows[0].size_label).toBe('50 kg');
    });
  });

  it('refuses a size longer than 40 characters', async () => {
    await asUser(USERS.manager, async (sql) => {
      const { pcs, unit } = await baseUnit(sql);
      await expectDbError(save(sql, { sku: SKU, name_en: 'x', name_ar: 'x', base_unit_id: pcs, size_label: 'x'.repeat(41) }, [unit]), /size_label|check/);
    });
  });
});

describe('purchase price (cost)', () => {
  it('a price-writer saves a purchase price for a unit and it is read back', async () => {
    await asUser(USERS.manager, async (sql) => {
      const { pcs, unit } = await baseUnit(sql);
      const r = await save(sql, { sku: SKU, name_en: 'Cost item', name_ar: 'تكلفة', base_unit_id: pcs }, [{ ...unit, purchase_price: '7.25' }]);
      const { rows } = await sql('select purchase_price::text as p from public.product_unit_costs where product_id = $1', [r.id]);
      expect(rows).toEqual([{ p: '7.2500' }]);
      const sale = await sql('select sale_price::text as s from public.product_units where product_id = $1 and is_base', [r.id]);
      expect(sale.rows[0].s).toBe('10.0000');
    });
  });

  it('keeps the stored purchase price when the key is absent, and clears it when the value is empty', async () => {
    await asUser(USERS.manager, async (sql) => {
      const { pcs, unit } = await baseUnit(sql);
      const r = await save(sql, { sku: SKU, name_en: 'Cost item', name_ar: 'تكلفة', base_unit_id: pcs }, [{ ...unit, purchase_price: '3' }]);
      await save(sql, { id: r.id, sku: SKU, name_en: 'Cost item', name_ar: 'تكلفة', base_unit_id: pcs }, [unit], r.row_version);
      expect((await sql('select count(*)::int as n from public.product_unit_costs where product_id = $1', [r.id])).rows[0].n).toBe(1);
      await save(sql, { id: r.id, sku: SKU, name_en: 'Cost item', name_ar: 'تكلفة', base_unit_id: pcs }, [{ ...unit, purchase_price: '' }], r.row_version + 1);
      expect((await sql('select count(*)::int as n from public.product_unit_costs where product_id = $1', [r.id])).rows[0].n).toBe(0);
    });
  });

  it('refuses a negative purchase price', async () => {
    await asUser(USERS.manager, async (sql) => {
      const { pcs, unit } = await baseUnit(sql);
      await expectDbError(save(sql, { sku: SKU, name_en: 'x', name_ar: 'x', base_unit_id: pcs }, [{ ...unit, purchase_price: '-1' }]), /check|purchase_price/);
    });
  });

  it('a storekeeper (catalog.write, no price permission) cannot set a purchase price', async () => {
    await asUser(USERS.storekeeper, async (sql) => {
      const { pcs, unit } = await baseUnit(sql);
      await expectDbError(save(sql, { sku: SKU, name_en: 'x', name_ar: 'x', base_unit_id: pcs }, [{ ...unit, purchase_price: '5' }]), /forbidden|row-level|violates/i);
    });
  });

  it('a storekeeper cannot read purchase prices, even of a product they can see', async () => {
    // One transaction: save as the manager, then continue as the storekeeper (same rolled-back transaction).
    await asUser(USERS.manager, async (sql) => {
      const pcs = await unitId(sql, 'pcs');
      const { rows } = await sql('select public.save_product($1, $2, $3) as r', [
        JSON.stringify({ org_id: DEMO_ORG, sku: 'COST-HIDDEN', name_en: 'h', name_ar: 'h', base_unit_id: pcs, product_type: 'stock', tax_category: 'S' }),
        JSON.stringify([{ unit_id: pcs, factor: '1', is_base: true, sale_price: '1', purchase_price: '9' }]),
        null,
      ]);
      const productId = (rows[0].r as { id: string }).id;
      expect((await sql('select count(*)::int as n from public.product_unit_costs where product_id = $1', [productId])).rows[0].n).toBe(1);
      await sql("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USERS.storekeeper, role: 'authenticated' })]);
      await sql('set local role authenticated');
      const storekeeper = (await sql('select count(*)::int as n from public.product_unit_costs where product_id = $1', [productId])).rows[0].n;
      expect(storekeeper).toBe(0);
      const visibleProduct = (await sql('select count(*)::int as n from public.products where id = $1', [productId])).rows[0].n;
      expect(visibleProduct).toBe(1);
    });
  });

  it('a product saved without any cost keeps selling prices and stock exactly as before', async () => {
    await asUser(USERS.manager, async (sql) => {
      const { pcs, unit } = await baseUnit(sql);
      const before = (await sql('select count(*)::int as n from public.stock_levels')).rows[0].n;
      const r = await save(sql, { sku: SKU, name_en: 'Plain item', name_ar: 'عادي', base_unit_id: pcs }, [unit]);
      expect((await sql('select count(*)::int as n from public.product_unit_costs where product_id = $1', [r.id])).rows[0].n).toBe(0);
      expect((await sql('select count(*)::int as n from public.stock_levels')).rows[0].n).toBe(before);
    });
  });
});

describe('variant group', () => {
  it('saves a variant group, keeps it when the key is absent, and clears it when empty', async () => {
    await asUser(USERS.manager, async (sql) => {
      const { pcs, unit } = await baseUnit(sql);
      const first = await save(sql, { sku: SKU, name_en: 'Pipe 1/2', name_ar: 'ماسورة', base_unit_id: pcs, variant_group: 'PVC-PIPE' }, [unit]);
      const kept = await save(sql, { id: first.id, sku: SKU, name_en: 'Pipe 1/2', name_ar: 'ماسورة', base_unit_id: pcs }, [unit], first.row_version);
      expect((await sql('select variant_group from public.products where id = $1', [first.id])).rows[0].variant_group).toBe('PVC-PIPE');
      await save(sql, { id: first.id, sku: SKU, name_en: 'Pipe 1/2', name_ar: 'ماسورة', base_unit_id: pcs, variant_group: '' }, [unit], kept.row_version);
      expect((await sql('select variant_group from public.products where id = $1', [first.id])).rows[0].variant_group).toBeNull();
    });
  });
});

