import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { planProductImport, type ProductCsvLookups, type UnitDef } from '@erp/domain';
import { describe, expect, it } from 'vitest';

/** The demo file as the app's importer plans it: no database needed. */
const ROOT = resolve(import.meta.dirname, '../../../..');
const csv = readFileSync(join(ROOT, 'docs/demo-products/demo-products.csv'), 'utf8');
const ORG = '20000000-0000-4000-8000-000000000001';

const UNITS: Array<UnitDef & { id: string }> = [
  { id: '10000000-0000-4000-8000-000000000001', code: 'pcs', dimension: 'count', ratioToDimensionBase: '1', allowFraction: false, decimalPlaces: 0 },
  { id: '10000000-0000-4000-8000-000000000004', code: 'm', dimension: 'length', ratioToDimensionBase: '1', allowFraction: true, decimalPlaces: 3 },
  { id: '10000000-0000-4000-8000-000000000101', code: 'bag', dimension: 'count', ratioToDimensionBase: null, allowFraction: false, decimalPlaces: 0 },
  { id: '10000000-0000-4000-8000-000000000102', code: 'bucket', dimension: 'count', ratioToDimensionBase: null, allowFraction: false, decimalPlaces: 0 },
];
const CATEGORIES = ['Plumbing', 'Electrical', 'Cables & wires', 'Building materials', 'Hand tools', 'Bolts & nuts'];
const categoryIds = new Map(CATEGORIES.map((c, i) => [c.toLowerCase(), `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));

const lookups = (existing: string[] = []): ProductCsvLookups => ({
  unitsByCode: new Map(UNITS.map((u) => [u.code, u])),
  categoryIdByName: categoryIds,
  brandIdByName: new Map(),
  existingBySku: new Map(existing.map((sku, i) => [sku, { id: `50000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, rowVersion: 1 }])),
});

const EXPECTED = [
  ['DEMO-PVC-PIPE', 'PVC Pipe (DEMO)', 'Plumbing', 'm', '12'],
  ['DEMO-PVC-ELBOW', 'PVC Elbow (DEMO)', 'Plumbing', 'pcs', '3'],
  ['DEMO-LED-BULB', 'LED Bulb (DEMO)', 'Electrical', 'pcs', '8'],
  ['DEMO-ELEC-CABLE', 'Electrical Cable (DEMO)', 'Cables & wires', 'm', '45'],
  ['DEMO-CEMENT-BAG', 'Cement Bag (DEMO)', 'Building materials', 'bag', '18'],
  ['DEMO-HAMMER', 'Hammer (DEMO)', 'Hand tools', 'pcs', '15'],
  ['DEMO-ADJ-WRENCH', 'Adjustable Wrench (DEMO)', 'Hand tools', 'pcs', '22'],
  ['DEMO-MEAS-TAPE', 'Measuring Tape (DEMO)', 'Hand tools', 'pcs', '10'],
  ['DEMO-BOLT-NUT', 'Bolt & Nut (DEMO)', 'Bolts & nuts', 'pcs', '2'],
  ['DEMO-PL-BUCKET', 'Plastic Bucket (DEMO)', 'Building materials', 'bucket', '9'],
] as const;

describe('demo products file (planned by the app importer)', () => {
  it('plans exactly the ten demo products as creates, with no issues', () => {
    const plan = planProductImport(csv, ORG, lookups());
    expect(plan.fatal).toEqual([]);
    expect(plan.products.flatMap((p) => p.issues)).toEqual([]);
    expect(plan.counts).toEqual({ create: 10, update: 0, invalid: 0 });
    expect(plan.products.map((p) => p.sku)).toEqual(EXPECTED.map(([sku]) => sku));
  });

  it('uses the agreed names, categories, units and SAR prices', () => {
    const plan = planProductImport(csv, ORG, lookups());
    for (const [sku, nameEn, category, unitCode, price] of EXPECTED) {
      const p = plan.products.find((x) => x.sku === sku)!;
      expect(p.draft?.nameEn, sku).toBe(nameEn);
      expect(p.draft?.categoryId, sku).toBe(categoryIds.get(category.toLowerCase()));
      const base = p.draft!.units.find((u) => u.isBase)!;
      expect(UNITS.find((u) => u.id === base.unitId)?.code, sku).toBe(unitCode);
      expect(base.salePrice, sku).toBe(price);
    }
  });

  it('marks every product as DEMO in English and Arabic, and every SKU starts with DEMO-', () => {
    const plan = planProductImport(csv, ORG, lookups());
    for (const p of plan.products) {
      expect(p.sku.startsWith('DEMO-'), p.sku).toBe(true);
      expect(p.draft!.nameEn, p.sku).toContain('(DEMO)');
      expect(p.draft!.nameAr, p.sku).toContain('(تجريبي)');
    }
  });

  it('is repeatable: when the demo SKUs already exist, every row is an update, never a duplicate', () => {
    const plan = planProductImport(csv, ORG, lookups(EXPECTED.map(([sku]) => sku)));
    expect(plan.counts).toEqual({ create: 0, update: 10, invalid: 0 });
  });
});
