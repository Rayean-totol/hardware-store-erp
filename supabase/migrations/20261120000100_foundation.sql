-- =============================================================================
-- Foundation: extensions, private helper schema, organizations, branches, profiles
-- =============================================================================
-- Conventions used by every business table:
--   id          uuid primary key (clients may generate it - offline-first)
--   org_id      tenant key; composite FKs (x_id, org_id) keep references inside a tenant
--   created_at / created_by / updated_at / updated_by
--   row_version bigint, incremented on every update (sync cursor + optimistic locking)

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Private schema for helper functions. It is NOT in PostgREST's exposed schemas.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Generic row maintenance trigger
-- -----------------------------------------------------------------------------
create or replace function app.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := new.created_at;
    new.row_version := 1;
    if new.created_by is null then
      new.created_by := auth.uid();
    end if;
    new.updated_by := new.created_by;
  else
    -- tenant key and creation metadata are immutable
    if to_jsonb(new) ? 'org_id' and (to_jsonb(new)->>'org_id') is distinct from (to_jsonb(old)->>'org_id') then
      raise exception 'org_id is immutable' using errcode = '22023', hint = 'immutable_org_id';
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := auth.uid();
    new.row_version := old.row_version + 1;
  end if;
  return new;
end;
$$;

-- Raise a business error with a machine-readable code in MESSAGE.
-- The client maps the code to a translated message (see packages/data/src/errors.ts).
create or replace function app.fail(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = coalesce(p_detail, '');
end;
$$;

-- -----------------------------------------------------------------------------
-- Organizations (tenants) and branches
-- -----------------------------------------------------------------------------
create table public.organizations (
  id                  uuid primary key default gen_random_uuid(),
  legal_name_en       text not null check (length(btrim(legal_name_en)) between 2 and 200),
  legal_name_ar       text not null check (length(btrim(legal_name_ar)) between 2 and 200),
  trade_name          text,
  -- Saudi VAT registration number: 15 digits, starts and ends with 3 (format check only)
  vat_number          text check (vat_number ~ '^3[0-9]{13}3$'),
  -- Commercial Registration number: 10 digits (format check only)
  cr_number           text check (cr_number ~ '^[0-9]{10}$'),
  base_currency       char(3) not null default 'SAR' check (base_currency = 'SAR'),
  prices_include_vat  boolean not null default true,
  default_locale      text not null default 'ar' check (default_locale in ('en', 'ar', 'bn')),
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  row_version         bigint not null default 1
);

create table public.branches (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete restrict,
  code             text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'),
  name_en          text not null check (length(btrim(name_en)) between 1 and 120),
  name_ar          text not null check (length(btrim(name_ar)) between 1 and 120),
  -- Saudi national address (format checks only)
  street           text,
  building_number  text check (building_number ~ '^[0-9]{4}$'),
  additional_number text check (additional_number ~ '^[0-9]{4}$'),
  district         text,
  city             text,
  postal_code      text check (postal_code ~ '^[0-9]{5}$'),
  country_code     char(2) not null default 'SA',
  phone            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  row_version      bigint not null default 1,
  unique (org_id, code),
  unique (id, org_id)
);
create index branches_org_idx on public.branches (org_id);

create trigger organizations_touch before insert or update on public.organizations
  for each row execute function app.touch_row();
create trigger branches_touch before insert or update on public.branches
  for each row execute function app.touch_row();

-- -----------------------------------------------------------------------------
-- Profiles: 1:1 with auth.users
-- -----------------------------------------------------------------------------
create table public.profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  full_name        text,
  email            text,
  preferred_locale text check (preferred_locale in ('en', 'ar', 'bn')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data->>'full_name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

alter table public.organizations enable row level security;
alter table public.branches      enable row level security;
alter table public.profiles      enable row level security;
-- Policies are defined in the RBAC migration, once the helper functions exist.
