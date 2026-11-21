/**
 * Local business data kept on this device: legacy outbox entries from the earlier offline build,
 * the legacy cache, and held POS sales. Nothing here is sent to the server.
 */
import { readPref, writePref } from './storage';

export const HOLDS_PREF = 'erp.pos.holds';
const LEGACY_DB = 'erp-offline';
const NOT_SENT = new Set(['pending', 'failed']);

export interface LegacyPendingEntry {
  id: string;
  orgId: string;
  createdAt: string;
  movementType: string;
  productId: string;
  quantity: string;
}

export interface LocalPendingSummary {
  legacy: LegacyPendingEntry[];
  heldSales: number;
}

function heldSaleCount(): number {
  try {
    const parsed: unknown = JSON.parse(readPref(HOLDS_PREF) ?? '[]');
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function openExisting(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const request = indexedDB.open(LEGACY_DB);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('outbox')) {
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
    request.onupgradeneeded = () => {
      // The database did not exist: do not create it. Abort and report nothing.
      request.transaction?.abort();
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** Reads entries that the earlier offline build never sent. Creates nothing. */
export async function readLegacyPending(): Promise<LegacyPendingEntry[]> {
  const db = await openExisting();
  if (!db) return [];
  try {
    const rows = await new Promise<Array<{ id: string; orgId: string; status: string; createdAt: string; payload: { movementType: string; productId: string; quantity: string } }>>((resolve, reject) => {
      const req = db.transaction('outbox', 'readonly').objectStore('outbox').getAll();
      req.onsuccess = () => resolve(req.result as never);
      req.onerror = () => reject(req.error);
    });
    return rows
      .filter((r) => NOT_SENT.has(r.status))
      .map((r) => ({ id: r.id, orgId: r.orgId, createdAt: r.createdAt, movementType: r.payload.movementType, productId: r.payload.productId, quantity: r.payload.quantity }));
  } finally {
    db.close();
  }
}

export async function discardLegacyEntry(id: string): Promise<void> {
  const db = await openExisting();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Deletes the whole legacy database (outbox and cached business data). Resolves even if blocked. */
export function clearLegacyDatabase(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve();
    const request = indexedDB.deleteDatabase(LEGACY_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export async function summarizeLocalPending(): Promise<LocalPendingSummary> {
  return { legacy: await readLegacyPending(), heldSales: heldSaleCount() };
}

export function pendingTotal(summary: LocalPendingSummary): number {
  return summary.legacy.length + summary.heldSales;
}

/** Removes everything local that holds business data. Call only after the user has confirmed. */
export async function clearLocalBusinessData(): Promise<void> {
  writePref(HOLDS_PREF, '[]');
  await clearLegacyDatabase();
}
