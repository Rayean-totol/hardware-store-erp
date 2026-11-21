import type { Supplier, SupplierRepository } from '@erp/data';

/** Columns of the supplier CSV (no financial fields: the directory export never includes balances). */
export const SUPPLIER_CSV_COLUMNS = [
  'supplier_no', 'supplier_code', 'name_en', 'name_ar', 'name_bn', 'contact_person', 'mobile', 'whatsapp', 'email',
  'city', 'country_code', 'vat_number', 'cr_number', 'payment_terms_days', 'is_active', 'updated_at',
] as const;

const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  // Quote anything with a delimiter, quote or line break; double the quotes inside.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function suppliersToCsv(items: readonly Supplier[]): string {
  const rows = items.map((s) => [
    s.supplierNo, s.supplierCode, s.nameEn, s.nameAr, s.nameBn ?? '', s.contactPerson ?? '', s.mobile ?? '', s.whatsapp ?? '',
    s.email ?? '', s.city ?? '', s.countryCode, s.vatNumber ?? '', s.crNumber ?? '', s.paymentTermsDays ?? '',
    s.isActive ? 'yes' : 'no', s.updatedAt,
  ]);
  return [SUPPLIER_CSV_COLUMNS.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
}

/** Every matching supplier (pages of 200, capped), so the export is the whole filtered directory. */
export async function fetchAllSuppliers(
  repo: SupplierRepository,
  orgId: string,
  status: 'active' | 'inactive' | 'all',
  search: string,
): Promise<Supplier[]> {
  const out: Supplier[] = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const page = await repo.list({ orgId, status, search, limit: 200, offset });
    out.push(...page.items);
    if (out.length >= page.total || page.items.length === 0) break;
  }
  return out;
}
