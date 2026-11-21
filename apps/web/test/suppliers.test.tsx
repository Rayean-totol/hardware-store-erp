import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/app-shell';
import { SupplierForm } from '@/features/suppliers/supplier-form';
import { SupplierList } from '@/features/suppliers/supplier-list';
import { SupplierProfile } from '@/features/suppliers/supplier-profile';
import { fakeServices, ORG, renderWithProviders, SUPPLIERS } from './helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/suppliers/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/providers/sync-provider', () => ({
  useSync: () => ({ status: 'online', pending: 0, flush: async () => undefined }),
  SyncProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const NAJD = SUPPLIERS[0]!;

describe('supplier directory', () => {
  it('lists suppliers with their supplier ID and status', async () => {
    renderWithProviders(<SupplierList />);
    expect((await screen.findAllByText('Najd Fasteners')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('SUP-000001').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'New supplier' })).toBeInTheDocument();
  });

  it('a storekeeper can read the directory but has no create or edit action', async () => {
    renderWithProviders(<SupplierList />, { services: fakeServices({ role: 'storekeeper' }) });
    await screen.findAllByText('Najd Fasteners');
    expect(screen.queryByRole('link', { name: 'New supplier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Edit SUP-000001/ })).not.toBeInTheDocument();
  });

  it('searches through the repository', async () => {
    const services = fakeServices();
    renderWithProviders(<SupplierList />, { services });
    await screen.findAllByText('Najd Fasteners');
    await userEvent.type(screen.getByRole('searchbox'), 'najd');
    await waitFor(() => expect(services.suppliers.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'najd' })));
  });
});

describe('supplier form', () => {
  it('shows the first problem and sends nothing when a required name is missing', async () => {
    const services = fakeServices();
    renderWithProviders(<SupplierForm supplierId={null} />, { services });
    await userEvent.click(await screen.findByRole('button', { name: 'Save supplier' }));
    expect(await screen.findByText('Enter the supplier name in English and Arabic.')).toBeInTheDocument();
    expect(services.suppliers.save).not.toHaveBeenCalled();
  });

  it('explains a malformed VAT number before saving', async () => {
    const services = fakeServices();
    renderWithProviders(<SupplierForm supplierId={null} />, { services });
    await userEvent.type(await screen.findByLabelText(/Name \(English\)/), 'Najd');
    await userEvent.type(screen.getByLabelText(/Name \(Arabic\)/), 'نجد');
    await userEvent.type(screen.getByLabelText('VAT registration number'), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
    expect(await screen.findByText('A VAT number has 15 digits and starts and ends with 3.')).toBeInTheDocument();
    expect(services.suppliers.save).not.toHaveBeenCalled();
  });

  it('an owner creates a supplier with the financial terms', async () => {
    const services = fakeServices();
    renderWithProviders(<SupplierForm supplierId={null} />, { services });
    await userEvent.type(await screen.findByLabelText(/Name \(English\)/), 'Najd Fasteners');
    await userEvent.type(screen.getByLabelText(/Name \(Arabic\)/), 'مثبتات نجد');
    await userEvent.type(screen.getByLabelText(/Credit limit/), '5000');
    await userEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
    await waitFor(() =>
      expect(services.suppliers.save).toHaveBeenCalledWith(
        ORG,
        expect.objectContaining({ nameEn: 'Najd Fasteners', nameAr: 'مثبتات نجد', creditLimit: '5000', openingBalance: '0' }),
        null,
      ),
    );
  });

  it('a storekeeper does not see the financial section and the save omits financial fields', async () => {
    const services = fakeServices({ role: 'storekeeper' });
    renderWithProviders(<SupplierForm supplierId={null} />, { services });
    expect(await screen.findByText('Financial terms and bank details are visible to managers only.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Credit limit/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Name \(English\)/), 'Najd');
    await userEvent.type(screen.getByLabelText(/Name \(Arabic\)/), 'نجد');
    await userEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
    await waitFor(() => expect(services.suppliers.save).toHaveBeenCalled());
    const input = (services.suppliers.save as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as Record<string, unknown>;
    expect(input).not.toHaveProperty('openingBalance');
    expect(input).not.toHaveProperty('iban');
  });

  it('an edit sends the version it loaded', async () => {
    const services = fakeServices();
    renderWithProviders(<SupplierForm supplierId={NAJD.id} />, { services });
    expect(await screen.findByDisplayValue('Najd Fasteners')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
    await waitFor(() => expect(services.suppliers.save).toHaveBeenCalledWith(ORG, expect.objectContaining({ id: NAJD.id }), NAJD.rowVersion));
  });
});

describe('supplier profile', () => {
  it('an owner sees balances and bank details', async () => {
    renderWithProviders(<SupplierProfile supplierId={NAJD.id} />);
    expect(await screen.findByText('Financial terms')).toBeInTheDocument();
    expect(screen.getByText('SA0380000000608010167519')).toBeInTheDocument();
  });

  it('a storekeeper sees no financial terms, and the history sections say what arrives later', async () => {
    renderWithProviders(<SupplierProfile supplierId={NAJD.id} />, { services: fakeServices({ role: 'storekeeper' }) });
    expect((await screen.findAllByText('Najd Fasteners'))[0]).toBeInTheDocument();
    expect(screen.queryByText('Financial terms')).not.toBeInTheDocument();
    expect(screen.queryByText('SA0380000000608010167519')).not.toBeInTheDocument();
    expect(screen.getByText(/will appear here in Phase 4C/)).toBeInTheDocument();
    expect(screen.getByText(/Phase 4D/)).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('a storekeeper sees Suppliers; a cashier does not', async () => {
    const { unmount } = renderWithProviders(<AppShell><div>x</div></AppShell>, { services: fakeServices({ role: 'storekeeper' }) });
    const link = await screen.findByRole('link', { name: 'Suppliers' });
    expect(link.getAttribute('href')).toMatch(/^\/suppliers\/?$/);
    unmount();
    renderWithProviders(<AppShell><div>x</div></AppShell>, { services: fakeServices({ role: 'cashier' }) });
    await screen.findAllByText('POS / Sales');
    expect(screen.queryByRole('link', { name: 'Suppliers' })).not.toBeInTheDocument();
  });
});
