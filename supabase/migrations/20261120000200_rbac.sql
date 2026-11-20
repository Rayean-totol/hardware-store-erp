-- =============================================================================
-- Roles, permissions, memberships, RLS helper functions, org bootstrap RPCs
-- =============================================================================
-- Phase 1 ships system roles only (org_id is null). The role-permission matrix
-- here MUST match packages/domain/src/permissions.ts. A DB test enforces this.

create table public.permissions (
  code        text primary key check (code ~ '^[a-z]+(\.[a-z_]+)+$'),
  module      text not null,
  description text not null
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations (id) on delete cascade,
  code        text not null check (code ~ '^[a-z][a-z_]{1,31}$'),
  name        text not null,
  is_system   boolean not null default false,
  check (is_system = (org_id is null)),
  unique nulls not distinct (org_id, code)
);

create table public.role_permissions (
  role_id         uuid not null references public.roles (id) on delete cascade,
  permission_code text not null references public.permissions (code) on delete cascade,
  primary key (role_id, permission_code)
);

create table public.memberships (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role_id       uuid not null references public.roles (id),
  all_branches  boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  row_version   bigint not null default 1,
  unique (org_id, user_id),
  unique (id, org_id)
);
create index memberships_user_idx on public.memberships (user_id, org_id) where is_active;

create table public.membership_branches (
  membership_id uuid not null,
  org_id        uuid not null,
  branch_id     uuid not null,
  primary key (membership_id, branch_id),
  foreign key (membership_id, org_id) references public.memberships (id, org_id) on delete cascade,
  foreign key (branch_id, org_id) references public.branches (id, org_id) on delete cascade
);

create trigger memberships_touch before insert or update on public.memberships
  for each row execute function app.touch_row();

-- Roles referenced by memberships must be system roles or roles of the same org
create or replace function app.check_membership_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role_org uuid;
begin
  select org_id into v_role_org from public.roles where id = new.role_id;
  if v_role_org is not null and v_role_org <> new.org_id then
    perform app.fail('membership.role_wrong_org');
  end if;
  return new;
end;
$$;
create trigger memberships_role_check before insert or update of role_id, org_id on public.memberships
  for each row execute function app.check_membership_role();

-- -----------------------------------------------------------------------------
-- Reference data: permissions and system roles
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('org.manage',          'org',     'Edit organization settings (legal names, VAT/CR numbers, pricing mode)'),
  ('branch.manage',       'org',     'Create and edit branches'),
  ('users.manage',        'org',     'Add, remove and change roles of team members'),
  ('audit.read',          'audit',   'Read the audit log'),
  ('catalog.read',        'catalog', 'View products, units, categories and brands'),
  ('catalog.write',       'catalog', 'Create and edit products, units, categories and brands'),
  ('catalog.price_write', 'catalog', 'Set or change selling prices'),
  ('catalog.archive',     'catalog', 'Archive and restore products');

insert into public.roles (code, name, is_system) values
  ('owner',       'Owner',       true),
  ('admin',       'Administrator', true),
  ('manager',     'Branch manager', true),
  ('storekeeper', 'Storekeeper', true),
  ('cashier',     'Cashier',     true),
  ('accountant',  'Accountant',  true),
  ('auditor',     'Auditor',     true);

insert into public.role_permissions (role_id, permission_code)
select r.id, m.permission_code
from (values
  ('owner', 'org.manage'), ('owner', 'branch.manage'), ('owner', 'users.manage'), ('owner', 'audit.read'),
  ('owner', 'catalog.read'), ('owner', 'catalog.write'), ('owner', 'catalog.price_write'), ('owner', 'catalog.archive'),
  ('admin', 'org.manage'), ('admin', 'branch.manage'), ('admin', 'users.manage'), ('admin', 'audit.read'),
  ('admin', 'catalog.read'), ('admin', 'catalog.write'), ('admin', 'catalog.price_write'), ('admin', 'catalog.archive'),
  ('manager', 'audit.read'), ('manager', 'catalog.read'), ('manager', 'catalog.write'),
  ('manager', 'catalog.price_write'), ('manager', 'catalog.archive'),
  ('storekeeper', 'catalog.read'), ('storekeeper', 'catalog.write'),
  ('cashier', 'catalog.read'),
  ('accountant', 'catalog.read'), ('accountant', 'audit.read'),
  ('auditor', 'catalog.read'), ('auditor', 'audit.read')
) as m (role_code, permission_code)
join public.roles r on r.code = m.role_code and r.org_id is null;

-- -----------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER so they can read memberships without
-- recursive RLS evaluation; empty search_path to prevent search-path attacks)
-- -----------------------------------------------------------------------------
create or replace function app.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.is_active
  );
$$;

create or replace function app.has_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.is_active
      and rp.permission_code = p_permission
  );
$$;

create or replace function app.can_access_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.branches b
    join public.memberships m on m.org_id = b.org_id and m.user_id = auth.uid() and m.is_active
    where b.id = p_branch_id
      and (m.all_branches or exists (
        select 1 from public.membership_branches mb
        where mb.membership_id = m.id and mb.branch_id = b.id
      ))
  );
$$;

create or replace function app.has_role(p_org_id uuid, p_role_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m join public.roles r on r.id = m.role_id
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.is_active and r.code = p_role_code
  );
$$;

revoke all on function app.is_org_member(uuid), app.has_permission(uuid, text),
  app.can_access_branch(uuid), app.has_role(uuid, text) from public;
grant execute on function app.is_org_member(uuid), app.has_permission(uuid, text),
  app.can_access_branch(uuid), app.has_role(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Owner protection: only owners may grant/revoke the owner role, and an org
-- must always keep at least one active owner.
-- -----------------------------------------------------------------------------
create or replace function app.guard_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_role uuid;
  v_org uuid := coalesce(new.org_id, old.org_id);
  v_remaining int;
begin
  select id into v_owner_role from public.roles where code = 'owner' and org_id is null;

  -- Changes that grant or remove the owner role require the caller to be an owner.
  -- auth.uid() is null for service_role / migrations, which are trusted.
  if auth.uid() is not null and (
       (tg_op in ('INSERT', 'UPDATE') and new.role_id = v_owner_role)
    or (tg_op in ('UPDATE', 'DELETE') and old.role_id = v_owner_role)
  ) and not app.has_role(v_org, 'owner')
    -- allow the bootstrap insert done by create_organization (no owner exists yet)
    and exists (select 1 from public.memberships where org_id = v_org and role_id = v_owner_role)
  then
    perform app.fail('membership.owner_required');
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role_id = v_owner_role then
    select count(*) into v_remaining
    from public.memberships
    where org_id = v_org and role_id = v_owner_role and is_active
      and id <> old.id;
    if tg_op = 'UPDATE' and new.role_id = v_owner_role and new.is_active then
      v_remaining := v_remaining + 1;
    end if;
    if v_remaining = 0 then
      perform app.fail('membership.last_owner');
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger memberships_owner_guard
  before insert or update or delete on public.memberships
  for each row execute function app.guard_owner_membership();

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------
alter table public.permissions         enable row level security;
alter table public.roles               enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.memberships         enable row level security;
alter table public.membership_branches enable row level security;

create policy permissions_read on public.permissions
  for select to authenticated using (true);

create policy roles_read on public.roles
  for select to authenticated
  using (org_id is null or app.is_org_member(org_id));

create policy role_permissions_read on public.role_permissions
  for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id
                 and (r.org_id is null or app.is_org_member(r.org_id))));
-- No write policies on roles/role_permissions in Phase 1: system roles are read-only.

create policy organizations_read on public.organizations
  for select to authenticated using (app.is_org_member(id));
create policy organizations_update on public.organizations
  for update to authenticated
  using (app.has_permission(id, 'org.manage'))
  with check (app.has_permission(id, 'org.manage'));
-- Inserts go through create_organization(); deletes are not allowed.

create policy branches_read on public.branches
  for select to authenticated using (app.is_org_member(org_id));
create policy branches_insert on public.branches
  for insert to authenticated with check (app.has_permission(org_id, 'branch.manage'));
create policy branches_update on public.branches
  for update to authenticated
  using (app.has_permission(org_id, 'branch.manage'))
  with check (app.has_permission(org_id, 'branch.manage'));

create policy profiles_read on public.profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.memberships theirs
      where theirs.user_id = profiles.user_id and app.is_org_member(theirs.org_id)
    )
  );
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy memberships_read on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or app.has_permission(org_id, 'users.manage'));
create policy memberships_insert on public.memberships
  for insert to authenticated with check (app.has_permission(org_id, 'users.manage'));
create policy memberships_update on public.memberships
  for update to authenticated
  using (app.has_permission(org_id, 'users.manage'))
  with check (app.has_permission(org_id, 'users.manage'));
create policy memberships_delete on public.memberships
  for delete to authenticated using (app.has_permission(org_id, 'users.manage'));

create policy membership_branches_read on public.membership_branches
  for select to authenticated
  using (app.has_permission(org_id, 'users.manage')
         or exists (select 1 from public.memberships m where m.id = membership_id and m.user_id = auth.uid()));
create policy membership_branches_write on public.membership_branches
  for all to authenticated
  using (app.has_permission(org_id, 'users.manage'))
  with check (app.has_permission(org_id, 'users.manage'));

-- Anonymous users get nothing (Supabase grants anon table privileges by default).
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon, public;

-- -----------------------------------------------------------------------------
-- RPC: bootstrap an organization; caller becomes owner with access to all branches
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(
  p_legal_name_en text,
  p_legal_name_ar text,
  p_branch_code text default 'MAIN',
  p_branch_name_en text default 'Main branch',
  p_branch_name_ar text default 'الفرع الرئيسي',
  p_vat_number text default null,
  p_cr_number text default null,
  p_default_locale text default 'ar'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_owner_role uuid;
begin
  if v_uid is null then
    perform app.fail('auth.required');
  end if;

  insert into public.organizations (legal_name_en, legal_name_ar, vat_number, cr_number, default_locale, created_by)
  values (btrim(p_legal_name_en), btrim(p_legal_name_ar), nullif(btrim(p_vat_number), ''),
          nullif(btrim(p_cr_number), ''), p_default_locale, v_uid)
  returning id into v_org;

  insert into public.branches (org_id, code, name_en, name_ar, created_by)
  values (v_org, upper(btrim(p_branch_code)), btrim(p_branch_name_en), btrim(p_branch_name_ar), v_uid);

  select id into v_owner_role from public.roles where code = 'owner' and org_id is null;
  insert into public.memberships (org_id, user_id, role_id, all_branches, created_by)
  values (v_org, v_uid, v_owner_role, true, v_uid);

  return v_org;
end;
$$;
revoke all on function public.create_organization(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: add an existing (already signed-up) user to an org by e-mail
-- -----------------------------------------------------------------------------
create or replace function public.add_member_by_email(
  p_org_id uuid,
  p_email text,
  p_role_code text,
  p_all_branches boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_role uuid;
  v_membership uuid;
begin
  if not app.has_permission(p_org_id, 'users.manage') then
    perform app.fail('forbidden');
  end if;

  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    perform app.fail('membership.user_not_found');
  end if;

  select id into v_role from public.roles where code = p_role_code and (org_id is null or org_id = p_org_id);
  if v_role is null then
    perform app.fail('membership.role_not_found');
  end if;

  if exists (select 1 from public.memberships where org_id = p_org_id and user_id = v_user) then
    perform app.fail('membership.already_member');
  end if;

  insert into public.memberships (org_id, user_id, role_id, all_branches, created_by)
  values (p_org_id, v_user, v_role, p_all_branches, auth.uid())
  returning id into v_membership;
  return v_membership;
end;
$$;
revoke all on function public.add_member_by_email(uuid, text, text, boolean) from public, anon;
grant execute on function public.add_member_by_email(uuid, text, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: everything the client needs to know about "me" in one round trip
-- -----------------------------------------------------------------------------
create or replace function public.get_my_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', m.id,
        'org_id', o.id,
        'org_name_en', o.legal_name_en,
        'org_name_ar', o.legal_name_ar,
        'prices_include_vat', o.prices_include_vat,
        'role', r.code,
        'all_branches', m.all_branches,
        'permissions', coalesce((
          select jsonb_agg(rp.permission_code order by rp.permission_code)
          from public.role_permissions rp where rp.role_id = r.id
        ), '[]'::jsonb),
        'branches', coalesce((
          select jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'name_en', b.name_en, 'name_ar', b.name_ar) order by b.code)
          from public.branches b
          where b.org_id = o.id and b.is_active
            and (m.all_branches or exists (select 1 from public.membership_branches mb
                                           where mb.membership_id = m.id and mb.branch_id = b.id))
        ), '[]'::jsonb)
      ) order by o.legal_name_en)
      from public.memberships m
      join public.organizations o on o.id = m.org_id
      join public.roles r on r.id = m.role_id
      where m.user_id = auth.uid() and m.is_active
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.get_my_context() from public, anon;
grant execute on function public.get_my_context() to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: list members of an org with e-mail/name (auth.users is not exposed via the API)
-- -----------------------------------------------------------------------------
create or replace function public.list_members(p_org_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  full_name text,
  role text,
  all_branches boolean,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_permission(p_org_id, 'users.manage') then
    perform app.fail('forbidden', 'users.manage');
  end if;
  return query
    select m.id, m.user_id, u.email::text, p.full_name, r.code, m.all_branches, m.is_active
    from public.memberships m
    join auth.users u on u.id = m.user_id
    join public.roles r on r.id = m.role_id
    left join public.profiles p on p.user_id = m.user_id
    where m.org_id = p_org_id
    order by u.email;
end;
$$;
revoke all on function public.list_members(uuid) from public, anon;
grant execute on function public.list_members(uuid) to authenticated;
