/**
 * Inventory and offline sync THROUGH POSTGREST (real HTTP, real JWTs, real RLS and RPCs).
 * Requires the PostgREST binary: scripts/fetch-postgrest.sh (see docs/setup.md).
 */
import { describe, expect, it } from 'vitest';
import {
  createSupabaseCatalogRepository,
  createSupabaseInventoryRepository,
  createSupabaseSyncTransport,
  DataError,
  SyncEngine,
  createMemoryStore,
  type ApplyResult,
  type MovementPayload,
} from '@erp/data';
import { clientFor } from '../api-client';
import { DEMO_ORG, USERS } from '../env';

async function setup(user: string, device = 'API-DEVICE') {
  const client = await clientFor(user, device);
  const inventory = createSupabaseInventoryRepository(client);
  const catalog = createSupabaseCatalogRepository(client);
  const transport = createSupabaseSyncTransport(client, inventory, catalog);
  const warehouses = await inventory.listWarehouses(DEMO_ORG);
  const warehouseId = warehouses.find((w) => w.code === 'JED')!.id;
  const products = (await catalog.searchProducts({ orgId: DEMO_ORG, search: 'FST-HB', limit: 5, offset: 0 })).items;
  const bolt = products.find((p) => p.sku === 'FST-HB-M10X50')!;
  return { client, inventory, catalog, transport, warehouseId, bolt };
}

const unitOf = (bolt: { units: Array<{ unitId: string; isBase: boolean }> }) => bolt.units.find((u) => u.isBase)!.unitId;

describe('catalog cache download (PostgREST)', () => {
  it('loads products with units and the organization stock policy', async () => {
    const { transport } = await setup(USERS.cashier);
    const cache = await transport.loadCatalog(DEMO_ORG);
    expect(cache.allowNegativeStock).toBe(true);
    expect(cache.products.length).toBeGreaterThanOrEqual(12);
    const screw = cache.products.find((p) => p.sku === 'FST-WS-4X40')!;
    expect(screw.units.map((u) => u.factor).sort()).toEqual(['1.000000', '200.000000']);
    expect(screw.baseUnitAllowsFraction).toBe(false);
  });
});

describe('stock movements (PostgREST RPC)', () => {
  it('applies a receipt, reports exact decimals, and replays it as a duplicate', async () => {
    const { inventory, warehouseId, bolt } = await setup(USERS.storekeeper);
    const clientId = crypto.randomUUID();
    const item: MovementPayload = {
      clientId, warehouseId, productId: bolt.id, movementType: 'stock_in', unitId: unitOf(bolt),
      quantity: '40', unitCost: '0.50', reasonCode: 'purchase', note: null, reference: 'PO-1', occurredAt: new Date().toISOString(),
    };
    const [first] = await inventory.applyMovements(DEMO_ORG, 'API-DEVICE', [item]);
    expect(first).toMatchObject({ status: 'applied', balanceAfter: '40', averageCostAfter: '0.5' });
    const [again] = await inventory.applyMovements(DEMO_ORG, 'API-DEVICE', [item]);
    expect(again).toMatchObject({ status: 'duplicate', balanceAfter: '40' });
    const levels = await inventory.listStockLevels(warehouseId);
    expect(levels.find((l) => l.productId === bolt.id)?.quantity).toBe('40');
  });

  it('a cashier gets a per-item rejection, not an exception', async () => {
    const { inventory, warehouseId, bolt } = await setup(USERS.cashier);
    const [res] = await inventory.applyMovements(DEMO_ORG, 'API-DEVICE', [{
      clientId: crypto.randomUUID(), warehouseId, productId: bolt.id, movementType: 'stock_in', unitId: unitOf(bolt),
      quantity: '1', unitCost: '1', reasonCode: 'purchase', note: null, reference: null, occurredAt: new Date().toISOString(),
    }]);
    expect(res).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('a malformed batch fails as a whole with a clear error', async () => {
    const { inventory } = await setup(USERS.storekeeper);
    await expect(inventory.applyMovements('not-a-uuid', 'd', [])).rejects.toBeInstanceOf(DataError);
  });
});

describe('offline engine end-to-end through PostgREST', () => {
  it('a lost response followed by a retry never double-counts stock', async () => {
    const { transport, inventory, warehouseId, bolt } = await setup(USERS.storekeeper, 'POS-OFFLINE-1');
    const qtyOf = async () =>
      Number((await inventory.listStockLevels(warehouseId)).find((l) => l.productId === bolt.id)?.quantity ?? '0');
    const before = await qtyOf();
    let lose = true;
    const flaky = {
      ...transport,
      async applyMovements(org: string, device: string, batch: MovementPayload[]): Promise<ApplyResult[]> {
        const results = await transport.applyMovements(org, device, batch);   // the server applies
        if (lose) {
          lose = false;
          throw new DataError('network', 'connection reset after the server applied the batch');
        }
        return results;
      },
    };
    const engine = new SyncEngine({
      orgId: DEMO_ORG, deviceId: 'POS-OFFLINE-1', store: createMemoryStore(), transport: flaky,
      now: () => Date.now() + 10 * 60_000,   // past any back-off
    });
    await engine.refreshCatalog();
    await engine.enqueue({ warehouseId, productId: bolt.id, unitId: unitOf(bolt), movementType: 'stock_in', quantity: '7', unitCost: '1', reasonCode: 'purchase' });
    const first = await engine.flush();
    expect(first.networkError).toMatch(/connection reset/);
    const second = await engine.flush();
    expect(second.acked).toBe(1);
    // Exactly one receipt of 7 landed, even though the batch was sent twice.
    expect(await qtyOf()).toBe(before + 7);
    const projected = (await engine.projectedLevels(warehouseId)).find((l) => l.productId === bolt.id)!;
    expect(projected.quantity.toString()).toBe(String(before + 7));
    expect((await engine.status()).pending).toBe(0);
  });

  it('a server rejection reaches the device as a failed entry with the server code', async () => {
    const { transport, warehouseId, bolt } = await setup(USERS.cashier, 'POS-CASHIER-1');
    const engine = new SyncEngine({ orgId: DEMO_ORG, deviceId: 'POS-CASHIER-1', store: createMemoryStore(), transport });
    await engine.refreshCatalog();
    await engine.enqueue({ warehouseId, productId: bolt.id, unitId: unitOf(bolt), movementType: 'stock_in', quantity: '1', unitCost: '1', reasonCode: 'purchase' });
    const report = await engine.flush();
    expect(report.rejected).toBe(1);
    const [entry] = await engine.queued();
    expect(entry).toMatchObject({ status: 'failed', lastError: { code: 'forbidden' } });
  });
});

describe('warehouses and price tiers (PostgREST)', () => {
  it('saves price tiers and resolves the quantity break', async () => {
    const { catalog, inventory, bolt } = await setup(USERS.owner);
    const unit = unitOf(bolt);
    await inventory.savePriceTiers(DEMO_ORG, bolt.id, [{ unitId: unit, priceLevel: 'wholesale', minQuantity: '500', price: '0.6' }]);
    expect(await inventory.resolveSalePrice(bolt.id, unit, '499', 'wholesale')).toBe('0.75');
    expect(await inventory.resolveSalePrice(bolt.id, unit, '500', 'wholesale')).toBe('0.6');
    expect((await catalog.getProduct(bolt.id))?.sku).toBe('FST-HB-M10X50');
    await inventory.savePriceTiers(DEMO_ORG, bolt.id, []);
  });
});
