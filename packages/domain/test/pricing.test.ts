import { describe, expect, it } from 'vitest';
import { resolveSalePrice, validatePriceTiers, type PriceTier } from '../src';

const PCS = 'u-pcs';
const BOX = 'u-box';
const base = [
  { unitId: PCS, salePrice: '0.20' },
  { unitId: BOX, salePrice: '18.00' },
];
const tiers: PriceTier[] = [
  { unitId: PCS, level: 'retail', minQuantity: '100', price: '0.18' },
  { unitId: PCS, level: 'wholesale', minQuantity: '1', price: '0.17' },
  { unitId: PCS, level: 'wholesale', minQuantity: '1000', price: '0.15' },
  { unitId: BOX, level: 'trade', minQuantity: '10', price: '16.50' },
];

describe('resolveSalePrice', () => {
  it('uses the base retail price when no tier applies', () => {
    expect(resolveSalePrice({ unitId: PCS, quantity: 5, level: 'retail', tiers, basePrices: base })?.toString()).toBe('0.2');
  });
  it('applies retail quantity breaks', () => {
    expect(resolveSalePrice({ unitId: PCS, quantity: 100, level: 'retail', tiers, basePrices: base })?.toString()).toBe('0.18');
  });
  it('uses the highest wholesale break reached', () => {
    expect(resolveSalePrice({ unitId: PCS, quantity: 999, level: 'wholesale', tiers, basePrices: base })?.toString()).toBe('0.17');
    expect(resolveSalePrice({ unitId: PCS, quantity: 1000, level: 'wholesale', tiers, basePrices: base })?.toString()).toBe('0.15');
  });
  it('falls back from a missing level to the retail tier, then to the base price', () => {
    expect(resolveSalePrice({ unitId: BOX, quantity: 3, level: 'trade', tiers, basePrices: base })?.toString()).toBe('18');
    expect(resolveSalePrice({ unitId: BOX, quantity: 10, level: 'trade', tiers, basePrices: base })?.toString()).toBe('16.5');
  });
  it('returns null when a unit has no price at all', () => {
    expect(resolveSalePrice({ unitId: 'other', quantity: 1, level: 'retail', tiers, basePrices: base })).toBeNull();
  });
});

describe('validatePriceTiers', () => {
  const units = new Set([PCS, BOX]);
  it('accepts a sound tier set', () => {
    expect(validatePriceTiers(tiers, units)).toEqual([]);
  });
  it('flags bad prices, quantities, duplicates and foreign units', () => {
    const issues = validatePriceTiers(
      [
        { unitId: PCS, level: 'wholesale', minQuantity: '0', price: '1' },
        { unitId: PCS, level: 'wholesale', minQuantity: '5', price: '-1' },
        { unitId: PCS, level: 'wholesale', minQuantity: '5', price: 'abc' },
        { unitId: PCS, level: 'retail', minQuantity: '5', price: '1' },
        { unitId: PCS, level: 'retail', minQuantity: '5.0', price: '1' },
        { unitId: 'x', level: 'retail', minQuantity: '1', price: '1' },
      ],
      units,
    );
    const codes = issues.map((i) => `${i.index}:${i.code}`);
    expect(codes).toContain('0:price.min_quantity');
    expect(codes).toContain('1:price.negative');
    expect(codes).toContain('2:price.invalid');
    expect(codes).toContain('4:price.duplicate');
    expect(codes).toContain('5:price.unit');
  });
});
