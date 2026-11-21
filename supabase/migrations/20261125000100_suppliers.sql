-- =============================================================================
-- Phase 4A: supplier management (additive)
-- =============================================================================
-- Creates the supplier master data, its numbering counter, three access functions
-- (list, get, save) and two permissions. Nothing existing is altered except for new
-- permission rows and new role-grant rows.
--
-- Access model: the suppliers tables grant NOTHING to anon or authenticated. Every read and
-- write goes through the security-definer functions below, which check organisation
-- membership and the permission for each call. Financial columns (opening balance, credit
-- limit, bank details) are returned only to holders of suppliers.manage.
--
-- Re-runnable: every object is created only if missing, or replaced with the same definition.
-- Run after migration 20261124000100 (POS). See docs/phase-4-compatibility-report.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Preflight: stop with one clear message if a prerequisite is missing. Read-only.
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.organizations') is null then v_missing := array_append(v_missing, 'table public.organizations'); end if;
  if to_regclass('public.memberships') is null then v_missing := array_append(v_missing, 'table public.memberships'); end if;
  if to_regclass('public.roles') is null then v_missing := array_append(v_missing, 'table public.roles'); end if;
  if to_regclass('public.role_permissions') is null then v_missing := array_append(v_missing, 'table public.role_permissions'); end if;
  if to_regclass('public.permissions') is null then v_missing := array_append(v_missing, 'table public.permissions'); end if;
  if to_regclass('public.audit_log') is null then v_missing := array_append(v_missing, 'table public.audit_log'); end if;
  if to_regclass('public.sales') is null then v_missing := array_append(v_missing, 'table public.sales (migration 20261124000100)'); end if;
  if to_regprocedure('app.fail(text,text)') is null then v_missing := array_append(v_missing, 'function app.fail'); end if;
  if to_regprocedure('app.is_org_member(uuid)') is null then v_missing := array_append(v_missing, 'function app.is_org_member'); end if;
  if to_regprocedure('app.has_permission(uuid,text)') is null then v_missing := array_append(v_missing, 'function app.has_permission'); end if;
  if to_regprocedure('app.touch_row()') is null then v_missing := array_append(v_missing, 'function app.touch_row'); end if;
  if to_regprocedure('app.audit_row_change()') is null then v_missing := array_append(v_missing, 'function app.audit_row_change'); end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'Phase 4A prerequisites are missing: %. Apply the earlier migrations first.', array_to_string(v_missing, ', ')
      using errcode = 'P0001', hint = 'No supplier objects were created.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Permissions and role grants (rows added; existing rows untouched)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('suppliers.read',   'suppliers', 'View the supplier directory and profiles (financial fields need suppliers.manage)'),
  ('suppliers.manage', 'suppliers', 'Create and edit suppliers, including opening balance, credit limit and bank details')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, v.code
from public.roles r
join (values
  ('owner',       'suppliers.read'), ('owner',       'suppliers.manage'),
  ('admin',       'suppliers.read'), ('admin',       'suppliers.manage'),
  ('manager',     'suppliers.read'), ('manager',     'suppliers.manage'),
  ('storekeeper', 'suppliers.read'),
  ('accountant',  'suppliers.read'),
  ('auditor',     'suppliers.read')
) as v(role_code, code) on v.role_code = r.code and r.is_system
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Numbering counter (one row per organisation; written only by save_supplier)
-- -----------------------------------------------------------------------------
create table if not exists public.supplier_counters (
  org_id      uuid primary key references public.organizations (id) on delete restrict,
  last_value  bigint not null default 0 check (last_value >= 0)
);
alter table public.supplier_counters enable row level security;
-- No policies and no grants: only the security-definer functions below touch it.

-- -----------------------------------------------------------------------------
-- 3. Suppliers
-- -----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete restrict,
  -- Auto-generated, never changes: SUP-000001
  supplier_no        text not null,
  -- Supplier code: unique per organisation. Defaults to supplier_no when left blank.
  supplier_code      text not null check (supplier_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
  name_en            text not null check (length(btrim(name_en)) between 1 and 200),
  name_ar            text not null check (length(btrim(name_ar)) between 1 and 200),
  name_bn            text check (name_bn is null or length(btrim(name_bn)) between 1 and 200),
  contact_person     text check (contact_person is null or length(contact_person) <= 120),
  mobile             text check (mobile is null or mobile ~ '^\+?[0-9][0-9 ()-]{6,18}[0-9]$'),
  whatsapp           text check (whatsapp is null or whatsapp ~ '^\+?[0-9][0-9 ()-]{6,18}[0-9]$'),
  email              text check (email is null or (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  address            text check (address is null or length(address) <= 300),
  city               text check (city is null or length(city) <= 100),
  country_code       char(2) not null default 'SA' check (country_code ~ '^[A-Z]{2}$'),
  -- Saudi VAT registration number: 15 digits, starts and ends with 3 (same rule as organizations)
  vat_number         text check (vat_number is null or vat_number ~ '^3[0-9]{13}3$'),
  -- Commercial Registration number: 10 digits
  cr_number          text check (cr_number is null or cr_number ~ '^[0-9]{10}$'),
  -- Financial terms: the amount we owe the supplier at the start (zero or positive)
  opening_balance    numeric(18, 2) not null default 0 check (opening_balance >= 0),
  credit_limit       numeric(18, 2) check (credit_limit is null or credit_limit >= 0),
  payment_terms_days integer check (payment_terms_days is null or payment_terms_days between 0 and 365),
  default_currency   char(3) not null default 'SAR' check (default_currency = 'SAR'),
  bank_name          text check (bank_name is null or length(bank_name) <= 120),
  bank_account_name  text check (bank_account_name is null or length(bank_account_name) <= 120),
  -- Saudi IBAN only (SA + 22 digits); stored without spaces
  iban               text check (iban is null or iban ~ '^SA[0-9]{22}$'),
  notes              text check (notes is null or length(notes) <= 2000),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  row_version        bigint not null default 1,
  constraint suppliers_id_org_uq unique (id, org_id),
  constraint suppliers_no_uq unique (org_id, supplier_no),
  constraint suppliers_code_uq unique (org_id, supplier_code)
);
-- VAT registration number is unique within an organisation (blank numbers are allowed).
create unique index if not exists suppliers_vat_uq on public.suppliers (org_id, vat_number) where vat_number is not null;
create index if not exists suppliers_org_name_idx on public.suppliers (org_id, name_en);

drop trigger if exists suppliers_touch on public.suppliers;
create trigger suppliers_touch before insert or update on public.suppliers
  for each row execute function app.touch_row();
drop trigger if exists suppliers_audit on public.suppliers;
create trigger suppliers_audit after insert or update or delete on public.suppliers
  for each row execute function app.audit_row_change();

-- No row-level policies are needed because the table has no grants for clients; RLS stays on
-- as a second barrier, so any future grant still has to pass an organisation check.
alter table public.suppliers enable row level security;

-- -----------------------------------------------------------------------------
-- 4. Helpers (not callable by clients)
-- -----------------------------------------------------------------------------

-- IBAN check digits (ISO 13616 mod-97). Returns false for anything that is not a well-formed IBAN.
create or replace function app.iban_checksum_valid(p_iban text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rotated text;
  v_digits  text := '';
  v_rem     integer := 0;
  v_char    text;
  i         integer;
begin
  if p_iban is null or p_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then
    return false;
  end if;
  v_rotated := substr(p_iban, 5) || substr(p_iban, 1, 4);
  for i in 1..length(v_rotated) loop
    v_char := substr(v_rotated, i, 1);
    if v_char ~ '[A-Z]' then
      v_digits := v_digits || (ascii(v_char) - 55)::text;
    else
      v_digits := v_digits || v_char;
    end if;
  end loop;
  for i in 1..length(v_digits) loop
    v_rem := (v_rem * 10 + substr(v_digits, i, 1)::integer) % 97;
  end loop;
  return v_rem = 1;
end;
$$;

-- Validation: returns the first problem with a supplier payload, or null when it is valid.
-- Codes are translated by the app (errors.supplier.*, errors.validation). The function never
-- raises a cast error: every input is checked as text before it is cast.
create or replace function app.supplier_issue(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_code     text := upper(btrim(coalesce(p->>'supplier_code', '')));
  v_iban     text := upper(regexp_replace(coalesce(p->>'iban', ''), '\s', '', 'g'));
  v_terms    text := nullif(btrim(coalesce(p->>'payment_terms_days', '')), '');
  v_country  text := nullif(upper(btrim(coalesce(p->>'country_code', ''))), '');
  v_currency text := nullif(upper(btrim(coalesce(p->>'default_currency', ''))), '');
  v_opening  text := nullif(btrim(coalesce(p->>'opening_balance', '')), '');
  v_credit   text := nullif(btrim(coalesce(p->>'credit_limit', '')), '');
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'validation'; end if;

  -- Names
  if length(btrim(coalesce(p->>'name_en', ''))) = 0 or length(btrim(p->>'name_en')) > 200 then return 'supplier.name_required'; end if;
  if length(btrim(coalesce(p->>'name_ar', ''))) = 0 or length(btrim(p->>'name_ar')) > 200 then return 'supplier.name_required'; end if;
  if nullif(btrim(coalesce(p->>'name_bn', '')), '') is not null and length(btrim(p->>'name_bn')) > 200 then return 'validation'; end if;

  -- Code
  if v_code <> '' and v_code !~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$' then return 'supplier.code_invalid'; end if;

  -- Contact
  if nullif(btrim(coalesce(p->>'mobile', '')), '') is not null and btrim(p->>'mobile') !~ '^\+?[0-9][0-9 ()-]{6,18}[0-9]$' then return 'supplier.phone_invalid'; end if;
  if nullif(btrim(coalesce(p->>'whatsapp', '')), '') is not null and btrim(p->>'whatsapp') !~ '^\+?[0-9][0-9 ()-]{6,18}[0-9]$' then return 'supplier.phone_invalid'; end if;
  if nullif(btrim(coalesce(p->>'email', '')), '') is not null
     and (length(btrim(p->>'email')) > 254 or btrim(p->>'email') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    return 'supplier.email_invalid';
  end if;
  if nullif(btrim(coalesce(p->>'contact_person', '')), '') is not null and length(btrim(p->>'contact_person')) > 120 then return 'validation'; end if;
  if nullif(btrim(coalesce(p->>'address', '')), '') is not null and length(btrim(p->>'address')) > 300 then return 'validation'; end if;
  if nullif(btrim(coalesce(p->>'city', '')), '') is not null and length(btrim(p->>'city')) > 100 then return 'validation'; end if;

  -- Tax and registration
  if nullif(btrim(coalesce(p->>'vat_number', '')), '') is not null and btrim(p->>'vat_number') !~ '^3[0-9]{13}3$' then return 'supplier.vat_invalid'; end if;
  if nullif(btrim(coalesce(p->>'cr_number', '')), '') is not null and btrim(p->>'cr_number') !~ '^[0-9]{10}$' then return 'supplier.cr_invalid'; end if;

  -- Money: plain decimal text, at most 16 whole digits and 2 decimals (fits numeric(18,2)).
  if v_opening is not null and v_opening !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' then return 'supplier.amount_invalid'; end if;
  if v_credit is not null and v_credit !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' then return 'supplier.amount_invalid'; end if;

  -- Terms and currency
  if v_terms is not null and (v_terms !~ '^[0-9]{1,3}$' or v_terms::integer > 365) then return 'supplier.payment_terms_invalid'; end if;
  if coalesce(v_currency, 'SAR') <> 'SAR' then return 'supplier.currency_invalid'; end if;
  if coalesce(v_country, 'SA') !~ '^[A-Z]{2}$' then return 'supplier.country_invalid'; end if;

  -- Bank: Saudi IBAN format and check digits
  if v_iban <> '' and (v_iban !~ '^SA[0-9]{22}$' or not app.iban_checksum_valid(v_iban)) then return 'supplier.iban_invalid'; end if;
  if nullif(btrim(coalesce(p->>'bank_name', '')), '') is not null and length(btrim(p->>'bank_name')) > 120 then return 'validation'; end if;
  if nullif(btrim(coalesce(p->>'bank_account_name', '')), '') is not null and length(btrim(p->>'bank_account_name')) > 120 then return 'validation'; end if;

  -- Other
  if nullif(btrim(coalesce(p->>'notes', '')), '') is not null and length(btrim(p->>'notes')) > 2000 then return 'validation'; end if;
  if coalesce(jsonb_typeof(p->'is_active'), 'null') not in ('boolean', 'null') then return 'validation'; end if;

  return null;
end;
$$;

-- The supplier as JSON. Financial and bank fields are included only when p_manage is true.
create or replace function app.supplier_json(s public.suppliers, p_manage boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', s.id,
    'supplier_no', s.supplier_no,
    'supplier_code', s.supplier_code,
    'name_en', s.name_en,
    'name_ar', s.name_ar,
    'name_bn', s.name_bn,
    'contact_person', s.contact_person,
    'mobile', s.mobile,
    'whatsapp', s.whatsapp,
    'email', s.email,
    'address', s.address,
    'city', s.city,
    'country_code', s.country_code,
    'vat_number', s.vat_number,
    'cr_number', s.cr_number,
    'payment_terms_days', s.payment_terms_days,
    'default_currency', s.default_currency,
    'notes', s.notes,
    'is_active', s.is_active,
    'created_at', s.created_at,
    'updated_at', s.updated_at,
    'row_version', s.row_version)
    || case when p_manage then jsonb_build_object(
         'opening_balance', s.opening_balance::text,
         'credit_limit', s.credit_limit::text,
         'bank_name', s.bank_name,
         'bank_account_name', s.bank_account_name,
         'iban', s.iban)
       else '{}'::jsonb end);
$$;

-- -----------------------------------------------------------------------------
-- 5. list_suppliers: directory with search, status filter and paging
-- -----------------------------------------------------------------------------
create or replace function public.list_suppliers(
  p_org_id uuid,
  p_search text default null,
  p_status text default 'active',
  p_limit  integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manage  boolean;
  v_search  text := btrim(coalesce(p_search, ''));
  v_pattern text;
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_total   bigint;
  v_items   jsonb;
begin
  if not app.is_org_member(p_org_id) then
    perform app.fail('forbidden', 'membership');
  end if;
  if not app.has_permission(p_org_id, 'suppliers.read') then
    perform app.fail('forbidden', 'suppliers.read');
  end if;
  if p_status not in ('active', 'inactive', 'all') then
    perform app.fail('validation', 'status');
  end if;
  v_manage := app.has_permission(p_org_id, 'suppliers.manage');
  v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select count(*) into v_total
  from public.suppliers s
  where s.org_id = p_org_id
    and (p_status = 'all' or s.is_active = (p_status = 'active'))
    and (v_search = '' or s.supplier_code ilike v_pattern or s.supplier_no ilike v_pattern
         or s.name_en ilike v_pattern or s.name_ar ilike v_pattern or coalesce(s.name_bn, '') ilike v_pattern
         or coalesce(s.mobile, '') ilike v_pattern or coalesce(s.vat_number, '') ilike v_pattern);

  select coalesce(jsonb_agg(page.j), '[]'::jsonb)
  into v_items
  from (
    select app.supplier_json(s, v_manage) as j
    from public.suppliers s
    where s.org_id = p_org_id
      and (p_status = 'all' or s.is_active = (p_status = 'active'))
      and (v_search = '' or s.supplier_code ilike v_pattern or s.supplier_no ilike v_pattern
           or s.name_en ilike v_pattern or s.name_ar ilike v_pattern or coalesce(s.name_bn, '') ilike v_pattern
           or coalesce(s.mobile, '') ilike v_pattern or coalesce(s.vat_number, '') ilike v_pattern)
    order by s.name_en, s.id
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. get_supplier: one supplier profile
-- -----------------------------------------------------------------------------
create or replace function public.get_supplier(p_org_id uuid, p_supplier_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.suppliers%rowtype;
begin
  if not app.is_org_member(p_org_id) then
    perform app.fail('forbidden', 'membership');
  end if;
  if not app.has_permission(p_org_id, 'suppliers.read') then
    perform app.fail('forbidden', 'suppliers.read');
  end if;
  select * into v_row from public.suppliers where id = p_supplier_id and org_id = p_org_id;
  if not found then
    perform app.fail('supplier.not_found');
  end if;
  return app.supplier_json(v_row, app.has_permission(p_org_id, 'suppliers.manage'));
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. save_supplier: create or update, with validation, uniqueness and optimistic locking
-- -----------------------------------------------------------------------------
-- Create: every field is taken from the payload (absent optional fields are empty).
-- Update: the payload is MERGED onto the stored row. Keys that are not sent keep their stored
-- values; a key sent as null or as an empty string clears that field on purpose.
-- The version (p_expected_version) must match the stored row_version, or nothing changes.
create or replace function public.save_supplier(
  p_org_id           uuid,
  p_supplier         jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_existing public.suppliers%rowtype;
  v_row      public.suppliers%rowtype;
  v_src      jsonb;
  v_issue    text;
  v_next     bigint;
  v_no       text;
  v_code     text;
  v_vat      text;
  v_cr       text;
  v_iban     text;
  v_email    text;
  v_opening  numeric;
  v_credit   numeric;
  v_terms    integer;
  v_active   boolean;
begin
  if not app.is_org_member(p_org_id) then
    perform app.fail('forbidden', 'membership');
  end if;
  if not app.has_permission(p_org_id, 'suppliers.manage') then
    perform app.fail('forbidden', 'suppliers.manage');
  end if;
  if p_supplier is null or jsonb_typeof(p_supplier) <> 'object' then
    perform app.fail('validation', 'supplier');
  end if;
  -- A payload may not name another organisation.
  if p_supplier ? 'org_id' and (p_supplier->>'org_id') is distinct from p_org_id::text then
    perform app.fail('forbidden', 'org_id');
  end if;

  -- The id, when present, must be a uuid (checked as text, so no cast error can escape).
  if nullif(btrim(coalesce(p_supplier->>'id', '')), '') is not null then
    if btrim(p_supplier->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app.fail('validation', 'id');
    end if;
    v_id := btrim(p_supplier->>'id')::uuid;
  end if;

  if v_id is null then
    -- Create. A version without an id is refused, never treated as a create.
    if p_expected_version is not null then
      perform app.fail('validation', 'id');
    end if;
    v_src := p_supplier;
  else
    select * into v_existing from public.suppliers where id = v_id and org_id = p_org_id for update;
    if not found then
      perform app.fail('supplier.not_found');
    end if;
    if p_expected_version is null or p_expected_version <> v_existing.row_version then
      perform app.fail('concurrency_conflict', v_existing.row_version::text);
    end if;
    -- Partial update: merge the stored row with the keys that were sent. Bookkeeping keys are never taken from the client.
    v_src := to_jsonb(v_existing) || (p_supplier - array['id', 'org_id', 'supplier_no', 'row_version', 'created_at', 'updated_at', 'created_by', 'updated_by']);
  end if;

  v_issue := app.supplier_issue(v_src);
  if v_issue is not null then
    perform app.fail(v_issue);
  end if;

  -- Normalised values (the same rules the validator checked).
  v_code    := nullif(upper(btrim(coalesce(v_src->>'supplier_code', ''))), '');
  v_vat     := nullif(btrim(coalesce(v_src->>'vat_number', '')), '');
  v_cr      := nullif(btrim(coalesce(v_src->>'cr_number', '')), '');
  v_email   := nullif(btrim(coalesce(v_src->>'email', '')), '');
  v_iban    := nullif(upper(regexp_replace(coalesce(v_src->>'iban', ''), '\s', '', 'g')), '');
  v_opening := coalesce(nullif(btrim(coalesce(v_src->>'opening_balance', '')), '')::numeric, 0);
  v_credit  := nullif(btrim(coalesce(v_src->>'credit_limit', '')), '')::numeric;
  v_terms   := nullif(btrim(coalesce(v_src->>'payment_terms_days', '')), '')::integer;
  v_active  := coalesce((v_src->>'is_active')::boolean, true);

  if v_id is null then
    -- The counter row is locked, so numbers are gap-free per organisation and never repeat.
    insert into public.supplier_counters (org_id, last_value) values (p_org_id, 1)
    on conflict (org_id) do update set last_value = public.supplier_counters.last_value + 1
    returning last_value into v_next;
    v_no := 'SUP-' || lpad(v_next::text, 6, '0');

    begin
      insert into public.suppliers (
        org_id, supplier_no, supplier_code, name_en, name_ar, name_bn, contact_person, mobile, whatsapp, email,
        address, city, country_code, vat_number, cr_number, opening_balance, credit_limit, payment_terms_days,
        default_currency, bank_name, bank_account_name, iban, notes, is_active)
      values (
        p_org_id, v_no, coalesce(v_code, v_no),
        btrim(v_src->>'name_en'), btrim(v_src->>'name_ar'), nullif(btrim(coalesce(v_src->>'name_bn', '')), ''),
        nullif(btrim(coalesce(v_src->>'contact_person', '')), ''),
        nullif(btrim(coalesce(v_src->>'mobile', '')), ''), nullif(btrim(coalesce(v_src->>'whatsapp', '')), ''),
        v_email, nullif(btrim(coalesce(v_src->>'address', '')), ''), nullif(btrim(coalesce(v_src->>'city', '')), ''),
        coalesce(nullif(upper(btrim(coalesce(v_src->>'country_code', ''))), ''), 'SA'),
        v_vat, v_cr, v_opening, v_credit, v_terms, 'SAR',
        nullif(btrim(coalesce(v_src->>'bank_name', '')), ''), nullif(btrim(coalesce(v_src->>'bank_account_name', '')), ''),
        v_iban, nullif(btrim(coalesce(v_src->>'notes', '')), ''), v_active)
      returning * into v_row;
    exception when unique_violation then
      if sqlerrm like '%suppliers_code_uq%' then perform app.fail('supplier.code_taken', v_code);
      elsif sqlerrm like '%suppliers_vat_uq%' then perform app.fail('supplier.vat_taken', v_vat);
      else raise; end if;
    end;
  else
    begin
      update public.suppliers set
        -- An empty code means "no code": the supplier number is used, as on creation.
        supplier_code      = coalesce(v_code, v_existing.supplier_no),
        name_en            = btrim(v_src->>'name_en'),
        name_ar            = btrim(v_src->>'name_ar'),
        name_bn            = nullif(btrim(coalesce(v_src->>'name_bn', '')), ''),
        contact_person     = nullif(btrim(coalesce(v_src->>'contact_person', '')), ''),
        mobile             = nullif(btrim(coalesce(v_src->>'mobile', '')), ''),
        whatsapp           = nullif(btrim(coalesce(v_src->>'whatsapp', '')), ''),
        email              = v_email,
        address            = nullif(btrim(coalesce(v_src->>'address', '')), ''),
        city               = nullif(btrim(coalesce(v_src->>'city', '')), ''),
        country_code       = coalesce(nullif(upper(btrim(coalesce(v_src->>'country_code', ''))), ''), 'SA'),
        vat_number         = v_vat,
        cr_number          = v_cr,
        opening_balance    = v_opening,
        credit_limit       = v_credit,
        payment_terms_days = v_terms,
        bank_name          = nullif(btrim(coalesce(v_src->>'bank_name', '')), ''),
        bank_account_name  = nullif(btrim(coalesce(v_src->>'bank_account_name', '')), ''),
        iban               = v_iban,
        notes              = nullif(btrim(coalesce(v_src->>'notes', '')), ''),
        is_active          = v_active
      where id = v_id and org_id = p_org_id
      returning * into v_row;
    exception when unique_violation then
      if sqlerrm like '%suppliers_code_uq%' then perform app.fail('supplier.code_taken', v_code);
      elsif sqlerrm like '%suppliers_vat_uq%' then perform app.fail('supplier.vat_taken', v_vat);
      else raise; end if;
    end;
  end if;

  return jsonb_build_object('id', v_row.id, 'supplier_no', v_row.supplier_no, 'row_version', v_row.row_version);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Privileges (least privilege; see docs/security.md)
-- -----------------------------------------------------------------------------
revoke all on public.suppliers, public.supplier_counters from public, anon, authenticated;

revoke all on function app.iban_checksum_valid(text) from public, anon, authenticated;
revoke all on function app.supplier_issue(jsonb) from public, anon, authenticated;
revoke all on function app.supplier_json(public.suppliers, boolean) from public, anon, authenticated;

revoke all on function public.list_suppliers(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.list_suppliers(uuid, text, text, integer, integer) to authenticated;
revoke all on function public.get_supplier(uuid, uuid) from public, anon;
grant execute on function public.get_supplier(uuid, uuid) to authenticated;
revoke all on function public.save_supplier(uuid, jsonb, bigint) from public, anon;
grant execute on function public.save_supplier(uuid, jsonb, bigint) to authenticated;

notify pgrst, 'reload schema';

-- Version marker (confirm with obj_description on public.suppliers)
comment on table public.suppliers is 'Phase 4A supplier management, migration 20261125000100 (v2: partial-update merge, amount and IBAN checksum validation).';
