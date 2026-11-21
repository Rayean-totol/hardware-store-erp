import { parseCsv, toCsv, unescapeCell } from './csv';
import { normalizeSku } from './sku';
import { validateProductDraft, type ProductDraft, type ProductType, type ValidationIssue } from './product';
import { TAX_CATEGORIES, type TaxCategory } from './vat';
import { unitCatalog, type UnitDef } from './units';

/**
 * Bulk product CSV: ONE ROW PER UNIT. Rows sharing a SKU form one product.
 *
 *   sku,name_en,name_ar,name_bn,description,category,brand,product_type,base_unit,
 *   tax_category,tax_exemption_reason,reorder_level,unit,factor,barcode,sale_price,is_sale,is_purchase
 *
 * `unit` is a unit code (pcs, box, m, roll, kg, bag, l, carton ...). The row whose unit equals
 * `base_unit` is the base unit and must have factor 1. `category` and `brand` are matched by name.
 * Selling prices for wholesale/trade tiers are NOT part of the CSV (manage them on the product).
 */
export const PRODUCT_CSV_HEADERS = [
  'sku', 'name_en', 'name_ar', 'name_bn', 'description', 'category', 'brand', 'product_type',
  'base_unit', 'tax_category', 'tax_exemption_reason', 'reorder_level', 'unit', 'factor',
  'barcode', 'sale_price', 'is_sale', 'is_purchase',
] as const;

const REQUIRED_HEADERS = ['sku', 'name_en', 'name_ar', 'base_unit', 'unit', 'factor'] as const;

export interface ProductCsvLookups {
  unitsByCode: ReadonlyMap<string, UnitDef & { id: string }>;
  categoryIdByName: ReadonlyMap<string, string>;
  brandIdByName: ReadonlyMap<string, string>;
  existingBySku: ReadonlyMap<string, { id: string; rowVersion: number }>;
  /** barcode -> SKU of the existing product that already uses it (duplicate detection). */
  existingBarcodes?: ReadonlyMap<string, string>;
}

export interface CsvIssue {
  line: number;
  path: string;
  code: string;
}

export interface PlannedProduct {
  sku: string;
  firstLine: number;
  action: 'create' | 'update' | 'invalid';
  draft: ProductDraft | null;
  existing: { id: string; rowVersion: number } | null;
  issues: CsvIssue[];
  warnings: CsvIssue[];
}

export interface ImportPlan {
  fatal: CsvIssue[];
  products: PlannedProduct[];
  counts: { create: number; update: number; invalid: number };
}

const truthy = (v: string, fallback: boolean): boolean => {
  const t = v.trim().toLowerCase();
  if (t === '') return fallback;
  return ['1', 'y', 'yes', 'true'].includes(t);
};

function headerIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => map.set(h.trim().toLowerCase(), i));
  return map;
}

export function planProductImport(text: string, orgId: string, lookups: ProductCsvLookups): ImportPlan {
  const fatal: CsvIssue[] = [];
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch {
    return { fatal: [{ line: 0, path: '', code: 'csv.malformed' }], products: [], counts: { create: 0, update: 0, invalid: 0 } };
  }
  if (rows.length < 2) {
    return { fatal: [{ line: 0, path: '', code: 'csv.empty' }], products: [], counts: { create: 0, update: 0, invalid: 0 } };
  }
  const header = headerIndex(rows[0]!);
  for (const required of REQUIRED_HEADERS) {
    if (!header.has(required)) fatal.push({ line: 1, path: required, code: 'csv.missing_column' });
  }
  if (fatal.length > 0) return { fatal, products: [], counts: { create: 0, update: 0, invalid: 0 } };

  const cell = (row: string[], name: string): string => {
    const idx = header.get(name);
    return idx === undefined ? '' : unescapeCell((row[idx] ?? '').trim());
  };

  // Group rows by normalized SKU, keeping file order and line numbers.
  const groups = new Map<string, Array<{ line: number; row: string[] }>>();
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const sku = normalizeSku(cell(row, 'sku'));
    if (!sku) {
      fatal.push({ line, path: 'sku', code: 'required' });
      return;
    }
    const list = groups.get(sku) ?? [];
    list.push({ line, row });
    groups.set(sku, list);
  });

  // A barcode must identify one product: in this file (across SKUs) and in the database.
  const barcodeSkus = new Map<string, Set<string>>();
  for (const [sku, entries] of groups) {
    for (const e of entries) {
      const b = cell(e.row, 'barcode');
      if (!b) continue;
      const set = barcodeSkus.get(b) ?? new Set<string>();
      set.add(sku);
      barcodeSkus.set(b, set);
    }
  }

  const products: PlannedProduct[] = [];
  for (const [sku, entries] of groups) {
    const firstLine = entries[0]!.line;
    const issues: CsvIssue[] = [];
    const warnings: CsvIssue[] = [];
    const first = entries[0]!.row;
    const baseCode = cell(first, 'base_unit').toLowerCase();
    const baseUnit = lookups.unitsByCode.get(baseCode);
    if (!baseUnit) issues.push({ line: firstLine, path: 'base_unit', code: 'import.unknown_unit' });

    for (const e of entries) {
      if (cell(e.row, 'base_unit').toLowerCase() !== baseCode) {
        issues.push({ line: e.line, path: 'base_unit', code: 'import.base_unit_conflict' });
      }
    }
    // Rows that repeat a SKU must describe the same product.
    for (const e of entries.slice(1)) {
      if (cell(e.row, 'name_en') !== cell(first, 'name_en') || cell(e.row, 'category').toLowerCase() !== cell(first, 'category').toLowerCase()) {
        issues.push({ line: e.line, path: 'name_en', code: 'import.sku_conflict' });
      }
    }
    // Barcodes: duplicates within the file, or already used by another product in the database.
    for (const e of entries) {
      const b = cell(e.row, 'barcode');
      if (!b) continue;
      const owners = barcodeSkus.get(b) ?? new Set<string>();
      const existingOwner = lookups.existingBarcodes?.get(b);
      if (owners.size > 1 || (existingOwner !== undefined && existingOwner !== sku)) {
        issues.push({ line: e.line, path: 'barcode', code: 'import.duplicate_barcode' });
      }
    }

    const categoryName = cell(first, 'category').toLowerCase();
    const categoryId = categoryName ? lookups.categoryIdByName.get(categoryName) : undefined;
    if (categoryName && !categoryId) issues.push({ line: firstLine, path: 'category', code: 'import.unknown_category' });
    const brandName = cell(first, 'brand').toLowerCase();
    const brandId = brandName ? lookups.brandIdByName.get(brandName) : undefined;
    if (brandName && !brandId) issues.push({ line: firstLine, path: 'brand', code: 'import.unknown_brand' });

    const taxRaw = (cell(first, 'tax_category') || 'S').toUpperCase();
    const taxCategory = (TAX_CATEGORIES as readonly string[]).includes(taxRaw) ? (taxRaw as TaxCategory) : null;
    if (!taxCategory) issues.push({ line: firstLine, path: 'tax_category', code: 'invalid' });
    const typeRaw = (cell(first, 'product_type') || 'stock').toLowerCase();
    if (typeRaw !== 'stock' && typeRaw !== 'service') issues.push({ line: firstLine, path: 'product_type', code: 'invalid' });

    const unitRows = entries.map((e) => {
      const code = cell(e.row, 'unit').toLowerCase();
      const unit = lookups.unitsByCode.get(code);
      if (!unit) issues.push({ line: e.line, path: 'unit', code: 'import.unknown_unit' });
      return { e, unit };
    });
    if (unitRows.some((u) => !u.unit)) {
      products.push(invalid(sku, firstLine, issues, warnings));
      continue;
    }

    const draft: ProductDraft = {
      orgId,
      sku,
      nameEn: cell(first, 'name_en'),
      nameAr: cell(first, 'name_ar'),
      nameBn: cell(first, 'name_bn') || null,
      description: cell(first, 'description') || null,
      categoryId: categoryId ?? null,
      brandId: brandId ?? null,
      productType: (typeRaw === 'service' ? 'service' : 'stock') as ProductType,
      baseUnitId: baseUnit?.id ?? '',
      taxCategory: taxCategory ?? 'S',
      taxExemptionReasonCode: cell(first, 'tax_exemption_reason') || null,
      reorderLevel: cell(first, 'reorder_level') || null,
      // Optional columns: read only when the file has them, and a blank cell leaves the stored value alone.
      sizeLabel: header.has('size') && cell(first, 'size') ? cell(first, 'size') : undefined,
      variantGroup: header.has('variant_group') && cell(first, 'variant_group') ? cell(first, 'variant_group') : undefined,
      units: unitRows.map(({ e, unit }) => ({
        unitId: unit!.id,
        factor: cell(e.row, 'factor'),
        isBase: unit!.id === baseUnit?.id,
        barcode: cell(e.row, 'barcode') || null,
        salePrice: cell(e.row, 'sale_price') || null,
        purchasePrice: header.has('purchase_price') && cell(e.row, 'purchase_price') ? cell(e.row, 'purchase_price') : undefined,
        isSaleUnit: truthy(cell(e.row, 'is_sale'), true),
        isPurchaseUnit: truthy(cell(e.row, 'is_purchase'), true),
      })),
    };

    const units = unitCatalog(lookups.unitsByCode.values());
    const result = validateProductDraft(draft, units);
    const toCsvIssue = (i: ValidationIssue): CsvIssue => {
      const m = /^units\.(\d+)(?:\.(\w+))?$/.exec(i.path);
      if (m) {
        const entry = entries[Number(m[1])];
        const field = m[2] === 'factor' ? 'factor' : m[2] === 'barcode' ? 'barcode' : m[2] === 'salePrice' ? 'sale_price' : m[2] ?? 'unit';
        return { line: entry?.line ?? firstLine, path: field, code: i.code };
      }
      const field = i.path === 'nameAr' ? 'name_ar' : i.path === 'nameEn' ? 'name_en' : i.path === 'taxExemptionReasonCode' ? 'tax_exemption_reason' : i.path === 'reorderLevel' ? 'reorder_level' : i.path || 'sku';
      return { line: firstLine, path: field, code: i.code };
    };
    const all = result.ok ? result.warnings : result.issues;
    for (const i of all) {
      (i.severity === 'error' ? issues : warnings).push(toCsvIssue(i));
    }
    if (issues.length > 0 || !result.ok) {
      products.push(invalid(sku, firstLine, issues, warnings, draft));
      continue;
    }

    const existing = lookups.existingBySku.get(sku) ?? null;
    products.push({
      sku,
      firstLine,
      action: existing ? 'update' : 'create',
      draft: { ...draft, ...(existing ? { id: existing.id } : {}) },
      existing,
      issues: [],
      warnings,
    });
  }

  const counts = { create: 0, update: 0, invalid: 0 };
  for (const p of products) counts[p.action] += 1;
  return { fatal, products, counts };
}

function invalid(sku: string, firstLine: number, issues: CsvIssue[], warnings: CsvIssue[], draft: ProductDraft | null = null): PlannedProduct {
  return { sku, firstLine, action: 'invalid', draft, existing: null, issues, warnings };
}

/** Minimal shape needed to export a product (kept structural so the domain has no DB types). */
export interface ExportableProduct {
  sku: string;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  productType: ProductType;
  baseUnitId: string;
  taxCategory: TaxCategory;
  taxExemptionReasonCode: string | null;
  reorderLevel: string | null;
  units: Array<{ unitId: string; factor: string; barcode: string | null; salePrice: string | null; isSaleUnit: boolean; isPurchaseUnit: boolean }>;
}

export function productsToCsv(
  products: readonly ExportableProduct[],
  names: {
    unitCode: (unitId: string) => string | undefined;
    categoryName: (id: string) => string | undefined;
    brandName: (id: string) => string | undefined;
  },
): string {
  const rows: string[][] = [[...PRODUCT_CSV_HEADERS]];
  for (const p of products) {
    const baseCode = names.unitCode(p.baseUnitId) ?? '';
    for (const u of p.units) {
      rows.push([
        p.sku,
        p.nameEn,
        p.nameAr,
        p.nameBn ?? '',
        p.description ?? '',
        (p.categoryId && names.categoryName(p.categoryId)) || '',
        (p.brandId && names.brandName(p.brandId)) || '',
        p.productType,
        baseCode,
        p.taxCategory,
        p.taxExemptionReasonCode ?? '',
        p.reorderLevel ?? '',
        names.unitCode(u.unitId) ?? '',
        u.factor,
        u.barcode ?? '',
        u.salePrice ?? '',
        u.isSaleUnit ? 'yes' : 'no',
        u.isPurchaseUnit ? 'yes' : 'no',
      ]);
    }
  }
  return toCsv(rows);
}
