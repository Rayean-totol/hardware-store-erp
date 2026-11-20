import { describe, expect, it } from 'vitest';
import {
  classifyBarcode,
  generateInStoreEan13,
  gtinCheckDigit,
  hasPermission,
  isValidCrNumberFormat,
  isValidGtin,
  isValidVatNumberFormat,
  normalizeSku,
  ROLE_PERMISSIONS,
  validateProductDraft,
  type ProductDraft,
} from '../src';
import { catalog, ORG, U } from './fixtures';

const baseDraft = (): ProductDraft => ({
  orgId: ORG,
  sku: ' ws 4x40 ',
  nameEn: 'Wood screw 4x40',
  nameAr: 'برغي خشب',
  productType: 'stock',
  baseUnitId: U.pcs.id,
  taxCategory: 'S',
  units: [
    { unitId: U.pcs.id, factor: '1', isBase: true, barcode: '2000000100012', salePrice: '0.15', isSaleUnit: true, isPurchaseUnit: true },
    { unitId: U.box.id, factor: '200', isBase: false, barcode: '', salePrice: '25', isSaleUnit: true, isPurchaseUnit: true },
  ],
});

describe('barcodes', () => {
  it('computes GS1 check digits', () => {
    expect(gtinCheckDigit('400638133393')).toBe(1); // EAN-13 4006381333931
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
    expect(isValidGtin('036000291452')).toBe(true); // UPC-A
  });
  it('classifies GTIN vs internal codes', () => {
    expect(classifyBarcode('4006381333931')).toEqual({ kind: 'gtin', valid: true, length: 13 });
    expect(classifyBarcode('4006381333932')).toEqual({ kind: 'gtin', valid: false, length: 13 });
    expect(classifyBarcode('SCR-440')).toEqual({ kind: 'internal' });
    expect(classifyBarcode('12345')).toEqual({ kind: 'internal' });
    expect(classifyBarcode('has space')).toEqual({ kind: 'invalid' });
  });
  it('generates valid in-store EAN-13 codes', () => {
    const code = generateInStoreEan13(10001);
    expect(code).toBe('2000000100012');
    expect(isValidGtin(code)).toBe(true);
    expect(() => generateInStoreEan13(1, '40')).toThrow();
  });
});

describe('Saudi identifier formats', () => {
  it('validates VAT and CR number formats', () => {
    expect(isValidVatNumberFormat('399999999900003')).toBe(true);
    expect(isValidVatNumberFormat('300000000000000')).toBe(false); // must end with 3
    expect(isValidVatNumberFormat('39999999990000')).toBe(false); // 14 digits
    expect(isValidCrNumberFormat('1010000000')).toBe(true);
    expect(isValidCrNumberFormat('101000000')).toBe(false);
  });
});

describe('validateProductDraft', () => {
  it('accepts and normalises a valid draft', () => {
    const result = validateProductDraft(baseDraft(), catalog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sku).toBe('WS-4X40');
      expect(result.value.units[1]!.barcode).toBeNull();
      expect(result.warnings).toEqual([]);
    }
  });

  it('requires Arabic and English names', () => {
    const result = validateProductDraft({ ...baseDraft(), nameAr: '  ', nameEn: '' }, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({ path: 'nameAr', code: 'required', severity: 'error' });
      expect(result.issues).toContainEqual({ path: 'nameEn', code: 'required', severity: 'error' });
    }
  });

  it('warns (does not block) when the Arabic name has no Arabic letters', () => {
    const result = validateProductDraft({ ...baseDraft(), nameAr: 'WD-40' }, catalog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toContainEqual({ path: 'nameAr', code: 'name_ar_not_arabic', severity: 'warning' });
  });

  it('rejects invalid SKUs', () => {
    const result = validateProductDraft({ ...baseDraft(), sku: 'ws#1' }, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual({ path: 'sku', code: 'sku_format', severity: 'error' });
  });

  it('requires a valid exemption reason for non-standard tax categories', () => {
    const missing = validateProductDraft({ ...baseDraft(), taxCategory: 'Z' }, catalog);
    expect(missing.ok).toBe(false);
    const wrong = validateProductDraft({ ...baseDraft(), taxCategory: 'E', taxExemptionReasonCode: 'VATEX-SA-OOS' }, catalog);
    expect(wrong.ok).toBe(false);
    const right = validateProductDraft({ ...baseDraft(), taxCategory: 'O', taxExemptionReasonCode: 'VATEX-SA-OOS' }, catalog);
    expect(right.ok).toBe(true);
    const cleared = validateProductDraft({ ...baseDraft(), taxCategory: 'S', taxExemptionReasonCode: 'VATEX-SA-OOS' }, catalog);
    expect(cleared.ok && cleared.value.taxExemptionReasonCode).toBeNull();
  });

  it('rejects bad barcodes, duplicate barcodes and bad prices', () => {
    const draft = baseDraft();
    draft.units[0]!.barcode = '2000000100013'; // wrong check digit
    draft.units[1]!.barcode = '2000000100013';
    draft.units[1]!.salePrice = '-1';
    const result = validateProductDraft(draft, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({ path: 'units.0.barcode', code: 'barcode_check_digit', severity: 'error' });
      expect(result.issues).toContainEqual({ path: 'units.1.barcode', code: 'barcode_duplicate', severity: 'error' });
      expect(result.issues).toContainEqual({ path: 'units.1.salePrice', code: 'not_negative_number', severity: 'error' });
    }
  });

  it('maps unit invariant violations to row paths', () => {
    const draft = baseDraft();
    draft.units[1]!.factor = '12.5';
    const result = validateProductDraft(draft, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual({ path: 'units.1.factor', code: 'units.factor_whole', severity: 'error' });
  });
});

describe('misc', () => {
  it('normalises SKUs', () => {
    expect(normalizeSku('  pvc  pipe 1/2 ')).toBe('PVC-PIPE-1/2');
  });
  it('role matrix: cashiers cannot edit the catalog, storekeepers cannot set prices', () => {
    expect(hasPermission(ROLE_PERMISSIONS.cashier, 'catalog.write')).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.storekeeper, 'catalog.write')).toBe(true);
    expect(hasPermission(ROLE_PERMISSIONS.storekeeper, 'catalog.price_write')).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.owner, 'users.manage')).toBe(true);
  });
});
