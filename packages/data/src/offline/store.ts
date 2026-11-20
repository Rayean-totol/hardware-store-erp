import type { OutboxEntry, WarehouseSnapshot } from './types';

/**
 * Local persistence used by the sync engine. Two implementations share one contract test
 * suite: an in-memory store (tests, private mode fallback) and IndexedDB (idb-store.ts).
 */
export interface LocalStore {
  listOutbox(orgId: string): Promise<OutboxEntry[]>;
  putOutbox(entry: OutboxEntry): Promise<void>;
  deleteOutbox(id: string): Promise<void>;
  getCache<T>(key: string): Promise<T | undefined>;
  setCache<T>(key: string, value: T): Promise<void>;
  /**
   * Atomically store a refreshed warehouse snapshot AND remove the acknowledged entries it now
   * includes. Both happen or neither does: a crash in between would double-count movements.
   */
  commitWarehouseSnapshot(key: string, snapshot: WarehouseSnapshot, removeIds: string[]): Promise<void>;
}

export function createMemoryStore(): LocalStore {
  const outbox = new Map<string, OutboxEntry>();
  const cache = new Map<string, unknown>();
  // Structured clone keeps the in-memory store honest: callers cannot mutate stored state.
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    async listOutbox(orgId) {
      return [...outbox.values()].filter((e) => e.orgId === orgId).sort((a, b) => a.seq - b.seq).map(clone);
    },
    async putOutbox(entry) {
      outbox.set(entry.id, clone(entry));
    },
    async deleteOutbox(id) {
      outbox.delete(id);
    },
    async getCache<T>(key: string) {
      return cache.has(key) ? (clone(cache.get(key)) as T) : undefined;
    },
    async setCache(key, value) {
      cache.set(key, clone(value));
    },
    async commitWarehouseSnapshot(key, snapshot, removeIds) {
      cache.set(key, clone(snapshot));
      for (const id of removeIds) outbox.delete(id);
    },
  };
}
