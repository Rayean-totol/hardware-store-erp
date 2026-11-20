import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LocalStore } from './store';
import type { OutboxEntry, WarehouseSnapshot } from './types';

interface ErpDb extends DBSchema {
  outbox: { key: string; value: OutboxEntry; indexes: { byOrg: string } };
  cache: { key: string; value: unknown };
}

/**
 * IndexedDB implementation. Survives reloads and crashes: writes are committed per
 * transaction, so an outbox entry is either fully stored or not stored at all.
 */
export async function openIdbStore(name = 'erp-offline', version = 1): Promise<LocalStore> {
  const db: IDBPDatabase<ErpDb> = await openDB<ErpDb>(name, version, {
    upgrade(database) {
      const outbox = database.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('byOrg', 'orgId');
      database.createObjectStore('cache');
    },
  });
  return {
    async listOutbox(orgId) {
      const rows = await db.getAllFromIndex('outbox', 'byOrg', orgId);
      return rows.sort((a, b) => a.seq - b.seq);
    },
    async putOutbox(entry) {
      await db.put('outbox', entry);
    },
    async deleteOutbox(id) {
      await db.delete('outbox', id);
    },
    async getCache<T>(key: string) {
      return (await db.get('cache', key)) as T | undefined;
    },
    async setCache(key, value) {
      await db.put('cache', value, key);
    },
    async commitWarehouseSnapshot(key: string, snapshot: WarehouseSnapshot, removeIds: string[]) {
      const tx = db.transaction(['cache', 'outbox'], 'readwrite');
      tx.objectStore('cache').put(snapshot, key);
      for (const id of removeIds) tx.objectStore('outbox').delete(id);
      await tx.done;
    },
  };
}
