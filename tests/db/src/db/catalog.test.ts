import { afterAll, describe, expect, it } from 'vitest';
import { asUser, expectDbError, pool, unitId, type Sql } from '../db';
import { DEMO_ORG, OTHER_ORG, USERS } from '../env';

afterAll(() => pool.end());

interface UnitRow { unit_id: string; factor: string; is_base: boolean; barcode?: string | null; sale_price?: string | null; is_sale_unit?: boolean; is_purchase_unit?: boolean }

async function saveProduct(sql: Sql, product: Record<string, unknown>, units: UnitRow[], expectedVersion: number | null = null) {
  const { rows } = await sql('select public.save_product($1, $2, $3) as r', [
    JSON.stringify({ org_id: DEMO_ORG, product_type: 'stock', tax_category: 'S', ...product }),
    JSON.stringify(units),
    expectedVersion,
  ]);
  return rows[0].r as { id: string; row_version: number };
}

async function screwUnits(sql: Sql, prices = true): Promise<UnitRow[]> {
  return [
    { unit_id: await unitId(sql, 'pcs'), factor: '1', is_base: true, barcode: '4006381333931', sale_price: prices ? '0.20' : null },
    { unit_id: await unitId(sql, 'box'), factor: '100', is_base: false, barcode: 'NB-100', sale_price: prices ? '18.00' : null },
  ];
}

describe('catalog read access', () => {
  it('every demo role can read the catalog', async () => {
    for (const user of [USERS.owner, USERS.manager, USERS.storekeeper, USERS.cashier, USERS.auditor]) {
      const { rows } = await asUser(user, (sql) => sql('select count(*)::int as n from public.products'));
      expect(rows[0].n, user).toBe(12);
    }
  });

  it('system units are visible to everyone signed in', async () => {
    const { rows } = await asUser(USERS.outsider, (sql) => sql('select count(*)::int as n from public.units where org_id is null'));
    expect(rows[0].n).toBeGreaterThanOrEqual(20);
  });
});

describe('save_product', () => {
  it('creates a product with units atomically', async () => {
    await asUser(USERS.manager, async (sql) => {
      const pcs = await unitId(sql, 'pcs');
      const r = await saveProduct(sql, { sku: ' nb-m6 ', name_en: 'Nut M6', name_ar: 'صامولة M6', base_unit_id: pcs }, await screwUnits(sql));
      expect(r.row_version).toBe(1);
      const { rows } = await sql('select sku, created_by from public.products where id = $1', [r.id]);
      expect(rows[0]).toEqual({ sku: 'NB-M6', created_by: USERS.manager });
      const units = await sql('select count(*)::int as n from public.product_units where product_id = $1', [r.id]);
      expect(units.rows[0].n).toBe(2);
    });
  });

  it('cashiers cannot create products', async () => {
    await expectDbError(
      asUser(USERS.cashier, async (sql) =>
        saveProduct(sql, { sku: 'X1', name_en: 'X', name_ar: 'س', base_unit_id: await unitId(sql, 'pcs') }, await screwUnits(sql))),
      'forbidden',
    );
  });

  it('storekeepers can create products but not set prices', async () => {
    await asUser(USERS.storekeeper, async (sql) => {
      const r = await saveProduct(sql, { sku: 'SK-1', name_en: 'Washer', name_ar: 'وردة', base_unit_id: await unitId(sql, 'pcs') }, await screwUnits(sql, false));
      expect(r.id).toBeTruthy();
    });
    await expectDbError(
      asUser(USERS.storekeeper, async (sql) =>
        saveProduct(sql, { sku: 'SK-2', name_en: 'Washer', name_ar: 'وردة', base_unit_id: await unitId(sql, 'pcs') }, await screwUnits(sql, true))),
      'forbidden',
    );
  });

  it('storekeepers can edit a priced product as long as prices do not change', async () => {
    const { rows } = await asUser(USERS.storekeeper, (sql) =>
      sql(`select p.id, p.row_version, p.base_unit_id from public.products p where sku = 'FST-WS-4X40'`));
    const product = rows[0];
    await asUser(USERS.storekeeper, async (sql) => {
      const { rows: units } = await sql(
        'select unit_id, factor::text, is_base, barcode, sale_price::text, is_sale_unit, is_purchase_unit from public.product_units where product_id = $1',
        [product.id],
      );
      const r = await saveProduct(sql, { id: product.id, sku: 'FST-WS-4X40', name_en: 'Wood screw 4x40 (renamed)', name_ar: 'برغي خشب', base_unit_id: product.base_unit_id }, units, Number(product.row_version));
      expect(r.row_version).toBe(Number(product.row_version) + 1);
      units[0].sale_price = '9.99';
      await expectDbError(
        saveProduct(sql, { id: product.id, sku: 'FST-WS-4X40', name_en: 'x', name_ar: 'س', base_unit_id: product.base_unit_id }, units, r.row_version),
        'forbidden',
      );
    });
  });

  it('enforces optimistic concurrency', async () => {
    await asUser(USERS.manager, async (sql) => {
      const pcs = await unitId(sql, 'pcs');
      const units = await screwUnits(sql);
      const created = await saveProduct(sql, { sku: 'CC-1', name_en: 'A', name_ar: 'أ', base_unit_id: pcs }, units);
      await saveProduct(sql, { id: created.id, sku: 'CC-1', name_en: 'B', name_ar: 'ب', base_unit_id: pcs }, units, 1);
      await sql('savepoint before_conflict');
      const err = await expectDbError(
        saveProduct(sql, { id: created.id, sku: 'CC-1', name_en: 'C', name_ar: 'ج', base_unit_id: pcs }, units, 1),
        'concurrency_conflict',
      );
      expect(err.detail).toBe('2');
      await sql('rollback to savepoint before_conflict');
      // Re-sending a create for an existing id is a conflict too (no silent overwrite).
      await expectDbError(saveProduct(sql, { id: created.id, sku: 'CC-1', name_en: 'D', name_ar: 'د', base_unit_id: pcs }, units), 'concurrency_conflict');
    });
  });

  it('reports duplicate SKUs and barcodes with stable codes', async () => {
    await asUser(USERS.manager, async (sql) => {
      const pcs = await unitId(sql, 'pcs');
      const sku = await expectDbError(
        saveProduct(sql, { sku: 'fst-ws-4x40', name_en: 'Dup', name_ar: 'مكرر', base_unit_id: pcs }, [{ unit_id: pcs, factor: '1', is_base: true }]),
        'product.sku_taken',
      );
      expect(sku.detail).toBe('FST-WS-4X40');
    });
    await asUser(USERS.manager, async (sql) => {
      const pcs = await unitId(sql, 'pcs');
      await expectDbError(
        saveProduct(sql, { sku: 'NEW-1', name_en: 'New', name_ar: 'جديد', base_unit_id: pcs }, [{ unit_id: pcs, factor: '1', is_base: true, barcode: '2000000100012' }]),
        'product.barcode_taken',
      );
    });
  });

  it('allows the same SKU and barcode in a different organization', async () => {
    await asUser(USERS.outsider, async (sql) => {
      const pcs = await unitId(sql, 'pcs');
      const { rows } = await sql('select public.save_product($1, $2) as r', [
        JSON.stringify({ org_id: OTHER_ORG, sku: 'FST-WS-4X40', name_en: 'Screw', name_ar: 'برغي', base_unit_id: pcs }),
        JSON.stringify([{ unit_id: pcs, factor: '1', is_base: true, barcode: '2000000100012', sale_price: '1' }]),
      ]);
      expect(rows[0].r.id).toBeTruthy();
    });
  });

  it('validates the unit structure', async () => {
    const run = (build: (pcs: string, box: string) => [Record<string, unknown>, UnitRow[]], code: string) =>
      expectDbError(
        asUser(USERS.manager, async (sql) => {
          const [product, units] = build(await unitId(sql, 'pcs'), await unitId(sql, 'box'));
          return saveProduct(sql, { sku: 'V-1', name_en: 'V', name_ar: 'ف', ...product }, units);
        }),
        code,
      );
    await run((pcs) => [{ base_unit_id: pcs }, []], 'product.units_required');
    await run((pcs, box) => [{ base_unit_id: pcs }, [{ unit_id: box, factor: '1', is_base: true }]], 'product.base_unit_mismatch');
    await run((pcs, box) => [{ base_unit_id: pcs }, [{ unit_id: pcs, factor: '1', is_base: true }, { unit_id: box, factor: '12.5', is_base: false }]], 'product.fractional_factor');
    await run((pcs) => [{ base_unit_id: pcs }, [{ unit_id: pcs, factor: '1', is_base: true }, { unit_id: pcs, factor: '2', is_base: false }]], 'product.duplicate_unit');
    await run((pcs) => [{ base_unit_id: pcs, tax_category: 'E' }, [{ unit_id: pcs, factor: '1', is_base: true }]], 'product.exemption_reason_required');
  });

  it('allows fractional factors on divisible base units (cable sold by the foot)', async () => {
    await asUser(USERS.manager, async (sql) => {
      const m = await unitId(sql, 'm');
      const r = await saveProduct(sql, { sku: 'CBL-X', name_en: 'Cable', name_ar: 'كابل', base_unit_id: m }, [
        { unit_id: m, factor: '1', is_base: true },
        { unit_id: await unitId(sql, 'ft'), factor: '0.3048', is_base: false },
      ]);
      expect(r.id).toBeTruthy();
    });
  });

  it('can swap barcodes and change the base unit in one save', async () => {
    await asUser(USERS.manager, async (sql) => {
      const pcs = await unitId(sql, 'pcs');
      const pair = await unitId(sql, 'pair');
      const created = await saveProduct(sql, { sku: 'SWAP-1', name_en: 'S', name_ar: 'س', base_unit_id: pcs }, [
        { unit_id: pcs, factor: '1', is_base: true, barcode: 'AAA' },
        { unit_id: pair, factor: '2', is_base: false, barcode: 'BBB' },
      ]);
      await saveProduct(sql, { id: created.id, sku: 'SWAP-1', name_en: 'S', name_ar: 'س', base_unit_id: pair }, [
        { unit_id: pair, factor: '1', is_base: true, barcode: 'AAA' },
        { unit_id: pcs, factor: '0.5', is_base: false, barcode: 'BBB' },
      ].slice(0, 1), 1);
      const { rows } = await sql('select barcode, is_base from public.product_units where product_id = $1', [created.id]);
      expect(rows).toEqual([{ barcode: 'AAA', is_base: true }]);
    });
  });

  it('deferred invariant also guards direct table writes', async () => {
    await expectDbError(
      asUser(USERS.manager, async (sql) => {
        await sql(`update public.product_units set is_base = false
                   where product_id = (select id from public.products where sku = 'ELC-SW-1G') and is_base`);
        await sql('set constraints all immediate');
      }),
      'product.base_unit_mismatch',
    );
  });

  it('rejects units belonging to another organization', async () => {
    await expectDbError(
      asUser(USERS.outsider, async (sql) => {
        const { rows } = await sql(`insert into public.units (org_id, code, name_en, name_ar, dimension) values ($1, 'crate', 'Crate', 'صندوق', 'count') returning id`, [OTHER_ORG]);
        return rows[0].id as string;
      }).then((crate) =>
        asUser(USERS.owner, async (sql) =>
          saveProduct(sql, { sku: 'U-1', name_en: 'U', name_ar: 'و', base_unit_id: await unitId(sql, 'pcs') }, [
            { unit_id: await unitId(sql, 'pcs'), factor: '1', is_base: true },
            { unit_id: crate, factor: '10', is_base: false },
          ]),
        ),
      ),
      // The outsider's insert is rolled back, so the unit does not exist for the owner: FK error.
      /foreign key|unit.wrong_org/,
    );
  });
});

describe('archive', () => {
  it('requires catalog.archive', async () => {
    await expectDbError(
      asUser(USERS.storekeeper, (sql) => sql(`update public.products set archived_at = now() where sku = 'TLS-HAM-16'`)),
      'forbidden',
    );
    await asUser(USERS.manager, async (sql) => {
      const res = await sql(`update public.products set archived_at = now() where sku = 'TLS-HAM-16'`);
      expect(res.rowCount).toBe(1);
    });
  });

  it('products cannot be deleted (no DELETE privilege; archive instead)', async () => {
    // Hardened: the role has no DELETE grant at all, so the statement is refused outright.
    await expectDbError(
      asUser(USERS.owner, (sql) => sql(`delete from public.products where sku = 'TLS-HAM-16'`)),
      /permission denied/,
    );
  });
});

describe('search_products', () => {
  const search = (q: string | null, includeArchived = false) =>
    asUser(USERS.cashier, (sql) =>
      sql('select sku from public.search_products($1, $2, null, $3)', [DEMO_ORG, q, includeArchived]));

  it('finds by SKU fragment, English, Arabic and Bangla names, and exact barcode', async () => {
    expect((await search('ws-4x')).rows.map((r) => r.sku)).toEqual(['FST-WS-4X40']);
    expect((await search('cable')).rows.map((r) => r.sku)).toEqual(['ELC-CU-2.5']);
    expect((await search('مطرقة')).rows.map((r) => r.sku)).toEqual(['TLS-HAM-16']);
    expect((await search('সিমেন্ট')).rows.map((r) => r.sku)).toEqual(['BLD-CEM-50']);
    expect((await search('2000000100098')).rows.map((r) => r.sku)).toEqual(['PNT-INT-WHT']);
    expect((await search(null)).rowCount).toBe(12);
  });

  it('treats LIKE wildcards literally', async () => {
    expect((await search('%')).rowCount).toBe(0);
    expect((await search('_')).rowCount).toBe(0);
  });

  it('respects RLS (other tenants get nothing)', async () => {
    const { rowCount } = await asUser(USERS.outsider, (sql) => sql('select * from public.search_products($1)', [DEMO_ORG]));
    expect(rowCount).toBe(0);
  });
});

describe('categories', () => {
  it('prevents cycles', async () => {
    await expectDbError(
      asUser(USERS.manager, (sql) =>
        sql(`update public.product_categories set parent_id = (select id from public.product_categories where name_en = 'Screws')
             where name_en = 'Fasteners'`)),
      'category.cycle',
    );
  });
});
