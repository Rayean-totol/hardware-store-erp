import { describe, expect, it } from 'vitest';
import { planProductImport, type ProductCsvLookups, type UnitDef } from '../src';
import { ORG, U } from './fixtures';

const units: Array<UnitDef & { id: string }> = Object.entries(U).map(([code, u]) => ({ ...u, code }));
const HEADER = 'sku,name_en,name_ar,name_bn,description,category,brand,product_type,base_unit,tax_category,tax_exemption_reason,reorder_level,unit,factor,barcode,sale_price,is_sale,is_purchase';
const lookups = (extra: Partial<ProductCsvLookups> = {}): ProductCsvLookups => ({
  unitsByCode: new Map(units.map((u) => [u.code, u])),
  categoryIdByName: new Map([['fasteners', '30000000-0000-4000-8000-000000000001']]),
  brandIdByName: new Map(),
  existingBySku: new Map(),
  ...extra,
});
const row = (sku: string, barcode: string, name = 'Item', category = '') =>
  `${sku},${name},صنف,,,${category},,stock,pcs,S,,,pcs,1,${barcode},5,yes,yes`;
const issuesOf = (plan: ReturnType<typeof planProductImport>, sku: string) =>
  plan.products.find((p) => p.sku === sku)!.issues.map((i) => i.code);

describe('import safety: duplicate barcodes', () => {
  it('flags every row whose barcode is used by another SKU in the same file', () => {
    const plan = planProductImport([HEADER, row('A-1', '2000000100012'), row('B-2', '2000000100012')].join('\n'), ORG, lookups());
    expect(issuesOf(plan, 'A-1')).toContain('import.duplicate_barcode');
    expect(issuesOf(plan, 'B-2')).toContain('import.duplicate_barcode');
    expect(plan.counts.invalid).toBe(2);
  });

  it('flags a barcode that an existing product (another SKU) already uses', () => {
    const plan = planProductImport([HEADER, row('NEW-1', '2000000100012')].join('\n'), ORG,
      lookups({ existingBarcodes: new Map([['2000000100012', 'OLD-9']]) }));
    expect(issuesOf(plan, 'NEW-1')).toContain('import.duplicate_barcode');
    expect(plan.counts.invalid).toBe(1);
  });

  it('does not flag a product re-importing its own barcode (an update of the same SKU)', () => {
    const plan = planProductImport([HEADER, row('OLD-9', '2000000100012')].join('\n'), ORG,
      lookups({ existingBarcodes: new Map([['2000000100012', 'OLD-9']]), existingBySku: new Map([['OLD-9', { id: 'x', rowVersion: 1 }]]) }));
    expect(plan.counts).toEqual({ create: 0, update: 1, invalid: 0 });
  });

  it('a product without a barcode is never flagged', () => {
    const plan = planProductImport([HEADER, row('A-1', ''), row('B-2', '')].join('\n'), ORG,
      lookups({ existingBarcodes: new Map([['2000000100012', 'OLD-9']]) }));
    expect(plan.counts).toEqual({ create: 2, update: 0, invalid: 0 });
  });
});

describe('import safety: rows that repeat a SKU', () => {
  it('accepts repeated rows of one product that agree on name and category (one row per unit)', () => {
    const plan = planProductImport([HEADER,
      'MULTI-1,Bag,كيس,,,Fasteners,,stock,pcs,S,,,pcs,1,,5,yes,yes',
      'MULTI-1,Bag,كيس,,,Fasteners,,stock,pcs,S,,,box,12,,50,yes,yes'].join('\n'), ORG, lookups());
    expect(plan.counts).toEqual({ create: 1, update: 0, invalid: 0 });
  });

  it('flags repeated rows that disagree on the English name', () => {
    const plan = planProductImport([HEADER,
      'CONF-1,Bag,كيس,,,Fasteners,,stock,pcs,S,,,pcs,1,,5,yes,yes',
      'CONF-1,Sack,كيس,,,Fasteners,,stock,pcs,S,,,box,12,,50,yes,yes'].join('\n'), ORG, lookups());
    expect(issuesOf(plan, 'CONF-1')).toContain('import.sku_conflict');
    expect(plan.counts.invalid).toBe(1);
  });
});
