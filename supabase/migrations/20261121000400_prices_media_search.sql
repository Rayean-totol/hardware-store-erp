-- =============================================================================
-- Phase 2: multiple selling prices, product images, brand search filter
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Price tiers. product_units.sale_price remains the base RETAIL price (Phase 1).
-- product_prices adds wholesale / trade prices and quantity breaks per unit.
-- Resolution order (resolve_sale_price): level tier -> retail tier -> base retail price.
-- -----------------------------------------------------------------------------
create table public.product_prices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  product_id   uuid not null,
  unit_id      uuid not null,
  price_level  text not null check (price_level in ('retail', 'wholesale', 'trade')),
  min_quantity numeric(18, 6) not null default 1 check (min_quantity > 0),
  price        numeric(18, 4) not null check (price >= 0),
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  row_version  bigint not null default 1,
  constraint product_prices_tier_uq unique (product_id, unit_id, price_level, min_quantity),
  unique (id, org_id),
  foreign key (product_id, unit_id) references public.product_units (product_id, unit_id) on delete cascade,
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade
);
create index product_prices_product_idx on public.product_prices (product_id);

create trigger product_prices_touch before insert or update on public.product_prices
  for each row execute function app.touch_row();
create trigger product_prices_audit after insert or update or delete on public.product_prices
  for each row execute function app.audit_row_change();

-- Same rule as product_units.sale_price: changing a price needs catalog.price_write.
create or replace function app.guard_tier_price()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid := coalesce(new.org_id, old.org_id);
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and (new.price, new.min_quantity, new.unit_id, new.price_level)
                             is distinct from (old.price, old.min_quantity, old.unit_id, old.price_level))
     or tg_op = 'DELETE' then
    if not app.has_permission(v_org, 'catalog.price_write') then
      perform app.fail('forbidden', 'catalog.price_write');
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger product_prices_price_guard before insert or update or delete on public.product_prices
  for each row execute function app.guard_tier_price();

alter table public.product_prices enable row level security;
create policy product_prices_read on public.product_prices for select to authenticated
  using (app.has_permission(org_id, 'catalog.read'));
create policy product_prices_write on public.product_prices for all to authenticated
  using (app.has_permission(org_id, 'catalog.write'))
  with check (app.has_permission(org_id, 'catalog.write'));
revoke all on public.product_prices from anon;

-- Replace the tier set of one product. Rows are matched by id: unchanged rows are not
-- rewritten (so storekeepers can save products whose prices they may not change).
create or replace function public.save_product_prices(
  p_org_id uuid,
  p_product_id uuid,
  p_prices jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_count integer := 0;
begin
  if not app.has_permission(p_org_id, 'catalog.write') then
    perform app.fail('forbidden', 'catalog.write');
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id and p.org_id = p_org_id) then
    perform app.fail('not_found');
  end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' then
    perform app.fail('validation', 'prices');
  end if;

  delete from public.product_prices pp
  where pp.product_id = p_product_id and pp.org_id = p_org_id
    and not exists (
      select 1 from jsonb_array_elements(p_prices) e
      where nullif(e->>'id', '')::uuid = pp.id);

  for v_item in select value from jsonb_array_elements(p_prices) loop
    v_id := nullif(v_item->>'id', '')::uuid;
    if v_id is null then
      insert into public.product_prices (org_id, product_id, unit_id, price_level, min_quantity, price)
      values (p_org_id, p_product_id, (v_item->>'unit_id')::uuid, v_item->>'price_level',
              (v_item->>'min_quantity')::numeric, (v_item->>'price')::numeric);
    else
      update public.product_prices set
        unit_id = (v_item->>'unit_id')::uuid,
        price_level = v_item->>'price_level',
        min_quantity = (v_item->>'min_quantity')::numeric,
        price = (v_item->>'price')::numeric
      where id = v_id and product_id = p_product_id and org_id = p_org_id
        and (unit_id, price_level, min_quantity, price) is distinct from
            ((v_item->>'unit_id')::uuid, v_item->>'price_level', (v_item->>'min_quantity')::numeric,
             (v_item->>'price')::numeric);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.save_product_prices(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_product_prices(uuid, uuid, jsonb) to authenticated;

-- Price for a sale: best matching tier for the requested level and quantity.
create or replace function public.resolve_sale_price(
  p_product_id uuid,
  p_unit_id uuid,
  p_quantity numeric,
  p_level text default 'retail'
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select trim_scale(coalesce(
    (select pp.price::text from public.product_prices pp
      where pp.product_id = p_product_id and pp.unit_id = p_unit_id
        and pp.price_level = p_level and pp.min_quantity <= p_quantity
      order by pp.min_quantity desc limit 1),
    (select pp.price::text from public.product_prices pp
      where pp.product_id = p_product_id and pp.unit_id = p_unit_id
        and pp.price_level = 'retail' and pp.min_quantity <= p_quantity
      order by pp.min_quantity desc limit 1),
    (select pu.sale_price::text from public.product_units pu
      where pu.product_id = p_product_id and pu.unit_id = p_unit_id)
  )::numeric)::text;
$$;
revoke all on function public.resolve_sale_price(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.resolve_sale_price(uuid, uuid, numeric, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Product images: the object path lives in Supabase Storage bucket "product-images"
-- as <org_id>/<product_id>/<file>. Access follows the organization's catalog permissions.
-- -----------------------------------------------------------------------------
alter table public.products add column image_path text
  check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$');

create or replace function app.storage_org_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}/[^/]+$'
              then split_part(p_name, '/', 1)::uuid end;
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not present: product-images bucket and policies not created';
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('product-images', 'product-images', false)
  on conflict (id) do nothing;

  execute 'drop policy if exists product_images_read on storage.objects';
  execute 'drop policy if exists product_images_insert on storage.objects';
  execute 'drop policy if exists product_images_update on storage.objects';
  execute 'drop policy if exists product_images_delete on storage.objects';
  execute $p$create policy product_images_read on storage.objects for select to authenticated
    using (bucket_id = 'product-images' and app.is_org_member(app.storage_org_id(name)))$p$;
  execute $p$create policy product_images_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'product-images' and app.has_permission(app.storage_org_id(name), 'catalog.write'))$p$;
  execute $p$create policy product_images_update on storage.objects for update to authenticated
    using (bucket_id = 'product-images' and app.has_permission(app.storage_org_id(name), 'catalog.write'))
    with check (bucket_id = 'product-images' and app.has_permission(app.storage_org_id(name), 'catalog.write'))$p$;
  execute $p$create policy product_images_delete on storage.objects for delete to authenticated
    using (bucket_id = 'product-images' and app.has_permission(app.storage_org_id(name), 'catalog.write'))$p$;
end;
$$;

-- -----------------------------------------------------------------------------
-- Search: add a brand filter. Dropped and recreated with a defaulted parameter, so
-- existing four-argument calls keep working.
-- -----------------------------------------------------------------------------
drop function public.search_products(uuid, text, uuid, boolean);

create or replace function public.search_products(
  p_org_id uuid,
  p_query text default null,
  p_category_id uuid default null,
  p_include_archived boolean default false,
  p_brand_id uuid default null
)
returns setof public.products
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select nullif(btrim(p_query), '') as raw,
           '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select p.*
  from public.products p, q
  where p.org_id = p_org_id
    and (p_include_archived or p.archived_at is null)
    and (p_category_id is null or p.category_id = p_category_id)
    and (p_brand_id is null or p.brand_id = p_brand_id)
    and (
      q.raw is null
      or p.sku ilike q.pattern
      or p.name_en ilike q.pattern
      or p.name_ar ilike q.pattern
      or p.name_bn ilike q.pattern
      or exists (select 1 from public.product_units pu where pu.product_id = p.id and pu.barcode = q.raw)
    )
  order by p.name_en, p.id;
$$;
revoke all on function public.search_products(uuid, text, uuid, boolean, uuid) from public, anon;
grant execute on function public.search_products(uuid, text, uuid, boolean, uuid) to authenticated;
