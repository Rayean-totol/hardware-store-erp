import { describe, expect, it } from 'vitest';
import {
  breakdownQuantity,
  convertQuantity,
  fromBaseQuantity,
  suggestFactor,
  suggestUnitPrice,
  toBaseQuantity,
  validateProductUnits,
  validateQuantity,
  type ProductUnitDef,
} from '../src';
import { catalog, U } from './fixtures';

const pu = (unitId: string, factor: string, isBase = false, extra: Partial<ProductUnitDef> = {}): ProductUnitDef => ({
  unitId, factor, isBase, isSaleUnit: true, isPurchaseUnit: true, ...extra,
});

const screws = [pu(U.pcs.id, '1', true), pu(U.box.id, '200'), pu(U.dozen.id, '12')];
const cable = [pu(U.m.id, '1', true), pu(U.roll.id, '100'), pu(U.cm.id, '0.01'), pu(U.ft.id, '0.3048')];

describe('validateProductUnits', () => {
  it('accepts a valid multi-unit product', () => {
    expect(validateProductUnits(screws, U.pcs.id, catalog)).toEqual([]);
    expect(validateProductUnits(cable, U.m.id, catalog)).toEqual([]);
  });

  it('requires at least one unit', () => {
    expect(validateProductUnits([], U.pcs.id, catalog)).toEqual([{ code: 'units.required' }]);
  });

  it('requires exactly one base unit matching the product base unit', () => {
    expect(validateProductUnits([pu(U.pcs.id, '1'), pu(U.box.id, '10')], U.pcs.id, catalog))
      .toContainEqual({ code: 'units.base_count' });
    expect(validateProductUnits([pu(U.pcs.id, '1', true), pu(U.box.id, '1', true)], U.pcs.id, catalog))
      .toContainEqual({ code: 'units.base_count' });
    expect(validateProductUnits([pu(U.box.id, '1', true)], U.pcs.id, catalog))
      .toContainEqual({ code: 'units.base_mismatch' });
  });

  it('base factor must be 1', () => {
    expect(validateProductUnits([pu(U.pcs.id, '2', true)], U.pcs.id, catalog))
      .toContainEqual({ code: 'units.base_factor', index: 0 });
  });

  it('rejects zero, negative, garbage and over-precise factors', () => {
    const issues = validateProductUnits(
      [pu(U.m.id, '1', true), pu(U.roll.id, '0'), pu(U.cm.id, '-1'), pu(U.ft.id, 'abc'), pu(U.box.id, '0.1234567')],
      U.m.id,
      catalog,
    );
    expect(issues).toContainEqual({ code: 'units.factor_positive', index: 1 });
    expect(issues).toContainEqual({ code: 'units.factor_positive', index: 2 });
    expect(issues).toContainEqual({ code: 'units.factor_invalid', index: 3 });
    expect(issues).toContainEqual({ code: 'units.factor_precision', index: 4 });
  });

  it('rejects fractional factors when the base unit is indivisible (box of 12.5 pcs)', () => {
    expect(validateProductUnits([pu(U.pcs.id, '1', true), pu(U.box.id, '12.5')], U.pcs.id, catalog))
      .toContainEqual({ code: 'units.factor_whole', index: 1 });
  });

  it('detects duplicate and unknown units', () => {
    const issues = validateProductUnits(
      [pu(U.pcs.id, '1', true), pu(U.pcs.id, '1'), pu('99999999-0000-4000-8000-000000000000', '5')],
      U.pcs.id,
      catalog,
    );
    expect(issues).toContainEqual({ code: 'units.duplicate', index: 1 });
    expect(issues).toContainEqual({ code: 'units.unknown', index: 2 });
  });

  it('requires at least one sale unit', () => {
    expect(validateProductUnits([pu(U.pcs.id, '1', true, { isSaleUnit: false })], U.pcs.id, catalog))
      .toContainEqual({ code: 'units.no_sale_unit' });
  });
});

describe('quantity conversion', () => {
  it('converts to and from base units', () => {
    expect(toBaseQuantity('3', U.box.id, screws).toString()).toBe('600');
    expect(fromBaseQuantity('600', U.box.id, screws).toString()).toBe('3');
    expect(convertQuantity('2', U.box.id, U.dozen.id, screws).toDecimalPlaces(6).toString()).toBe('33.333333');
    expect(convertQuantity('1', U.roll.id, U.ft.id, cable).toDecimalPlaces(3).toString()).toBe('328.084');
    expect(convertQuantity('250', U.cm.id, U.m.id, cable).toString()).toBe('2.5');
  });

  it('throws for a unit that is not configured on the product', () => {
    expect(() => toBaseQuantity('1', U.kg.id, screws)).toThrow(RangeError);
  });

  it('breaks base quantities down into packs', () => {
    const result = breakdownQuantity('430', screws).map((r) => [r.unitId, r.quantity.toString()]);
    expect(result).toEqual([[U.box.id, '2'], [U.dozen.id, '2'], [U.pcs.id, '6']]);
    expect(breakdownQuantity('0', screws).map((r) => r.quantity.toString())).toEqual(['0']);
    expect(breakdownQuantity('-201', screws).map((r) => r.quantity.toString())).toEqual(['-1', '-1']);
    // fractional base unit: 250.5 m of cable = 2 rolls + 50.5 m
    expect(breakdownQuantity('250.5', cable).map((r) => r.quantity.toString())).toEqual(['2', '50.5']);
  });
});

describe('validateQuantity', () => {
  it('enforces fraction and precision rules per unit', () => {
    expect(validateQuantity('3', U.pcs)).toBeNull();
    expect(validateQuantity('1.5', U.pcs)).toBe('fraction_not_allowed');
    expect(validateQuantity('1.5', U.m)).toBeNull();
    expect(validateQuantity('1.2345', U.m)).toBe('too_many_decimals');
    expect(validateQuantity('0', U.m)).toBe('not_positive');
    expect(validateQuantity('x', U.m)).toBe('invalid');
  });
});

describe('suggestions', () => {
  it('suggests standard factors within a dimension', () => {
    expect(suggestFactor(U.cm, U.m)).toBe('0.01');
    expect(suggestFactor(U.ft, U.m)).toBe('0.3048');
    expect(suggestFactor(U.m, U.cm)).toBe('100');
    expect(suggestFactor(U.dozen, U.pcs)).toBe('12');
  });
  it('returns null for packaging units and cross-dimension pairs', () => {
    expect(suggestFactor(U.box, U.pcs)).toBeNull();
    expect(suggestFactor(U.kg, U.m)).toBeNull();
  });
  it('suggests pack prices', () => {
    expect(suggestUnitPrice('0.15', '200').toString()).toBe('30');
  });
});
