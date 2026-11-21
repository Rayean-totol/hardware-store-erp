import { describe, expect, it } from 'vitest';
import { ibanChecksumValid, normaliseIban, normaliseSupplierCode, supplierIssue, type SupplierDraft } from '../src/supplier';

const ok: SupplierDraft = {
  nameEn: 'Najd Fasteners Co.',
  nameAr: 'شركة نجد للمثبتات',
  supplierCode: 'NAJD-01',
  mobile: '+966 50 123 4567',
  email: 'sales@najd.example',
  vatNumber: '300000000000003',
  crNumber: '1010123456',
  openingBalance: '1500.50',
  creditLimit: '20000',
  paymentTermsDays: '30',
  iban: 'SA03 8000 0000 6080 1016 7519',
  countryCode: 'SA',
  defaultCurrency: 'SAR',
};

describe('supplier validation (mirrors app.supplier_issue)', () => {
  it('accepts a complete, valid supplier', () => {
    expect(supplierIssue(ok)).toBeNull();
  });

  it('accepts a minimal supplier: only the two names', () => {
    expect(supplierIssue({ nameEn: 'A', nameAr: 'ا' })).toBeNull();
  });

  it.each([
    ['blank English name', { nameEn: '   ' }, 'supplier.name_required'],
    ['blank Arabic name', { nameAr: '' }, 'supplier.name_required'],
    ['lower-case code with a space', { supplierCode: 'bad code' }, 'supplier.code_invalid'],
    ['short phone', { mobile: '12' }, 'supplier.phone_invalid'],
    ['bad email', { email: 'a@b' }, 'supplier.email_invalid'],
    ['VAT number of 14 digits', { vatNumber: '30000000000003' }, 'supplier.vat_invalid'],
    ['VAT number not starting with 3', { vatNumber: '100000000000003' }, 'supplier.vat_invalid'],
    ['CR of 9 digits', { crNumber: '123456789' }, 'supplier.cr_invalid'],
    ['foreign IBAN', { iban: 'DE89370400440532013000' }, 'supplier.iban_invalid'],
    ['negative balance', { openingBalance: '-1' }, 'supplier.amount_invalid'],
    ['three decimals', { creditLimit: '1.005' }, 'supplier.amount_invalid'],
    ['NaN', { openingBalance: 'NaN' }, 'supplier.amount_invalid'],
    ['Infinity', { creditLimit: 'Infinity' }, 'supplier.amount_invalid'],
    ['exponent notation', { openingBalance: '1e3' }, 'supplier.amount_invalid'],
    ['oversized amount', { creditLimit: '99999999999999999999' }, 'supplier.amount_invalid'],
    ['wrong IBAN check digits', { iban: 'SA0380000000608010167518' }, 'supplier.iban_invalid'],
    ['letters in an amount', { openingBalance: 'abc' }, 'supplier.amount_invalid'],
    ['terms over 365', { paymentTermsDays: '366' }, 'supplier.payment_terms_invalid'],
    ['currency USD', { defaultCurrency: 'USD' }, 'supplier.currency_invalid'],
    ['country code of three letters', { countryCode: 'SAU' }, 'supplier.country_invalid'],
  ])('%s → %s', (_n, over, code) => {
    expect(supplierIssue({ ...ok, ...over } as SupplierDraft)).toBe(code);
  });

  it('blank optional fields are allowed', () => {
    expect(supplierIssue({ nameEn: 'A', nameAr: 'ا', mobile: '', email: '  ', vatNumber: '', iban: '' })).toBeNull();
  });

  it('a blank currency or country falls back to the default', () => {
    expect(supplierIssue({ nameEn: 'A', nameAr: 'ا', defaultCurrency: '', countryCode: '' })).toBeNull();
  });
});

describe('normalisation', () => {
  it('upper-cases codes and blanks become null', () => {
    expect(normaliseSupplierCode(' najd-01 ')).toBe('NAJD-01');
    expect(normaliseSupplierCode('   ')).toBeNull();
  });

  it('removes spaces from IBANs', () => {
    expect(normaliseIban('sa03 8000 0000 6080 1016 7519')).toBe('SA0380000000608010167519');
    expect(normaliseIban('')).toBeNull();
  });
});

describe('IBAN checksum (ISO 13616)', () => {
  it('accepts the Saudi example and rejects a changed check digit or a short number', () => {
    expect(ibanChecksumValid('SA0380000000608010167519')).toBe(true);
    expect(ibanChecksumValid('SA0380000000608010167518')).toBe(false);
    expect(ibanChecksumValid('SA03800000006080101675')).toBe(false);
  });
});
