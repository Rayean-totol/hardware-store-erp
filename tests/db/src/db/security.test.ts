import { afterAll, describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ROLES } from '@erp/domain';
import { asAdmin, asUser, expectDbError, pool } from '../db';
import { DEMO_ORG, OTHER_ORG, USERS } from '../env';

afterAll(() => pool.end());

describe('schema safety nets', () => {
  it('every table in schema public has RLS enabled', async () => {
    const { rows } = await asAdmin((sql) =>
      sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`),
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('SECURITY DEFINER functions all pin search_path', async () => {
    const { rows } = await asAdmin((sql) =>
      sql(`select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'app') and p.prosecdef
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`),
    );
    expect(rows.map((r) => r.fn)).toEqual([]);
  });

  it('permission catalogue and role matrix match @erp/domain', async () => {
    const { rows: perms } = await asAdmin((sql) => sql('select code from public.permissions order by code'));
    expect(perms.map((r) => r.code)).toEqual([...PERMISSIONS].sort());

    const { rows } = await asAdmin((sql) =>
      sql(`select r.code as role, coalesce(array_agg(rp.permission_code order by rp.permission_code)
                  filter (where rp.permission_code is not null), '{}') as perms
           from public.roles r left join public.role_permissions rp on rp.role_id = r.id
           where r.org_id is null group by r.code`),
    );
    const db = Object.fromEntries(rows.map((r) => [r.role, r.perms]));
    expect(Object.keys(db).sort()).toEqual([...SYSTEM_ROLES].sort());
    for (const role of SYSTEM_ROLES) {
      expect(db[role], role).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });
});

describe('anonymous access', () => {
  it('anon can read nothing and call no RPC', async () => {
    await expectDbError(asUser(null, (sql) => sql('select * from public.products')), /permission denied/);
    await expectDbError(asUser(null, (sql) => sql('select * from public.organizations')), /permission denied/);
    await expectDbError(asUser(null, (sql) => sql(`select public.create_organization('A', 'ب')`)), /permission denied/);
  });
});

describe('tenant isolation', () => {
  it('members see only their own organization', async () => {
    const { rows } = await asUser(USERS.outsider, (sql) => sql('select id from public.organizations'));
    expect(rows.map((r) => r.id)).toEqual([OTHER_ORG]);
    const products = await asUser(USERS.outsider, (sql) => sql('select count(*)::int as n from public.products'));
    expect(products.rows[0].n).toBe(0);
    const branches = await asUser(USERS.outsider, (sql) => sql('select count(*)::int as n from public.branches where org_id = $1', [DEMO_ORG]));
    expect(branches.rows[0].n).toBe(0);
  });

  it('a user cannot write into another tenant', async () => {
    await expectDbError(
      asUser(USERS.outsider, (sql) =>
        sql(`insert into public.brands (org_id, name) values ($1, 'Injected')`, [DEMO_ORG])),
      /row-level security/,
    );
    const updated = await asUser(USERS.outsider, (sql) =>
      sql(`update public.products set name_en = 'hacked' where org_id = $1`, [DEMO_ORG]));
    expect(updated.rowCount).toBe(0);
  });

  it('org_id is immutable', async () => {
    await expectDbError(
      asUser(USERS.owner, (sql) => sql(`update public.brands set org_id = $1 where org_id = $2`, [OTHER_ORG, DEMO_ORG])),
      /org_id is immutable|row-level security/,
    );
  });
});

describe('organization bootstrap and membership', () => {
  it('create_organization makes the caller owner with a main branch', async () => {
    await asUser(USERS.newcomer, async (sql) => {
      const { rows } = await sql(`select public.create_organization('New Tools', 'أدوات جديدة', 'MAIN', 'Main', 'الرئيسي', '311111111100003') as id`);
      const orgId = rows[0].id;
      const ctx = await sql('select public.get_my_context() as ctx');
      const membership = ctx.rows[0].ctx.memberships.find((m: { org_id: string }) => m.org_id === orgId);
      expect(membership.role).toBe('owner');
      expect(membership.permissions).toContain('users.manage');
      expect(membership.branches.map((b: { code: string }) => b.code)).toEqual(['MAIN']);
    });
  });

  it('create_organization rejects malformed VAT numbers', async () => {
    await expectDbError(
      asUser(USERS.newcomer, (sql) => sql(`select public.create_organization('X Co', 'شركة', 'MAIN', 'Main', 'رئيسي', '123')`)),
      /organizations_vat_number_check/,
    );
  });

  it('get_my_context limits branches for branch-restricted members', async () => {
    const { rows } = await asUser(USERS.manager, (sql) => sql('select public.get_my_context() as ctx'));
    const m = rows[0].ctx.memberships[0];
    expect(m.role).toBe('manager');
    expect(m.branches.map((b: { code: string }) => b.code)).toEqual(['RUH']);
    expect(m.permissions).not.toContain('users.manage');
  });

  it('branch access helper respects assignments', async () => {
    const { rows } = await asUser(USERS.manager, (sql) =>
      sql(`select b.code, app.can_access_branch(b.id) as ok from public.branches b order by b.code`));
    expect(rows).toEqual([{ code: 'JED', ok: false }, { code: 'RUH', ok: true }]);
  });

  it('only users.manage holders can add members', async () => {
    await expectDbError(
      asUser(USERS.cashier, (sql) => sql(`select public.add_member_by_email($1, 'newcomer@example.test', 'cashier')`, [DEMO_ORG])),
      'forbidden',
    );
    await asUser(USERS.owner, async (sql) => {
      await sql(`select public.add_member_by_email($1, 'NEWCOMER@example.test', 'cashier')`, [DEMO_ORG]);
      await expectDbError(sql(`select public.add_member_by_email($1, 'newcomer@example.test', 'cashier')`, [DEMO_ORG]), 'membership.already_member');
    });
    await expectDbError(
      asUser(USERS.owner, (sql) => sql(`select public.add_member_by_email($1, 'nobody@example.test', 'cashier')`, [DEMO_ORG])),
      'membership.user_not_found',
    );
  });

  it('members cannot read other members unless they manage users', async () => {
    const cashier = await asUser(USERS.cashier, (sql) => sql('select user_id from public.memberships'));
    expect(cashier.rows.map((r) => r.user_id)).toEqual([USERS.cashier]);
    const owner = await asUser(USERS.owner, (sql) => sql('select user_id from public.memberships where org_id = $1', [DEMO_ORG]));
    expect(owner.rowCount).toBe(5);
  });

  it('protects the owner role and the last owner', async () => {
    await asUser(USERS.owner, async (sql) => {
      await expectDbError(
        sql(`update public.memberships set role_id = (select id from public.roles where code = 'cashier' and org_id is null)
             where user_id = $1 and org_id = $2`, [USERS.owner, DEMO_ORG]),
        'membership.last_owner',
      );
    });
    // An admin (users.manage, not owner) may not promote anyone to owner.
    await asAdmin(async (sql) => {
      await sql(`update public.memberships set role_id = (select id from public.roles where code = 'admin' and org_id is null)
                 where user_id = $1`, [USERS.manager]);
      await sql(`set local role authenticated`);
      await sql(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USERS.manager })]);
      await expectDbError(
        sql(`update public.memberships set role_id = (select id from public.roles where code = 'owner' and org_id is null)
             where user_id = $1`, [USERS.cashier]),
        'membership.owner_required',
      );
    });
  });

  it('system roles are read-only', async () => {
    const res = await asUser(USERS.owner, (sql) => sql(`update public.roles set name = 'x' where code = 'cashier'`));
    expect(res.rowCount).toBe(0);
    await expectDbError(
      asUser(USERS.owner, (sql) => sql(`insert into public.role_permissions (role_id, permission_code)
        select id, 'users.manage' from public.roles where code = 'cashier'`)),
      /row-level security/,
    );
  });
});

describe('list_members', () => {
  it('returns members with e-mail for users.manage holders only', async () => {
    const { rows } = await asUser(USERS.owner, (sql) => sql('select email, role from public.list_members($1)', [DEMO_ORG]));
    expect(rows).toContainEqual({ email: 'cashier@example.test', role: 'cashier' });
    expect(rows).toHaveLength(5);
    await expectDbError(asUser(USERS.cashier, (sql) => sql('select * from public.list_members($1)', [DEMO_ORG])), 'forbidden');
  });
});
