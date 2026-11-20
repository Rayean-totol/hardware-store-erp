/** Raw row shapes as selected through PostgREST (numerics are cast ::text to keep precision). */
export interface UnitRow {
  id: string;
  org_id: string | null;
  code: string;
  name_en: string;
  name_ar: string;
  name_bn: string | null;
  dimension: 'count' | 'length' | 'mass' | 'volume' | 'area';
  ratio_to_dimension_base: string | null;
  allow_fraction: boolean;
  decimal_places: number;
  is_active: boolean;
}

export interface CategoryRow {
  id: string;
  org_id: string;
  parent_id: string | null;
  name_en: string;
  name_ar: string;
  name_bn: string | null;
  sort_order: number;
  is_active: boolean;
  row_version: number;
}

export interface BrandRow {
  id: string;
  org_id: string;
  name: string;
  is_active: boolean;
  row_version: number;
}

export interface ProductUnitRow {
  id: string;
  unit_id: string;
  factor: string;
  is_base: boolean;
  barcode: string | null;
  sale_price: string | null;
  is_sale_unit: boolean;
  is_purchase_unit: boolean;
}

export interface ProductRow {
  id: string;
  org_id: string;
  sku: string;
  name_en: string;
  name_ar: string;
  name_bn: string | null;
  description: string | null;
  category_id: string | null;
  brand_id: string | null;
  product_type: 'stock' | 'service';
  base_unit_id: string;
  tax_category: 'S' | 'Z' | 'E' | 'O';
  tax_exemption_reason_code: string | null;
  reorder_level: string | null;
  archived_at: string | null;
  updated_at: string;
  row_version: number;
  product_units: ProductUnitRow[];
}

/** Column lists kept next to the row types; tests/api checks them against the live schema. */
export const UNIT_SELECT =
  'id, org_id, code, name_en, name_ar, name_bn, dimension, ratio_to_dimension_base::text, allow_fraction, decimal_places, is_active';
export const CATEGORY_SELECT = 'id, org_id, parent_id, name_en, name_ar, name_bn, sort_order, is_active, row_version';
export const BRAND_SELECT = 'id, org_id, name, is_active, row_version';
export const PRODUCT_UNIT_SELECT =
  'id, unit_id, factor::text, is_base, barcode, sale_price::text, is_sale_unit, is_purchase_unit';
export const PRODUCT_SELECT =
  'id, org_id, sku, name_en, name_ar, name_bn, description, category_id, brand_id, product_type, base_unit_id, ' +
  'tax_category, tax_exemption_reason_code, reorder_level::text, archived_at, updated_at, row_version, ' +
  `product_units(${PRODUCT_UNIT_SELECT})`;
