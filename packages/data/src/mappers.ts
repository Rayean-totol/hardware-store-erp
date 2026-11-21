import type { BrandRow, CategoryRow, ProductRow, ProductUnitRow, UnitRow } from './rows';
import type { Brand, Category, Product, ProductUnit, Unit } from './models';

export const mapUnit = (r: UnitRow): Unit => ({
  id: r.id,
  orgId: r.org_id,
  code: r.code,
  nameEn: r.name_en,
  nameAr: r.name_ar,
  nameBn: r.name_bn,
  dimension: r.dimension,
  ratioToDimensionBase: r.ratio_to_dimension_base,
  allowFraction: r.allow_fraction,
  decimalPlaces: r.decimal_places,
  isActive: r.is_active,
});

export const mapCategory = (r: CategoryRow): Category => ({
  id: r.id,
  orgId: r.org_id,
  parentId: r.parent_id,
  nameEn: r.name_en,
  nameAr: r.name_ar,
  nameBn: r.name_bn,
  sortOrder: r.sort_order,
  isActive: r.is_active,
  rowVersion: Number(r.row_version),
});

export const mapBrand = (r: BrandRow): Brand => ({
  id: r.id,
  orgId: r.org_id,
  name: r.name,
  isActive: r.is_active,
  rowVersion: Number(r.row_version),
});

export const mapProductUnit = (r: ProductUnitRow): ProductUnit => ({
  id: r.id,
  unitId: r.unit_id,
  factor: r.factor,
  isBase: r.is_base,
  barcode: r.barcode,
  salePrice: r.sale_price,
  isSaleUnit: r.is_sale_unit,
  isPurchaseUnit: r.is_purchase_unit,
});

export const mapProduct = (r: ProductRow): Product => ({
  id: r.id,
  orgId: r.org_id,
  sku: r.sku,
  nameEn: r.name_en,
  nameAr: r.name_ar,
  nameBn: r.name_bn,
  description: r.description,
  categoryId: r.category_id,
  brandId: r.brand_id,
  productType: r.product_type,
  baseUnitId: r.base_unit_id,
  taxCategory: r.tax_category,
  taxExemptionReasonCode: r.tax_exemption_reason_code,
  reorderLevel: r.reorder_level,
  sizeLabel: r.size_label ?? null,
  archivedAt: r.archived_at,
  imagePath: r.image_path,
  updatedAt: r.updated_at,
  rowVersion: Number(r.row_version),
  // base unit first, then by factor ascending
  units: r.product_units
    .map(mapProductUnit)
    .sort((a, b) => Number(b.isBase) - Number(a.isBase) || Number(a.factor) - Number(b.factor)),
});
