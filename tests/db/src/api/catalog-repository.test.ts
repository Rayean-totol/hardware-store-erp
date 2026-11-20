import { describe, expect, it } from 'vitest';
import { createSupabaseCatalogRepository, createSupabaseOrgRepository, DataError } from '@erp/data';
import { validateProductDraft, unitCatalog, type ProductDraft } from '@erp/domain';
import { clientFor } from '../api-client';
import { DEMO_ORG, USERS } from '../env';

const repoFor = async (user: string, device?: string) => createSupabaseCatalogRepository(await clientFor(user, device));

async function expectDataError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof DataError && e.code === code);
}

describe('catalog repository over PostgREST', () => {
  it('lists system units with exact decimal ratios', async () => {
    const units = await (await repoFor(USERS.cashier)).listUnits(DEMO_ORG);
    const gal = units.find((u) => u.code === 'gal');
    expect(gal?.ratioToDimensionBase).toBe('3.785411784000');
    expect(units.find((u) => u.code === 'pcs')?.allowFraction).toBe(false);
  });

  it('searches with paging, total count and embedded units', async () => {
    const repo = await repoFor(USERS.cashier);
    const page = await repo.searchProducts({ orgId: DEMO_ORG, limit: 5, offset: 0 });
    expect(page.total).toBe(12);
    expect(page.items).toHaveLength(5);
    const paint = (await repo.searchProducts({ orgId: DEMO_ORG, search: 'paint', limit: 10, offset: 0 })).items[0]!;
    expect(paint.sku).toBe('PNT-INT-WHT');
    expect(paint.units.map((u) => u.factor)).toEqual(['1.000000', '3.785412', '18.000000']);
    expect(paint.units[0]!.isBase).toBe(true);
    const byBarcode = await repo.searchProducts({ orgId: DEMO_ORG, search: '2000000100135', limit: 10, offset: 0 });
    expect(byBarcode.items.map((p) => p.sku)).toEqual(['SAF-GLV-L']);
  });

  it('creates, reads, updates and detects conflicts', async () => {
    const repo = await repoFor(USERS.manager, 'TEST-DEVICE');
    const units = unitCatalog(await repo.listUnits(DEMO_ORG));
    const pcs = [...units.values()].find((u) => u.code === 'pcs')!;
    const box = [...units.values()].find((u) => u.code === 'box')!;
    const draft: ProductDraft = {
      orgId: DEMO_ORG, sku: 'api test 1', nameEn: 'API test anchor', nameAr: 'مرساة اختبار', productType: 'stock',
      baseUnitId: pcs.id, taxCategory: 'S',
      units: [
        { unitId: pcs.id, factor: '1', isBase: true, barcode: null, salePrice: '1.25', isSaleUnit: true, isPurchaseUnit: true },
        { unitId: box.id, factor: '50', isBase: false, barcode: 'API-BOX-50', salePrice: '55', isSaleUnit: true, isPurchaseUnit: true },
      ],
    };
    const valid = validateProductDraft(draft, units);
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    const created = await repo.saveProduct(valid.value, null);
    const loaded = (await repo.getProduct(created.id))!;
    expect(loaded.sku).toBe('API-TEST-1');
    expect(loaded.units.map((u) => [u.factor, u.salePrice])).toEqual([['1.000000', '1.2500'], ['50.000000', '55.0000']]);

    const updated = await repo.saveProduct({ ...valid.value, id: created.id, nameEn: 'API test anchor v2' }, loaded.rowVersion);
    expect(updated.rowVersion).toBe(loaded.rowVersion + 1);
    await expectDataError(repo.saveProduct({ ...valid.value, id: created.id }, loaded.rowVersion), 'concurrency_conflict');
    await expectDataError(repo.saveProduct({ ...valid.value, id: undefined, sku: 'API-TEST-2' }, null), 'product.barcode_taken');
  });

  it('maps permission failures to DataError codes', async () => {
    const cashier = await repoFor(USERS.cashier);
    const product = (await cashier.searchProducts({ orgId: DEMO_ORG, search: 'hammer', limit: 1, offset: 0 })).items[0]!;
    await expectDataError(cashier.saveProduct({ ...product, units: product.units }, product.rowVersion), 'forbidden');
    await expectDataError(cashier.setProductArchived(product.id, true), 'forbidden');
    await expectDataError(cashier.saveBrand({ orgId: DEMO_ORG, name: 'Nope', isActive: true }), 'forbidden');

    const storekeeper = await repoFor(USERS.storekeeper);
    await expectDataError(storekeeper.setProductArchived(product.id, true), 'forbidden');

    const manager = await repoFor(USERS.manager);
    await manager.setProductArchived(product.id, true);
    const active = await manager.searchProducts({ orgId: DEMO_ORG, search: 'hammer', limit: 5, offset: 0 });
    expect(active.total).toBe(0);
    const all = await manager.searchProducts({ orgId: DEMO_ORG, search: 'hammer', includeArchived: true, limit: 5, offset: 0 });
    expect(all.items[0]?.archivedAt).not.toBeNull();
    await manager.setProductArchived(product.id, false);
  });

  it('saves categories and brands', async () => {
    const repo = await repoFor(USERS.manager);
    const brand = await repo.saveBrand({ orgId: DEMO_ORG, name: '  Tihama Tools ', isActive: true });
    expect(brand.name).toBe('Tihama Tools');
    const renamed = await repo.saveBrand({ id: brand.id, orgId: DEMO_ORG, name: 'Tihama Pro', isActive: false });
    expect(renamed).toMatchObject({ name: 'Tihama Pro', isActive: false, rowVersion: 2 });
    await expectDataError(repo.saveBrand({ orgId: DEMO_ORG, name: 'tihama pro', isActive: true }), 'conflict.unique');

    const cat = await repo.saveCategory({ orgId: DEMO_ORG, parentId: null, nameEn: 'Garden', nameAr: 'حدائق', nameBn: null, sortOrder: 100, isActive: true });
    expect((await repo.listCategories(DEMO_ORG)).some((c) => c.id === cat.id)).toBe(true);
  });
});

describe('org repository over PostgREST', () => {
  it('returns the caller context and members', async () => {
    const org = createSupabaseOrgRepository(await clientFor(USERS.owner));
    const [ctx] = await org.getMyContext();
    expect(ctx).toMatchObject({ orgId: DEMO_ORG, role: 'owner', pricesIncludeVat: true });
    expect(ctx!.branches.map((b) => b.code)).toEqual(['JED', 'RUH']);
    const members = await org.listMembers(DEMO_ORG);
    expect(members.map((m) => m.role).sort()).toEqual(['auditor', 'cashier', 'manager', 'owner', 'storekeeper']);
  });

  it('anonymous callers are rejected', async () => {
    const anon = createSupabaseOrgRepository(await clientFor(null));
    await expect(anon.getMyContext()).rejects.toBeInstanceOf(DataError);
  });
});
