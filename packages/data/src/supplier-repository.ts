import type { DbClient } from './client';
import { unwrap } from './errors';

/** A supplier as the server returns it. Financial fields are present only for suppliers.manage holders. */
export interface Supplier {
  id: string;
  supplierNo: string;
  supplierCode: string;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
  contactPerson: string | null;
  mobile: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  countryCode: string;
  vatNumber: string | null;
  crNumber: string | null;
  paymentTermsDays: number | null;
  defaultCurrency: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
  /** Financial and bank fields: undefined when the caller may not see them. */
  openingBalance?: string;
  creditLimit?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  iban?: string | null;
}

export type SupplierStatusFilter = 'active' | 'inactive' | 'all';

export interface SupplierListQuery {
  orgId: string;
  search?: string;
  status?: SupplierStatusFilter;
  limit?: number;
  offset?: number;
}

export interface SupplierListPage {
  items: Supplier[];
  total: number;
  limit: number;
  offset: number;
}

/** What the form sends. Strings are as typed; the server validates and normalises. */
export interface SupplierInput {
  id?: string | null;
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
  bankName?: string | null;
  bankAccountName?: string | null;
  iban?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface SupplierSaveResult {
  id: string;
  supplierNo: string;
  rowVersion: number;
}

export interface SupplierRepository {
  list(query: SupplierListQuery): Promise<SupplierListPage>;
  get(orgId: string, supplierId: string): Promise<Supplier>;
  save(orgId: string, input: SupplierInput, expectedVersion: number | null): Promise<SupplierSaveResult>;
}

interface RawSupplier {
  id: string; supplier_no: string; supplier_code: string; name_en: string; name_ar: string; name_bn?: string;
  contact_person?: string; mobile?: string; whatsapp?: string; email?: string; address?: string; city?: string;
  country_code: string; vat_number?: string; cr_number?: string; payment_terms_days?: number; default_currency: string;
  notes?: string; is_active: boolean; created_at: string; updated_at: string; row_version: number;
  opening_balance?: string; credit_limit?: string; bank_name?: string; bank_account_name?: string; iban?: string;
}

export function mapSupplier(r: RawSupplier): Supplier {
  const s: Supplier = {
    id: r.id,
    supplierNo: r.supplier_no,
    supplierCode: r.supplier_code,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    nameBn: r.name_bn ?? null,
    contactPerson: r.contact_person ?? null,
    mobile: r.mobile ?? null,
    whatsapp: r.whatsapp ?? null,
    email: r.email ?? null,
    address: r.address ?? null,
    city: r.city ?? null,
    countryCode: r.country_code,
    vatNumber: r.vat_number ?? null,
    crNumber: r.cr_number ?? null,
    paymentTermsDays: r.payment_terms_days ?? null,
    defaultCurrency: r.default_currency,
    notes: r.notes ?? null,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    rowVersion: r.row_version,
  };
  if (r.opening_balance !== undefined) {
    s.openingBalance = r.opening_balance;
    s.creditLimit = r.credit_limit ?? null;
    s.bankName = r.bank_name ?? null;
    s.bankAccountName = r.bank_account_name ?? null;
    s.iban = r.iban ?? null;
  }
  return s;
}

/** The payload the save function reads (snake_case keys, as the SQL expects). */
export function supplierPayload(input: SupplierInput): Record<string, unknown> {
  return {
    ...(input.id ? { id: input.id } : {}),
    supplier_code: input.supplierCode ?? null,
    name_en: input.nameEn,
    name_ar: input.nameAr,
    name_bn: input.nameBn ?? null,
    contact_person: input.contactPerson ?? null,
    mobile: input.mobile ?? null,
    whatsapp: input.whatsapp ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    country_code: input.countryCode ?? null,
    vat_number: input.vatNumber ?? null,
    cr_number: input.crNumber ?? null,
    opening_balance: input.openingBalance ?? null,
    credit_limit: input.creditLimit ?? null,
    payment_terms_days: input.paymentTermsDays ?? null,
    bank_name: input.bankName ?? null,
    bank_account_name: input.bankAccountName ?? null,
    iban: input.iban ?? null,
    notes: input.notes ?? null,
    is_active: input.isActive ?? true,
  };
}

export function createSupabaseSupplierRepository(db: DbClient): SupplierRepository {
  return {
    async list(q) {
      const raw = unwrap(
        await db.rpc('list_suppliers', {
          p_org_id: q.orgId,
          p_search: q.search?.trim() || null,
          p_status: q.status ?? 'active',
          p_limit: q.limit ?? 50,
          p_offset: q.offset ?? 0,
        }),
      ) as unknown as { items: RawSupplier[]; total: number; limit: number; offset: number };
      return { items: raw.items.map(mapSupplier), total: Number(raw.total), limit: raw.limit, offset: raw.offset };
    },

    async get(orgId, supplierId) {
      const raw = unwrap(await db.rpc('get_supplier', { p_org_id: orgId, p_supplier_id: supplierId })) as unknown as RawSupplier;
      return mapSupplier(raw);
    },

    async save(orgId, input, expectedVersion) {
      const raw = unwrap(
        await db.rpc('save_supplier', {
          p_org_id: orgId,
          p_supplier: supplierPayload(input),
          p_expected_version: expectedVersion,
        }),
      ) as unknown as { id: string; supplier_no: string; row_version: number };
      return { id: raw.id, supplierNo: raw.supplier_no, rowVersion: raw.row_version };
    },
  };
}
