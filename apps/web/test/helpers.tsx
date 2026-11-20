import type { Brand, CatalogRepository, Category, InventoryRepository, MembershipContext, OrgRepository, Product, SyncTransport, Unit, Warehouse } from '@erp/data';
import { ROLE_PERMISSIONS, type SystemRole } from '@erp/domain';
import type { Locale } from '@erp/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type * as React from 'react';
import { vi } from 'vitest';
import type { AuthService, ProductImageStore, Services } from '@/lib/services';
import { I18nProvider } from '@/providers/i18n-provider';
import { ServicesProvider } from '@/providers/services-provider';
import { SessionProvider, useSession } from '@/providers/session-provider';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/products/',
  useSearchParams: () => new URLSearchParams(),
}));

export const ORG = '00000000-0000-4000-8000-000000000001';

const unit = (id: string, code: string, nameEn: string, nameAr: string, dimension: Unit['dimension'], ratio: string | null, allowFraction: boolean): Unit => ({
  id, code, nameEn, nameAr, nameBn: null, dimension, ratioToDimensionBase: ratio, allowFraction,
  decimalPlaces: allowFraction ? 3 : 0, orgId: null, isActive: true,
});

export const UNITS: Unit[] = [
  unit('10000000-0000-4000-8000-000000000001', 'pcs', 'Piece', 'حبة', 'count', '1', false),
  unit('10000000-0000-4000-8000-000000000002', 'box', 'Box', 'علبة', 'count', null, false),
  unit('10000000-0000-4000-8000-000000000003', 'dozen', 'Dozen', 'دزينة', 'count', '12', false),
  unit('10000000-0000-4000-8000-000000000004', 'm', 'Metre', 'متر', 'length', '1', true),
];

export const CATEGORIES: Category[] = [
  { id: '30000000-0000-4000-8000-000000000001', orgId: ORG, parentId: null, nameEn: 'Fasteners', nameAr: 'مثبتات', nameBn: null, sortOrder: 1, isActive: true, rowVersion: 1 },
];
export const BRANDS: Brand[] = [
  { id: '40000000-0000-4000-8000-000000000001', orgId: ORG, name: 'Najd Fasteners', isActive: true, rowVersion: 1 },
];

export const WAREHOUSES: Warehouse[] = [
  { id: '70000000-0000-4000-8000-000000000001', branchId: '80000000-0000-4000-8000-000000000001', code: 'RUH', nameEn: 'Riyadh', nameAr: 'الرياض', nameBn: null, isActive: true, rowVersion: 1 },
];

export const HAMMER: Product = {
  id: '50000000-0000-4000-8000-000000000001', orgId: ORG, sku: 'TLS-HAM-16', nameEn: 'Claw hammer', nameAr: 'مطرقة مخلب', nameBn: null,
  description: null, categoryId: null, brandId: null, productType: 'stock', baseUnitId: UNITS[0]!.id, taxCategory: 'S',
  taxExemptionReasonCode: null, reorderLevel: null, archivedAt: null, imagePath: null, updatedAt: '2026-11-20T00:00:00Z', rowVersion: 3,
  units: [
    { id: '60000000-0000-4000-8000-000000000001', unitId: UNITS[0]!.id, factor: '1.000000', isBase: true, barcode: '2000000100104', salePrice: '35.0000', isSaleUnit: true, isPurchaseUnit: true },
    { id: '60000000-0000-4000-8000-000000000002', unitId: UNITS[1]!.id, factor: '12.000000', isBase: false, barcode: null, salePrice: '390.0000', isSaleUnit: true, isPurchaseUnit: true },
  ],
};

export function membership(role: SystemRole): MembershipContext {
  return {
    membershipId: 'm1', orgId: ORG, orgNameEn: 'Demo Hardware', orgNameAr: 'العدد التجريبية', pricesIncludeVat: true,
    role, allBranches: true, permissions: [...ROLE_PERMISSIONS[role]], branches: [],
  };
}

/** In-memory test doubles. They implement the same interfaces as the Supabase repositories. */
export function fakeServices(opts: { role?: SystemRole; products?: Product[] } = {}) {
  const products = opts.products ?? [HAMMER];
  const catalog: CatalogRepository = {
    listUnits: vi.fn(async () => UNITS),
    listCategories: vi.fn(async () => CATEGORIES),
    listBrands: vi.fn(async () => BRANDS),
    saveCategory: vi.fn(),
    saveBrand: vi.fn(),
    searchProducts: vi.fn(async (q) => {
      const items = products.filter((p) => !q.search || p.sku.includes(q.search.toUpperCase()) || p.nameEn.toLowerCase().includes(q.search.toLowerCase()));
      return { items, total: items.length };
    }),
    getProduct: vi.fn(async (id) => products.find((p) => p.id === id) ?? null),
    saveProduct: vi.fn(async () => ({ id: 'new-id', rowVersion: 1 })),
    setProductArchived: vi.fn(async () => undefined),
    setProductImagePath: vi.fn(async () => undefined),
  };
  const org: OrgRepository = {
    getMyContext: vi.fn(async () => [membership(opts.role ?? 'owner')]),
    createOrganization: vi.fn(),
    listMembers: vi.fn(async () => []),
    addMemberByEmail: vi.fn(),
  };
  const auth: AuthService = {
    getUser: vi.fn(async () => ({ id: 'u1', email: 'owner@example.test' })),
    onChange: vi.fn(() => () => undefined),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  };
  const inventory: InventoryRepository = {
    listWarehouses: vi.fn(async () => WAREHOUSES),
    saveWarehouse: vi.fn(),
    listStockLevels: vi.fn(async () => []),
    listLowStock: vi.fn(async () => []),
    listMovements: vi.fn(async () => []),
    applyMovements: vi.fn(async () => []),
    listPriceTiers: vi.fn(async () => []),
    savePriceTiers: vi.fn(async () => 0),
    resolveSalePrice: vi.fn(async () => null),
  };
  const syncTransport: SyncTransport = {
    applyMovements: vi.fn(async () => []),
    listStockLevels: vi.fn(async () => []),
    loadCatalog: vi.fn(async () => ({
      products: [],
      allowNegativeStock: true,
    })),
  };
  const productImages: ProductImageStore = {
    upload: vi.fn(async () => 'org/product/x.jpg'),
    signedUrl: vi.fn(async () => 'https://example.test/x.jpg'),
  };
  const services: Services = { catalog, org, auth, inventory, syncTransport, productImages };
  return services;
}

/** Mirrors AppShell: pages render only once the session and membership are loaded. */
function WhenReady({ children }: { children: React.ReactNode }) {
  const { status, membership } = useSession();
  return status === 'signed_in' && membership ? <>{children}</> : null;
}

export function renderWithProviders(ui: React.ReactElement, opts: { services?: Services; locale?: Locale } = {}) {
  const services = opts.services ?? fakeServices();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <I18nProvider locale={opts.locale ?? 'en'}>
      <QueryClientProvider client={queryClient}>
        <ServicesProvider services={services}>
          <SessionProvider><WhenReady>{ui}</WhenReady></SessionProvider>
        </ServicesProvider>
      </QueryClientProvider>
    </I18nProvider>,
  );
  return { ...result, services };
}
