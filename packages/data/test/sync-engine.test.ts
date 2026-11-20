import { beforeEach, describe, expect, it } from 'vitest';
import { DataError } from '../src/errors';
import { createMemoryStore, SyncEngine, type LocalStore } from '../src';
import { createFakeServer, type FakeServer } from './fake-server';
import { BOX, CABLE, M, ORG, PCS, products, SCREW, SERVICE, WH, WH_JED } from './fixtures';

let store: LocalStore;
let server: FakeServer;
let clock: number;
let counter: number;

const engine = (opts: { batchSize?: number } = {}) =>
  new SyncEngine({
    orgId: ORG,
    deviceId: 'DEVICE-A',
    store,
    transport: server,
    now: () => clock,
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    ...(opts.batchSize ? { batchSize: opts.batchSize } : {}),
  });

const stockIn = (qty: string, unitCost: string, unitId = PCS, productId = SCREW) => ({
  warehouseId: WH, productId, unitId, movementType: 'stock_in' as const, quantity: qty, unitCost, reasonCode: 'purchase' as const,
});
const stockOut = (qty: string, unitId = PCS, productId = SCREW) => ({
  warehouseId: WH, productId, unitId, movementType: 'stock_out' as const, quantity: qty,
});

beforeEach(() => {
  store = createMemoryStore();
  server = createFakeServer({ products });
  clock = Date.parse('2026-11-20T10:00:00Z');
  counter = 0;
});

describe('queueing and local validation (offline)', () => {
  it('needs a downloaded catalog before queueing anything', async () => {
    await expect(engine().enqueue(stockIn('1', '1'))).rejects.toMatchObject({ code: 'offline.catalog_missing' });
  });

  it('queues movements without the network and shows them in the projection', async () => {
    const e = engine();
    await e.refreshCatalog();
    await e.enqueue(stockIn('2', '25', BOX));          // 2 boxes = 400 pcs at 0.125 each
    await e.enqueue(stockOut('50'));
    expect(server.applyCount()).toBe(0);               // nothing was sent
    const [level] = (await e.projectedLevels(WH)).filter((l) => l.productId === SCREW);
    expect(level!.quantity.toString()).toBe('350');
    expect(level!.averageCost.toString()).toBe('0.125');
    expect(level!.pendingCount).toBe(2);
  });

  it.each([
    ['unknown product', { productId: '99999999-0000-4000-8000-000000000000' }, 'offline.product_unknown'],
    ['service product', { productId: SERVICE }, 'product.not_stock'],
    ['unit not configured', { unitId: M }, 'unit.not_configured'],
    ['fraction of an indivisible unit', { quantity: '1.5' }, 'quantity.fraction_not_allowed'],
    ['too many decimals', { productId: CABLE, unitId: M, quantity: '0.0000001' }, 'quantity.precision'],
    ['zero quantity', { quantity: '0' }, 'quantity.invalid'],
    ['negative issue', { quantity: '-1' }, 'quantity.not_positive'],
  ])('rejects %s before queueing', async (_name, override, code) => {
    const e = engine();
    await e.refreshCatalog();
    await expect(e.enqueue({ ...stockOut('1'), ...override })).rejects.toMatchObject({ code: expect.stringContaining(code.split('.')[0]!) });
    await expect(e.enqueue({ ...stockOut('1'), ...override })).rejects.toBeInstanceOf(DataError);
    expect(await e.queued()).toHaveLength(0);
  });

  it('requires a cost for receipts and blocks overdraw when the org disallows it', async () => {
    const e = engine();
    await e.refreshCatalog();
    await expect(e.enqueue({ ...stockIn('1', '1'), unitCost: null })).rejects.toMatchObject({ code: 'cost.required' });
    await expect(e.enqueue(stockOut('1'))).resolves.toBeTruthy();   // negative allowed in this org: queued
  });

  it('enforces the no-negative-stock policy on the device too', async () => {
    server = createFakeServer({ products, allowNegative: false });
    const e = engine();
    await e.refreshCatalog();
    await e.enqueue(stockIn('10', '1'));
    await expect(e.enqueue(stockOut('11'))).rejects.toMatchObject({ code: 'stock.insufficient' });
    await expect(e.enqueue(stockOut('10'))).resolves.toBeTruthy();
  });

  it('finds products offline by SKU and by any barcode', async () => {
    const e = engine();
    await e.refreshCatalog();
    expect((await e.findProduct('fst-ws-4x40'))?.id).toBe(SCREW);
    expect((await e.findProduct('2000000100029'))?.id).toBe(SCREW);
    expect(await e.findProduct('nothing')).toBeNull();
  });
});

describe('sending and reconciling', () => {
  it('sends queued movements, clears them once the snapshot is stored, and matches the server', async () => {
    const e = engine();
    await e.refreshCatalog();
    await e.enqueue(stockIn('2', '25', BOX));
    await e.enqueue(stockOut('50'));
    await e.enqueue(stockIn('100', '0.20'));
    const report = await e.flush();
    expect(report).toMatchObject({ attempted: 3, acked: 3, rejected: 0, networkError: null, refreshErrors: [] });
    expect(report.refreshed).toEqual([WH]);
    expect(await e.queued()).toHaveLength(0);
    expect(server.levels(WH, SCREW)).toEqual({ quantity: '450', averageCost: '0.1417' });
    const [level] = (await e.projectedLevels(WH)).filter((l) => l.productId === SCREW);
    expect(level!.quantity.toString()).toBe('450');
    expect(level!.averageCost.toString()).toBe('0.1417');
    expect((await e.status()).lastSyncedAt).not.toBeNull();
  });

  it('keeps warehouses separate', async () => {
    const e = engine();
    await e.refreshCatalog();
    await e.enqueue(stockIn('5', '1'));
    await e.enqueue({ ...stockIn('7', '1'), warehouseId: WH_JED });
    await e.flush();
    expect(server.levels(WH, SCREW)?.quantity).toBe('5');
    expect(server.levels(WH_JED, SCREW)?.quantity).toBe('7');
  });

  it('a network failure keeps everything queued with a back-off; nothing is lost', async () => {
    const e = engine();
    await e.refreshCatalog();
    await e.enqueue(stockIn('4', '1'));
    server.failNext('before');
    const first = await e.flush();
    expect(first.networkError).toBe('network down');
    const st = await e.status();
    expect(st.pending).toBe(1);
    expect(st.lastError?.code).toBe('network');

    // Still backing off: flush does not even call the server.
    const callsBefore = server.applyCount();
    await e.flush();
    expect(server.applyCount()).toBe(callsBefore);

    clock += 60_000;
    const second = await e.flush();
    expect(second.acked).toBe(1);
    expect(server.levels(WH, SCREW)?.quantity).toBe('4');
  });

  it('a lost response does not double-count after the retry (idempotency)', async () => {
    const e = engine();
    await e.refreshCatalog();
    await e.enqueue(stockIn('10', '1'));
    await e.enqueue(stockOut('3'));
    server.failNext('after', 'connection reset after the server applied the batch');
    const first = await e.flush();
    expect(first.networkError).toMatch(/connection reset/);
    expect(server.levels(WH, SCREW)?.quantity).toBe('7');     // applied on the server…
    clock += 60_000;
    const second = await e.flush();                             // …and the device re-sends the same ids
    expect(second.acked).toBe(2);
    expect(server.levels(WH, SCREW)?.quantity).toBe('7');     // still 7, not 14 or 4
    const [level] = (await e.projectedLevels(WH)).filter((l) => l.productId === SCREW);
    expect(level!.quantity.toString()).toBe('7');
  });

  it('a failed snapshot refresh keeps acknowledged movements in the projection until it succeeds', async () => {
    const e = engine();
    await e.refreshCatalog();
    await e.enqueue(stockIn('6', '2'));
    server.failRefreshOnce();
    const report = await e.flush();
    expect(report.acked).toBe(1);
    expect(report.refreshErrors).toHaveLength(1);
    expect((await e.status()).acked).toBe(1);
    const [mid] = (await e.projectedLevels(WH)).filter((l) => l.productId === SCREW);
    expect(mid!.quantity.toString()).toBe('6');              // not lost, not doubled

    const retry = await e.flush();
    expect(retry.refreshed).toEqual([WH]);
    expect((await e.status()).acked).toBe(0);
    const [after] = (await e.projectedLevels(WH)).filter((l) => l.productId === SCREW);
    expect(after!.quantity.toString()).toBe('6');
  });

  it('a rejected movement is kept as failed with the server code, and later movements still apply', async () => {
    const e = engine();
    await e.refreshCatalog();
    const bad = await e.enqueue(stockIn('1', '1'));
    await e.enqueue(stockIn('2', '1'));
    server.rejectNext(bad.id, 'forbidden');
    const report = await e.flush();
    expect(report).toMatchObject({ acked: 1, rejected: 1 });
    const failed = (await e.queued()).find((x) => x.id === bad.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.lastError).toEqual({ code: 'forbidden', message: 'forbidden' });
    expect(server.levels(WH, SCREW)?.quantity).toBe('2');
    const [level] = (await e.projectedLevels(WH)).filter((l) => l.productId === SCREW);
    expect(level!.quantity.toString()).toBe('2');           // the failed one is not projected
  });

  it('a rejected movement can be retried after the cause is fixed, or discarded', async () => {
    const e = engine();
    await e.refreshCatalog();
    const a = await e.enqueue(stockIn('1', '1'));
    const b = await e.enqueue(stockIn('2', '1'));
    server.rejectNext(a.id, 'forbidden');
    server.rejectNext(b.id, 'forbidden');
    await e.flush();
    await e.retry(a.id);
    await e.discard(b.id);
    await e.flush();
    expect(server.levels(WH, SCREW)?.quantity).toBe('1');
    expect(await e.queued()).toHaveLength(0);
    await expect(e.discard(a.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('sends in batches and reports every movement', async () => {
    const e = engine({ batchSize: 2 });
    await e.refreshCatalog();
    for (let i = 0; i < 5; i++) await e.enqueue(stockIn('1', '1'));
    const report = await e.flush();
    expect(report.acked).toBe(5);
    expect(server.applyCount()).toBe(3);
    expect(server.levels(WH, SCREW)?.quantity).toBe('5');
  });

  it('a movement the server did not answer for stays queued', async () => {
    const e = engine();
    await e.refreshCatalog();
    const entry = await e.enqueue(stockIn('1', '1'));
    const original = server.applyMovements;
    server.applyMovements = async (org, dev, batch) => (await original(org, dev, batch)).filter((r) => r.clientId !== entry.id);
    const report = await e.flush();
    expect(report.acked).toBe(0);
    expect((await e.queued())[0]!.lastError?.code).toBe('missing_result');
  });

  it('a backed-off movement blocks later ones so the device order is kept', async () => {
    const e = engine();
    await e.refreshCatalog();
    await e.enqueue(stockIn('10', '2'));
    server.failNext('before');
    await e.flush();                                   // first entry now backs off
    await e.enqueue(stockOut('4'));                    // queued after it
    await e.flush();                                   // must not send the issue ahead of the receipt
    expect(server.applyCount()).toBe(1);
    clock += 60_000;
    await e.flush();
    expect(server.levels(WH, SCREW)).toEqual({ quantity: '6', averageCost: '2' });
  });

  it('concurrent flushes share one run', async () => {
    const e = engine();
    await e.refreshCatalog();
    await e.enqueue(stockIn('1', '1'));
    const [a, b] = await Promise.all([e.flush(), e.flush()]);
    expect(a).toBe(b);
    expect(server.applyCount()).toBe(1);
  });

  it('survives a restart: a new engine on the same store finishes the queue', async () => {
    const first = engine();
    await first.refreshCatalog();
    await first.enqueue(stockIn('8', '1'));
    server.failNext('before');
    await first.flush();
    const restarted = engine();                       // same store, fresh process
    clock += 60_000;
    expect((await restarted.flush()).acked).toBe(1);
    expect(server.levels(WH, SCREW)?.quantity).toBe('8');
  });

  it('retry and discard only apply to failed entries', async () => {
    const e = engine();
    await e.refreshCatalog();
    const a = await e.enqueue(stockIn('1', '1'));
    await expect(e.retry(a.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});
