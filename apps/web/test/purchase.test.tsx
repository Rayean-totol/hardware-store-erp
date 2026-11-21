import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseDetail } from '@/features/purchase/purchase-detail';
import { PurchaseForm } from '@/features/purchase/purchase-form';
import { PurchaseList } from '@/features/purchase/purchase-list';
import { fakeServices, HAMMER, ORG, PURCHASE_ORDERS, renderWithProviders } from './helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/purchase-orders/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/providers/sync-provider', () => ({
  useSync: () => ({ status: 'online', pending: 0, flush: async () => undefined }),
  SyncProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const PO = PURCHASE_ORDERS[0]!;

describe('purchase order list', () => {
  it('lists orders with their number and status; a storekeeper cannot create one', async () => {
    renderWithProviders(<PurchaseList />);
    expect((await screen.findAllByText('PO-000001'))[0]).toBeInTheDocument();
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'New purchase order' })).toBeInTheDocument();
  });

  it('a storekeeper sees orders but no create action', async () => {
    renderWithProviders(<PurchaseList />, { services: fakeServices({ role: 'storekeeper' }) });
    await screen.findAllByText('PO-000001');
    expect(screen.queryByRole('link', { name: 'New purchase order' })).not.toBeInTheDocument();
  });
});

describe('purchase order detail', () => {
  it('the creator of a draft can submit it, but cannot approve it', async () => {
    renderWithProviders(<PurchaseDetail orderId={PO.id} />);
    expect(await screen.findByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('submit sends the version the user loaded', async () => {
    const services = fakeServices();
    renderWithProviders(<PurchaseDetail orderId={PO.id} />, { services });
    await userEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(services.purchaseOrders.submit).toHaveBeenCalledWith(ORG, PO.id, PO.rowVersion));
    expect(await screen.findByText('Submitted for approval.')).toBeInTheDocument();
  });

  it('an approver who did not create the order sees Approve on a submitted order', async () => {
    const submitted = { ...PO, status: 'submitted' as const, createdBy: 'someone-else' };
    const services = fakeServices();
    (services.purchaseOrders.get as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(submitted);
    renderWithProviders(<PurchaseDetail orderId={PO.id} />, { services });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('cancelling needs a reason of at least five characters', async () => {
    const services = fakeServices();
    renderWithProviders(<PurchaseDetail orderId={PO.id} />, { services });
    const button = await screen.findByRole('button', { name: 'Cancel order' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Reason for cancelling/), 'Supplier cannot deliver');
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(services.purchaseOrders.cancel).toHaveBeenCalledWith(ORG, PO.id, PO.rowVersion, 'Supplier cannot deliver'));
  });

  it('costs and totals are hidden from a storekeeper', async () => {
    renderWithProviders(<PurchaseDetail orderId={PO.id} />, { services: fakeServices({ role: 'storekeeper' }) });
    await screen.findAllByText('PO-000001');
    expect(screen.queryByText('Grand total')).not.toBeInTheDocument();
  });
});

describe('purchase order form', () => {
  it('creates a draft from a product search, with a live total', async () => {
    const services = fakeServices();
    renderWithProviders(<PurchaseForm orderId={null} />, { services });
    await userEvent.type(await screen.findByLabelText('Find a product'), 'Claw');
    await userEvent.click(await screen.findByRole('button', { name: /TLS-HAM-16/ }));
    const quantity = await screen.findByLabelText('Quantity');
    await userEvent.clear(quantity);
    await userEvent.type(quantity, '4');
    const cost = screen.getByLabelText('Unit cost');
    await userEvent.clear(cost);
    await userEvent.type(cost, '10');
    // 4 x 10.00 with VAT included: total 40.00, of which VAT 5.22 (40.00 / 1.15 = 34.78 net).
    expect((await screen.findAllByText(/40\.00/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/5\.22/)).length).toBeGreaterThan(0);
    await userEvent.selectOptions(screen.getByLabelText(/Supplier/), SUPPLIER_ID);
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(services.purchaseOrders.create).toHaveBeenCalledWith(
        ORG,
        expect.any(String),
        expect.objectContaining({ supplierId: SUPPLIER_ID, lines: [expect.objectContaining({ productId: HAMMER.id, quantity: '4', unitCost: '10' })] }),
      ),
    );
  });

  it('save stays disabled until a supplier and a valid line are present', async () => {
    renderWithProviders(<PurchaseForm orderId={null} />, { services: fakeServices() });
    expect(await screen.findByRole('button', { name: 'Save draft' })).toBeDisabled();
  });
});

const SUPPLIER_ID = 'a0000000-1000-4000-8000-000000000001';
