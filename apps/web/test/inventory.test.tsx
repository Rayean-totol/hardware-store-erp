import { createMemoryStore, SyncEngine, type CachedProduct, type FlushReport, type OutboxEntry } from '@erp/data';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MovementForm } from '@/features/inventory/movement-form';
import { SyncPanel } from '@/features/inventory/sync-panel';
import { ORG, renderWithProviders, UNITS, fakeServices } from './helpers';

const sync = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/providers/sync-provider', () => ({ useSync: () => sync.value }));

const PCS = UNITS[0]!.id;
const BOX = UNITS[1]!.id;
const WH = '70000000-0000-4000-8000-000000000001';
const SCREW: CachedProduct = {
  id: '50000000-0000-4000-8000-000000000010', sku: 'FST-WS-4X40', nameEn: 'Wood screw', nameAr: 'برغي', nameBn: null,
  productType: 'stock', baseUnitId: PCS, baseUnitAllowsFraction: false, reorderLevel: '500', archived: false,
  units: [
    { unitId: PCS, factor: '1', barcode: '2000000100012' },
    { unitId: BOX, factor: '200', barcode: '2000000100029' },
  ],
};

let engine: SyncEngine;
let online: boolean;
let rejectAll: string | null;
const clock = Date.parse('2026-11-20T10:00:00Z');
let counter = 0;

function makeEngine(allowNegative = true) {
  const transport = {
    applyMovements: vi.fn(async (_o: string, _d: string, batch: Array<{ clientId: string }>) => {
      if (!online) throw new Error('offline');
      return batch.map((m) => rejectAll
        ? { clientId: m.clientId, status: 'rejected' as const, movementId: null, balanceAfter: null, averageCostAfter: null, warnings: [], code: rejectAll, message: rejectAll, detail: null }
        : { clientId: m.clientId, status: 'applied' as const, movementId: 'x', balanceAfter: '1', averageCostAfter: '1', warnings: [], code: null, message: null, detail: null });
    }),
    listStockLevels: vi.fn(async () => []),
    loadCatalog: vi.fn(async () => ({ products: [SCREW], allowNegativeStock: allowNegative })),
  };
  return new SyncEngine({
    orgId: ORG, deviceId: 'UI-TEST', store: createMemoryStore(), transport,
    now: () => clock, newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  });
}

function setSync(overrides: Partial<Record<string, unknown>> = {}) {
  const state = {
    ready: true, engine, durable: true, storageError: null, online,
    status: null as unknown, queue: [] as OutboxEntry[], lastReport: null as FlushReport | null,
    flush: async () => {
      const report = await engine.flush();
      state.lastReport = report;
      return report;
    },
    refresh: async () => {},
    ...overrides,
  };
  sync.value = state;
  return state;
}

beforeEach(async () => {
  online = true;
  rejectAll = null;
  engine = makeEngine(true);
  await engine.refreshCatalog();
  setSync();
});

describe('stock movement form', () => {
  it('scans a barcode from the downloaded catalog and records a receipt', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MovementForm initialType="stock_in" />, { services: fakeServices() });
    const scan = await screen.findByLabelText('Barcode or SKU');
    await user.type(scan, '2000000100029{Enter}');
    expect(await screen.findByText('Wood screw')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Quantity/), '2');
    await user.type(screen.getByLabelText(/Cost per unit/), '25');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText('Movement recorded.')).toBeInTheDocument();
    const queue = await engine.queued();
    expect(queue).toHaveLength(0);
  });

  it('shows validation messages instead of queueing invalid movements', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MovementForm initialType="adjustment" />, { services: fakeServices() });
    await user.type(await screen.findByLabelText('Barcode or SKU'), '2000000100012{Enter}');
    await user.type(await screen.findByLabelText(/Signed quantity/), '-3');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText('Choose a reason for the adjustment.')).toBeInTheDocument();
    expect(await engine.queued()).toHaveLength(0);
  });

  it('refuses to queue an overdraw when the organization disallows negative stock, with the reason', async () => {
    engine = makeEngine(false);
    await engine.refreshCatalog();
    setSync({ engine, online: false });
    const user = userEvent.setup();
    renderWithProviders(<MovementForm initialType="stock_out" />, { services: fakeServices() });
    await user.type(await screen.findByLabelText('Barcode or SKU'), '2000000100012{Enter}');
    await user.type(await screen.findByLabelText(/^Quantity/), '5');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText(/Not enough stock for this movement \(available: 0\)/)).toBeInTheDocument();
  });

  it('keeps a server rejection visible for review instead of reporting success', async () => {
    rejectAll = 'forbidden';
    const user = userEvent.setup();
    renderWithProviders(<MovementForm initialType="stock_in" />, { services: fakeServices() });
    await user.type(await screen.findByLabelText('Barcode or SKU'), '2000000100012{Enter}');
    await user.type(await screen.findByLabelText(/^Quantity/), '1');
    await user.type(screen.getByLabelText(/Cost per unit/), '3');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText(/kept under Sync for review/)).toBeInTheDocument();
    const [failed] = await engine.queued();
    expect(failed).toMatchObject({ status: 'failed', lastError: { code: 'forbidden' } });
  });

  it('queues while offline and says so', async () => {
    online = false;
    setSync({ online: false });
    const user = userEvent.setup();
    renderWithProviders(<MovementForm initialType="stock_in" />, { services: fakeServices() });
    await user.type(await screen.findByLabelText('Barcode or SKU'), '2000000100012{Enter}');
    await user.type(await screen.findByLabelText(/^Quantity/), '4');
    await user.type(screen.getByLabelText(/Cost per unit/), '2');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText(/Saved on this device/)).toBeInTheDocument();
    await waitFor(async () => expect((await engine.queued())[0]?.status).toBe('pending'));
  });

  it('only offers the movement types the role may record', async () => {
    renderWithProviders(<MovementForm initialType={null} />, { services: fakeServices({ role: 'storekeeper' }) });
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Stock in', 'Stock out']);
  });

  it('cashiers see that they cannot record movements', async () => {
    renderWithProviders(<MovementForm initialType={null} />, { services: fakeServices({ role: 'cashier' }) });
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});

describe('sync panel', () => {
  it('shows connection state, counts and rejected movements with retry and discard', async () => {
    rejectAll = 'forbidden';
    await engine.enqueue({ warehouseId: WH, productId: SCREW.id, unitId: PCS, movementType: 'stock_in', quantity: '1', unitCost: '1', reasonCode: 'purchase' });
    await engine.flush();
    setSync({ engine, status: await engine.status(), queue: await engine.queued(), online: true });
    renderWithProviders(<SyncPanel />, { services: fakeServices() });
    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Rejected by the server')).toBeInTheDocument();
    const row = screen.getByText(/You do not have permission to do this/).closest('li')!;
    expect(within(row).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('warns when offline storage is not durable', async () => {
    setSync({ durable: false, storageError: 'blocked by the browser' });
    renderWithProviders(<SyncPanel />, { services: fakeServices() });
    expect(await screen.findByText(/Offline storage is not available/)).toBeInTheDocument();
    expect(screen.getByText(/blocked by the browser/)).toBeInTheDocument();
  });
});
