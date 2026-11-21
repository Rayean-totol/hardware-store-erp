/**
 * Supplier rules for the form and tests. The database (app.supplier_issue, save_supplier) applies
 * the same rules and is the authority. Parity is tested in packages/domain/test/supplier.test.ts.
 */

export const SUPPLIER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,39}$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,18}[0-9]$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VAT_PATTERN = /^3[0-9]{13}3$/;
const CR_PATTERN = /^[0-9]{10}$/;
const IBAN_PATTERN = /^SA[0-9]{22}$/;

export interface SupplierDraft {
  supplierCode?: string | null;
  nameEn: string;
  nameAr: string;
  nameBn?: string | null;
  contactPerson?: string | null;
  mobile?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  countryCode?: string | null;
  vatNumber?: string | null;
  crNumber?: string | null;
  openingBalance?: string | null;
  creditLimit?: string | null;
  paymentTermsDays?: string | null;
  defaultCurrency?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  iban?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export type SupplierIssue =
  | 'supplier.name_required'
  | 'supplier.code_invalid'
  | 'supplier.phone_invalid'
  | 'supplier.email_invalid'
  | 'supplier.vat_invalid'
  | 'supplier.cr_invalid'
  | 'supplier.iban_invalid'
  | 'supplier.amount_invalid'
  | 'supplier.payment_terms_invalid'
  | 'supplier.currency_invalid'
  | 'supplier.country_invalid';

const blank = (v: string | null | undefined) => (v ?? '').trim() === '';

/** The first problem with a draft, or null. Order matches the database check. */
export function supplierIssue(d: SupplierDraft): SupplierIssue | null {
  if (blank(d.nameEn) || d.nameEn.trim().length > 200) return 'supplier.name_required';
  if (blank(d.nameAr) || d.nameAr.trim().length > 200) return 'supplier.name_required';
  const code = (d.supplierCode ?? '').trim().toUpperCase();
  if (code !== '' && !SUPPLIER_CODE_PATTERN.test(code)) return 'supplier.code_invalid';
  if (!blank(d.mobile) && !PHONE_PATTERN.test(d.mobile!.trim())) return 'supplier.phone_invalid';
  if (!blank(d.whatsapp) && !PHONE_PATTERN.test(d.whatsapp!.trim())) return 'supplier.phone_invalid';
  if (!blank(d.email)) {
    const email = d.email!.trim();
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) return 'supplier.email_invalid';
  }
  if (!blank(d.vatNumber) && !VAT_PATTERN.test(d.vatNumber!.trim())) return 'supplier.vat_invalid';
  if (!blank(d.crNumber) && !CR_PATTERN.test(d.crNumber!.trim())) return 'supplier.cr_invalid';
  const iban = (d.iban ?? '').replace(/\s/g, '').toUpperCase();
  if (iban !== '' && !IBAN_PATTERN.test(iban)) return 'supplier.iban_invalid';
  if (!isValidMoney(d.openingBalance)) return 'supplier.amount_invalid';
  if (!isValidMoney(d.creditLimit)) return 'supplier.amount_invalid';
  const terms = (d.paymentTermsDays ?? '').trim();
  if (terms !== '' && (!/^[0-9]{1,3}$/.test(terms) || Number(terms) > 365)) return 'supplier.payment_terms_invalid';
  const currency = (d.defaultCurrency ?? '').trim().toUpperCase() || 'SAR';
  if (currency !== 'SAR') return 'supplier.currency_invalid';
  const country = (d.countryCode ?? '').trim().toUpperCase() || 'SA';
  if (!/^[A-Z]{2}$/.test(country)) return 'supplier.country_invalid';
  return null;
}

/** Blank is allowed (the field is optional). Otherwise: a non-negative amount with at most two decimals. */
function isValidMoney(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (v === '') return true;
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(v)) return false;
  return Number(v) >= 0;
}

/** Stock-keeping style code as the database stores it: trimmed and upper-cased. */
export function normaliseSupplierCode(code: string | null | undefined): string | null {
  const v = (code ?? '').trim().toUpperCase();
  return v === '' ? null : v;
}

/** IBAN as stored: spaces removed, upper-cased. */
export function normaliseIban(iban: string | null | undefined): string | null {
  const v = (iban ?? '').replace(/\s/g, '').toUpperCase();
  return v === '' ? null : v;
}
