import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createMemoryStore, openIdbStore, type LocalStore, type OutboxEntry, type WarehouseSnapshot } from '../src';
import { ORG, SCREW, WH } from './fixtures';

const entry = (id: string, seq: number, orgId = ORG): OutboxEntry => ({
  id, orgId, seq, warehouseId: WH, factor: '1', status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  payload: {
    clientId: id, warehouseId: WH, productId: SCREW, movementType: 'stock_in', unitId: 'u', quantity: '1', unitCost: '1',
    reasonCode: 'purchase', note: null, reference: null, occurredAt: '2026-11-20T10:00:00.000Z',
  },
});
const snapshot: WarehouseSnapshot = { warehouseId: WH, levels: { [SCREW]: { quantity: '5', averageCost: '1' } }, syncedAt: 'now' };

const stores: Array<[string, () => Promise<LocalStore>]> = [
  ['memory', async () => createMemoryStore()],
  ['indexeddb', async () => openIdbStore(`test-${Math.random()}`)],
];

describe.each(stores)('%s store contract', (_name, make) => {
  it('lists outbox entries of one organization in sequence order', async () => {
    const s = await make();
    await s.putOutbox(entry('b', 2));
    await s.putOutbox(entry('a', 1));
    await s.putOutbox(entry('other', 0, '99999999-0000-4000-8000-000000000000'));
    expect((await s.listOutbox(ORG)).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('updates and deletes entries', async () => {
    const s = await make();
    await s.putOutbox(entry('a', 1));
    await s.putOutbox({ ...entry('a', 1), status: 'failed', lastError: { code: 'x', message: 'y' } });
    expect((await s.listOutbox(ORG))[0]).toMatchObject({ status: 'failed', lastError: { code: 'x' } });
    await s.deleteOutbox('a');
    expect(await s.listOutbox(ORG)).toEqual([]);
  });

  it('stores JSON cache values and returns undefined for unknown keys', async () => {
    const s = await make();
    expect(await s.getCache('missing')).toBeUndefined();
    await s.setCache('k', { n: 1, nested: { ok: true } });
    expect(await s.getCache('k')).toEqual({ n: 1, nested: { ok: true } });
  });

  it('commits a snapshot and removes the acknowledged entries together', async () => {
    const s = await make();
    await s.putOutbox(entry('a', 1));
    await s.putOutbox(entry('b', 2));
    await s.commitWarehouseSnapshot(`levels:${WH}`, snapshot, ['a']);
    expect((await s.listOutbox(ORG)).map((e) => e.id)).toEqual(['b']);
    expect(await s.getCache(`levels:${WH}`)).toEqual(snapshot);
  });
});

describe('IndexedDB durability', () => {
  it('keeps the outbox across a reopen (simulated reload)', async () => {
    const name = `durable-${Math.random()}`;
    const first = await openIdbStore(name);
    await first.putOutbox(entry('kept', 1));
    const second = await openIdbStore(name);
    expect((await second.listOutbox(ORG)).map((e) => e.id)).toEqual(['kept']);
  });
});
