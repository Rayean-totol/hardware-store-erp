import type { DbClient } from './client';
import { unwrap } from './errors';

export type PurchaseOrderStatus = 'draft' | 'submitted' | 'approved' | 'partially_received' | 'fully_received' | 'cancelled';

/** A line as the server returns it. Cost fields are present only for purchase.cost_view holders. */
export interface PurchaseOrderLine {
  id: string;
  lineNo: number;
  productId: string;
  unitId: string;
  sku: string;
  nameEn: string;
  nameAr: string | null;
  nameBn: string | null;
  enteredQuantity: string;
  factor: string;
  baseQuantity: string;
  receivedBaseQuantity: string;
  taxCategory?: string;
  unitCost?: string;
  baseUnitCost?: string;
  discountType?: 'percent' | 'fixed' | null;
  discountValue?: string | null;
  discountAmount?: string;
  netAmount?: string;
  vatRate?: string;
  vatAmount?: string;
  grossAmount?: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierNameEn?: string;
  supplierNo?: string;
  branchId: string;
  warehouseId: string;
  expectedDeliveryDate: string | null;
  deliveryNotes: string | null;
  createdAt: string;
  createdBy: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  rowVersion: number;
  lines: PurchaseOrderLine[];
  /** Cost view only. */
  pricesIncludeVat?: boolean;
  subtotalNet?: string;
  discountTotal?: string;
  vatTotal?: string;
  grandTotal?: string;
}

export interface PurchaseOrderLineInput {
  productId: string;
  unitId: string;
  quantity: string;
  unitCost: string;
  discountType?: 'percent' | 'fixed' | null;
  discountValue?: string | null;
}

export interface PurchaseOrderInput {
  supplierId: string;
  branchId: string;
  warehouseId: string;
  expectedDeliveryDate?: string | null;
  deliveryNotes?: string | null;
  lines: PurchaseOrderLineInput[];
}

export interface PurchaseOrderQuery {
  orgId: string;
  status?: PurchaseOrderStatus | 'all';
  supplierId?: string | null;
  branchId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export interface PurchaseOrderListPage {
  items: PurchaseOrder[];
  total: number;
  limit: number;
  offset: number;
}

export interface PurchaseOrderActionResult {
  status: 'created' | 'updated' | 'submitted' | 'approved' | 'cancelled' | 'duplicate';
  id: string;
  poNumber: string;
  rowVersion: number;
}

export interface PurchaseOrderRepository {
  list(query: PurchaseOrderQuery): Promise<PurchaseOrderListPage>;
  get(orgId: string, id: string): Promise<PurchaseOrder>;
  create(orgId: string, clientId: string, input: PurchaseOrderInput): Promise<PurchaseOrderActionResult>;
  update(orgId: string, id: string, expectedVersion: number, header: Partial<PurchaseOrderInput>, lines: PurchaseOrderLineInput[] | null): Promise<PurchaseOrderActionResult>;
  submit(orgId: string, id: string, expectedVersion: number): Promise<PurchaseOrderActionResult>;
  approve(orgId: string, id: string, expectedVersion: number): Promise<PurchaseOrderActionResult>;
  cancel(orgId: string, id: string, expectedVersion: number, reason: string): Promise<PurchaseOrderActionResult>;
}

type Raw = Record<string, unknown>;

const str = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

export function mapPurchaseOrderLine(r: Raw): PurchaseOrderLine {
  return {
    id: String(r.id),
    lineNo: Number(r.line_no),
    productId: String(r.product_id),
    unitId: String(r.unit_id),
    sku: String(r.sku),
    nameEn: String(r.name_en),
    nameAr: str(r.name_ar) ?? null,
    nameBn: str(r.name_bn) ?? null,
    enteredQuantity: String(r.entered_quantity),
    factor: String(r.factor),
    baseQuantity: String(r.base_quantity),
    receivedBaseQuantity: str(r.received_base_quantity) ?? '0',
    taxCategory: str(r.tax_category),
    unitCost: str(r.unit_cost),
    baseUnitCost: str(r.base_unit_cost),
    discountType: (r.discount_type as 'percent' | 'fixed' | null | undefined) ?? undefined,
    discountValue: str(r.discount_value) ?? null,
    discountAmount: str(r.discount_amount),
    netAmount: str(r.net_amount),
    vatRate: str(r.vat_rate),
    vatAmount: str(r.vat_amount),
    grossAmount: str(r.gross_amount),
  };
}

export function mapPurchaseOrder(r: Raw): PurchaseOrder {
  const lines = Array.isArray(r.lines) ? (r.lines as Raw[]).map(mapPurchaseOrderLine) : [];
  return {
    id: String(r.id),
    poNumber: String(r.po_number),
    status: r.status as PurchaseOrderStatus,
    supplierId: String(r.supplier_id),
    supplierNameEn: str(r.supplier_name_en),
    supplierNo: str(r.supplier_no),
    branchId: String(r.branch_id),
    warehouseId: String(r.warehouse_id),
    expectedDeliveryDate: str(r.expected_delivery_date) ?? null,
    deliveryNotes: str(r.delivery_notes) ?? null,
    createdAt: String(r.created_at),
    createdBy: str(r.created_by) ?? null,
    submittedAt: str(r.submitted_at) ?? null,
    approvedAt: str(r.approved_at) ?? null,
    cancelledAt: str(r.cancelled_at) ?? null,
    cancelReason: str(r.cancel_reason) ?? null,
    rowVersion: Number(r.row_version),
    lines,
    pricesIncludeVat: r.prices_include_vat as boolean | undefined,
    subtotalNet: str(r.subtotal_net),
    discountTotal: str(r.discount_total),
    vatTotal: str(r.vat_total),
    grandTotal: str(r.grand_total),
  };
}

/** Lines as the server expects them (snake_case). */
export function purchaseLinesPayload(lines: PurchaseOrderLineInput[]): Raw[] {
  return lines.map((l) => ({
    product_id: l.productId,
    unit_id: l.unitId,
    quantity: l.quantity.trim(),
    unit_cost: l.unitCost.trim(),
    discount_type: l.discountType ?? null,
    discount_value: l.discountValue?.trim() || null,
  }));
}

export function createSupabasePurchaseOrderRepository(db: DbClient): PurchaseOrderRepository {
  const action = async (fn: string, args: Raw): Promise<PurchaseOrderActionResult> => {
    const raw = unwrap(await db.rpc(fn, args)) as unknown as Raw;
    return { status: raw.status as PurchaseOrderActionResult['status'], id: String(raw.id), poNumber: String(raw.po_number), rowVersion: Number(raw.row_version) };
  };
  return {
    async list(q) {
      const raw = unwrap(
        await db.rpc('list_purchase_orders', {
          p_org_id: q.orgId,
          p_status: q.status ?? 'all',
          p_supplier_id: q.supplierId ?? null,
          p_branch_id: q.branchId ?? null,
          p_from: q.from ?? null,
          p_to: q.to ?? null,
          p_limit: q.limit ?? 50,
          p_offset: q.offset ?? 0,
        }),
      ) as unknown as { items: Raw[]; total: number; limit: number; offset: number };
      return { items: raw.items.map(mapPurchaseOrder), total: Number(raw.total), limit: raw.limit, offset: raw.offset };
    },

    async get(orgId, id) {
      return mapPurchaseOrder(unwrap(await db.rpc('get_purchase_order', { p_org_id: orgId, p_po_id: id })) as unknown as Raw);
    },

    create(orgId, clientId, input) {
      return action('create_purchase_order', {
        p_org_id: orgId,
        p_client_id: clientId,
        p_supplier_id: input.supplierId,
        p_branch_id: input.branchId,
        p_warehouse_id: input.warehouseId,
        p_expected_delivery: input.expectedDeliveryDate || null,
        p_delivery_notes: input.deliveryNotes?.trim() || null,
        p_lines: purchaseLinesPayload(input.lines),
      });
    },

    update(orgId, id, expectedVersion, header, lines) {
      const payload: Raw = {};
      if (header.supplierId !== undefined) payload.supplier_id = header.supplierId;
      if (header.warehouseId !== undefined) payload.warehouse_id = header.warehouseId;
      if (header.expectedDeliveryDate !== undefined) payload.expected_delivery_date = header.expectedDeliveryDate || null;
      if (header.deliveryNotes !== undefined) payload.delivery_notes = header.deliveryNotes ?? null;
      return action('update_purchase_order', {
        p_org_id: orgId,
        p_po_id: id,
        p_expected_version: expectedVersion,
        p_header: payload,
        p_lines: lines ? purchaseLinesPayload(lines) : null,
      });
    },

    submit(orgId, id, expectedVersion) {
      return action('submit_purchase_order', { p_org_id: orgId, p_po_id: id, p_expected_version: expectedVersion });
    },

    approve(orgId, id, expectedVersion) {
      return action('approve_purchase_order', { p_org_id: orgId, p_po_id: id, p_expected_version: expectedVersion });
    },

    cancel(orgId, id, expectedVersion, reason) {
      return action('cancel_purchase_order', { p_org_id: orgId, p_po_id: id, p_expected_version: expectedVersion, p_reason: reason.trim() });
    },
  };
}
