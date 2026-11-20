-- =============================================================================
-- Phase 2: warehouses (stock locations inside a branch) and inventory permissions
-- =============================================================================
-- Additive only: Phase 1 migrations are not modified.

-- -----------------------------------------------------------------------------
-- Permissions and system role matrix (must match packages/domain/src/permissions.ts)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('warehouse.manage', 'inventory', 'Create and edit warehouses'),
  ('inventory.read',   'inventory', 'View stock levels, low-stock alerts and movement history'),
  ('inventory.move',   'inventory', 'Record stock in and stock out'),
  ('inventory.adjust', 'inventory', 'Record stock adjustments, including write-offs');

insert into public.role_permissions (role_id, permission_code)
select r.id, m.permission_code
from (values
  ('owner',       'warehouse.manage'), ('owner',       'inventory.read'), ('owner',       'inventory.move'), ('owner',       'inventory.adjust'),
  ('admin',       'warehouse.manage'), ('admin',       'inventory.read'), ('admin',       'inventory.move'), ('admin',       'inventory.adjust'),
  ('manager',     'inventory.read'),   ('manager',     'inventory.move'), ('manager',     'inventory.adjust'),
  ('storekeeper', 'inventory.read'),   ('storekeeper', 'inventory.move'),
  ('cashier',     'inventory.read'),
  ('accountant',  'inventory.read'),
  ('auditor',     'inventory.read')
) as m (role_code, permission_code)
join public.roles r on r.code = m.role_code and r.org_id is null;

-- -----------------------------------------------------------------------------
-- Organization setting: may stock go below zero? (offline sales can overdraw stock)
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column allow_negative_stock boolean not null default true;

-- -----------------------------------------------------------------------------
-- Warehouses
-- -----------------------------------------------------------------------------
create table public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  branch_id   uuid not null,
  code        text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'),
  name_en     text not null check (length(btrim(name_en)) between 1 and 120),
  name_ar     text not null check (length(btrim(name_ar)) between 1 and 120),
  name_bn     text check (name_bn is null or length(name_bn) <= 120),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  row_version bigint not null default 1,
  unique (org_id, code),
  -- lets stock tables reference (warehouse, branch, org) so the branch can never disagree
  unique (id, branch_id, org_id),
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete restrict
);
create index warehouses_branch_idx on public.warehouses (branch_id);

create trigger warehouses_touch before insert or update on public.warehouses
  for each row execute function app.touch_row();

-- Every branch gets a default warehouse with the same code (existing branches are backfilled).
create or replace function app.create_default_warehouse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.warehouses (org_id, branch_id, code, name_en, name_ar, created_by)
  values (new.org_id, new.id, new.code, new.name_en, new.name_ar, new.created_by);
  return new;
end;
$$;

create trigger branches_default_warehouse after insert on public.branches
  for each row execute function app.create_default_warehouse();

insert into public.warehouses (org_id, branch_id, code, name_en, name_ar, created_by)
select b.org_id, b.id, b.code, b.name_en, b.name_ar, b.created_by
from public.branches b
where not exists (select 1 from public.warehouses w where w.branch_id = b.id);

create trigger warehouses_audit after insert or update or delete on public.warehouses
  for each row execute function app.audit_row_change();

alter table public.warehouses enable row level security;

create policy warehouses_read on public.warehouses for select to authenticated
  using (app.has_permission(org_id, 'inventory.read') and app.can_access_branch(branch_id));
create policy warehouses_insert on public.warehouses for insert to authenticated
  with check (app.has_permission(org_id, 'warehouse.manage') and app.can_access_branch(branch_id));
create policy warehouses_update on public.warehouses for update to authenticated
  using (app.has_permission(org_id, 'warehouse.manage') and app.can_access_branch(branch_id))
  with check (app.has_permission(org_id, 'warehouse.manage') and app.can_access_branch(branch_id));
-- No delete: deactivate with is_active instead (stock history references warehouses).

revoke all on public.warehouses from anon;
