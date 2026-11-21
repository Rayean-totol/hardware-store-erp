import { DataError } from '@erp/data';
import { describe, expect, it, vi } from 'vitest';
import { guardServices } from '@/lib/services-guard';
import { OFFLINE_WRITE_CODE, WRITE_METHOD, guardWrites } from '@/lib/write-guard';
import { fakeServices } from './helpers';

describe('write method detection', () => {
  it('matches changing operations and not reads', () => {
    for (const name of ['save', 'saveProduct', 'applyMovements', 'finalizeSale', 'cancelSale', 'adjustBalance', 'upload', 'setProductArchived', 'addMemberByEmail', 'submit', 'approve', 'create', 'update', 'savePriceTiers']) {
      expect(WRITE_METHOD.test(name), name).toBe(true);
    }
    for (const name of ['listStockLevels', 'searchProducts', 'getProduct', 'get', 'list', 'resolveSalePrice', 'listRecentSales', 'signedUrl', 'getInventorySummary']) {
      expect(WRITE_METHOD.test(name), name).toBe(false);
    }
  });
});

describe('guardWrites', () => {
  it('refuses writes while the gate is closed, without calling the repository', async () => {
    const save = vi.fn(async () => 'saved');
    const repo = guardWrites({ r: { save, get: async () => 'read' } }, () => false).r as { save: () => Promise<unknown>; get: () => Promise<unknown> };
    await expect(repo.save()).rejects.toMatchObject({ code: OFFLINE_WRITE_CODE });
    await expect(repo.save()).rejects.toBeInstanceOf(DataError);
    expect(save).not.toHaveBeenCalled();
    expect(await repo.get()).toBe('read');
  });

  it('passes writes through with their arguments once the gate is open', async () => {
    const applyMovements = vi.fn(async (_org: string, batch: string[]) => batch.length);
    const repo = guardWrites({ inventory: { applyMovements } }, () => true).inventory as { applyMovements: (o: string, b: string[]) => Promise<number> };
    expect(await repo.applyMovements('org', ['a', 'b'])).toBe(2);
    expect(applyMovements).toHaveBeenCalledWith('org', ['a', 'b']);
  });

  it('is evaluated at call time, so a closed gate after mount still blocks', async () => {
    let open = true;
    const repo = guardWrites({ s: { adjustBalance: async () => 'ok' } }, () => open).s as { adjustBalance: () => Promise<string> };
    expect(await repo.adjustBalance()).toBe('ok');
    open = false;
    await expect(repo.adjustBalance()).rejects.toMatchObject({ code: OFFLINE_WRITE_CODE });
  });
});

describe('guardServices', () => {
  it('guards every repository write but leaves sign-out available offline', async () => {
    const base = fakeServices();
    const services = guardServices(base);
    // Gate is closed by default (see connection-gate.ts): writes must be refused.
    await expect(services.sales.finalizeSale({} as never)).rejects.toMatchObject({ code: OFFLINE_WRITE_CODE });
    await expect(services.inventory.applyMovements('org', 'dev', [])).rejects.toMatchObject({ code: OFFLINE_WRITE_CODE });
    expect(base.sales.finalizeSale).not.toHaveBeenCalled();
    // Reads are unaffected.
    await expect(services.catalog.searchProducts({ orgId: 'o', limit: 1, offset: 0 } as never)).resolves.toBeDefined();
    // Authentication is not a business write.
    await services.auth.signOut();
    expect(base.auth.signOut).toHaveBeenCalledTimes(1);
  });
});
