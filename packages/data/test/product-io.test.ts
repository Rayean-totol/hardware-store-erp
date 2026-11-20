import { describe, expect, it, vi } from 'vitest';
import { applyImportPlan, DataError, exportProductsCsv, planImportFile, type CatalogRepository, type Product } from '../src';
import { ORG, PCS, BOX } from './fixtures';

const existing: Product = {
  id: '50000000-0000-4000-8000-000000000001', orgId: ORG, sku: 'WS-4X40', nameEn: 'Wood screw', nameAr: 'برغي', nameBn: null,
  description: null, categoryId: null, brandId: null, productType: 'stock', baseUnitId: PCS, taxCategory: 'S',
  taxExemptionReasonCode: null, reorderLevel: null, archivedAt: null, imagePath: null, updatedAt: 'x', rowVersion: 4,
  units: [{ id: 'u1', unitId: PCS, factor: '1', isBase: true, barcode: null, salePrice: '0.15', isSaleUnit: true, isPurchaseUnit: true }],
};

function fakeCatalog(saveImpl?: (d: unknown, v: number | null) => Promise<{ id: string; rowVersion: number }>) {
  const saveProduct = vi.fn(saveImpl ?? (async () => ({ id: 'new', rowVersion: 1 })));
  const repo = {
    listUnits: vi.fn(async () => [
      { id: PCS, orgId: null, code: 'pcs', nameEn: 'Piece', nameAr: 'حبة', nameBn: null, dimension: 'count', ratioToDimensionBase: '1', allowFraction: false, decimalPlaces: 0, isActive: true },
      { id: BOX, orgId: null, code: 'box', nameEn: 'Box', nameAr: 'علبة', nameBn: null, dimension: 'count', ratioToDimensionBase: null, allowFraction: false, decimalPlaces: 0, isActive: true },
    ]),
    listCategories: vi.fn(async () => []),
    listBrands: vi.fn(async () => []),
    searchProducts: vi.fn(async () => ({ items: [existing], total: 1 })),
    saveProduct,
  } as unknown as CatalogRepository;
  return { repo, saveProduct };
}

const CSV = [
  'sku,name_en,name_ar,name_bn,description,category,brand,product_type,base_unit,tax_category,tax_exemption_reason,reorder_level,unit,factor,barcode,sale_price,is_sale,is_purchase',
  'WS-4X40,Wood screw,برغي,,,,,stock,pcs,S,,,pcs,1,,0.15,yes,yes',
  'WS-4X40,Wood screw,برغي,,,,,stock,pcs,S,,,box,200,,25,yes,yes',
  'NEW-1,New item,صنف جديد,,,,,stock,pcs,S,,,pcs,1,,0.5,yes,yes',
  'BAD-1,Bad,خطأ,,,,,stock,pcs,S,,,pcs,1,2000000100013,1,yes,yes',
].join('\n');

describe('bulk product import against the repository', () => {
  it('plans against existing SKUs, then saves only valid products with the expected row version', async () => {
    const { repo, saveProduct } = fakeCatalog();
    const plan = await planImportFile(repo, ORG, CSV);
    expect(plan.counts).toEqual({ create: 1, update: 1, invalid: 1 });

    const outcomes = await applyImportPlan(repo, plan);
    expect(outcomes.map((o) => [o.sku, o.status])).toEqual([['WS-4X40', 'updated'], ['NEW-1', 'created']]);
    expect(saveProduct.mock.calls[0]![1]).toBe(4);      // optimistic concurrency: the version we planned against
    expect(saveProduct.mock.calls[1]![1]).toBeNull();
  });

  it('keeps going after a failure and reports it per product', async () => {
    const { repo } = fakeCatalog(async (draft) => {
      if ((draft as { sku: string }).sku === 'WS-4X40') throw new DataError('concurrency_conflict', 'concurrency_conflict', '5');
      return { id: 'new', rowVersion: 1 };
    });
    const plan = await planImportFile(repo, ORG, CSV);
    const outcomes = await applyImportPlan(repo, plan);
    expect(outcomes[0]).toMatchObject({ sku: 'WS-4X40', status: 'failed', code: 'concurrency_conflict' });
    expect(outcomes[1]).toMatchObject({ sku: 'NEW-1', status: 'created' });
  });

  it('exports every product as one row per unit and keeps Arabic text intact', async () => {
    const { repo } = fakeCatalog();
    const csv = await exportProductsCsv(repo, ORG);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toMatch(/^sku,name_en,name_ar/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('برغي');
    expect(lines[1]).toContain('WS-4X40');
  });
});
