import type { Brand, CatalogRepository, Category, Customer, InventoryRepository, MembershipContext, MovementPayload, OrgRepository, Product, PurchaseOrder, PurchaseOrderRepository, SalesRepository, Supplier, SupplierRepository, Unit, Warehouse } from '@erp/data';
import { ROLE_PERMISSIONS, type SystemRole } from '@erp/domain';
import type { Locale } from '@erp/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type * as React from 'react';
import { vi } from 'vitest';
import type { AuthService, ProductImageStore, Services } from '@/lib/services';
import { ConnectionContext, type ConnectionValue } from '@/providers/connection-provider';
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

export const CUSTOMERS: Customer[] = [
  { id: '90000000-0000-4000-8000-000000000001', name: 'Al Tamimi Build', phone: null, creditAllowed: true },
  { id: '90000000-0000-4000-8000-000000000002', name: 'Walk-in cash', phone: null, creditAllowed: false },
];

export const SUPPLIERS: Supplier[] = [
  {
    id: 'a0000000-1000-4000-8000-000000000001', supplierNo: 'SUP-000001', supplierCode: 'NAJD', nameEn: 'Najd Fasteners', nameAr: 'مثبتات نجد',
    nameBn: null, contactPerson: 'Khalid', mobile: '+966501234567', whatsapp: null, email: null, address: null, city: 'Riyadh',
    countryCode: 'SA', vatNumber: null, crNumber: null, paymentTermsDays: 30, defaultCurrency: 'SAR', notes: null, isActive: true,
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z', rowVersion: 3,
    openingBalance: '1500.50', creditLimit: '20000.00', bankName: 'Al Rajhi', bankAccountName: 'Najd', iban: 'SA0380000000608010167519',
    openingBalanceLocked: false, currentBalance: '1500.50',
  },
];

export const PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: 'po-1', poNumber: 'PO-000001', status: 'draft', supplierId: SUPPLIERS[0]!.id, supplierNameEn: 'Najd Fasteners', supplierNo: 'SUP-000001',
    branchId: '80000000-0000-4000-8000-000000000001', warehouseId: '70000000-0000-4000-8000-000000000001', expectedDeliveryDate: null,
    deliveryNotes: null, createdAt: '2026-11-21T08:00:00Z', createdBy: 'u1', submittedAt: null, approvedAt: null, cancelledAt: null,
    cancelReason: null, rowVersion: 1, lines: [], grandTotal: '57.50',
  },
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
    role, allBranches: true, permissions: [...ROLE_PERMISSIONS[role]],
    branches: [{ id: '80000000-0000-4000-8000-000000000001', code: 'RUH', nameEn: 'Riyadh', nameAr: 'الرياض' }],
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
      const items = products.filter((p) => !q.search || p.sku.includes(q.search.toUpperCase()) || p.nameEn.toLowerCase().includes(q.search.toLowerCase())
        || p.units.some((u) => u.barcode === q.search));
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
    getInventorySummary: vi.fn(async () => ({ stockValue: '0', stockPositions: 0, outOfStockCount: 0, lowStockCount: 0, productCount: 0 })),
    listMovements: vi.fn(async () => []),
    applyMovements: vi.fn(async (_org: string, _device: string, batch: MovementPayload[]) => batch.map((m) => ({
      clientId: m.clientId, status: 'applied' as const, movementId: 'mv-1', balanceAfter: '0', averageCostAfter: '0',
      warnings: [], code: null, message: null, detail: null,
    }))),
    listPriceTiers: vi.fn(async () => []),
    savePriceTiers: vi.fn(async () => 0),
    resolveSalePrice: vi.fn(async () => null),
  };
  const sales: SalesRepository = {
    finalizeSale: vi.fn(async () => ({
      status: 'created' as const, saleId: 'sale-1', invoiceNumber: 'INV-RUH-2026-000001', saleStatus: 'finalized' as const,
      netTotal: '0.00', discountTotal: '0.00', vatTotal: '0.00', grossTotal: '0.00', paidTotal: '0.00', changeGiven: '0.00', balanceDue: '0.00',
    })),
    cancelSale: vi.fn(async () => {
      throw new Error('not used');
    }),
    listRecentSales: vi.fn(async () => []),
    listCustomers: vi.fn(async () => CUSTOMERS),
  };
  // Mirrors the server: financial and bank fields are present only with suppliers.manage.
  const canManageSuppliers = ROLE_PERMISSIONS[opts.role ?? 'owner'].includes('suppliers.manage');
  const visible = (s: Supplier): Supplier => {
    if (canManageSuppliers) return s;
    const { openingBalance: _o, creditLimit: _c, bankName: _b, bankAccountName: _a, iban: _i, openingBalanceLocked: _l, currentBalance: _cb, ...rest } = s;
    return rest;
  };
  const suppliers: SupplierRepository = {
    list: vi.fn(async () => ({ items: SUPPLIERS.map(visible), total: SUPPLIERS.length, limit: 25, offset: 0 })),
    get: vi.fn(async (_org, id) => visible(SUPPLIERS.find((s) => s.id === id) ?? SUPPLIERS[0]!)),
    save: vi.fn(async () => ({ id: 'supplier-new', supplierNo: 'SUP-000002', rowVersion: 1 })),
    adjustBalance: vi.fn(async () => ({ status: 'created' as const, entryId: 'entry-1', balance: '1450.50' })),
  };
  const purchaseOrders: PurchaseOrderRepository = {
    list: vi.fn(async () => ({ items: PURCHASE_ORDERS, total: PURCHASE_ORDERS.length, limit: 50, offset: 0 })),
    get: vi.fn(async (_org, id) => PURCHASE_ORDERS.find((p) => p.id === id) ?? PURCHASE_ORDERS[0]!),
    create: vi.fn(async () => ({ status: 'created' as const, id: 'po-new', poNumber: 'PO-000002', rowVersion: 1 })),
    update: vi.fn(async () => ({ status: 'updated' as const, id: 'po-1', poNumber: 'PO-000001', rowVersion: 2 })),
    submit: vi.fn(async () => ({ status: 'submitted' as const, id: 'po-1', poNumber: 'PO-000001', rowVersion: 2 })),
    approve: vi.fn(async () => ({ status: 'approved' as const, id: 'po-1', poNumber: 'PO-000001', rowVersion: 3 })),
    cancel: vi.fn(async () => ({ status: 'cancelled' as const, id: 'po-1', poNumber: 'PO-000001', rowVersion: 2 })),
  };
  const productImages: ProductImageStore = {
    upload: vi.fn(async () => 'org/product/x.jpg'),
    signedUrl: vi.fn(async () => 'https://example.test/x.jpg'),
  };
  const services: Services = { catalog, org, auth, inventory, sales, suppliers, purchaseOrders, productImages };
  return services;
}

/** Mirrors AppShell: pages render only once the session and membership are loaded. */
function WhenReady({ children }: { children: React.ReactNode }) {
  const { status, membership } = useSession();
  return status === 'signed_in' && membership ? <>{children}</> : null;
}

export function renderWithProviders(
  ui: React.ReactElement,
  opts: { services?: Services; locale?: Locale; connection?: 'online' | 'offline' } = {},
) {
  const services = opts.services ?? fakeServices();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const online = opts.connection !== 'offline';
  const connection: ConnectionValue = { state: online ? 'online' : 'offline', writable: online, revalidate: async () => online };
  const result = render(
    <I18nProvider locale={opts.locale ?? 'en'}>
      <ConnectionContext.Provider value={connection}>
        <QueryClientProvider client={queryClient}>
          <ServicesProvider services={services}>
            <SessionProvider><WhenReady>{ui}</WhenReady></SessionProvider>
          </ServicesProvider>
        </QueryClientProvider>
      </ConnectionContext.Provider>
    </I18nProvider>,
  );
  return { ...result, services };
}
