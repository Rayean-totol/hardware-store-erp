import { beforeEach, describe, expect, it } from 'vitest';
import { clearLocalBusinessData, HOLDS_PREF, pendingTotal, readLegacyPending, summarizeLocalPending } from '@/lib/local-data';

describe('local business data on this device', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads no legacy entries when the browser has no offline database', async () => {
    expect(await readLegacyPending()).toEqual([]);
  });

  it('counts held sales from storage, and tolerates corrupt storage', async () => {
    window.localStorage.setItem(HOLDS_PREF, JSON.stringify([{ id: '1' }, { id: '2' }]));
    expect((await summarizeLocalPending()).heldSales).toBe(2);
    window.localStorage.setItem(HOLDS_PREF, '{not json');
    expect((await summarizeLocalPending()).heldSales).toBe(0);
  });

  it('total pending work counts unsent legacy entries and held sales together', () => {
    expect(pendingTotal({ legacy: [], heldSales: 0 })).toBe(0);
    expect(pendingTotal({ legacy: [{ id: 'a', orgId: 'o', createdAt: '', movementType: 'stock_in', productId: 'p', quantity: '1' }], heldSales: 2 })).toBe(3);
  });

  it('clearing local business data empties held sales (only called after the user confirms)', async () => {
    window.localStorage.setItem(HOLDS_PREF, JSON.stringify([{ id: '1' }]));
    await clearLocalBusinessData();
    expect(window.localStorage.getItem(HOLDS_PREF)).toBe('[]');
  });
});
