import { dec, tryDec, type Dec, type Numeric } from './decimal';

export const UNIT_DIMENSIONS = ['count', 'length', 'mass', 'volume', 'area'] as const;
export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

/** A unit of measure (DB: public.units). */
export interface UnitDef {
  id: string;
  code: string;
  dimension: UnitDimension;
  /** Ratio to the dimension's reference unit (cm = 0.01 m). null = packaging unit. */
  ratioToDimensionBase: string | null;
  allowFraction: boolean;
  decimalPlaces: number;
}

/** One unit a product can be bought/sold in (DB: public.product_units). */
export interface ProductUnitDef {
  unitId: string;
  /** Number of base units contained in one of this unit. Decimal string. */
  factor: string;
  isBase: boolean;
  barcode?: string | null;
  salePrice?: string | null;
  /** Purchase (cost) price per unit. undefined = unchanged; null or '' = clear. */
  purchasePrice?: string | null;
  isSaleUnit: boolean;
  isPurchaseUnit: boolean;
}

/** DB column is numeric(18,6). */
export const FACTOR_MAX_DECIMALS = 6;
export const FACTOR_MAX = dec('999999999999');

export type UnitIssueCode =
  | 'units.required'
  | 'units.base_count'
  | 'units.base_mismatch'
  | 'units.base_factor'
  | 'units.factor_invalid'
  | 'units.factor_positive'
  | 'units.factor_precision'
  | 'units.factor_whole'
  | 'units.duplicate'
  | 'units.unknown'
  | 'units.no_sale_unit';

export interface UnitIssue {
  code: UnitIssueCode;
  /** Index into the units array, when the issue concerns one row. */
  index?: number;
}

export type UnitCatalog = ReadonlyMap<string, UnitDef>;

export function unitCatalog(units: Iterable<UnitDef>): UnitCatalog {
  return new Map([...units].map((u) => [u.id, u]));
}

/**
 * Validate a product's unit list. Mirrors the database invariants in
 * migrations/…_catalog.sql so users get immediate (and offline) feedback.
 */
export function validateProductUnits(
  units: readonly ProductUnitDef[],
  baseUnitId: string,
  catalog: UnitCatalog,
): UnitIssue[] {
  const issues: UnitIssue[] = [];
  if (units.length === 0) {
    return [{ code: 'units.required' }];
  }

  const bases = units.filter((u) => u.isBase);
  if (bases.length !== 1) {
    issues.push({ code: 'units.base_count' });
  } else if (bases[0]!.unitId !== baseUnitId) {
    issues.push({ code: 'units.base_mismatch' });
  }

  const baseUnit = catalog.get(baseUnitId);
  const seen = new Set<string>();

  units.forEach((u, index) => {
    if (seen.has(u.unitId)) {
      issues.push({ code: 'units.duplicate', index });
    }
    seen.add(u.unitId);

    if (!catalog.has(u.unitId)) {
      issues.push({ code: 'units.unknown', index });
    }

    const factor = tryDec(u.factor);
    if (!factor) {
      issues.push({ code: 'units.factor_invalid', index });
      return;
    }
    if (factor.lte(0) || factor.gt(FACTOR_MAX)) {
      issues.push({ code: 'units.factor_positive', index });
      return;
    }
    if (factor.decimalPlaces() > FACTOR_MAX_DECIMALS) {
      issues.push({ code: 'units.factor_precision', index });
    }
    if (u.isBase && !factor.eq(1)) {
      issues.push({ code: 'units.base_factor', index });
    }
    if (baseUnit && !baseUnit.allowFraction && !factor.isInteger()) {
      issues.push({ code: 'units.factor_whole', index });
    }
  });

  if (!units.some((u) => u.isSaleUnit)) {
    issues.push({ code: 'units.no_sale_unit' });
  }
  return issues;
}

/**
 * Suggest the factor for `unit` relative to `baseUnit` when both are standard units of the
 * same dimension (e.g. base m, unit cm → 0.01; base pcs, unit dozen → 12). Returns null when
 * the factor is product-specific (box, roll, …) or the dimensions differ.
 */
export function suggestFactor(unit: UnitDef, baseUnit: UnitDef): string | null {
  if (unit.dimension !== baseUnit.dimension) return null;
  if (unit.ratioToDimensionBase === null || baseUnit.ratioToDimensionBase === null) return null;
  return dec(unit.ratioToDimensionBase)
    .dividedBy(dec(baseUnit.ratioToDimensionBase))
    .toDecimalPlaces(FACTOR_MAX_DECIMALS)
    .toString();
}

function findUnit(units: readonly ProductUnitDef[], unitId: string): ProductUnitDef {
  const pu = units.find((u) => u.unitId === unitId);
  if (!pu) {
    throw new RangeError(`Unit ${unitId} is not configured for this product`);
  }
  return pu;
}

/** Quantity in `unitId` → quantity in the product's base unit. */
export function toBaseQuantity(qty: Numeric, unitId: string, units: readonly ProductUnitDef[]): Dec {
  return dec(qty).times(dec(findUnit(units, unitId).factor));
}

/** Quantity in base units → quantity in `unitId` (exact division, not rounded). */
export function fromBaseQuantity(baseQty: Numeric, unitId: string, units: readonly ProductUnitDef[]): Dec {
  return dec(baseQty).dividedBy(dec(findUnit(units, unitId).factor));
}

export function convertQuantity(
  qty: Numeric,
  fromUnitId: string,
  toUnitId: string,
  units: readonly ProductUnitDef[],
): Dec {
  return fromBaseQuantity(toBaseQuantity(qty, fromUnitId, units), toUnitId, units);
}

export type QuantityIssue = 'invalid' | 'not_positive' | 'fraction_not_allowed' | 'too_many_decimals';

/** Validate a quantity typed by a user for a given unit. */
export function validateQuantity(qty: unknown, unit: UnitDef): QuantityIssue | null {
  const d = tryDec(qty);
  if (!d) return 'invalid';
  if (d.lte(0)) return 'not_positive';
  if (!unit.allowFraction && !d.isInteger()) return 'fraction_not_allowed';
  if (d.decimalPlaces() > unit.decimalPlaces) return 'too_many_decimals';
  return null;
}

/**
 * Break a base quantity down into the largest units first, e.g. 230 pcs with a box of
 * 200 → [{box, 1}, {pcs, 30}]. Used for human-friendly stock display.
 * Only units with whole-number factors ≥ 1 are used; any remainder stays in the base unit.
 */
export function breakdownQuantity(
  baseQty: Numeric,
  units: readonly ProductUnitDef[],
): Array<{ unitId: string; quantity: Dec }> {
  let remaining = dec(baseQty);
  const negative = remaining.isNegative();
  remaining = remaining.abs();
  const base = units.find((u) => u.isBase);
  if (!base) throw new RangeError('Product has no base unit');

  const packs = units
    .filter((u) => !u.isBase && dec(u.factor).isInteger() && dec(u.factor).gt(1))
    .sort((a, b) => dec(b.factor).comparedTo(dec(a.factor)));

  const result: Array<{ unitId: string; quantity: Dec }> = [];
  for (const pack of packs) {
    const factor = dec(pack.factor);
    const count = remaining.dividedToIntegerBy(factor);
    if (count.gt(0)) {
      result.push({ unitId: pack.unitId, quantity: negative ? count.negated() : count });
      remaining = remaining.minus(count.times(factor));
    }
  }
  if (remaining.gt(0) || result.length === 0) {
    result.push({ unitId: base.unitId, quantity: negative ? remaining.negated() : remaining });
  }
  return result;
}

/** Price suggestion for a pack: base price × factor (rounded to 4 dp). */
export function suggestUnitPrice(baseUnitPrice: Numeric, factor: Numeric): Dec {
  return dec(baseUnitPrice).times(dec(factor)).toDecimalPlaces(4);
}
