import { describe, expect, it } from 'vitest';
import { createSupabaseSupplierRepository, DataError } from '@erp/data';
import { clientFor } from '../api-client';
import { DEMO_ORG, USERS } from '../env';

/**
 * Suppliers over real PostgREST with signed JWTs (what the browser does). Runs in its own database
 * because it commits rows (see vitest.api-pos.config.ts).
 */
const input = (code: string) => ({ nameEn: `Supplier ${code}`, nameAr: 'مورد', supplierCode: code, countryCode: 'SA', openingBalance: '250.00' });

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof DataError && e.code === code);
}

describe('suppliers over PostgREST', () => {
  it('owner creates, reads, edits with the current version, and sees the financial fields', async () => {
    const repo = createSupabaseSupplierRepository(await clientFor(USERS.owner));
    const created = await repo.save(DEMO_ORG, input(`API-${Date.now().toString(36).toUpperCase()}`), null);
    expect(created.supplierNo).toMatch(/^SUP-\d{6}$/);

    const profile = await repo.get(DEMO_ORG, created.id);
    expect(profile.openingBalance).toBe('250.00');

    const edited = await repo.save(DEMO_ORG, { ...input(profile.supplierCode), id: created.id, city: 'Jeddah' }, profile.rowVersion);
    expect(edited.rowVersion).toBe(profile.rowVersion + 1);
    await expectCode(repo.save(DEMO_ORG, { ...input(profile.supplierCode), id: created.id }, profile.rowVersion), 'concurrency_conflict');
  });

  it('a storekeeper reads the directory without financial fields and cannot write', async () => {
    const repo = createSupabaseSupplierRepository(await clientFor(USERS.storekeeper));
    const page = await repo.list({ orgId: DEMO_ORG, status: 'all', limit: 5 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]).not.toHaveProperty('openingBalance');
    await expectCode(repo.save(DEMO_ORG, input('STK-NO'), null), 'forbidden');
  });

  it('a cashier has no access to the directory', async () => {
    const repo = createSupabaseSupplierRepository(await clientFor(USERS.cashier));
    await expectCode(repo.list({ orgId: DEMO_ORG }), 'forbidden');
  });

  it('a user of another organisation sees none of this organisation’s suppliers', async () => {
    const repo = createSupabaseSupplierRepository(await clientFor(USERS.outsider));
    await expectCode(repo.list({ orgId: DEMO_ORG }), 'forbidden');
  });
});
