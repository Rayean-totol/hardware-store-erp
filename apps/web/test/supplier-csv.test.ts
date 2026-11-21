import { describe, expect, it } from 'vitest';
import { SUPPLIER_CSV_COLUMNS, suppliersToCsv } from '@/features/suppliers/supplier-csv';
import { SUPPLIERS } from './helpers';

describe('supplier CSV', () => {
  it('never includes financial or bank columns', () => {
    const header = suppliersToCsv(SUPPLIERS).split('\r\n')[0]!;
    for (const forbidden of ['opening_balance', 'credit_limit', 'iban', 'bank']) {
      expect(header).not.toContain(forbidden);
    }
    expect(SUPPLIER_CSV_COLUMNS).toContain('supplier_no');
  });

  it('quotes values with commas, quotes and line breaks', () => {
    const csv = suppliersToCsv([{ ...SUPPLIERS[0]!, nameEn: 'Najd, "Trading"\nCo', notes: null }]);
    expect(csv).toContain('"Najd, ""Trading""\nCo"');
  });

  it('writes one row per supplier after the header', () => {
    expect(suppliersToCsv(SUPPLIERS).split('\r\n')).toHaveLength(2);
  });
});
