import { describe, expect, it, vi } from 'vitest';
import { createSupabasePurchaseOrderRepository, mapPurchaseOrder, purchaseLinesPayload, type DbClient } from '../src/index';

function fakeDb(result: unknown) {
  const rpc = vi.fn(async () => ({ data: result, error: null }));
  return { db: { rpc } as unknown as DbClient, rpc };
}

const LINE = { productId: 'p1', unitId: 'u1', quantity: ' 10 ', unitCost: '4.50', discountType: 'percent' as const, discountValue: '5' };

describe('purchase order repository', () => {
  it('creates through create_purchase_order with snake_case lines and an idempotency key', async () => {
    const { db, rpc } = fakeDb({ status: 'created', id: 'po1', po_number: 'PO-000001', row_version: 1 });
    const result = await createSupabasePurchaseOrderRepository(db).create('o1', 'c1', {
      supplierId: 's1', branchId: 'b1', warehouseId: 'w1', expectedDeliveryDate: '', deliveryNotes: ' gate 2 ', lines: [LINE],
    });
    expect(rpc).toHaveBeenCalledWith('create_purchase_order', {
      p_org_id: 'o1', p_client_id: 'c1', p_supplier_id: 's1', p_branch_id: 'b1', p_warehouse_id: 'w1', p_expected_delivery: null,
      p_delivery_notes: 'gate 2',
      p_lines: [{ product_id: 'p1', unit_id: 'u1', quantity: '10', unit_cost: '4.50', discount_type: 'percent', discount_value: '5' }],
    });
    expect(result).toEqual({ status: 'created', id: 'po1', poNumber: 'PO-000001', rowVersion: 1 });
  });

  it('sends the expected version on every transition and the reason on cancel', async () => {
    const { db, rpc } = fakeDb({ status: 'approved', id: 'po1', po_number: 'PO-000001', row_version: 3 });
    const repo = createSupabasePurchaseOrderRepository(db);
    await repo.approve('o1', 'po1', 2);
    expect(rpc).toHaveBeenLastCalledWith('approve_purchase_order', { p_org_id: 'o1', p_po_id: 'po1', p_expected_version: 2 });
    await repo.cancel('o1', 'po1', 3, ' Supplier cannot deliver ');
    expect(rpc).toHaveBeenLastCalledWith('cancel_purchase_order', { p_org_id: 'o1', p_po_id: 'po1', p_expected_version: 3, p_reason: 'Supplier cannot deliver' });
  });

  it('sends only the header keys the caller set on update, and lines only when given', async () => {
    const { db, rpc } = fakeDb({ status: 'updated', id: 'po1', po_number: 'PO-000001', row_version: 4 });
    await createSupabasePurchaseOrderRepository(db).update('o1', 'po1', 3, { deliveryNotes: 'late' }, null);
    expect(rpc).toHaveBeenLastCalledWith('update_purchase_order', { p_org_id: 'o1', p_po_id: 'po1', p_expected_version: 3, p_header: { delivery_notes: 'late' }, p_lines: null });
  });

  it('maps cost fields only when present, so a viewer without cost access never sees them', () => {
    const withCost = mapPurchaseOrder({
      id: 'po1', po_number: 'PO-000001', status: 'draft', supplier_id: 's1', branch_id: 'b1', warehouse_id: 'w1', created_at: '2026-11-21T00:00:00Z',
      row_version: 1, grand_total: '57.50', lines: [{ id: 'l1', line_no: 1, product_id: 'p', unit_id: 'u', sku: 'X', name_en: 'X', entered_quantity: '10', factor: '1', base_quantity: '10', unit_cost: '5.0000' }],
    });
    expect(withCost.grandTotal).toBe('57.50');
    expect(withCost.lines[0]!.unitCost).toBe('5.0000');
    const withoutCost = mapPurchaseOrder({ id: 'po1', po_number: 'PO-000001', status: 'draft', supplier_id: 's1', branch_id: 'b1', warehouse_id: 'w1', created_at: '', row_version: 1, lines: [{ id: 'l1', line_no: 1, product_id: 'p', unit_id: 'u', sku: 'X', name_en: 'X', entered_quantity: '10', factor: '1', base_quantity: '10' }] });
    expect(withoutCost.grandTotal).toBeUndefined();
    expect(withoutCost.lines[0]!.unitCost).toBeUndefined();
  });

  it('builds the line payload without trailing spaces', () => {
    expect(purchaseLinesPayload([{ ...LINE, quantity: '2 ', unitCost: ' 1.2 ', discountValue: '' }])[0]).toMatchObject({ quantity: '2', unit_cost: '1.2', discount_value: null });
  });
});
