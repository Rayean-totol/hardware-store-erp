import { createMemoryStore, openIdbStore, type LocalStore } from '@erp/data';

export interface OfflineStorage {
  store: LocalStore;
  /** false when IndexedDB is unavailable: queued changes are then lost on reload. */
  durable: boolean;
  storageError: string | null;
}

let cached: Promise<OfflineStorage> | null = null;

/**
 * Opens the durable IndexedDB store once per page load. If it cannot be opened (private
 * mode, blocked storage) the app keeps working in memory and says so, rather than
 * pretending queued changes are safe.
 */
export function getOfflineStorage(): Promise<OfflineStorage> {
  cached ??= openIdbStore()
    .then((store): OfflineStorage => ({ store, durable: true, storageError: null }))
    .catch((error: unknown): OfflineStorage => ({
      store: createMemoryStore(),
      durable: false,
      storageError: error instanceof Error ? error.message : String(error),
    }));
  return cached;
}
