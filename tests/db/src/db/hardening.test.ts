import { afterAll, describe, expect, it } from 'vitest';
import { asAdmin, asUser, expectDbError, pool, type Sql } from '../db';
import { DEMO_ORG, OTHER_ORG, USERS } from '../env';

afterAll(() => pool.end());

/**
 * Expected grants for role authenticated, per table. This is the contract from
 * supabase/migrations/20261122000100_security_hardening.sql. Anything not listed here
 * (including every TRUNCATE, REFERENCES and TRIGGER privilege) must be absent.
 */
const MATRIX: Record<string, string[]> = {
  audit_log: ['SELECT'],
  permissions: ['SELECT'],
  roles: ['SELECT'],
  role_permissions: ['SELECT'],
  stock_levels: ['SELECT'],
  stock_movements: ['SELECT'],
  organizations: ['SELECT', 'UPDATE'],
  profiles: ['SELECT', 'UPDATE'],
  branches: ['SELECT', 'INSERT', 'UPDATE'],
  brands: ['SELECT', 'INSERT', 'UPDATE'],
  product_categories: ['SELECT', 'INSERT', 'UPDATE'],
  products: ['SELECT', 'INSERT', 'UPDATE'],
  units: ['SELECT', 'INSERT', 'UPDATE'],
  warehouses: ['SELECT', 'INSERT', 'UPDATE'],
  memberships: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  membership_branches: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  product_units: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  product_prices: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  // Purchase prices: the row policies (catalog.price_write) decide who sees and changes them.
  product_unit_costs: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  // Phase 3 (POS). Sales documents are written only by finalize_sale / cancel_sale.
  customers: ['SELECT', 'INSERT', 'UPDATE'],
  sales: ['SELECT'],
  sale_lines: ['SELECT'],
  sale_payments: ['SELECT'],
  invoice_counters: [],
};
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;

/** Public RPCs that signed-in users may call. Everything else in public/app is not callable. */
const PUBLIC_RPCS = [
  'create_organization(text,text,text,text,text,text,text,text)',
  'add_member_by_email(uuid,text,text,boolean)',
  'get_my_context()',
  'list_members(uuid)',
  'save_product(jsonb,jsonb,bigint)',
  'search_products(uuid,text,uuid,boolean,uuid)',
  'save_product_prices(uuid,uuid,jsonb)',
  'resolve_sale_price(uuid,uuid,numeric,text)',
  'apply_stock_movements(uuid,text,jsonb)',
  'list_stock_levels(uuid)',
  'list_low_stock(uuid,uuid)',
  'list_stock_movements(uuid,uuid,text,integer,integer)',
  'dashboard_inventory_summary(uuid,uuid)',
  'finalize_sale(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb)',
  'cancel_sale(uuid,uuid,text,text)',
];

describe('table privileges match the least-privilege matrix', () => {
  it('every public table is covered by the matrix (no table is left unreviewed)', async () => {
    const { rows } = await asAdmin((sql) =>
      sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' order by 1`));
    expect(rows.map((r) => r.relname)).toEqual(Object.keys(MATRIX).sort());
  });

  it('authenticated holds exactly the granted privileges on every table', async () => {
    const { rows } = await asAdmin((sql) =>
      sql(`select c.relname, p.priv, has_table_privilege('authenticated', c.oid, p.priv) as granted
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           cross join unnest($1::text[]) as p(priv)
           where n.nspname = 'public' and c.relkind = 'r'`, [PRIVILEGES]));
    const mismatches = rows
      .filter((r) => r.granted !== (MATRIX[r.relname] ?? []).includes(r.priv))
      .map((r) => `${r.relname}.${r.priv}=${r.granted}`);
    expect(mismatches).toEqual([]);
  });

  it('TRUNCATE is not granted to authenticated or anon on any table', async () => {
    const { rows } = await asAdmin((sql) =>
      sql(`select c.relname, r.role from pg_class c join pg_namespace n on n.oid = c.relnamespace
           cross join unnest(array['authenticated','anon']) as r(role)
           where n.nspname = 'public' and c.relkind = 'r'
             and has_table_privilege(r.role, c.oid, 'TRUNCATE')`));
    expect(rows).toEqual([]);
  });

  it('anon has no privileges on any public table', async () => {
    const { rows } = await asAdmin((sql) =>
      sql(`select c.relname, p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
           cross join unnest($1::text[]) as p(priv)
           where n.nspname = 'public' and c.relkind = 'r'
             and has_table_privilege('anon', c.oid, p.priv)`, [PRIVILEGES]));
    expect(rows).toEqual([]);
  });

  it('new tables created by migrations get no API grants by default', async () => {
    await asAdmin(async (sql) => {
      await sql('create table public.hardening_probe (id int)');
      const { rows } = await sql(
        `select r.role, p.priv from unnest(array['anon','authenticated']) as r(role)
         cross join unnest($1::text[]) as p(priv)
         where has_table_privilege(r.role, 'public.hardening_probe', p.priv)`, [PRIVILEGES]);
      expect(rows).toEqual([]);
    });
  });
});

describe('TRUNCATE lock-down', () => {
  it('signed-in users cannot truncate tenant tables', async () => {
    for (const table of ['organizations', 'memberships', 'products', 'brands']) {
      await expectDbError(asUser(USERS.owner, (sql) => sql(`truncate public.${table}`)), /permission denied/);
    }
  });

  it('the stock ledger refuses TRUNCATE even for the database owner', async () => {
    await expectDbError(asAdmin((sql) => sql('truncate public.stock_movements')), 'stock_movements is append-only');
  });

  it('the stock ledger refuses TRUNCATE for signed-in users (privilege check first)', async () => {
    await expectDbError(asUser(USERS.owner, (sql) => sql('truncate public.stock_movements')), /permission denied/);
  });
});

describe('function execution', () => {
  it('PUBLIC cannot execute any function in public or app', async () => {
    const { rows } = await asAdmin((sql) =>
      sql(`select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'app')
             and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         where a.grantee = 0 and a.privilege_type = 'EXECUTE')`));
    expect(rows.map((r) => r.fn)).toEqual([]);
  });

  it('authenticated can execute exactly the public RPCs, and anon cannot execute any', async () => {
    const { rows } = await asAdmin((sql) =>
      sql(`select p.oid::regprocedure::text as sig,
                  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
                  has_function_privilege('anon', p.oid, 'EXECUTE') as anon
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`));
    const granted = rows.filter((r) => r.auth).map((r) => r.sig.replace(/^public\./, '').replace(/\s+/g, ''));
    expect(granted.map((s) => s.replace(/character varying/g, 'text')).sort())
      .toEqual(PUBLIC_RPCS.map((s) => s.replace(/\s+/g, '')).sort());
    expect(rows.filter((r) => r.anon)).toEqual([]);
  });

  it('signed-in users can still call the RPCs they need (behaviour preserved)', async () => {
    await asUser(USERS.cashier, async (sql) => {
      const { rows } = await sql('select public.get_my_context() as ctx');
      expect(rows[0].ctx.memberships).toHaveLength(1);
    });
  });
});

describe('auth.users trigger', () => {
  it('caps the profile name length and copies the e-mail at sign-up', async () => {
    await asAdmin(async (sql) => {
      const id = (await sql('select gen_random_uuid() as id')).rows[0].id;
      await sql(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'long-name@example.test',
                 jsonb_build_object('full_name', repeat('a', 300)))`, [id]);
      const { rows } = await sql('select full_name, email from public.profiles where user_id = $1', [id]);
      expect(rows[0]).toEqual({ full_name: 'a'.repeat(200), email: 'long-name@example.test' });
    });
  });

  it('keeps the profile e-mail in step when the address changes', async () => {
    await asAdmin(async (sql) => {
      await sql(`update auth.users set email = 'changed@example.test' where email = 'manager@example.test'`);
      const { rows } = await sql(`select email from public.profiles where user_id = $1`, [USERS.manager]);
      expect(rows[0].email).toBe('changed@example.test');
    });
  });

  it('rejects over-long names written directly to profiles', async () => {
    await expectDbError(asUser(USERS.owner, (sql) =>
      sql(`update public.profiles set full_name = repeat('b', 201) where user_id = $1`, [USERS.owner])),
      /profiles_full_name_length/);
  });
});

describe('product image storage policies', () => {
  const sku = async (sql: Sql, s: string) =>
    (await sql('select id from public.products where org_id = $1 and sku = $2', [DEMO_ORG, s])).rows[0].id as string;

  it('a catalog writer may upload only under a product of their own organization', async () => {
    await asUser(USERS.manager, async (sql) => {
      const screw = await sql('select id from public.products where org_id = $1 and sku = $2', [DEMO_ORG, 'FST-WS-4X40']);
      await sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`,
        [`${DEMO_ORG}/${screw.rows[0].id}/ok.jpg`]);
    });
  });

  it('uploads for a product that does not exist are refused', async () => {
    await expectDbError(asUser(USERS.manager, (sql) =>
      sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`,
        [`${DEMO_ORG}/00000000-0000-4000-8000-00000000dead/ghost.jpg`])), /row-level security/);
  });

  it('a product of another organization cannot be used under this organization path', async () => {
    await asAdmin(async (sql) => {
      await sql(`insert into public.brands (org_id, name) values ($1, 'x')`, [OTHER_ORG]);
    });
    await expectDbError(asUser(USERS.owner, async (sql) => {
      const target = await sql('select id from public.products where org_id = $1 limit 1', [DEMO_ORG]);
      // Writes an object for DEMO_ORG's product under OTHER_ORG's prefix: the org folder must match.
      await sql(`insert into storage.objects (bucket_id, name) values ('product-images', $1)`,
        [`${OTHER_ORG}/${target.rows[0].id}/mismatch.jpg`]);
    }), /row-level security/);
    void sku;
  });

  it('malformed object names never resolve to a product id', async () => {
    await asAdmin(async (sql) => {
      const { rows } = await sql(`select app.storage_product_id($1) as p, app.storage_product_id($2) as q`,
        ['not-a-uuid/file.jpg', `${DEMO_ORG}/not-a-product/file.jpg`]);
      expect(rows[0]).toEqual({ p: null, q: null });
    });
  });
});
