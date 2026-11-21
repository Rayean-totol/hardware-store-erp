import { z } from 'zod';
import { classifyBarcode } from './barcode';
import { tryDec } from './decimal';
import { PRICE_DECIMALS } from './money';
import { containsArabic } from './saudi';
import { isValidSku, normalizeSku } from './sku';
import { TAX_CATEGORIES, VAT_EXEMPTION_REASONS, type TaxCategory } from './vat';
import { validateProductUnits, type ProductUnitDef, type UnitCatalog } from './units';

export const PRODUCT_TYPES = ['stock', 'service'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** Shape of the product form / save command (camelCase; @erp/data maps to DB columns). */
export interface ProductDraft {
  id?: string | undefined;
  orgId: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  nameBn?: string | null | undefined;
  description?: string | null | undefined;
  categoryId?: string | null | undefined;
  brandId?: string | null | undefined;
  productType: ProductType;
  baseUnitId: string;
  taxCategory: TaxCategory;
  taxExemptionReasonCode?: string | null | undefined;
  reorderLevel?: string | null | undefined;
  /** Free text such as "1/2 inch" or "50 kg". undefined = unchanged; null or '' = clear. */
  sizeLabel?: string | null | undefined;
  /** Shared code for sizes or versions of one item. undefined = unchanged; null or '' = clear. */
  variantGroup?: string | null | undefined;
  units: ProductUnitDef[];
}

export type IssueSeverity = 'error' | 'warning';
export interface ValidationIssue {
  /** Dotted path of the offending field, e.g. "units.1.barcode". "" = whole form. */
  path: string;
  /** Stable code; the UI translates `issues.<code>`. */
  code: string;
  severity: IssueSeverity;
}

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().max(max).nullish();

const draftSchema = z.object({
  id: uuid.optional(),
  orgId: uuid,
  sku: z.string(),
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  nameBn: optionalText(200),
  description: optionalText(2000),
  categoryId: uuid.nullish(),
  brandId: uuid.nullish(),
  productType: z.enum(PRODUCT_TYPES),
  baseUnitId: uuid,
  taxCategory: z.enum(TAX_CATEGORIES),
  taxExemptionReasonCode: z.string().nullish(),
  reorderLevel: z.string().nullish(),
  sizeLabel: z.string().nullish(),
  variantGroup: z.string().nullish(),
  units: z.array(
    z.object({
      unitId: uuid,
      factor: z.string(),
      isBase: z.boolean(),
      barcode: z.string().nullish(),
      salePrice: z.string().nullish(),
      purchasePrice: z.string().nullish(),
      isSaleUnit: z.boolean(),
      isPurchaseUnit: z.boolean(),
    }),
  ),
});

function zodCode(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'too_small':
      return 'required';
    case 'too_big':
      return 'too_long';
    case 'invalid_format':
      return 'invalid';
    default:
      return 'invalid';
  }
}

/** Trim strings, turn empty strings into null, normalise SKU and barcodes. */
export function normalizeProductDraft(draft: ProductDraft): ProductDraft {
  const blank = (v: string | null | undefined) => {
    const t = v?.trim();
    return t ? t : null;
  };
  return {
    ...draft,
    sku: normalizeSku(draft.sku),
    nameEn: draft.nameEn.trim(),
    nameAr: draft.nameAr.trim(),
    nameBn: blank(draft.nameBn),
    description: blank(draft.description),
    categoryId: blank(draft.categoryId),
    brandId: blank(draft.brandId),
    taxExemptionReasonCode: draft.taxCategory === 'S' ? null : blank(draft.taxExemptionReasonCode),
    reorderLevel: blank(draft.reorderLevel),
    // undefined stays undefined: an absent field means "leave the stored value alone".
    sizeLabel: draft.sizeLabel === undefined ? undefined : blank(draft.sizeLabel),
    variantGroup: draft.variantGroup === undefined ? undefined : blank(draft.variantGroup),
    units: draft.units.map((u) => ({
      ...u,
      factor: u.factor.trim(),
      barcode: blank(u.barcode),
      salePrice: blank(u.salePrice),
      purchasePrice: u.purchasePrice === undefined ? undefined : blank(u.purchasePrice),
    })),
  };
}

export type ProductValidationResult =
  | { ok: true; value: ProductDraft; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Full client-side validation of a product draft. Errors block saving; warnings are shown
 * but do not block. The database re-checks every error rule.
 */
export function validateProductDraft(input: ProductDraft, units: UnitCatalog): ProductValidationResult {
  const draft = normalizeProductDraft(input);
  const issues: ValidationIssue[] = [];
  const error = (path: string, code: string) => issues.push({ path, code, severity: 'error' });
  const warn = (path: string, code: string) => issues.push({ path, code, severity: 'warning' });
  if (draft.sizeLabel && draft.sizeLabel.length > 40) error('sizeLabel', 'size_too_long');
  if (draft.variantGroup && draft.variantGroup.length > 40) error('variantGroup', 'variant_group_too_long');

  const parsed = draftSchema.safeParse(draft);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      error(issue.path.join('.'), zodCode(issue));
    }
  }

  if (!draft.sku) error('sku', 'required');
  else if (!isValidSku(draft.sku)) error('sku', 'sku_format');

  if (draft.nameAr && !containsArabic(draft.nameAr)) warn('nameAr', 'name_ar_not_arabic');

  if (draft.taxCategory !== 'S') {
    const allowed = VAT_EXEMPTION_REASONS[draft.taxCategory];
    if (!draft.taxExemptionReasonCode) error('taxExemptionReasonCode', 'required');
    else if (!allowed.includes(draft.taxExemptionReasonCode)) error('taxExemptionReasonCode', 'invalid');
  }

  if (draft.reorderLevel !== null && draft.reorderLevel !== undefined) {
    const level = tryDec(draft.reorderLevel);
    if (!level || level.isNegative()) error('reorderLevel', 'not_negative_number');
  }

  for (const unitIssue of validateProductUnits(draft.units, draft.baseUnitId, units)) {
    const path = unitIssue.index === undefined ? 'units' : `units.${unitIssue.index}.factor`;
    const row = unitIssue.index === undefined ? 'units' : `units.${unitIssue.index}`;
    const fieldPath = unitIssue.code === 'units.duplicate' || unitIssue.code === 'units.unknown'
      ? `${row}.unitId`
      : path;
    error(fieldPath, unitIssue.code);
  }

  const barcodes = new Map<string, number>();
  draft.units.forEach((u, index) => {
    if (u.barcode) {
      const cls = classifyBarcode(u.barcode);
      if (cls.kind === 'invalid') error(`units.${index}.barcode`, 'barcode_chars');
      else if (cls.kind === 'gtin' && !cls.valid) error(`units.${index}.barcode`, 'barcode_check_digit');
      if (barcodes.has(u.barcode)) error(`units.${index}.barcode`, 'barcode_duplicate');
      barcodes.set(u.barcode, index);
    }
    if (u.salePrice) {
      const price = tryDec(u.salePrice);
      if (!price || price.isNegative()) error(`units.${index}.salePrice`, 'not_negative_number');
      else if (price.decimalPlaces() > PRICE_DECIMALS) error(`units.${index}.salePrice`, 'price_precision');
    } else if (u.isSaleUnit && draft.productType === 'stock') {
      warn(`units.${index}.salePrice`, 'price_missing');
    }
    if (u.purchasePrice) {
      const cost = tryDec(u.purchasePrice);
      if (!cost || cost.isNegative()) error(`units.${index}.purchasePrice`, 'not_negative_number');
      else if (cost.decimalPlaces() > PRICE_DECIMALS) error(`units.${index}.purchasePrice`, 'price_precision');
      else if (u.salePrice && tryDec(u.salePrice) && cost.greaterThan(tryDec(u.salePrice)!)) {
        warn(`units.${index}.purchasePrice`, 'purchase_above_sale');
      }
    }
  });

  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) return { ok: false, issues };
  return { ok: true, value: draft, warnings: issues };
}
