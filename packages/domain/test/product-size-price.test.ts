import { describe, expect, it } from 'vitest';
import { planProductImport, validateProductDraft, type ProductDraft } from '../src';
import { catalog, ORG, U } from './fixtures';

const base = (overrides: Partial<ProductDraft> = {}, unitOverrides: Record<string, unknown> = {}): ProductDraft => ({
  orgId: ORG,
  sku: 'SIZE-1',
  nameEn: 'Size item',
  nameAr: 'صنف',
  productType: 'stock',
  baseUnitId: U.pcs.id,
  taxCategory: 'S',
  units: [{ unitId: U.pcs.id, factor: '1', isBase: true, salePrice: '10', isSaleUnit: true, isPurchaseUnit: true, ...unitOverrides }],
  ...overrides,
});

describe('product size', () => {
  it('trims a size and keeps it', () => {
    const r = validateProductDraft(base({ sizeLabel: '  1/2 inch ' }), catalog);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sizeLabel).toBe('1/2 inch');
  });

  it('leaves an absent size absent (so saving never clears a stored size by accident)', () => {
    const r = validateProductDraft(base(), catalog);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sizeLabel).toBeUndefined();
  });

  it('an empty size clears it', () => {
    const r = validateProductDraft(base({ sizeLabel: '   ' }), catalog);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sizeLabel).toBeNull();
  });

  it('refuses a size longer than 40 characters', () => {
    const r = validateProductDraft(base({ sizeLabel: 'x'.repeat(41) }), catalog);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain('size_too_long');
  });
});

describe('purchase price', () => {
  it('leaves an absent purchase price absent (a stored cost is not cleared by an unrelated save)', () => {
    const r = validateProductDraft(base(), catalog);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.units[0]!.purchasePrice).toBeUndefined();
  });

  it('accepts a valid purchase price', () => {
    const r = validateProductDraft(base({}, { purchasePrice: '7.25' }), catalog);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.units[0]!.purchasePrice).toBe('7.25');
  });

  it('an empty purchase price is a request to clear it', () => {
    const r = validateProductDraft(base({}, { purchasePrice: '' }), catalog);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.units[0]!.purchasePrice).toBeNull();
  });

  it('refuses a negative purchase price', () => {
    const r = validateProductDraft(base({}, { purchasePrice: '-1' }), catalog);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain('not_negative_number');
  });

  it('refuses more decimals than prices allow', () => {
    const r = validateProductDraft(base({}, { purchasePrice: '1.23456' }), catalog);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain('price_precision');
  });

  it('warns (does not block) when the purchase price is above the selling price', () => {
    const r = validateProductDraft(base({}, { salePrice: '5', purchasePrice: '9' }), catalog);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain('purchase_above_sale');
  });
});

describe('import of size and purchase price (optional CSV columns)', () => {
  const lookups = {
    unitsByCode: new Map(Object.entries(U).map(([code, u]) => [code, { ...u, code }])),
    categoryIdByName: new Map<string, string>(),
    brandIdByName: new Map<string, string>(),
    existingBySku: new Map<string, { id: string; rowVersion: number }>(),
  };
  const HEAD = 'sku,name_en,name_ar,name_bn,description,category,brand,product_type,base_unit,tax_category,tax_exemption_reason,reorder_level,unit,factor,barcode,sale_price,is_sale,is_purchase';

  it('reads size and purchase price when the file has those columns', () => {
    const csv = [`${HEAD},size,purchase_price`, 'SZ-1,Size one,صنف,,,,,stock,pcs,S,,,pcs,1,,10,yes,yes,50 kg,6.5'].join('\n');
    const plan = planProductImport(csv, ORG, lookups);
    expect(plan.counts).toEqual({ create: 1, update: 0, invalid: 0 });
    expect(plan.products[0]!.draft!.sizeLabel).toBe('50 kg');
    expect(plan.products[0]!.draft!.units[0]!.purchasePrice).toBe('6.5');
  });

  it('a blank size or purchase price cell leaves the stored value alone (undefined, not null)', () => {
    const csv = [`${HEAD},size,purchase_price`, 'SZ-2,Size two,صنف,,,,,stock,pcs,S,,,pcs,1,,10,yes,yes,,'].join('\n');
    const plan = planProductImport(csv, ORG, lookups);
    expect(plan.products[0]!.draft!.sizeLabel).toBeUndefined();
    expect(plan.products[0]!.draft!.units[0]!.purchasePrice).toBeUndefined();
  });

  it('a file without these columns plans exactly as before (absent, not cleared)', () => {
    const csv = [HEAD, 'SZ-3,Size three,صنف,,,,,stock,pcs,S,,,pcs,1,,10,yes,yes'].join('\n');
    const plan = planProductImport(csv, ORG, lookups);
    expect(plan.products[0]!.draft!.sizeLabel).toBeUndefined();
    expect(plan.products[0]!.draft!.units[0]!.purchasePrice).toBeUndefined();
  });
});

describe('variant group', () => {
  it('trims and keeps a variant group; absent stays absent; empty clears', () => {
    const kept = validateProductDraft(base({ variantGroup: ' PVC-PIPE ' }), catalog);
    expect(kept.ok && kept.value.variantGroup).toBe('PVC-PIPE');
    const absent = validateProductDraft(base(), catalog);
    expect(absent.ok && absent.value.variantGroup).toBeUndefined();
    const cleared = validateProductDraft(base({ variantGroup: ' ' }), catalog);
    expect(cleared.ok && cleared.value.variantGroup).toBeNull();
  });

  it('refuses a variant group longer than 40 characters', () => {
    const r = validateProductDraft(base({ variantGroup: 'x'.repeat(41) }), catalog);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain('variant_group_too_long');
  });
});
