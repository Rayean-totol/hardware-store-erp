import { afterAll, describe, expect, it } from 'vitest';
import { asAdmin, asUser, expectDbError, pool } from '../db';
import { DEMO_ORG, USERS } from '../env';

afterAll(() => pool.end());

describe('audit log', () => {
  it('records actor, changed fields and device id for updates', async () => {
    await asUser(
      USERS.manager,
      async (sql) => {
        await sql(`update public.brands set name = 'Falcon Pro Tools' where name = 'Falcon Tools'`);
        // Manager holds audit.read
        const { rows } = await sql(
          `select action, actor_id, changed_fields, device_id, old_data->>'name' as old_name, new_data->>'name' as new_name
           from public.audit_log where table_name = 'brands' and action = 'UPDATE'`,
        );
        expect(rows).toEqual([{
          action: 'UPDATE', actor_id: USERS.manager, changed_fields: ['name'], device_id: 'POS-RUH-01',
          old_name: 'Falcon Tools', new_name: 'Falcon Pro Tools',
        }]);
      },
      { headers: { 'x-device-id': 'POS-RUH-01' } },
    );
  });

  it('skips no-op updates', async () => {
    await asUser(USERS.manager, async (sql) => {
      await sql(`update public.brands set name = name where name = 'Gulf Cable'`);
      const { rowCount } = await sql(`select 1 from public.audit_log where table_name = 'brands' and action = 'UPDATE'`);
      expect(rowCount).toBe(0);
    });
  });

  it('seed inserts were audited', async () => {
    const { rows } = await asUser(USERS.auditor, (sql) =>
      sql(`select count(*)::int as n from public.audit_log where org_id = $1 and table_name = 'products' and action = 'INSERT'`, [DEMO_ORG]));
    expect(rows[0].n).toBe(12);
  });

  it('is readable only with audit.read', async () => {
    const { rowCount } = await asUser(USERS.cashier, (sql) => sql('select 1 from public.audit_log'));
    expect(rowCount).toBe(0);
    const outsider = await asUser(USERS.outsider, (sql) => sql('select 1 from public.audit_log where org_id = $1', [DEMO_ORG]));
    expect(outsider.rowCount).toBe(0);
  });

  it('cannot be written, changed or deleted by API users', async () => {
    await expectDbError(
      asUser(USERS.owner, (sql) => sql(`insert into public.audit_log (org_id, table_name, action) values ($1, 'x', 'INSERT')`, [DEMO_ORG])),
      /permission denied/,
    );
    await expectDbError(asUser(USERS.owner, (sql) => sql('delete from public.audit_log')), /permission denied/);
  });

  it('is append-only even for the database owner', async () => {
    await expectDbError(asAdmin((sql) => sql('update public.audit_log set action = action')), 'audit_log is append-only');
    await expectDbError(asAdmin((sql) => sql('delete from public.audit_log')), 'audit_log is append-only');
    await expectDbError(asAdmin((sql) => sql('truncate public.audit_log')), 'audit_log is append-only');
  });
});
