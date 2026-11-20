import { dec, validateStockMovementInput, type StockReason } from '@erp/domain';
import { DataError } from '../errors';
import type { ApplyResult, MovementPayload, StockLevel } from '../inventory-models';
import type { LocalStore } from './store';
import { projectWarehouse, type ProjectedLevel } from './projection';
import type { CachedProduct, CatalogSnapshot, OutboxEntry, SyncMeta, WarehouseSnapshot } from './types';

export interface SyncTransport {
  applyMovements(orgId: string, deviceId: string, batch: MovementPayload[]): Promise<ApplyResult[]>;
  listStockLevels(warehouseId: string): Promise<StockLevel[]>;
  loadCatalog(orgId: string): Promise<{ products: CachedProduct[]; allowNegativeStock: boolean }>;
}

export interface SyncEngineOptions {
  orgId: string;
  deviceId: string;
  store: LocalStore;
  transport: SyncTransport;
  now?: () => number;
  newId?: () => string;
  batchSize?: number;
}

export interface LocalMovementInput {
  warehouseId: string;
  productId: string;
  unitId: string;
  movementType: 'stock_in' | 'stock_out' | 'adjustment';
  /** Positive for stock in/out; signed for adjustments. */
  quantity: string;
  unitCost?: string | null;
  reasonCode?: StockReason | null;
  note?: string | null;
  reference?: string | null;
}

export interface FlushReport {
  attempted: number;
  acked: number;
  rejected: number;
  /** Set when the server could not be reached; remaining entries stay queued. */
  networkError: string | null;
  refreshed: string[];
  refreshErrors: string[];
}

export interface SyncStatus {
  pending: number;
  acked: number;
  failed: number;
  lastSyncedAt: string | null;
  lastError: { code: string; message: string } | null;
}

const BATCH_SIZE_DEFAULT = 50;
const MAX_BACKOFF_MS = 5 * 60_000;

const warehouseKey = (id: string) => `levels:${id}`;
const catalogKey = (orgId: string) => `catalog:${orgId}`;
const metaKey = (orgId: string) => `meta:${orgId}`;

/**
 * Offline-first stock engine.
 *
 *  - Writes are queued locally first (enqueue), then sent with flush().
 *  - Every movement carries a device-generated id; the server applies each id at most once,
 *    so a retry after a lost response cannot double-count stock.
 *  - Rejections are kept (status "failed") with the server's code, never dropped silently.
 *  - Acknowledged movements leave the queue only after the server snapshot containing them
 *    has been stored (atomically), so the displayed balance never loses or repeats a movement.
 *  - Failed deliveries back off exponentially; a backed-off entry blocks later entries so the
 *    server applies movements in the device's order (moving-average cost depends on it).
 */
export class SyncEngine {
  private readonly opts: Required<Omit<SyncEngineOptions, 'orgId' | 'deviceId' | 'store' | 'transport'>> & SyncEngineOptions;
  private flushing: Promise<FlushReport> | null = null;

  constructor(options: SyncEngineOptions) {
    this.opts = {
      now: () => Date.now(),
      newId: () => crypto.randomUUID(),
      batchSize: BATCH_SIZE_DEFAULT,
      ...options,
    };
  }

  private get store() {
    return this.opts.store;
  }

  private async catalog(): Promise<CatalogSnapshot | undefined> {
    return this.store.getCache<CatalogSnapshot>(catalogKey(this.opts.orgId));
  }

  /** Download products and org settings for offline use (barcode lookup, validation). */
  async refreshCatalog(): Promise<CatalogSnapshot> {
    const { products, allowNegativeStock } = await this.opts.transport.loadCatalog(this.opts.orgId);
    const snapshot: CatalogSnapshot = {
      orgId: this.opts.orgId,
      allowNegativeStock,
      products,
      syncedAt: new Date(this.opts.now()).toISOString(),
    };
    await this.store.setCache(catalogKey(this.opts.orgId), snapshot);
    return snapshot;
  }

  /** Offline product lookup by SKU or any barcode. */
  async findProduct(code: string): Promise<CachedProduct | null> {
    const cat = await this.catalog();
    if (!cat) return null;
    const needle = code.trim();
    const upper = needle.toUpperCase();
    return (
      cat.products.find((p) => p.sku === upper || p.units.some((u) => u.barcode === needle)) ?? null
    );
  }

  /** True once the catalog has been downloaded at least once. */
  async hasCatalog(): Promise<boolean> {
    return (await this.catalog()) !== undefined;
  }

  /** Active stock products from the cache, in name order (includes products with zero stock). */
  async catalogProducts(): Promise<CachedProduct[]> {
    const cat = await this.catalog();
    return (cat?.products ?? [])
      .filter((p) => p.productType === 'stock' && !p.archived)
      .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  }

  async getProduct(productId: string): Promise<CachedProduct | null> {
    const cat = await this.catalog();
    return cat?.products.find((p) => p.id === productId) ?? null;
  }

  /**
   * Validate and queue a movement. Nothing is sent here. Throws DataError with a stable code
   * for anything the device can already see is wrong.
   */
  async enqueue(input: LocalMovementInput): Promise<OutboxEntry> {
    const issues = validateStockMovementInput({
      movementType: input.movementType,
      quantity: input.quantity,
      reasonCode: input.reasonCode ?? null,
      unitCost: input.unitCost ?? null,
    });
    if (issues.length > 0) throw new DataError(issues[0]!, issues[0]!);

    const cat = await this.catalog();
    if (!cat) throw new DataError('offline.catalog_missing', 'Product catalog is not downloaded yet');
    const product = cat.products.find((p) => p.id === input.productId);
    if (!product) throw new DataError('offline.product_unknown', input.productId);
    if (product.productType !== 'stock') throw new DataError('product.not_stock', product.sku);
    if (product.archived) throw new DataError('product.archived', product.sku);
    const unit = product.units.find((u) => u.unitId === input.unitId);
    if (!unit) throw new DataError('unit.not_configured', product.sku);

    const entered = dec(input.quantity).abs();
    const base = entered.times(dec(unit.factor));
    if (!product.baseUnitAllowsFraction && !base.isInteger()) {
      throw new DataError('quantity.fraction_not_allowed', product.sku);
    }
    // Same limits as the database: at most 6 decimals for entered and base quantities.
    if (entered.decimalPlaces() > 6 || base.decimalPlaces() > 6) {
      throw new DataError('quantity.precision', product.sku);
    }

    const entries = await this.store.listOutbox(this.opts.orgId);
    const forWarehouse = entries.filter((e) => e.warehouseId === input.warehouseId);
    const current = (await this.snapshotFor(input.warehouseId)) ?? undefined;
    const projected = projectWarehouse(current, forWarehouse, cat.allowNegativeStock).levels.get(input.productId);
    const change =
      input.movementType === 'stock_out' ? base.negated()
        : input.movementType === 'stock_in' ? base
          : dec(input.quantity).isNegative() ? base.negated() : base;
    if (change.lt(0) && !cat.allowNegativeStock) {
      const available = projected?.quantity ?? dec(0);
      if (available.plus(change).lt(0)) throw new DataError('stock.insufficient', 'stock.insufficient', available.toString());
    }

    const id = this.opts.newId();
    const seq = entries.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
    const occurredAt = new Date(this.opts.now()).toISOString();
    const entry: OutboxEntry = {
      id,
      orgId: this.opts.orgId,
      seq,
      warehouseId: input.warehouseId,
      payload: {
        clientId: id,
        warehouseId: input.warehouseId,
        productId: input.productId,
        movementType: input.movementType,
        unitId: input.unitId,
        quantity: input.quantity,
        unitCost: input.unitCost ?? null,
        reasonCode: input.reasonCode ?? null,
        note: input.note ?? null,
        reference: input.reference ?? null,
        occurredAt,
      },
      factor: unit.factor,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      createdAt: occurredAt,
    };
    await this.store.putOutbox(entry);
    return entry;
  }

  /** Send queued movements. Safe to call at any time and concurrently (single-flight). */
  flush(): Promise<FlushReport> {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async doFlush(): Promise<FlushReport> {
    const report: FlushReport = { attempted: 0, acked: 0, rejected: 0, networkError: null, refreshed: [], refreshErrors: [] };
    const { orgId, deviceId } = this.opts;
    const now = this.opts.now();

    const all = await this.store.listOutbox(orgId);
    const pending = all.filter((e) => e.status === 'pending');
    // Stop at the first entry that is still backing off: later entries must not overtake it.
    const due: OutboxEntry[] = [];
    for (const e of pending) {
      if (e.nextAttemptAt > now) break;
      due.push(e);
    }

    for (let i = 0; i < due.length && report.networkError === null; i += this.opts.batchSize) {
      const batch = due.slice(i, i + this.opts.batchSize);
      report.attempted += batch.length;
      let results: ApplyResult[];
      try {
        results = await this.opts.transport.applyMovements(orgId, deviceId, batch.map((e) => e.payload));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = error instanceof DataError ? error.code : 'network';
        report.networkError = message;
        for (const entry of batch) {
          const attempts = entry.attempts + 1;
          await this.store.putOutbox({
            ...entry,
            attempts,
            nextAttemptAt: this.opts.now() + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 10)),
            lastError: { code, message },
          });
        }
        await this.setMeta({ lastError: { code, message } });
        break;
      }

      const byId = new Map(results.map((r) => [r.clientId, r]));
      for (const entry of batch) {
        const r = byId.get(entry.id);
        if (!r) {
          // Protocol violation: the server did not answer for this movement. Keep it queued.
          await this.store.putOutbox({ ...entry, attempts: entry.attempts + 1, lastError: { code: 'missing_result', message: 'No result for this movement' } });
          continue;
        }
        if (r.status === 'rejected') {
          report.rejected += 1;
          await this.store.putOutbox({ ...entry, status: 'failed', lastError: { code: r.code ?? 'unknown', message: r.message ?? 'Rejected' } });
        } else {
          report.acked += 1;
          await this.store.putOutbox({ ...entry, status: 'acked', lastError: null });
        }
      }
    }

    // Reconcile: store fresh snapshots for warehouses with acknowledged movements, and remove
    // those movements in the same write. A failed refresh keeps them queued in the projection.
    const all2 = await this.store.listOutbox(orgId);
    const warehouses = [...new Set(all2.filter((e) => e.status === 'acked').map((e) => e.warehouseId))];
    for (const warehouseId of warehouses) {
      try {
        await this.refreshWarehouse(warehouseId);
        report.refreshed.push(warehouseId);
      } catch (error) {
        report.refreshErrors.push(`${warehouseId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (report.networkError === null && report.refreshErrors.length === 0) {
      await this.setMeta({ lastSyncedAt: new Date(this.opts.now()).toISOString(), lastError: null });
    }
    return report;
  }

  /** Replace a warehouse snapshot with the server's levels and clear acknowledged entries. */
  async refreshWarehouse(warehouseId: string): Promise<void> {
    const levels = await this.opts.transport.listStockLevels(warehouseId);
    const snapshot: WarehouseSnapshot = {
      warehouseId,
      levels: Object.fromEntries(levels.map((l) => [l.productId, { quantity: l.quantity, averageCost: l.averageCost }])),
      syncedAt: new Date(this.opts.now()).toISOString(),
    };
    const acked = (await this.store.listOutbox(this.opts.orgId))
      .filter((e) => e.status === 'acked' && e.warehouseId === warehouseId)
      .map((e) => e.id);
    await this.store.commitWarehouseSnapshot(warehouseKey(warehouseId), snapshot, acked);
  }

  private async snapshotFor(warehouseId: string): Promise<WarehouseSnapshot | undefined> {
    return this.store.getCache<WarehouseSnapshot>(warehouseKey(warehouseId));
  }

  /** What the device should display for a warehouse: snapshot plus everything not yet on the server. */
  async projectedLevels(warehouseId: string): Promise<ProjectedLevel[]> {
    const cat = await this.catalog();
    const entries = (await this.store.listOutbox(this.opts.orgId)).filter((e) => e.warehouseId === warehouseId);
    const { levels } = projectWarehouse(await this.snapshotFor(warehouseId), entries, cat?.allowNegativeStock ?? true);
    return [...levels.values()];
  }

  async queued(): Promise<OutboxEntry[]> {
    return (await this.store.listOutbox(this.opts.orgId)).filter((e) => e.status !== 'acked');
  }

  async status(): Promise<SyncStatus> {
    const entries = await this.store.listOutbox(this.opts.orgId);
    const meta = (await this.store.getCache<SyncMeta>(metaKey(this.opts.orgId))) ?? { lastSyncedAt: null, lastError: null };
    return {
      pending: entries.filter((e) => e.status === 'pending').length,
      acked: entries.filter((e) => e.status === 'acked').length,
      failed: entries.filter((e) => e.status === 'failed').length,
      lastSyncedAt: meta.lastSyncedAt,
      lastError: meta.lastError,
    };
  }

  /** Put a rejected movement back in the queue (after the cause was fixed). */
  async retry(id: string): Promise<void> {
    const entry = (await this.store.listOutbox(this.opts.orgId)).find((e) => e.id === id);
    if (!entry || entry.status !== 'failed') throw new DataError('not_found', id);
    await this.store.putOutbox({ ...entry, status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null });
  }

  /** Drop a rejected movement the user decided not to keep. Nothing is sent to the server. */
  async discard(id: string): Promise<void> {
    const entry = (await this.store.listOutbox(this.opts.orgId)).find((e) => e.id === id);
    if (!entry || entry.status !== 'failed') throw new DataError('not_found', id);
    await this.store.deleteOutbox(id);
  }

  private async setMeta(patch: Partial<SyncMeta>): Promise<void> {
    const current = (await this.store.getCache<SyncMeta>(metaKey(this.opts.orgId))) ?? { lastSyncedAt: null, lastError: null };
    await this.store.setCache(metaKey(this.opts.orgId), { ...current, ...patch });
  }
}
