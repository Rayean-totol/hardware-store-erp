-- =============================================================================
-- Security hardening: least-privilege grants, TRUNCATE lock-down, auth trigger
-- and storage policy tightening.
-- =============================================================================
-- Why this migration exists
--   Supabase grants ALL privileges on new public tables to anon, authenticated and
--   service_role by default. The Phase 1/2 migrations only revoked anon. As a result
--   a signed-in user held TRUNCATE on most tables (TRUNCATE bypasses RLS, so one
--   tenant could empty a table for every tenant), plus INSERT/UPDATE/DELETE/TRIGGER/
--   REFERENCES that no RLS policy needed.
--
-- What this migration does (additive in intent; no table, row or function is dropped)
--   1. Future tables and sequences: default privileges for objects created by migrations
--      no longer grant anything to anon/authenticated. (Function defaults are NOT relied on:
--      PostgreSQL keeps PUBLIC's EXECUTE on new functions even after a default revoke, so every
--      migration that creates functions must revoke them explicitly. See section 7.)
--   2. Existing public tables: all privileges are removed from anon and authenticated,
--      then re-granted exactly as the RLS policies require (matrix below). Nothing is
--      granted to anon.
--   7. Functions: PUBLIC and anon may not execute any function in public or app. The
--      public RPCs are granted to authenticated explicitly. The app schema is not exposed
--      through the API; its functions are granted to authenticated because RLS policies
--      and invoker RPCs call them (for example app.fail and app.has_permission).
--   4. Stock ledger: TRUNCATE is blocked for every role, including the owner.
--   5. auth.users: the profile trigger caps the name length; a new trigger keeps the
--      profile e-mail in step with auth.users when an address changes.
--   6. Storage: product-image writes must reference a product that exists in the same
--      organization (previously any UUID folder inside the org prefix was accepted).
--
-- Behaviour changes to be aware of (intentional)
--   * Direct table writes that RLS previously refused with "0 rows" (for example UPDATE
--     on system roles) are now refused with "permission denied". Both are refusals.
--   * New tables created later by migrations get no API grants unless the migration
--     grants them explicitly. This is the secure default and is documented in
--     docs/security.md.
--
-- Privilege matrix for role authenticated (everything else is revoked):
--   SELECT only:            audit_log, permissions, roles, role_permissions,
--                           stock_levels, stock_movements
--   SELECT, UPDATE:         organizations (org.manage), profiles (self)
--   SELECT, INSERT, UPDATE: branches, brands, product_categories, products, units,
--                           warehouses
--   SELECT, INSERT, UPDATE, DELETE: memberships, membership_branches, product_units,
--                           product_prices
--   Never granted to authenticated or anon: TRUNCATE, REFERENCES, TRIGGER.
--
-- Execution order: this file must run AFTER 20261121000400_prices_media_search.sql
-- (it touches every table and the storage policies created there). It is the last
-- migration in the set. Run the whole set in one transaction (see docs/deployment.md).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Default privileges for objects created later by migrations (owner: migration role)
-- -----------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
revoke create on schema public from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Tables and sequences: remove everything, then grant the matrix
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.audit_log, public.permissions, public.roles, public.role_permissions,
  public.stock_levels, public.stock_movements to authenticated;

grant select, update on public.organizations, public.profiles to authenticated;

grant select, insert, update on public.branches, public.brands, public.product_categories,
  public.products, public.units, public.warehouses to authenticated;

grant select, insert, update, delete on public.memberships, public.membership_branches,
  public.product_units, public.product_prices to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Ledger: TRUNCATE is refused for every role (the ledger is evidence)
-- -----------------------------------------------------------------------------
drop trigger if exists stock_movements_no_truncate on public.stock_movements;
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function app.stock_movements_immutable();

-- -----------------------------------------------------------------------------
-- 5. auth.users: profile trigger hardening
-- -----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_full_name_length;
alter table public.profiles add constraint profiles_full_name_length
  check (full_name is null or length(full_name) <= 200);
alter table public.profiles drop constraint if exists profiles_email_length;
alter table public.profiles add constraint profiles_email_length
  check (email is null or length(email) <= 320);

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    new.email,
    left(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), 200)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function app.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email, updated_at = now()
  where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function app.sync_profile_email();

-- -----------------------------------------------------------------------------
-- 6. Storage: product images must belong to a product of the same organization
-- -----------------------------------------------------------------------------
create or replace function app.storage_product_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
              then split_part(p_name, '/', 2)::uuid end;
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not present: product image policies not updated';
    return;
  end if;

  execute 'drop policy if exists product_images_insert on storage.objects';
  execute 'drop policy if exists product_images_update on storage.objects';
  execute 'drop policy if exists product_images_delete on storage.objects';

  execute $p$create policy product_images_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'product-images'
      and app.has_permission(app.storage_org_id(name), 'catalog.write')
      and exists (select 1 from public.products p
                  where p.id = app.storage_product_id(name) and p.org_id = app.storage_org_id(name)))$p$;

  execute $p$create policy product_images_update on storage.objects for update to authenticated
    using (bucket_id = 'product-images'
      and app.has_permission(app.storage_org_id(name), 'catalog.write')
      and exists (select 1 from public.products p
                  where p.id = app.storage_product_id(name) and p.org_id = app.storage_org_id(name)))
    with check (bucket_id = 'product-images'
      and app.has_permission(app.storage_org_id(name), 'catalog.write')
      and exists (select 1 from public.products p
                  where p.id = app.storage_product_id(name) and p.org_id = app.storage_org_id(name)))$p$;

  execute $p$create policy product_images_delete on storage.objects for delete to authenticated
    using (bucket_id = 'product-images'
      and app.has_permission(app.storage_org_id(name), 'catalog.write')
      and exists (select 1 from public.products p
                  where p.id = app.storage_product_id(name) and p.org_id = app.storage_org_id(name)))$p$;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Functions: explicit RPC grants; app helpers for authenticated only.
-- Placed last so that every function created by this file is covered.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema public from public, anon;
revoke all on all functions in schema app from public, anon;

grant execute on function public.create_organization(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.add_member_by_email(uuid, text, text, boolean) to authenticated;
grant execute on function public.get_my_context() to authenticated;
grant execute on function public.list_members(uuid) to authenticated;
grant execute on function public.save_product(jsonb, jsonb, bigint) to authenticated;
grant execute on function public.search_products(uuid, text, uuid, boolean, uuid) to authenticated;
grant execute on function public.save_product_prices(uuid, uuid, jsonb) to authenticated;
grant execute on function public.resolve_sale_price(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.apply_stock_movements(uuid, text, jsonb) to authenticated;
grant execute on function public.list_stock_levels(uuid) to authenticated;
grant execute on function public.list_low_stock(uuid, uuid) to authenticated;
grant execute on function public.list_stock_movements(uuid, uuid, text, integer, integer) to authenticated;

grant execute on all functions in schema app to authenticated, service_role;

