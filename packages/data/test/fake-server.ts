import { applyStockChange, dec, StockRuleError, type Dec } from '@erp/domain';
import { DataError } from '../src/errors';
import type { ApplyResult, MovementPayload, StockLevel } from '../src/inventory-models';
import type { SyncTransport } from '../src/offline/sync-engine';
import type { CachedProduct } from '../src/offline/types';

/**
 * In-process stand-in for the server, used by unit tests only. It implements the same
 * contract as public.apply_stock_movements (idempotency by client id, moving-average costing,
 * per-item rejection). The real database is exercised separately in tests/api over PostgREST.
 */
export interface FakeServer extends SyncTransport {
  levels(warehouseId: string, productId: string): { quantity: string; averageCost: string } | undefined;
  applyCount(): number;
  /** Next call to applyMovements: 'before' fails without applying; 'after' applies, then fails. */
  failNext(mode: 'before' | 'after', message?: string): void;
  /** Make listStockLevels fail once. */
  failRefreshOnce(): void;
  /** Force a rejection for a client id. */
  rejectNext(clientId: string, code: string): void;
  allowNegative: boolean;
  products: CachedProduct[];
}

export function createFakeServer(opts: { products: CachedProduct[]; allowNegative?: boolean }): FakeServer {
  const factorOf = new Map<string, string>();
  const baseFractionOf = new Map<string, boolean>();
  for (const p of opts.products) {
    baseFractionOf.set(p.id, p.baseUnitAllowsFraction);
    for (const u of p.units) factorOf.set(`${p.id}|${u.unitId}`, u.factor);
  }
  const done = new Map<string, ApplyResult>();
  const state = new Map<string, { quantity: Dec; averageCost: Dec }>();
  let calls = 0;
  let failMode: 'before' | 'after' | null = null;
  let failMessage = 'network down';
  let refreshFail = false;
  const rejects = new Map<string, string>();

  const server: FakeServer = {
    allowNegative: opts.allowNegative ?? true,
    products: opts.products,
    levels(warehouseId, productId) {
      const s = state.get(`${warehouseId}|${productId}`);
      return s ? { quantity: s.quantity.toString(), averageCost: s.averageCost.toString() } : undefined;
    },
    applyCount: () => calls,
    failNext(mode, message = 'network down') {
      failMode = mode;
      failMessage = message;
    },
    failRefreshOnce() {
      refreshFail = true;
    },
    rejectNext(clientId, code) {
      rejects.set(clientId, code);
    },
    async applyMovements(_org, _device, batch: MovementPayload[]) {
      calls += 1;
      const mode = failMode;
      failMode = null;
      if (mode === 'before') throw new DataError('network', failMessage);

      const results: ApplyResult[] = batch.map((m) => {
        const prior = done.get(m.clientId);
        if (prior) return { ...prior, status: 'duplicate' as const };
        const forced = rejects.get(m.clientId);
        if (forced) {
          rejects.delete(m.clientId);
          return rejected(m.clientId, forced);
        }
        const factor = factorOf.get(`${m.productId}|${m.unitId}`);
        if (!factor) return rejected(m.clientId, 'unit.not_configured');
        const key = `${m.warehouseId}|${m.productId}`;
        const entered = dec(m.quantity).abs();
        const base = entered.times(dec(factor));
        if (!baseFractionOf.get(m.productId) && !base.isInteger()) return rejected(m.clientId, 'quantity.fraction_not_allowed');
        const change = m.movementType === 'stock_out' ? base.negated()
          : m.movementType === 'stock_in' ? base : dec(m.quantity).isNegative() ? base.negated() : base;
        const cur = state.get(key) ?? { quantity: dec(0), averageCost: dec(0) };
        try {
          const unitCost = m.unitCost === null ? null : dec(m.unitCost).dividedBy(dec(factor));
          const r = applyStockChange(cur, change, unitCost, { allowNegative: server.allowNegative });
          state.set(key, r.state);
          const ok: ApplyResult = {
            clientId: m.clientId, status: 'applied', movementId: `mv-${m.clientId}`,
            balanceAfter: r.state.quantity.toString(), averageCostAfter: r.state.averageCost.toString(),
            warnings: r.warnings, code: null, message: null, detail: null,
          };
          done.set(m.clientId, ok);
          return ok;
        } catch (error) {
          const code = error instanceof StockRuleError ? error.code : 'unknown';
          return rejected(m.clientId, code);
        }
      });

      if (mode === 'after') throw new DataError('network', failMessage);
      return results;
    },
    async listStockLevels(warehouseId): Promise<StockLevel[]> {
      if (refreshFail) {
        refreshFail = false;
        throw new DataError('network', 'refresh failed');
      }
      return [...state.entries()]
        .filter(([k]) => k.startsWith(`${warehouseId}|`))
        .map(([k, v]) => {
          const productId = k.split('|')[1]!;
          const p = opts.products.find((x) => x.id === productId)!;
          return {
            productId, sku: p.sku, nameEn: p.nameEn, nameAr: p.nameAr, nameBn: p.nameBn, baseUnitId: p.baseUnitId,
            quantity: v.quantity.toString(), averageCost: v.averageCost.toString(), reorderLevel: null,
            lastMovementAt: null, isLow: false,
          };
        });
    },
    async loadCatalog() {
      return { products: opts.products, allowNegativeStock: server.allowNegative };
    },
  };
  return server;
}

function rejected(clientId: string, code: string): ApplyResult {
  return { clientId, status: 'rejected', movementId: null, balanceAfter: null, averageCostAfter: null, warnings: [], code, message: code, detail: null };
}
