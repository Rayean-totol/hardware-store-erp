import { applyStockChange, dec, EMPTY_STOCK, type Dec, type StockState } from '@erp/domain';
import type { OutboxEntry, WarehouseSnapshot } from './types';

export interface ProjectedLevel {
  productId: string;
  quantity: Dec;
  averageCost: Dec;
  /** Entries that are not yet on the server and contribute to this figure. */
  pendingCount: number;
}

/** Signed base-unit change of a queued movement. */
export function baseChangeOf(entry: Pick<OutboxEntry, 'payload' | 'factor'>): Dec {
  const qty = dec(entry.payload.quantity);
  // Magnitude in base units first; the sign comes from the movement type (or the adjustment's sign).
  const magnitude = qty.abs().times(dec(entry.factor));
  switch (entry.payload.movementType) {
    case 'stock_in':
      return magnitude;
    case 'stock_out':
      return magnitude.negated();
    default:
      return qty.isNegative() ? magnitude.negated() : magnitude;
  }
}

/**
 * What the device shows: the last server snapshot with every entry that the server has not
 * yet reflected replayed on top, in queue order. Mirrors the server's costing rules through
 * applyStockChange, so offline and online balances agree once the queue drains.
 * Entries that cannot be replayed locally (would overdraw) are skipped here and will be
 * rejected by the server with the same reason, so they are reported rather than hidden.
 */
export function projectWarehouse(
  snapshot: WarehouseSnapshot | undefined,
  entries: readonly OutboxEntry[],
  allowNegative: boolean,
): { levels: Map<string, ProjectedLevel>; skipped: OutboxEntry[] } {
  const states = new Map<string, { state: StockState; pending: number }>();
  for (const [productId, lvl] of Object.entries(snapshot?.levels ?? {})) {
    states.set(productId, { state: { quantity: dec(lvl.quantity), averageCost: dec(lvl.averageCost) }, pending: 0 });
  }
  const skipped: OutboxEntry[] = [];
  // Callers pass one warehouse's entries. Rejected (failed) entries never reached the server.
  const ordered = entries.filter((e) => e.status !== 'failed').sort((a, b) => a.seq - b.seq);
  for (const entry of ordered) {
    const pid = entry.payload.productId;
    const current = states.get(pid) ?? { state: EMPTY_STOCK, pending: 0 };
    try {
      const unitCost = entry.payload.unitCost === null ? null : dec(entry.payload.unitCost).dividedBy(dec(entry.factor));
      const r = applyStockChange(current.state, baseChangeOf(entry), unitCost, { allowNegative });
      states.set(pid, { state: r.state, pending: current.pending + 1 });
    } catch {
      skipped.push(entry);
    }
  }
  const levels = new Map<string, ProjectedLevel>();
  for (const [pid, { state, pending }] of states) {
    levels.set(pid, { productId: pid, quantity: state.quantity, averageCost: state.averageCost, pendingCount: pending });
  }
  return { levels, skipped };
}
