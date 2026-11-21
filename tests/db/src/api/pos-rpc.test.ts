import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSupabaseSalesRepository, DataError } from '@erp/data';
import { calculateLine } from '@erp/domain';
import { clientFor } from '../api-client';
import { DEMO_ORG, USERS } from '../env';

/**
 * The POS over real PostgREST with signed JWTs (what the browser does). Runs in its own database
 * because it commits sales and stock (see vitest.api-pos.config.ts).
 */
async function refs() {
  const db = await clientFor(USERS.owner);
  const wh = (await db.from('warehouses').select('id, branch_id').eq('org_id', DEMO_ORG).eq('code', 'RUH').single()).data!;
  const product = (await db.from('products').select('id').eq('org_id', DEMO_ORG).eq('sku', 'FST-WS-4X40').single()).data!;
  const unit = (await db.from('units').select('id').eq('code', 'pcs').single()).data!;
  const price = (await db.from('product_units').select('sale_price').eq('product_id', product.id).eq('unit_id', unit.id).single()).data!;
  const org = (await db.from('organizations').select('prices_include_vat').eq('id', DEMO_ORG).single()).data!;
  return { wh, product, unit, price: price.sale_price as string, pricesIncludeVat: org.prices_include_vat as boolean };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof DataError && e.code === code);
}

describe('POS over PostgREST', () => {
  it('owner stocks the shelf, sells, sees the sale, replays safely, and cancels', async () => {
    const owner = await clientFor(USERS.owner);
    const r = await refs();
    await owner.rpc('apply_stock_movements', {
      p_org_id: DEMO_ORG,
      p_device_id: 'POS-API',
      p_movements: [{ client_id: randomUUID(), warehouse_id: r.wh.id, product_id: r.product.id, movement_type: 'stock_in', unit_id: r.unit.id,
        quantity: '50', unit_cost: '2', occurred_at: '2026-11-20T10:00:00Z' }],
    });

    const sales = createSupabaseSalesRepository(owner);
    const client = randomUUID();
    const input = {
      clientId: client, orgId: DEMO_ORG, branchId: r.wh.branch_id, warehouseId: r.wh.id,
      lines: [{ productId: r.product.id, unitId: r.unit.id, quantity: '2' }],
      payments: [
        {
          method: 'cash' as const,
          amount: calculateLine({ unitPrice: r.price, quantity: '2', taxCategory: 'S', pricesIncludeVat: r.pricesIncludeVat }).gross.toFixed(2),
        },
      ],
    };
    const first = await sales.finalizeSale(input);
    expect(first.status).toBe('created');
    expect(first.invoiceNumber).toMatch(/^INV-RUH-\d{4}-\d{6,}$/);

    const replay = await sales.finalizeSale(input);
    expect(replay).toMatchObject({ status: 'duplicate', saleId: first.saleId, invoiceNumber: first.invoiceNumber });

    const recent = await sales.listRecentSales(DEMO_ORG, r.wh.branch_id, 5);
    expect(recent.map((s) => s.invoiceNumber)).toContain(first.invoiceNumber);

    const voided = await sales.cancelSale(DEMO_ORG, first.saleId, 'Test cancellation', 'POS-API');
    expect(voided.saleStatus).toBe('voided');
    // A repeated cancel is idempotent: the voided sale is returned and nothing is reversed twice.
    const again = await sales.cancelSale(DEMO_ORG, first.saleId, 'again', 'POS-API');
    expect(again).toMatchObject({ status: 'duplicate', saleStatus: 'voided' });
  });

  it('a cashier can sell at the shelf but cannot discount', async () => {
    const r = await refs();
    const sales = createSupabaseSalesRepository(await clientFor(USERS.cashier));
    await expectCode(
      sales.finalizeSale({
        clientId: randomUUID(), orgId: DEMO_ORG, branchId: r.wh.branch_id, warehouseId: r.wh.id,
        lines: [{ productId: r.product.id, unitId: r.unit.id, quantity: '1', discountType: 'fixed', discountValue: '1' }],
        payments: [{ method: 'cash', amount: '1' }],
      }),
      'forbidden',
    );
  });

  it('an outsider sees no sales of another organization', async () => {
    const r = await refs();
    const sales = createSupabaseSalesRepository(await clientFor(USERS.outsider));
    expect(await sales.listRecentSales(DEMO_ORG, r.wh.branch_id, 20)).toEqual([]);
  });
});
