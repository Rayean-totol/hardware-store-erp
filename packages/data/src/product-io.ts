import { planProductImport, productsToCsv, type ImportPlan, type PlannedProduct, type ProductCsvLookups } from '@erp/domain';
import type { CatalogRepository } from './catalog-repository';
import { DataError } from './errors';
import type { Product } from './models';

const PAGE = 500;

/** Every product of the organization, archived ones included, read page by page. */
export async function loadAllProducts(catalog: CatalogRepository, orgId: string): Promise<Product[]> {
  const all: Product[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await catalog.searchProducts({ orgId, includeArchived: true, limit: PAGE, offset });
    all.push(...page.items);
    if (page.items.length < PAGE) return all;
  }
}

/** Name lookups that turn CSV names into ids (and back for export). */
export async function buildCsvLookups(catalog: CatalogRepository, orgId: string) {
  const [units, categories, brands, products] = await Promise.all([
    catalog.listUnits(orgId),
    catalog.listCategories(orgId),
    catalog.listBrands(orgId),
    loadAllProducts(catalog, orgId),
  ]);
  const lookups: ProductCsvLookups = {
    unitsByCode: new Map(units.map((u) => [u.code, { ...u, id: u.id }])),
    categoryIdByName: new Map(categories.map((c) => [c.nameEn.trim().toLowerCase(), c.id])),
    brandIdByName: new Map(brands.map((b) => [b.name.trim().toLowerCase(), b.id])),
    existingBySku: new Map(products.map((p) => [p.sku, { id: p.id, rowVersion: p.rowVersion }])),
    existingBarcodes: new Map(products.flatMap((p) => p.units.flatMap((u) => (u.barcode ? [[u.barcode, p.sku] as const] : [])))),
  };
  return { lookups, units, categories, brands, products };
}

export async function planImportFile(catalog: CatalogRepository, orgId: string, text: string): Promise<ImportPlan> {
  const { lookups } = await buildCsvLookups(catalog, orgId);
  return planProductImport(text, orgId, lookups);
}

export interface ImportOutcome {
  sku: string;
  line: number;
  status: 'created' | 'updated' | 'failed';
  code: string | null;
  message: string | null;
}

/**
 * Saves the valid planned products one by one. A failure on one product is recorded and the
 * run continues: partial imports are reported line by line, never hidden.
 */
export async function applyImportPlan(
  catalog: CatalogRepository,
  plan: ImportPlan,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportOutcome[]> {
  const work = plan.products.filter((p): p is PlannedProduct & { draft: NonNullable<PlannedProduct['draft']> } =>
    (p.action === 'create' || p.action === 'update') && p.draft !== null);
  const outcomes: ImportOutcome[] = [];
  for (const [i, p] of work.entries()) {
    try {
      const expected = p.existing ? p.existing.rowVersion : null;
      await catalog.saveProduct(p.draft, expected);
      outcomes.push({ sku: p.sku, line: p.firstLine, status: p.action === 'create' ? 'created' : 'updated', code: null, message: null });
    } catch (error) {
      const e = error instanceof DataError ? error : new DataError('unknown', error instanceof Error ? error.message : String(error));
      outcomes.push({ sku: p.sku, line: p.firstLine, status: 'failed', code: e.code, message: e.message });
    }
    onProgress?.(i + 1, work.length);
  }
  return outcomes;
}

/** CSV of every product (one row per unit), ready for download. */
export async function exportProductsCsv(catalog: CatalogRepository, orgId: string): Promise<string> {
  const { units, categories, brands, products } = await buildCsvLookups(catalog, orgId);
  const unitCode = new Map(units.map((u) => [u.id, u.code]));
  const catName = new Map(categories.map((c) => [c.id, c.nameEn]));
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const exportable = products.map((p) => ({
    sku: p.sku,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    nameBn: p.nameBn ?? null,
    description: p.description ?? null,
    categoryId: p.categoryId ?? null,
    brandId: p.brandId ?? null,
    productType: p.productType,
    baseUnitId: p.baseUnitId,
    taxCategory: p.taxCategory,
    taxExemptionReasonCode: p.taxExemptionReasonCode ?? null,
    reorderLevel: p.reorderLevel ?? null,
    units: p.units.map((u) => ({
      unitId: u.unitId,
      factor: u.factor,
      barcode: u.barcode ?? null,
      salePrice: u.salePrice ?? null,
      isSaleUnit: u.isSaleUnit,
      isPurchaseUnit: u.isPurchaseUnit,
    })),
  }));
  return productsToCsv(exportable, {
    unitCode: (id) => unitCode.get(id),
    categoryName: (id) => catName.get(id),
    brandName: (id) => brandName.get(id),
  });
}
