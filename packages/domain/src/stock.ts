import { dec, type Dec, type Numeric } from './decimal';

/**
 * Stock rules shared by the browser (offline projection), the sync engine and tests.
 * The database (apply_stock_movements) implements the SAME rules and is authoritative;
 * tests/db and tests/api compare both implementations on identical scenarios.
 *
 * Costing: weighted moving average, per base unit, rounded to 4 dp (half-up).
 */

export const COST_DECIMALS = 4;

export const MOVEMENT_TYPES = ['stock_in', 'stock_out', 'adjustment'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const RECEIPT_REASONS = ['purchase', 'opening', 'return', 'transfer_in', 'found', 'other'] as const;
export const ADJUSTMENT_REASONS = [
  'count_correction',
  'damage',
  'theft',
  'expired',
  'found',
  'opening',
  'other',
] as const;
export const ALL_REASONS = [
  'purchase', 'opening', 'return', 'transfer_in', 'count_correction',
  'damage', 'theft', 'expired', 'found', 'other',
] as const;
export type StockReason = (typeof ALL_REASONS)[number];

export interface StockState {
  quantity: Dec;
  averageCost: Dec;
}

export type StockWarning = 'negative_stock';

export class StockRuleError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'StockRuleError';
    this.code = code;
  }
}

export function roundCost(value: Numeric): Dec {
  return dec(value).toDecimalPlaces(COST_DECIMALS);
}

/** Cost per BASE unit from a cost per entered unit (e.g. box price ÷ pieces per box). */
export function baseUnitCost(unitCost: Numeric, factor: Numeric): Dec {
  return roundCost(dec(unitCost).dividedBy(dec(factor)));
}

export const EMPTY_STOCK: StockState = { quantity: dec(0), averageCost: dec(0) };

/**
 * Apply a signed base-unit change. Mirrors app.apply_one_stock_movement():
 *  - receipts (change > 0) need a cost; they re-average the cost when stock was positive,
 *    otherwise the receipt cost becomes the average;
 *  - issues (change < 0) are costed at the current average, which does not change;
 *  - going below zero is allowed only when allowNegative is true (offline overdraw).
 */
export function applyStockChange(
  state: StockState,
  change: Numeric,
  unitCostPerBase: Numeric | null,
  options: { allowNegative: boolean },
): { state: StockState; costPerBase: Dec; warnings: StockWarning[] } {
  const c = dec(change);
  if (c.isZero()) throw new StockRuleError('quantity.invalid');

  let averageCost = state.averageCost;
  let costPerBase: Dec;
  if (c.gt(0)) {
    costPerBase = unitCostPerBase === null ? averageCost : roundCost(unitCostPerBase);
    averageCost =
      state.quantity.lte(0)
        ? costPerBase
        : roundCost(state.quantity.times(state.averageCost).plus(c.times(costPerBase)).dividedBy(state.quantity.plus(c)));
  } else {
    costPerBase = state.averageCost;
  }

  const quantity = state.quantity.plus(c);
  const warnings: StockWarning[] = [];
  if (quantity.lt(0)) {
    if (c.lt(0) && !options.allowNegative) {
      throw new StockRuleError('stock.insufficient', state.quantity.toString());
    }
    warnings.push('negative_stock');
  }
  return { state: { quantity, averageCost }, costPerBase, warnings };
}

export interface StockMovementInput {
  movementType: MovementType;
  /** Quantity as entered: positive for stock in/out; signed (non-zero) for adjustments. */
  quantity: string;
  reasonCode?: string | null;
  unitCost?: string | null;
}

export type StockInputIssue =
  | 'stock.invalid_type'
  | 'quantity.invalid'
  | 'quantity.not_positive'
  | 'stock.reason_required'
  | 'stock.reason_invalid'
  | 'cost.required'
  | 'cost.negative';

/** Client-side checks mirroring the database. The server re-checks everything. */
export function validateStockMovementInput(input: StockMovementInput): StockInputIssue[] {
  const issues: StockInputIssue[] = [];
  if (!(MOVEMENT_TYPES as readonly string[]).includes(input.movementType)) {
    return ['stock.invalid_type'];
  }
  let qty: Dec | null = null;
  try {
    qty = dec(input.quantity);
  } catch {
    issues.push('quantity.invalid');
  }
  if (qty) {
    if (qty.isZero()) issues.push('quantity.invalid');
    if (input.movementType !== 'adjustment' && qty.isNegative()) issues.push('quantity.not_positive');
  }

  const reason = input.reasonCode ?? null;
  if (reason !== null && !(ALL_REASONS as readonly string[]).includes(reason)) {
    issues.push('stock.reason_invalid');
  }
  if (input.movementType === 'adjustment' && !reason) issues.push('stock.reason_required');

  if (input.unitCost !== undefined && input.unitCost !== null && input.unitCost !== '') {
    try {
      if (dec(input.unitCost).isNegative()) issues.push('cost.negative');
    } catch {
      issues.push('cost.negative');
    }
  } else if (input.movementType === 'stock_in') {
    issues.push('cost.required');
  }
  return issues;
}
