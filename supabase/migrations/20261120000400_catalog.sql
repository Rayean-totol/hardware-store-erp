-- =============================================================================
-- Catalog: units of measure, categories, brands, products, product units
-- =============================================================================
-- Stock is always held in the product's BASE unit. product_units lists every unit
-- a product can be bought/sold in, with factor = number of base units per unit.
-- Invariant (enforced by a deferred constraint trigger):
--   exactly one product_units row with is_base = true, factor = 1,
--   and its unit_id = products.base_unit_id.

-- -----------------------------------------------------------------------------
-- Units of measure
-- -----------------------------------------------------------------------------
create table public.units (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid references public.organizations (id) on delete cascade,
  code                    text not null check (code ~ '^[a-z][a-z0-9_]{0,15}$'),
  name_en                 text not null,
  name_ar                 text not null,
  name_bn                 text,
  dimension               text not null check (dimension in ('count', 'length', 'mass', 'volume', 'area')),
  -- Ratio to the dimension's reference unit (m, kg, l, m2, pcs). Null = packaging unit
  -- whose size is product-specific (box, carton, roll, bag ...).
  ratio_to_dimension_base numeric(24, 12) check (ratio_to_dimension_base > 0),
  allow_fraction          boolean not null default false,
  decimal_places          smallint not null default 0 check (decimal_places between 0 and 6),
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  created_by              uuid,
  updated_at              timestamptz not null default now(),
  updated_by              uuid,
  row_version             bigint not null default 1,
  check (allow_fraction or decimal_places = 0),
  unique nulls not distinct (org_id, code)
);

create trigger units_touch before insert or update on public.units
  for each row execute function app.touch_row();

-- System units (org_id null), available to every organization
insert into public.units (code, name_en, name_ar, name_bn, dimension, ratio_to_dimension_base, allow_fraction, decimal_places) values
  ('pcs',    'Piece',        'حبة',        'পিস',           'count',  1,      false, 0),
  ('pair',   'Pair',         'زوج',        'জোড়া',          'count',  2,      false, 0),
  ('dozen',  'Dozen',        'دزينة',      'ডজন',           'count',  12,     false, 0),
  ('set',    'Set',          'طقم',        'সেট',           'count',  null,   false, 0),
  ('box',    'Box',          'علبة',       'বাক্স',          'count',  null,   false, 0),
  ('carton', 'Carton',       'كرتون',      'কার্টন',         'count',  null,   false, 0),
  ('pack',   'Pack',         'باكت',       'প্যাক',          'count',  null,   false, 0),
  ('bag',    'Bag',          'كيس',        'ব্যাগ',          'count',  null,   false, 0),
  ('roll',   'Roll',         'لفة',        'রোল',           'count',  null,   false, 0),
  ('sheet',  'Sheet',        'لوح',        'শীট',           'count',  null,   false, 0),
  ('bucket', 'Bucket',       'سطل',        'বালতি',          'count',  null,   false, 0),
  ('m',      'Metre',        'متر',        'মিটার',          'length', 1,      true,  3),
  ('cm',     'Centimetre',   'سنتيمتر',    'সেন্টিমিটার',     'length', 0.01,   true,  2),
  ('mm',     'Millimetre',   'مليمتر',     'মিলিমিটার',       'length', 0.001,  true,  1),
  ('ft',     'Foot',         'قدم',        'ফুট',            'length', 0.3048, true,  3),
  ('in',     'Inch',         'بوصة',       'ইঞ্চি',           'length', 0.0254, true,  3),
  ('kg',     'Kilogram',     'كيلوغرام',   'কিলোগ্রাম',       'mass',   1,      true,  3),
  ('g',      'Gram',         'غرام',       'গ্রাম',           'mass',   0.001,  true,  1),
  ('ton',    'Tonne',        'طن',         'টন',            'mass',   1000,   true,  3),
  ('l',      'Litre',        'لتر',        'লিটার',          'volume', 1,      true,  3),
  ('ml',     'Millilitre',   'مليلتر',     'মিলিলিটার',       'volume', 0.001,  true,  0),
  ('gal',    'Gallon (US)',  'جالون',      'গ্যালন',          'volume', 3.785411784, true, 3),
  ('sqm',    'Square metre', 'متر مربع',   'বর্গমিটার',        'area',   1,      true,  3);

-- -----------------------------------------------------------------------------
-- Categories (hierarchical) and brands
-- -----------------------------------------------------------------------------
create table public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  parent_id   uuid,
  name_en     text not null check (length(btrim(name_en)) between 1 and 120),
  name_ar     text not null check (length(btrim(name_ar)) between 1 and 120),
  name_bn     text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  row_version bigint not null default 1,
  unique (id, org_id),
  check (parent_id is distinct from id),
  foreign key (parent_id, org_id) references public.product_categories (id, org_id)
);
create unique index product_categories_name_uq
  on public.product_categories (org_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name_en));

create or replace function app.prevent_category_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is null then
    return new;
  end if;
  if exists (
    with recursive ancestors (id, depth) as (
      select c.parent_id, 1 from public.product_categories c where c.id = new.parent_id
      union all
      select c.parent_id, a.depth + 1
      from public.product_categories c join ancestors a on c.id = a.id
      where a.id is not null and a.depth < 50
    )
    select 1 from ancestors where id = new.id
  ) or new.parent_id = new.id then
    perform app.fail('category.cycle');
  end if;
  return new;
end;
$$;

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 120),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  row_version bigint not null default 1,
  unique (id, org_id)
);
create unique index brands_name_uq on public.brands (org_id, lower(name));

create trigger product_categories_touch before insert or update on public.product_categories
  for each row execute function app.touch_row();
create trigger product_categories_cycle before insert or update of parent_id on public.product_categories
  for each row execute function app.prevent_category_cycle();
create trigger brands_touch before insert or update on public.brands
  for each row execute function app.touch_row();

-- -----------------------------------------------------------------------------
-- Products
-- -----------------------------------------------------------------------------
create table public.products (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organizations (id) on delete cascade,
  sku                       text not null check (sku ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
  name_en                   text not null check (length(btrim(name_en)) between 1 and 200),
  -- Arabic is mandatory: Saudi tax invoices must be issued in Arabic.
  name_ar                   text not null check (length(btrim(name_ar)) between 1 and 200),
  name_bn                   text check (name_bn is null or length(name_bn) <= 200),
  description               text check (description is null or length(description) <= 2000),
  category_id               uuid,
  brand_id                  uuid,
  product_type              text not null default 'stock' check (product_type in ('stock', 'service')),
  base_unit_id              uuid not null references public.units (id),
  -- UNCL5305 VAT category as used by ZATCA: S standard, Z zero-rated, E exempt, O out of scope
  tax_category              text not null default 'S' check (tax_category in ('S', 'Z', 'E', 'O')),
  tax_exemption_reason_code text check (tax_exemption_reason_code ~ '^VATEX-SA-[A-Z0-9.-]{1,20}$'),
  reorder_level             numeric(18, 6) check (reorder_level >= 0),
  archived_at               timestamptz,
  created_at                timestamptz not null default now(),
  created_by                uuid,
  updated_at                timestamptz not null default now(),
  updated_by                uuid,
  row_version               bigint not null default 1,
  constraint products_exemption_reason_required
    check ((tax_category = 'S') = (tax_exemption_reason_code is null)),
  constraint products_sku_uq unique (org_id, sku),
  unique (id, org_id),
  foreign key (category_id, org_id) references public.product_categories (id, org_id),
  foreign key (brand_id, org_id) references public.brands (id, org_id)
);
create index products_org_name_idx on public.products (org_id, name_en);
create index products_category_idx on public.products (category_id);
create index products_brand_idx on public.products (brand_id);
create index products_search_en_idx on public.products using gin (name_en extensions.gin_trgm_ops);
create index products_search_ar_idx on public.products using gin (name_ar extensions.gin_trgm_ops);
create index products_search_sku_idx on public.products using gin (sku extensions.gin_trgm_ops);

create table public.product_units (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  product_id       uuid not null,
  unit_id          uuid not null references public.units (id),
  factor           numeric(18, 6) not null check (factor > 0),
  is_base          boolean not null default false,
  -- GTIN or internal code (Code 128 printable subset)
  barcode          text check (barcode ~ '^[0-9A-Za-z./+-]{1,48}$'),
  sale_price       numeric(18, 4) check (sale_price >= 0),
  is_sale_unit     boolean not null default true,
  is_purchase_unit boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  row_version      bigint not null default 1,
  constraint product_units_base_factor check (not is_base or factor = 1),
  constraint product_units_unit_uq unique (product_id, unit_id),
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade
);
create unique index product_units_one_base_uq on public.product_units (product_id) where is_base;
create unique index product_units_barcode_uq on public.product_units (org_id, barcode) where barcode is not null;

create trigger products_touch before insert or update on public.products
  for each row execute function app.touch_row();
create trigger product_units_touch before insert or update on public.product_units
  for each row execute function app.touch_row();

-- Units used by a product must be system units or belong to the same org
create or replace function app.check_unit_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- TG_ARGV[0] names the unit column; read through jsonb because the trigger is shared by tables.
  v_unit_id uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  v_unit_org uuid;
  v_found boolean;
begin
  select true, u.org_id into v_found, v_unit_org from public.units u where u.id = v_unit_id;
  if v_found and v_unit_org is not null and v_unit_org <> new.org_id then
    perform app.fail('unit.wrong_org');
  end if;
  return new;
end;
$$;
create trigger products_unit_scope before insert or update of base_unit_id on public.products
  for each row execute function app.check_unit_scope('base_unit_id');
create trigger product_units_unit_scope before insert or update of unit_id on public.product_units
  for each row execute function app.check_unit_scope('unit_id');

-- Field-level permissions that RLS cannot express (end users only; auth.uid() is
-- null for service_role/migrations which are trusted).
create or replace function app.guard_product_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bookkeeping text[] := array['archived_at', 'updated_at', 'updated_by', 'row_version'];
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.archived_at is distinct from (case when tg_op = 'UPDATE' then old.archived_at end)
     and not app.has_permission(new.org_id, 'catalog.archive') then
    perform app.fail('forbidden', 'catalog.archive');
  end if;
  -- The update policy also admits archive-only users; they may not change anything else.
  if tg_op = 'UPDATE'
     and not app.has_permission(new.org_id, 'catalog.write')
     and (to_jsonb(new) - v_bookkeeping) is distinct from (to_jsonb(old) - v_bookkeeping) then
    perform app.fail('forbidden', 'catalog.write');
  end if;
  return new;
end;
$$;
create trigger products_archive_guard before insert or update on public.products
  for each row execute function app.guard_product_archive();

create or replace function app.guard_price_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.sale_price is distinct from (case when tg_op = 'UPDATE' then old.sale_price end)
     and not app.has_permission(new.org_id, 'catalog.price_write') then
    perform app.fail('forbidden', 'catalog.price_write');
  end if;
  return new;
end;
$$;
create trigger product_units_price_guard before insert or update of sale_price on public.product_units
  for each row execute function app.guard_price_change();

-- Deferred invariant: base unit consistency and whole-number factors when the
-- base unit cannot be fractional (a "box of 12.5 pieces" is rejected).
create or replace function app.check_product_unit_invariants()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- TG_ARGV[0] names the product id column ('id' on products, 'product_id' on product_units).
  v_product_id uuid := (coalesce(to_jsonb(new), to_jsonb(old)) ->> tg_argv[0])::uuid;
  v_product record;
  v_base_count int;
  v_base_unit uuid;
  v_base_allows_fraction boolean;
begin
  select p.id, p.base_unit_id into v_product from public.products p where p.id = v_product_id;
  if not found then
    return null; -- product deleted (cascade)
  end if;

  select count(*), min(pu.unit_id::text)::uuid into v_base_count, v_base_unit
  from public.product_units pu where pu.product_id = v_product_id and pu.is_base;

  if v_base_count <> 1 or v_base_unit <> v_product.base_unit_id then
    perform app.fail('product.base_unit_mismatch');
  end if;

  select u.allow_fraction into v_base_allows_fraction from public.units u where u.id = v_product.base_unit_id;
  if not v_base_allows_fraction and exists (
    select 1 from public.product_units pu
    where pu.product_id = v_product_id and pu.factor <> trunc(pu.factor)
  ) then
    perform app.fail('product.fractional_factor');
  end if;
  return null;
end;
$$;
create constraint trigger products_unit_invariants
  after insert or update of base_unit_id on public.products
  deferrable initially deferred
  for each row execute function app.check_product_unit_invariants('id');
create constraint trigger product_units_invariants
  after insert or update or delete on public.product_units
  deferrable initially deferred
  for each row execute function app.check_product_unit_invariants('product_id');

-- -----------------------------------------------------------------------------
-- Audit
-- -----------------------------------------------------------------------------
-- System units (org_id null) are skipped by app.audit_row_change(); they change only via migrations.
create trigger units_audit after insert or update or delete on public.units
  for each row execute function app.audit_row_change();
create trigger product_categories_audit after insert or update or delete on public.product_categories
  for each row execute function app.audit_row_change();
create trigger brands_audit after insert or update or delete on public.brands
  for each row execute function app.audit_row_change();
create trigger products_audit after insert or update or delete on public.products
  for each row execute function app.audit_row_change();
create trigger product_units_audit after insert or update or delete on public.product_units
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.units              enable row level security;
alter table public.product_categories enable row level security;
alter table public.brands             enable row level security;
alter table public.products           enable row level security;
alter table public.product_units      enable row level security;

create policy units_read on public.units for select to authenticated
  using (org_id is null or app.has_permission(org_id, 'catalog.read'));
create policy units_insert on public.units for insert to authenticated
  with check (org_id is not null and app.has_permission(org_id, 'catalog.write'));
create policy units_update on public.units for update to authenticated
  using (org_id is not null and app.has_permission(org_id, 'catalog.write'))
  with check (org_id is not null and app.has_permission(org_id, 'catalog.write'));

create policy product_categories_read on public.product_categories for select to authenticated
  using (app.has_permission(org_id, 'catalog.read'));
create policy product_categories_insert on public.product_categories for insert to authenticated
  with check (app.has_permission(org_id, 'catalog.write'));
create policy product_categories_update on public.product_categories for update to authenticated
  using (app.has_permission(org_id, 'catalog.write'))
  with check (app.has_permission(org_id, 'catalog.write'));

create policy brands_read on public.brands for select to authenticated
  using (app.has_permission(org_id, 'catalog.read'));
create policy brands_insert on public.brands for insert to authenticated
  with check (app.has_permission(org_id, 'catalog.write'));
create policy brands_update on public.brands for update to authenticated
  using (app.has_permission(org_id, 'catalog.write'))
  with check (app.has_permission(org_id, 'catalog.write'));

create policy products_read on public.products for select to authenticated
  using (app.has_permission(org_id, 'catalog.read'));
create policy products_insert on public.products for insert to authenticated
  with check (app.has_permission(org_id, 'catalog.write'));
create policy products_update on public.products for update to authenticated
  using (app.has_permission(org_id, 'catalog.write') or app.has_permission(org_id, 'catalog.archive'))
  with check (app.has_permission(org_id, 'catalog.write') or app.has_permission(org_id, 'catalog.archive'));
-- No delete policy: products are archived, never deleted (offline devices may reference them).

create policy product_units_read on public.product_units for select to authenticated
  using (app.has_permission(org_id, 'catalog.read'));
create policy product_units_insert on public.product_units for insert to authenticated
  with check (app.has_permission(org_id, 'catalog.write'));
create policy product_units_update on public.product_units for update to authenticated
  using (app.has_permission(org_id, 'catalog.write'))
  with check (app.has_permission(org_id, 'catalog.write'));
create policy product_units_delete on public.product_units for delete to authenticated
  using (app.has_permission(org_id, 'catalog.write'));

revoke all on public.units, public.product_categories, public.brands,
  public.products, public.product_units from anon;
