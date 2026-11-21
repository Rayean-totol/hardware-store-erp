import { describe, expect, it, vi } from 'vitest';
import { createSupabaseSalesRepository, type DbClient } from '../src/index';

/** Captures the RPC name and arguments the repository sends (names must match the SQL functions). */
function fakeDb(data: unknown) {
  const rpc = vi.fn(async () => ({ data, error: null }));
  return { db: { rpc } as unknown as DbClient, rpc };
}

const RECEIPT = {
  status: 'created', sale_id: 'sale-1', invoice_number: 'INV-RUH-2026-000001', sale_status: 'finalized',
  net_total: '100.00', discount_total: '0.00', vat_total: '15.00', gross_total: '115.00',
  paid_total: '115.00', change_given: '0.00', balance_due: '0.00',
};

describe('sales repository', () => {
  it('sends the checkout to finalize_sale with the server parameter names and maps the receipt', async () => {
    const { db, rpc } = fakeDb(RECEIPT);
    const repo = createSupabaseSalesRepository(db);

    const receipt = await repo.finalizeSale({
      clientId: 'c1', orgId: 'o1', branchId: 'b1', warehouseId: 'w1', deviceId: 'd1', customerId: null, note: ' note ',
      lines: [{ productId: 'p1', unitId: 'u1', quantity: '2', unitPrice: null, discountType: 'percent', discountValue: '10' }],
      payments: [{ method: 'cash', amount: '115.00', tendered: '120.00', reference: null }],
    });

    expect(rpc).toHaveBeenCalledWith('finalize_sale', {
      p_org_id: 'o1', p_client_id: 'c1', p_branch_id: 'b1', p_warehouse_id: 'w1', p_device_id: 'd1', p_customer_id: null,
      p_note: 'note',
      p_lines: [{ product_id: 'p1', unit_id: 'u1', quantity: '2', unit_price: null, discount_type: 'percent', discount_value: '10' }],
      p_payments: [{ method: 'cash', amount: '115.00', tendered: '120.00', reference: null }],
    });
    expect(receipt).toMatchObject({
      status: 'created', saleId: 'sale-1', invoiceNumber: 'INV-RUH-2026-000001', grossTotal: '115.00', vatTotal: '15.00', balanceDue: '0.00',
    });
  });

  it('refuses an empty checkout before calling the server', async () => {
    const { db, rpc } = fakeDb(RECEIPT);
    await expect(
      createSupabaseSalesRepository(db).finalizeSale({
        clientId: 'c1', orgId: 'o1', branchId: 'b1', warehouseId: 'w1', lines: [], payments: [],
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('cancels through cancel_sale with the reason', async () => {
    const { db, rpc } = fakeDb({ ...RECEIPT, status: 'voided', sale_status: 'voided' });
    const receipt = await createSupabaseSalesRepository(db).cancelSale('o1', 'sale-1', 'Wrong item', 'd1');
    expect(rpc).toHaveBeenCalledWith('cancel_sale', { p_org_id: 'o1', p_sale_id: 'sale-1', p_reason: 'Wrong item', p_device_id: 'd1' });
    expect(receipt.saleStatus).toBe('voided');
  });
});
