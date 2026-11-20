import { describe, expect, it, vi } from 'vitest';
import { DataError, createSupabaseInventoryRepository, type DbClient } from '../src';

const ORG = '20000000-0000-4000-8000-000000000001';
const BRANCH = '30000000-0000-4000-8000-000000000101';

function fakeDb(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { db: { rpc } as unknown as DbClient, rpc };
}

describe('dashboard data loading (repository → RPC)', () => {
  it('calls the RPC by its exact name with the documented named parameters', async () => {
    const { db, rpc } = fakeDb({ data: {}, error: null });
    await createSupabaseInventoryRepository(db).getInventorySummary(ORG, BRANCH);
    expect(rpc).toHaveBeenCalledWith('dashboard_inventory_summary', { p_org_id: ORG, p_branch_id: BRANCH });
  });

  it('sends a null branch when the owner asks for all branches', async () => {
    const { db, rpc } = fakeDb({ data: {}, error: null });
    await createSupabaseInventoryRepository(db).getInventorySummary(ORG, null);
    expect(rpc).toHaveBeenCalledWith('dashboard_inventory_summary', { p_org_id: ORG, p_branch_id: null });
  });

  it('maps the response to typed figures, keeping money as an exact string', async () => {
    const { db } = fakeDb({
      data: { stock_value: '185430.5', stock_positions: 3842, out_of_stock_count: 7, low_stock_count: 5, product_count: 2486 },
      error: null,
    });
    const s = await createSupabaseInventoryRepository(db).getInventorySummary(ORG, null);
    expect(s).toEqual({ stockValue: '185430.5', stockPositions: 3842, outOfStockCount: 7, lowStockCount: 5, productCount: 2486 });
  });

  it('surfaces a missing function or a refusal as a DataError, never as zero figures', async () => {
    const missing = fakeDb({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.dashboard_inventory_summary in the schema cache' },
    });
    await expect(createSupabaseInventoryRepository(missing.db).getInventorySummary(ORG, null))
      .rejects.toBeInstanceOf(DataError);

    const refused = fakeDb({ data: null, error: { code: 'P0001', message: 'forbidden', details: 'inventory.read' } });
    await expect(createSupabaseInventoryRepository(refused.db).getInventorySummary(ORG, null))
      .rejects.toMatchObject({ code: 'forbidden' });
  });
});
