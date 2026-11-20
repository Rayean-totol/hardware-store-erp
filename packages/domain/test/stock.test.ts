import { describe, expect, it } from 'vitest';
import {
  applyStockChange,
  baseUnitCost,
  dec,
  EMPTY_STOCK,
  StockRuleError,
  validateStockMovementInput,
  type StockState,
} from '../src';

/**
 * Scenario shared with tests/db (SQL implementation) and tests/api (through PostgREST).
 * Screws: base unit pcs, box = 200 pcs, box cost 25.00 → 0.125 per pcs.
 *   receive 2 boxes @25.00   → 400 pcs, avg 0.125
 *   issue 50 pcs             → 350 pcs, avg 0.125
 *   receive 100 pcs @0.20    → 450 pcs, avg (350*0.125 + 100*0.2)/450 = 0.1417 (4dp)
 *   issue 500 pcs            → -50 pcs (negative allowed), avg 0.1417
 */
describe('applyStockChange (shared scenario)', () => {
  it('re-averages receipts and costs issues at the average', () => {
    const cost = baseUnitCost('25.00', '200');
    expect(cost.toString()).toBe('0.125');

    let s: StockState = EMPTY_STOCK;
    let r = applyStockChange(s, 400, cost, { allowNegative: true });
    s = r.state;
    expect(s.quantity.toString()).toBe('400');
    expect(s.averageCost.toString()).toBe('0.125');

    r = applyStockChange(s, -50, null, { allowNegative: true });
    s = r.state;
    expect(s.quantity.toString()).toBe('350');
    expect(r.costPerBase.toString()).toBe('0.125');
    expect(s.averageCost.toString()).toBe('0.125');

    r = applyStockChange(s, 100, dec('0.2'), { allowNegative: true });
    s = r.state;
    expect(s.quantity.toString()).toBe('450');
    expect(s.averageCost.toString()).toBe('0.1417');

    r = applyStockChange(s, -500, null, { allowNegative: true });
    expect(r.state.quantity.toString()).toBe('-50');
    expect(r.state.averageCost.toString()).toBe('0.1417');
    expect(r.warnings).toEqual(['negative_stock']);
  });

  it('a receipt into a negative balance sets the average to the receipt cost', () => {
    const r = applyStockChange({ quantity: dec(-5), averageCost: dec('2') }, 10, dec('3'), { allowNegative: true });
    expect(r.state.quantity.toString()).toBe('5');
    expect(r.state.averageCost.toString()).toBe('3');
  });

  it('blocks issues below zero when negative stock is not allowed', () => {
    expect(() => applyStockChange({ quantity: dec(10), averageCost: dec(1) }, -11, null, { allowNegative: false }))
      .toThrow(StockRuleError);
    try {
      applyStockChange({ quantity: dec(10), averageCost: dec(1) }, -11, null, { allowNegative: false });
    } catch (e) {
      expect((e as StockRuleError).code).toBe('stock.insufficient');
    }
  });

  it('uses the current average for uncosted positive adjustments', () => {
    const r = applyStockChange({ quantity: dec(10), averageCost: dec('4') }, 5, null, { allowNegative: true });
    expect(r.state.averageCost.toString()).toBe('4');
    expect(r.costPerBase.toString()).toBe('4');
  });

  it('rejects zero changes', () => {
    expect(() => applyStockChange(EMPTY_STOCK, 0, null, { allowNegative: true })).toThrow(StockRuleError);
  });

  it('computes base cost per piece from a box price', () => {
    expect(baseUnitCost('390', '12').toString()).toBe('32.5');
    expect(baseUnitCost('1', '3').toString()).toBe('0.3333');
  });
});

describe('validateStockMovementInput', () => {
  it('accepts a valid receipt, issue and adjustment', () => {
    expect(validateStockMovementInput({ movementType: 'stock_in', quantity: '2', unitCost: '25' })).toEqual([]);
    expect(validateStockMovementInput({ movementType: 'stock_out', quantity: '3' })).toEqual([]);
    expect(validateStockMovementInput({ movementType: 'adjustment', quantity: '-4', reasonCode: 'damage' })).toEqual([]);
  });

  it('requires a cost for receipts and a reason for adjustments', () => {
    expect(validateStockMovementInput({ movementType: 'stock_in', quantity: '2' })).toContain('cost.required');
    expect(validateStockMovementInput({ movementType: 'adjustment', quantity: '1' })).toContain('stock.reason_required');
  });

  it('rejects negative issues, zero, garbage, unknown reasons and negative cost', () => {
    expect(validateStockMovementInput({ movementType: 'stock_out', quantity: '-1' })).toContain('quantity.not_positive');
    expect(validateStockMovementInput({ movementType: 'stock_out', quantity: '0' })).toContain('quantity.invalid');
    expect(validateStockMovementInput({ movementType: 'stock_out', quantity: '1e3' })).toContain('quantity.invalid');
    expect(validateStockMovementInput({ movementType: 'adjustment', quantity: '1', reasonCode: 'fun' })).toContain('stock.reason_invalid');
    expect(validateStockMovementInput({ movementType: 'stock_in', quantity: '1', unitCost: '-2' })).toContain('cost.negative');
    expect(validateStockMovementInput({ movementType: 'move' as never, quantity: '1' })).toEqual(['stock.invalid_type']);
  });
});
