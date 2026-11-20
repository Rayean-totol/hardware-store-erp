import { describe, expect, it } from 'vitest';
import { DataError, readSupabaseConfig, toDataError, toSaveProductParams, unwrap } from '../src';

describe('toDataError', () => {
  it('maps app.fail() codes from P0001', () => {
    const e = toDataError({ code: 'P0001', message: 'product.sku_taken', details: 'ABC' });
    expect(e).toBeInstanceOf(DataError);
    expect(e.code).toBe('product.sku_taken');
    expect(e.detail).toBe('ABC');
  });
  it('keeps unknown messages visible instead of hiding them', () => {
    const e = toDataError({ code: 'P0001', message: 'Something Odd happened' });
    expect(e.code).toBe('unknown');
    expect(e.message).toBe('Something Odd happened');
  });
  it('maps Postgres and PostgREST codes', () => {
    expect(toDataError({ code: '42501', message: 'permission denied' }).code).toBe('forbidden');
    expect(toDataError({ code: '23505', message: 'dup' }).code).toBe('conflict.unique');
    expect(toDataError({ code: 'PGRST301', message: 'JWT expired' }).code).toBe('auth.session_expired');
    expect(toDataError(new TypeError('Failed to fetch')).code).toBe('network');
    expect(toDataError({ code: '', message: 'TypeError: fetch failed' }).code).toBe('network');
    expect(toDataError(new Error('socket hang up')).code).toBe('unknown');
  });
  it('unwrap throws on error and on null data', () => {
    expect(() => unwrap({ data: null, error: { code: '42501', message: 'x' } })).toThrow(DataError);
    expect(() => unwrap({ data: null, error: null })).toThrow(/No data/);
    expect(unwrap({ data: 1, error: null })).toBe(1);
  });
});

describe('readSupabaseConfig', () => {
  it('reports missing values instead of defaulting', () => {
    expect(readSupabaseConfig({})).toEqual({ ok: false, missing: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] });
    expect(readSupabaseConfig({ url: 'not a url', anonKey: 'k' }).ok).toBe(false);
    expect(readSupabaseConfig({ url: 'https://x.supabase.co', anonKey: 'k' }).ok).toBe(true);
  });
});

describe('toSaveProductParams', () => {
  it('maps camelCase drafts to snake_case RPC params', () => {
    const params = toSaveProductParams(
      {
        orgId: 'o', sku: 'A', nameEn: 'A', nameAr: 'أ', productType: 'stock', baseUnitId: 'u', taxCategory: 'S',
        units: [{ unitId: 'u', factor: '1', isBase: true, barcode: null, salePrice: '1.5', isSaleUnit: true, isPurchaseUnit: false }],
      },
      3,
    );
    expect(params.p_expected_version).toBe(3);
    expect(params.p_product).toMatchObject({ id: null, org_id: 'o', base_unit_id: 'u', tax_exemption_reason_code: null });
    expect(params.p_units).toEqual([{ unit_id: 'u', factor: '1', is_base: true, barcode: null, sale_price: '1.5', is_sale_unit: true, is_purchase_unit: false }]);
  });
});
