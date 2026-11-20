import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/app-shell';
import { Dashboard } from '@/features/dashboard/dashboard';
import { fakeServices, renderWithProviders } from './helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a href={href} {...rest}>{children}</a>,
}));

vi.mock('@/providers/sync-provider', () => ({
  SyncProvider: ({ children }: { children: React.ReactNode }) => children,
  useSync: () => ({ ready: false }),
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
  it('links live modules and shows unbuilt modules as disabled, not clickable', async () => {
    renderWithProviders(<AppShell><div>content</div></AppShell>, { services: fakeServices() });
    const dashboardLink = (await screen.findByText('Dashboard')).closest('a');
    expect(dashboardLink).toHaveAttribute('href', '/dashboard/');
    const pos = screen.getByText('POS / Sales');
    expect(pos.closest('a')).toBeNull();
    expect(pos.closest('[aria-disabled="true"]')).not.toBeNull();
    expect(screen.getAllByText('Soon').length).toBeGreaterThanOrEqual(10);
  });
});
