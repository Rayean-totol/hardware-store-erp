import { describe, expect, it } from 'vitest';
import { validateProductDraft, type ProductDraft } from '../src';
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
