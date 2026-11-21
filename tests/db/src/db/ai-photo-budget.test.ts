import { describe, expect, it } from 'vitest';
import { asUser, expectDbError } from '../db';
import { DEMO_ORG, USERS } from '../env';

/**
 * Monthly budget for AI photo suggestions (ai_photo_reserve). Each test runs in one transaction that is
 * always rolled back, so the shared test database is left as it was.
 */
describe('ai_photo_reserve', () => {
  it('reserves the cost for a user with catalog.write and counts the call', async () => {
    await asUser(USERS.manager, async (sql) => {
      const { rows } = await sql('select public.ai_photo_reserve($1, $2, $3) as r', [DEMO_ORG, 1463, 10_000_000]);
      expect(rows[0].r).toEqual({ allowed: true, spent_sar_micro: 1463 });
      const second = await sql('select public.ai_photo_reserve($1, $2, $3) as r', [DEMO_ORG, 1463, 10_000_000]);
      expect(second.rows[0].r).toEqual({ allowed: true, spent_sar_micro: 2926 });
    });
  });

  it('refuses a call that would pass the monthly cap, and reserves nothing', async () => {
    await asUser(USERS.manager, async (sql) => {
      const { rows } = await sql('select public.ai_photo_reserve($1, $2, $3) as r', [DEMO_ORG, 1463, 1000]);
      expect(rows[0].r).toEqual({ allowed: false, reason: 'monthly_cap', spent_sar_micro: 0 });
    });
    // The refused call must not have counted: a call that fits afterwards starts from zero.
    await asUser(USERS.manager, async (sql) => {
      const { rows } = await sql('select public.ai_photo_reserve($1, $2, $3) as r', [DEMO_ORG, 1463, 10_000_000]);
      expect(rows[0].r).toEqual({ allowed: true, spent_sar_micro: 1463 });
    });
  });

  it('refuses a user without catalog.write (cashier)', async () => {
    await asUser(USERS.cashier, async (sql) => {
      await expectDbError(sql('select public.ai_photo_reserve($1, $2, $3)', [DEMO_ORG, 1463, 10_000_000]), /forbidden/);
    });
  });

  it('refuses a zero or negative cost, which would bypass the cap', async () => {
    await asUser(USERS.manager, async (sql) => {
      await expectDbError(sql('select public.ai_photo_reserve($1, $2, $3)', [DEMO_ORG, 0, 10_000_000]), /validation|budget/);
    });
    await asUser(USERS.manager, async (sql) => {
      await expectDbError(sql('select public.ai_photo_reserve($1, $2, $3)', [DEMO_ORG, -5, 10_000_000]), /validation|budget/);
    });
  });

  it('keeps the usage table closed to direct reads by app users', async () => {
    await asUser(USERS.manager, async (sql) => {
      await expectDbError(sql('select * from public.ai_photo_usage'), /permission denied/);
    });
  });
});
