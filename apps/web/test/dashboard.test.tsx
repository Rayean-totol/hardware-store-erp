import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/app-shell';
import { Dashboard } from '@/features/dashboard/dashboard';
import { fakeServices, renderWithProviders } from './helpers';

// The desktop sidebar and the phone bottom bar both render links; these tests check the sidebar.
async function sidebar() {
  await waitFor(() => expect(document.querySelector('aside')).not.toBeNull());
  return within(document.querySelector('aside') as HTMLElement);
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a href={href} {...rest}>{children}</a>,
}));

describe('dashboard', () => {
  it('shows only real inventory figures from the service, formatted in SAR', async () => {
    const services = fakeServices();
    services.inventory.getInventorySummary = vi.fn(async () => ({
      stockValue: '185430', stockPositions: 3842, outOfStockCount: 7, lowStockCount: 5, productCount: 2486,
    }));
    services.inventory.listLowStock = vi.fn(async () => [{
      warehouseId: 'w1', branchId: 'b1', productId: 'p1', sku: 'PVC-001', nameEn: 'PVC pipe', nameAr: 'ماسورة',
      quantity: '8', reorderLevel: '50', shortage: '42',
    }]);
    renderWithProviders(<Dashboard />, { services });
    expect(await screen.findByText(/SAR\s?185,430\.00/)).toBeInTheDocument();
    expect(screen.getByText('2,486')).toBeInTheDocument();
    expect(screen.getByText('PVC-001')).toBeInTheDocument();
  });

  it('marks figures from unbuilt modules as not available, never as numbers', async () => {
    renderWithProviders(<Dashboard />, { services: fakeServices() });
    expect((await screen.findAllByText('Not available yet')).length).toBeGreaterThanOrEqual(8);
    expect(screen.getByText(/Available after POS \(Phase 3\)/)).toBeInTheDocument();
  });
});

describe('navigation shell', () => {
  it('a cashier sees the POS / Sales link (cashiers hold sales.read and sales.create)', async () => {
    renderWithProviders(<AppShell><div>content</div></AppShell>, { services: fakeServices({ role: 'cashier' }) });
    const pos = (await (await sidebar()).findByText('POS / Sales')).closest('a');
    expect(pos).toHaveAttribute('href', '/pos/');
  });

  it('a role without sales.read does not see the POS link (accountant has it; storekeeper does not)', async () => {
    renderWithProviders(<AppShell><div>content</div></AppShell>, { services: fakeServices({ role: 'storekeeper' }) });
    (await sidebar()).getByText('Products');
    expect((await sidebar()).queryByText('POS / Sales')).not.toBeInTheDocument();
  });

  it('links live modules and shows unbuilt modules as disabled, not clickable', async () => {
    renderWithProviders(<AppShell><div>content</div></AppShell>, { services: fakeServices() });
    const dashboardLink = (await sidebar()).getByText('Dashboard').closest('a');
    expect(dashboardLink).toHaveAttribute('href', '/dashboard/');
    // POS is live for roles with sales.read (Phase 3); the remaining planned modules stay disabled.
    const side = await sidebar();
    const pos = side.getByText('POS / Sales');
    expect(pos.closest('a')).toHaveAttribute('href', '/pos/');
    // Purchase orders are live now; Customers is still a planned module.
    const purchase = side.getByText('Customers');
    expect(purchase.closest('a')).toBeNull();
    expect(purchase.closest('[aria-disabled="true"]')).not.toBeNull();
    // Suppliers and purchase orders are live; eight planned modules are still shown as Soon.
    expect(screen.getAllByText('Soon').length).toBeGreaterThanOrEqual(8);
  });
});
