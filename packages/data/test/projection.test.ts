import { describe, expect, it } from 'vitest';
import { projectWarehouse, type OutboxEntry, type WarehouseSnapshot } from '../src';
import { BOX, ORG, PCS, SCREW, WH } from './fixtures';

const e = (seq: number, movementType: 'stock_in' | 'stock_out' | 'adjustment', quantity: string, unitId: string, factor: string, unitCost: string | null = null, status: OutboxEntry['status'] = 'pending'): OutboxEntry => ({
  id: `e${seq}`, orgId: ORG, seq, warehouseId: WH, factor, status, attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: 'x',
  payload: { clientId: `e${seq}`, warehouseId: WH, productId: SCREW, movementType, unitId, quantity, unitCost, reasonCode: null, note: null, reference: null, occurredAt: 'x' },
});

const snap: WarehouseSnapshot = { warehouseId: WH, levels: { [SCREW]: { quantity: '400', averageCost: '0.125' } }, syncedAt: 'x' };

describe('projectWarehouse', () => {
  it('replays entries in sequence on top of the snapshot with server costing', () => {
    const { levels, skipped } = projectWarehouse(snap, [
      e(2, 'stock_out', '50', PCS, '1'),
      e(1, 'stock_in', '2', BOX, '200', '25'),   // out of order on purpose: seq 1 applies first
    ].map((x) => (x.seq === 1 ? { ...x, status: 'acked' as const } : x)), true);
    expect(skipped).toEqual([]);
    expect(levels.get(SCREW)!.quantity.toString()).toBe('750');  // 400 + 400 - 50 - nothing else
    expect(levels.get(SCREW)!.averageCost.toString()).toBe('0.125');
  });

  it('ignores failed entries', () => {
    const { levels } = projectWarehouse(snap, [e(1, 'stock_out', '5', PCS, '1', null, 'failed')], true);
    expect(levels.get(SCREW)!.quantity.toString()).toBe('400');
  });

  it('reports entries that cannot be replayed under the no-negative policy instead of hiding them', () => {
    const { levels, skipped } = projectWarehouse({ ...snap, levels: { [SCREW]: { quantity: '1', averageCost: '1' } } },
      [e(1, 'stock_out', '5', PCS, '1')], false);
    expect(skipped.map((x) => x.id)).toEqual(['e1']);
    expect(levels.get(SCREW)!.quantity.toString()).toBe('1');
  });

  it('starts from zero when there is no snapshot yet', () => {
    const { levels } = projectWarehouse(undefined, [e(1, 'stock_in', '3', PCS, '1', '2')], true);
    expect(levels.get(SCREW)).toMatchObject({ pendingCount: 1 });
    expect(levels.get(SCREW)!.quantity.toString()).toBe('3');
    expect(levels.get(SCREW)!.averageCost.toString()).toBe('2');
  });

  it('adjustments follow the sign of their quantity', () => {
    const { levels } = projectWarehouse(snap, [e(1, 'adjustment', '-10', PCS, '1')], true);
    expect(levels.get(SCREW)!.quantity.toString()).toBe('390');
  });
});
