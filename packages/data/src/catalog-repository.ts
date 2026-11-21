import type { ProductDraft } from '@erp/domain';
import type { DbClient } from './client';
import { DataError, toDataError, unwrap } from './errors';
import { mapBrand, mapCategory, mapProduct, mapUnit } from './mappers';
import type { Brand, Category, Page, Product, ProductQuery, Unit } from './models';
import {
  BRAND_SELECT,
  CATEGORY_SELECT,
  PRODUCT_SELECT,
  UNIT_SELECT,
  type BrandRow,
  type CategoryRow,
  type ProductRow,
  type UnitRow,
} from './rows';

export interface CategoryInput {
  id?: string;
  orgId: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface BrandInput {
  id?: string;
  orgId: string;
  name: string;
  isActive: boolean;
}

export interface SaveResult {
  id: string;
  rowVersion: number;
}

/**
 * Catalog data access. The Phase 2 offline implementation will provide the same
 * interface on top of the local store + outbox.
 */
export interface CatalogRepository {
  listUnits(orgId: string): Promise<Unit[]>;
  listCategories(orgId: string): Promise<Category[]>;
  saveCategory(input: CategoryInput): Promise<Category>;
  listBrands(orgId: string): Promise<Brand[]>;
  saveBrand(input: BrandInput): Promise<Brand>;
  searchProducts(query: ProductQuery): Promise<Page<Product>>;
  getProduct(id: string): Promise<Product | null>;
  /** Purchase prices of a product's units. Empty unless the user holds catalog.price_write (row policy). */
  listUnitCosts(productId: string): Promise<Array<{ unitId: string; purchasePrice: string }>>;
  /** expectedVersion: null to create; the current rowVersion to update. */
  saveProduct(draft: ProductDraft, expectedVersion: number | null): Promise<SaveResult>;
  setProductArchived(id: string, archived: boolean): Promise<void>;
  /** Stores the storage object path of the product image (null removes it). */
  setProductImagePath(id: string, path: string | null): Promise<void>;
}

/** Product draft → save_product payloads (snake_case, decimals as strings). */
export function toSaveProductParams(draft: ProductDraft, expectedVersion: number | null) {
  return {
    p_product: {
      id: draft.id ?? null,
      org_id: draft.orgId,
      sku: draft.sku,
      name_en: draft.nameEn,
      name_ar: draft.nameAr,
      name_bn: draft.nameBn ?? null,
      description: draft.description ?? null,
      category_id: draft.categoryId ?? null,
      brand_id: draft.brandId ?? null,
      product_type: draft.productType,
      base_unit_id: draft.baseUnitId,
      tax_category: draft.taxCategory,
      tax_exemption_reason_code: draft.taxExemptionReasonCode ?? null,
      reorder_level: draft.reorderLevel ?? null,
      // Sent only when the caller set it: an absent field leaves the stored size unchanged.
      ...(draft.sizeLabel !== undefined ? { size_label: draft.sizeLabel ?? null } : {}),
    },
    p_units: draft.units.map((u) => ({
      unit_id: u.unitId,
      factor: u.factor,
      is_base: u.isBase,
      barcode: u.barcode ?? null,
      sale_price: u.salePrice ?? null,
      // Sent only when set: an absent cost is left alone. null or '' clears it.
      ...(u.purchasePrice !== undefined ? { purchase_price: u.purchasePrice ?? null } : {}),
      is_sale_unit: u.isSaleUnit,
      is_purchase_unit: u.isPurchaseUnit,
    })),
    p_expected_version: expectedVersion,
  };
}

export function createSupabaseCatalogRepository(db: DbClient): CatalogRepository {
  return {
    async listUnits(orgId) {
      const rows = unwrap(
        await db
          .from('units')
          .select(UNIT_SELECT)
          .or(`org_id.is.null,org_id.eq.${orgId}`)
          .eq('is_active', true)
          .order('dimension')
          .order('code'),
      ) as unknown as UnitRow[];
      return rows.map(mapUnit);
    },

    async listCategories(orgId) {
      const rows = unwrap(
        await db.from('product_categories').select(CATEGORY_SELECT).eq('org_id', orgId).order('sort_order').order('name_en'),
      ) as unknown as CategoryRow[];
      return rows.map(mapCategory);
    },

    async saveCategory(input) {
      const row = {
        org_id: input.orgId,
        parent_id: input.parentId,
        name_en: input.nameEn.trim(),
        name_ar: input.nameAr.trim(),
        name_bn: input.nameBn?.trim() || null,
        sort_order: input.sortOrder,
        is_active: input.isActive,
      };
      const query = input.id
        ? db.from('product_categories').update(row).eq('id', input.id)
        : db.from('product_categories').insert(row);
      const saved = unwrap(await query.select(CATEGORY_SELECT).single()) as unknown as CategoryRow;
      return mapCategory(saved);
    },

    async listBrands(orgId) {
      const rows = unwrap(
        await db.from('brands').select(BRAND_SELECT).eq('org_id', orgId).order('name'),
      ) as unknown as BrandRow[];
      return rows.map(mapBrand);
    },

    async saveBrand(input) {
      const row = { org_id: input.orgId, name: input.name.trim(), is_active: input.isActive };
      const query = input.id ? db.from('brands').update(row).eq('id', input.id) : db.from('brands').insert(row);
      const saved = unwrap(await query.select(BRAND_SELECT).single()) as unknown as BrandRow;
      return mapBrand(saved);
    },

    async searchProducts(q) {
      const result = await db
        .rpc(
          'search_products',
          {
            p_org_id: q.orgId,
            p_query: q.search?.trim() || null,
            p_category_id: q.categoryId ?? null,
            p_include_archived: q.includeArchived ?? false,
            p_brand_id: q.brandId ?? null,
          },
          { count: 'exact' },
        )
        .select(PRODUCT_SELECT)
        .range(q.offset, q.offset + q.limit - 1);
      if (result.error) throw toDataError(result.error);
      const rows = (result.data ?? []) as unknown as ProductRow[];
      return { items: rows.map(mapProduct), total: result.count ?? rows.length };
    },

    async listUnitCosts(productId) {
      const rows = unwrap(
        await db.from('product_unit_costs').select('unit_id, purchase_price::text').eq('product_id', productId),
      ) as unknown as Array<{ unit_id: string; purchase_price: string }>;
      return rows.map((r) => ({ unitId: r.unit_id, purchasePrice: r.purchase_price }));
    },

    async getProduct(id) {
      const result = await db.from('products').select(PRODUCT_SELECT).eq('id', id).maybeSingle();
      if (result.error) throw toDataError(result.error);
      return result.data ? mapProduct(result.data as unknown as ProductRow) : null;
    },

    async saveProduct(draft, expectedVersion) {
      const result = await db.rpc('save_product', toSaveProductParams(draft, expectedVersion));
      const data = unwrap(result) as { id: string; row_version: number };
      return { id: data.id, rowVersion: Number(data.row_version) };
    },

    async setProductImagePath(id, path) {
      const result = await db.from('products').update({ image_path: path }).eq('id', id).select('id');
      if (result.error) throw toDataError(result.error);
      if (!result.data || result.data.length === 0) throw new DataError('forbidden', 'Product not found or not permitted');
    },

    async setProductArchived(id, archived) {
      const result = await db
        .from('products')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', id)
        .select('id');
      if (result.error) throw toDataError(result.error);
      // RLS hides rows the user may not update: zero rows means "not allowed or not found".
      if (!result.data || result.data.length === 0) {
        throw new DataError('forbidden', 'Product not found or not permitted');
      }
    },
  };
}
