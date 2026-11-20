# Deploying the database to a fresh Supabase Cloud project

Status: planned. Nothing in this document has been run against a cloud project. The rehearsal
was a local PostgreSQL 16 database with the test shim. Run the checks below before and after
the first deploy, and keep the output.

## Execution order

Apply the files in this exact order (filename order = the Supabase CLI order):

| # | File | Purpose |
| --- | --- | --- |
| 1 | `20261120000100_foundation.sql` | extensions, `app` schema, organizations, branches, profiles, `auth.users` trigger |
| 2 | `20261120000200_rbac.sql` | permissions, roles, memberships, RLS helpers, owner guards, RPCs |
| 3 | `20261120000300_audit.sql` | append-only audit log |
| 4 | `20261120000400_catalog.sql` | units, categories, brands, products, product units |
| 5 | `20261120000500_catalog_rpc.sql` | `save_product`, `search_products` |
| 6 | `20261121000100_warehouses.sql` | inventory permissions, warehouses |
| 7 | `20261121000200_stock_ledger.sql` | stock movements (append-only), stock levels |
| 8 | `20261121000300_stock_rpc.sql` | `apply_stock_movements`, stock read functions |
| 9 | `20261121000400_prices_media_search.sql` | price tiers, product image path, storage bucket and policies, brand search |
| 10 | `20261122000100_security_hardening.sql` | least-privilege grants, TRUNCATE lock-down, auth trigger, storage tightening |

Files 1–9 are already merged and must not be edited. File 10 must be last: it revokes and
regrants privileges on every table and function created by files 1–9.

**Do not apply** `supabase/tests/supabase-shim.sql` (it replaces Supabase's `auth.uid()`
and related functions) or `supabase/seed.sql` (demo data) to a production project.

## Before you start

1. Create the project in Supabase Cloud. Choose a region for data residency; this cannot be
   changed later without a migration.
2. In the dashboard, enable **Confirm email** under Authentication → Providers → Email, set the
   minimum password length to at least 8, and set the Site URL and redirect URLs.
3. Take a backup: Database → Backups. The project is expected to be empty; confirm that with the
   pre-flight query below.

### Pre-flight (read-only)

```sql
select count(*) as public_tables from information_schema.tables where table_schema = 'public';
-- expect 0 on a fresh project
select id, public from storage.buckets;      -- expect no rows, or only buckets you created
select extname from pg_extension where extname = 'pg_trgm';  -- expect no row before deploy
```

## Apply

Use one transaction for the whole set, so a failure leaves the database unchanged. Run from a
checkout of `main` in a trusted terminal. The connection string contains the database password:
enter it at a prompt and never paste it into a chat, issue or file.

```sh
cd supabase/migrations
psql "$SUPABASE_DB_URL" -1 -v ON_ERROR_STOP=1 \
  -f 20261120000100_foundation.sql -f 20261120000200_rbac.sql -f 20261120000300_audit.sql \
  -f 20261120000400_catalog.sql -f 20261120000500_catalog_rpc.sql \
  -f 20261121000100_warehouses.sql -f 20261121000200_stock_ledger.sql \
  -f 20261121000300_stock_rpc.sql -f 20261121000400_prices_media_search.sql \
  -f 20261122000100_security_hardening.sql
```

The Supabase CLI (`supabase db push`) applies the same files in the same order and records them in
`supabase_migrations.schema_migrations`. Prefer it when you have a laptop; the psql form above
has no migration ledger, so keep a note of the commit you deployed.

## Verify (read-only)

```sql
-- 1. RLS is on for every public table
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;          -- expect no rows

-- 2. Nothing can TRUNCATE for signed-in or anonymous users
select c.relname, r.role from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join unnest(array['authenticated','anon']) as r(role)
where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r.role, c.oid, 'TRUNCATE');  -- expect no rows

-- 3. PUBLIC cannot execute any function in public or app
select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','app') and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
where a.grantee = 0 and a.privilege_type = 'EXECUTE');                             -- expect no rows

-- 4. Storage bucket is private and has its four policies
select id, public from storage.buckets where id = 'product-images';               -- public = false
select count(*) from pg_policies where schemaname = 'storage' and policyname like 'product_images%';  -- 4
```

Then sign up one user in the app, create the first organization through onboarding (do not use
the seed), and confirm the organization appears. This is the first end-to-end check that the
hardened grants still allow the normal flow.

## Rollback

There are no down-migrations. Because the set runs in one transaction, a failure during
`psql -1` leaves the database unchanged. After a successful deploy, the recovery path is a
restore from the Supabase backup taken before the deploy.

## Behaviour changes in the hardening migration

* Direct writes that RLS previously refused silently (0 rows affected) are now refused with
  `permission denied`. Both are refusals; the application already handles errors.
* Deleting products is refused outright; products are archived.
* Future migrations that create tables get no API grants unless they grant them explicitly.
* Future migrations that create functions must revoke EXECUTE from PUBLIC explicitly.
