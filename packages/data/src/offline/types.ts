import type { MovementPayload } from '../inventory-models';

/**
 * Outbox entry lifecycle:
 *   pending → (server applied/duplicate) → acked → (warehouse snapshot refreshed) → removed
 *   pending → (server rejected)          → failed → (user retries: pending | discards: removed)
 * Only `pending` entries are sent. `acked` entries are already on the server but are still
 * part of the local projection until the snapshot that includes them has been stored.
 */
export type OutboxStatus = 'pending' | 'acked' | 'failed';

export interface OutboxEntry {
  /** Idempotency key; equals payload.clientId. */
  id: string;
  orgId: string;
  /** Monotonic per-device sequence: replay order. */
  seq: number;
  warehouseId: string;
  payload: MovementPayload;
  /** Conversion factor captured when queued (used for the local projection only). */
  factor: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms before which a pending entry is not retried (exponential back-off). */
  nextAttemptAt: number;
  lastError: { code: string; message: string } | null;
  createdAt: string;
}

export interface LevelSnapshot {
  quantity: string;
  averageCost: string;
}

export interface WarehouseSnapshot {
  warehouseId: string;
  levels: Record<string, LevelSnapshot>;
  syncedAt: string;
}

export interface CachedUnit {
  unitId: string;
  factor: string;
  barcode: string | null;
}

export interface CachedProduct {
  id: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
  productType: 'stock' | 'service';
  baseUnitId: string;
  baseUnitAllowsFraction: boolean;
  reorderLevel: string | null;
  archived: boolean;
  units: CachedUnit[];
}

export interface CatalogSnapshot {
  orgId: string;
  allowNegativeStock: boolean;
  products: CachedProduct[];
  syncedAt: string;
}

export interface SyncMeta {
  lastSyncedAt: string | null;
  lastError: { code: string; message: string } | null;
}
