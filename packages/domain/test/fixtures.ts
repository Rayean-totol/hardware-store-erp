import { unitCatalog, type UnitDef } from '../src';

export const U = {
  pcs: { id: '10000000-0000-4000-8000-000000000001', code: 'pcs', dimension: 'count', ratioToDimensionBase: '1', allowFraction: false, decimalPlaces: 0 },
  dozen: { id: '10000000-0000-4000-8000-000000000002', code: 'dozen', dimension: 'count', ratioToDimensionBase: '12', allowFraction: false, decimalPlaces: 0 },
  box: { id: '10000000-0000-4000-8000-000000000003', code: 'box', dimension: 'count', ratioToDimensionBase: null, allowFraction: false, decimalPlaces: 0 },
  m: { id: '10000000-0000-4000-8000-000000000004', code: 'm', dimension: 'length', ratioToDimensionBase: '1', allowFraction: true, decimalPlaces: 3 },
  cm: { id: '10000000-0000-4000-8000-000000000005', code: 'cm', dimension: 'length', ratioToDimensionBase: '0.01', allowFraction: true, decimalPlaces: 2 },
  ft: { id: '10000000-0000-4000-8000-000000000006', code: 'ft', dimension: 'length', ratioToDimensionBase: '0.3048', allowFraction: true, decimalPlaces: 3 },
  roll: { id: '10000000-0000-4000-8000-000000000007', code: 'roll', dimension: 'count', ratioToDimensionBase: null, allowFraction: false, decimalPlaces: 0 },
  kg: { id: '10000000-0000-4000-8000-000000000008', code: 'kg', dimension: 'mass', ratioToDimensionBase: '1', allowFraction: true, decimalPlaces: 3 },
} satisfies Record<string, UnitDef>;

export const catalog = unitCatalog(Object.values(U));
export const ORG = '20000000-0000-4000-8000-000000000001';
