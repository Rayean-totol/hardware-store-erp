import { DataError } from '@erp/data';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MovementForm } from '@/features/inventory/movement-form';
import { fakeServices, HAMMER, renderWithProviders, WAREHOUSES } from './helpers';

const BARCODE = '2000000100104';

async function pickHammer(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Barcode or SKU'), `${BARCODE}{Enter}`);
  expect(await screen.findByText('Claw hammer')).toBeInTheDocument();
}

describe('stock movement form (server-first)', () => {
  it('finds a product on the server by barcode and records a receipt', async () => {
    const services = fakeServices();
    const user = userEvent.setup();
    renderWithProviders(<MovementForm initialType="stock_in" />, { services });
    await pickHammer(user);
    await user.type(screen.getByLabelText(/^Quantity/), '2');
    await user.type(screen.getByLabelText(/Cost per unit/), '25');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText('Movement recorded.')).toBeInTheDocument();
    expect(services.inventory.applyMovements).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(services.inventory.applyMovements).mock.calls[0]![2];
    expect(batch).toEqual([expect.objectContaining({
      productId: HAMMER.id, warehouseId: WAREHOUSES[0]!.id, movementType: 'stock_in', quantity: '2', unitCost: '25',
    })]);
    expect(batch[0]!.clientId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses the same idempotency key when a failed send is retried unchanged', async () => {
    const services = fakeServices();
    vi.mocked(services.inventory.applyMovements)
      .mockRejectedValueOnce(new DataError('network', 'Failed to fetch'))
      .mockImplementation(async (_o, _d, batch) => batch.map((m) => ({
        clientId: m.clientId, status: 'applied' as const, movementId: 'mv', balanceAfter: '2', averageCostAfter: '25',
        warnings: [], code: null, message: null, detail: null,
      })));
    const user = userEvent.setup();
    renderWithProviders(<MovementForm initialType="stock_in" />, { services });
    await pickHammer(user);
    await user.type(screen.getByLabelText(/^Quantity/), '2');
    await user.type(screen.getByLabelText(/Cost per unit/), '25');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText('Movement recorded.')).toBeInTheDocument();
    const keys = vi.mocked(services.inventory.applyMovements).mock.calls.map((c) => c[2][0]!.clientId);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('shows validation messages and sends nothing for an invalid adjustment', async () => {
    const services = fakeServices();
    const user = userEvent.setup();
    renderWithProviders(<MovementForm initialType="adjustment" />, { services });
    await pickHammer(user);
    await user.type(screen.getByLabelText(/Signed quantity/), '-3');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText('Choose a reason for the adjustment.')).toBeInTheDocument();
    expect(services.inventory.applyMovements).not.toHaveBeenCalled();
  });

  it('keeps a server rejection visible with its reason and does not report success', async () => {
    const services = fakeServices();
    vi.mocked(services.inventory.applyMovements).mockImplementation(async (_o, _d, batch) => batch.map((m) => ({
      clientId: m.clientId, status: 'rejected' as const, movementId: null, balanceAfter: null, averageCostAfter: null,
      warnings: [], code: 'forbidden', message: 'forbidden', detail: null,
    })));
    const user = userEvent.setup();
    renderWithProviders(<MovementForm initialType="stock_in" />, { services });
    await pickHammer(user);
    await user.type(screen.getByLabelText(/^Quantity/), '1');
    await user.type(screen.getByLabelText(/Cost per unit/), '3');
    await user.click(screen.getByRole('button', { name: 'Record movement' }));
    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument();
    expect(screen.queryByText('Movement recorded.')).not.toBeInTheDocument();
  });

  it('while offline, product search says it needs a connection and recording is disabled', async () => {
    const services = fakeServices();
    const user = userEvent.setup();
    renderWithProviders(<MovementForm initialType="stock_in" />, { services, connection: 'offline' });
    await user.type(await screen.findByLabelText('Barcode or SKU'), `${BARCODE}{Enter}`);
    expect(await screen.findByText('Product search needs a connection to the server.')).toBeInTheDocument();
    expect(services.catalog.searchProducts).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Record movement' })).not.toBeInTheDocument();
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

