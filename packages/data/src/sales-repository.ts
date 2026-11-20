import type { DbClient } from './client';
import { DataError, unwrap } from './errors';

/** Lines and payments as the till sends them. The server recalculates every amount. */
export interface SaleLineRequest {
  productId: string;
  unitId: string;
  quantity: string;
  /** Only sent when the price was changed at the till (needs sales.price_override). */
  unitPrice?: string | null;
  discountType?: 'percent' | 'fixed' | null;
  discountValue?: string | null;
}

export interface PaymentRequest {
  method: 'cash' | 'card' | 'transfer';
  /** Amount applied to the invoice. */
  amount: string;
  /** Amount handed over (cash only). Change = tendered - amount. */
  tendered?: string | null;
  reference?: string | null;
}

export interface FinalizeSaleInput {
  /** Idempotency key: generated once per checkout attempt and reused on retries. */
  clientId: string;
  orgId: string;
  branchId: string;
  warehouseId: string;
  deviceId?: string | null;
  customerId?: string | null;
  note?: string | null;
  lines: SaleLineRequest[];
  payments: PaymentRequest[];
}

export interface SaleReceipt {
  status: 'created' | 'duplicate' | 'voided';
  saleId: string;
  invoiceNumber: string;
  saleStatus: 'finalized' | 'voided';
  netTotal: string;
  discountTotal: string;
  vatTotal: string;
  grossTotal: string;
  paidTotal: string;
  changeGiven: string;
  balanceDue: string;
}

export interface SaleSummary {
  id: string;
  invoiceNumber: string;
  status: 'finalized' | 'voided';
  grossTotal: string;
  paidTotal: string;
  balanceDue: string;
  businessDate: string;
  createdAt: string;
  customerId: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  creditAllowed: boolean;
}

export interface SalesRepository {
  finalizeSale(input: FinalizeSaleInput): Promise<SaleReceipt>;
  cancelSale(orgId: string, saleId: string, reason: string, deviceId?: string | null): Promise<SaleReceipt>;
  listRecentSales(orgId: string, branchId: string, limit: number): Promise<SaleSummary[]>;
  listCustomers(orgId: string): Promise<Customer[]>;
}

interface RawReceipt {
  status: SaleReceipt['status'];
  sale_id: string;
  invoice_number: string;
  sale_status: SaleReceipt['saleStatus'];
  net_total: string;
  discount_total: string;
  vat_total: string;
  gross_total: string;
  paid_total: string;
  change_given: string;
  balance_due: string;
}

const mapReceipt = (r: RawReceipt): SaleReceipt => ({
  status: r.status,
  saleId: r.sale_id,
  invoiceNumber: r.invoice_number,
  saleStatus: r.sale_status,
  netTotal: r.net_total,
  discountTotal: r.discount_total,
  vatTotal: r.vat_total,
  grossTotal: r.gross_total,
  paidTotal: r.paid_total,
  changeGiven: r.change_given,
  balanceDue: r.balance_due,
});

const SALE_SELECT = 'id, invoice_number, status, gross_total, paid_total, balance_due, business_date, created_at, customer_id';

export function createSupabaseSalesRepository(db: DbClient): SalesRepository {
  return {
    async finalizeSale(input) {
      if (input.lines.length === 0) throw new DataError('validation', 'lines');
      const raw = unwrap(
        await db.rpc('finalize_sale', {
          p_org_id: input.orgId,
          p_client_id: input.clientId,
          p_branch_id: input.branchId,
          p_warehouse_id: input.warehouseId,
          p_device_id: input.deviceId ?? null,
          p_customer_id: input.customerId ?? null,
          p_note: input.note?.trim() || null,
          p_lines: input.lines.map((l) => ({
            product_id: l.productId,
            unit_id: l.unitId,
            quantity: l.quantity,
            unit_price: l.unitPrice ?? null,
            discount_type: l.discountType ?? null,
            discount_value: l.discountValue ?? null,
          })),
          p_payments: input.payments.map((p) => ({
            method: p.method,
            amount: p.amount,
            tendered: p.tendered ?? null,
            reference: p.reference?.trim() || null,
          })),
        }),
      );
      return mapReceipt(raw as unknown as RawReceipt);
    },

    async cancelSale(orgId, saleId, reason, deviceId) {
      const raw = unwrap(await db.rpc('cancel_sale', { p_org_id: orgId, p_sale_id: saleId, p_reason: reason, p_device_id: deviceId ?? null }));
      return mapReceipt(raw as unknown as RawReceipt);
    },

    async listRecentSales(orgId, branchId, limit) {
      const rows = unwrap(
        await db
          .from('sales')
          .select(SALE_SELECT)
          .eq('org_id', orgId)
          .eq('branch_id', branchId)
          .order('created_at', { ascending: false })
          .limit(limit),
      ) as unknown as Array<{
        id: string; invoice_number: string; status: SaleSummary['status']; gross_total: string; paid_total: string;
        balance_due: string; business_date: string; created_at: string; customer_id: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        status: r.status,
        grossTotal: r.gross_total,
        paidTotal: r.paid_total,
        balanceDue: r.balance_due,
        businessDate: r.business_date,
        createdAt: r.created_at,
        customerId: r.customer_id,
      }));
    },

    async listCustomers(orgId) {
      const rows = unwrap(
        await db.from('customers').select('id, name, phone, credit_allowed').eq('org_id', orgId).eq('is_active', true).order('name'),
      ) as unknown as Array<{ id: string; name: string; phone: string | null; credit_allowed: boolean }>;
      return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, creditAllowed: r.credit_allowed }));
    },
  };
}
