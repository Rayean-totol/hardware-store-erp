import { describe, expect, it, vi } from 'vitest';
import { createSupabaseSupplierRepository, mapSupplier, supplierPayload, type DbClient } from '../src/index';

function fakeDb(result: unknown) {
  const rpc = vi.fn(async () => ({ data: result, error: null }));
  return { db: { rpc } as unknown as DbClient, rpc };
}

const ROW = {
  id: 's1', supplier_no: 'SUP-000001', supplier_code: 'NAJD', name_en: 'Najd', name_ar: 'نجد', country_code: 'SA',
  default_currency: 'SAR', is_active: true, created_at: '2026-11-21T00:00:00Z', updated_at: '2026-11-21T00:00:00Z', row_version: 2,
};

describe('supplier repository', () => {
  it('lists through list_suppliers with the server parameter names', async () => {
    const { db, rpc } = fakeDb({ items: [ROW], total: 1, limit: 50, offset: 0 });
    const page = await createSupabaseSupplierRepository(db).list({ orgId: 'o1', search: ' najd ', status: 'all' });
    expect(rpc).toHaveBeenCalledWith('list_suppliers', { p_org_id: 'o1', p_search: 'najd', p_status: 'all', p_limit: 50, p_offset: 0 });
    expect(page.items[0]).toMatchObject({ supplierNo: 'SUP-000001', supplierCode: 'NAJD', rowVersion: 2 });
    expect(page.items[0]).not.toHaveProperty('openingBalance');
  });

  it('keeps financial fields only when the server returned them', () => {
    const withFinance = mapSupplier({ ...ROW, opening_balance: '10.00', credit_limit: null, iban: 'SA0380000000608010167519' } as never);
    expect(withFinance.openingBalance).toBe('10.00');
    expect(withFinance.iban).toBe('SA0380000000608010167519');
    expect(mapSupplier(ROW as never)).not.toHaveProperty('iban');
  });

  it('saves through save_supplier with the expected version and maps the result', async () => {
    const { db, rpc } = fakeDb({ id: 's1', supplier_no: 'SUP-000001', row_version: 3 });
    const result = await createSupabaseSupplierRepository(db).save('o1', { id: 's1', nameEn: 'Najd', nameAr: 'نجد', openingBalance: '5' }, 2);
    expect(rpc).toHaveBeenCalledWith('save_supplier', {
      p_org_id: 'o1',
      p_supplier: expect.objectContaining({ id: 's1', name_en: 'Najd', opening_balance: '5' }),
      p_expected_version: 2,
    });
    expect(result).toEqual({ id: 's1', supplierNo: 'SUP-000001', rowVersion: 3 });
  });

  it('omits the id for a new supplier so the server numbers it', () => {
    expect(supplierPayload({ nameEn: 'A', nameAr: 'ا' })).not.toHaveProperty('id');
  });

  it('sends only the fields the caller set, so unset fields are never cleared by accident', () => {
    const payload = supplierPayload({ id: 's1', nameEn: 'Najd', nameAr: 'نجد' });
    expect(payload).toEqual({ id: 's1', name_en: 'Najd', name_ar: 'نجد' });
    expect(supplierPayload({ nameEn: 'A', nameAr: 'ا', city: null, mobile: '' })).toMatchObject({ city: null, mobile: '' });
  });

  it('surfaces a refusal from the server as a DataError with the code', async () => {
    const db = { rpc: vi.fn(async () => ({ data: null, error: { message: 'supplier.code_taken', details: 'NAJD', code: 'P0001' } })) } as unknown as DbClient;
    await expect(createSupabaseSupplierRepository(db).save('o1', { nameEn: 'A', nameAr: 'ا' }, null)).rejects.toMatchObject({ code: 'supplier.code_taken' });
  });
});
