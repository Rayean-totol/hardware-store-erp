/**
 * The dashboard's exact call, through PostgREST: named parameters p_org_id and p_branch_id.
 * Requires the PostgREST binary (CI runs this suite). Read-only: nothing is written.
 */
import { describe, expect, it } from 'vitest';
import { createSupabaseInventoryRepository, DataError } from '@erp/data';
import { clientFor } from '../api-client';
import { DEMO_ORG, USERS } from '../env';

describe('dashboard_inventory_summary through PostgREST', () => {
  it('returns typed figures for an owner, as the Dashboard loads them', async () => {
    const repo = createSupabaseInventoryRepository(await clientFor(USERS.owner));
    const s = await repo.getInventorySummary(DEMO_ORG, null);
    expect(typeof s.stockValue).toBe('string');
    expect(s.productCount).toBeGreaterThan(0);
    expect(s.lowStockCount).toBeGreaterThanOrEqual(0);
  });

  it('refuses a user from another organization with a clear code', async () => {
    const repo = createSupabaseInventoryRepository(await clientFor(USERS.outsider));
    await expect(repo.getInventorySummary(DEMO_ORG, null)).rejects.toSatisfy(
      (e: unknown) => e instanceof DataError && e.code === 'forbidden');
  });

  it('refuses anonymous callers', async () => {
    const repo = createSupabaseInventoryRepository(await clientFor(null));
    await expect(repo.getInventorySummary(DEMO_ORG, null)).rejects.toBeInstanceOf(DataError);
  });
});
