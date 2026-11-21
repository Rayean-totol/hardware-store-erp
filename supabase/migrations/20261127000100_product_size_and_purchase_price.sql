-- =============================================================================
-- Product size and purchase price (additive). Changes no existing row or meaning.
-- =============================================================================
-- 1. products.size_label: free text such as "1/2 inch", "50 kg" or "12 mm" (nullable, max 40).
-- 2. public.product_unit_costs: purchase price per product unit. Financial, so it is readable and
--    writable only with catalog.price_write (row policies). Empty for every existing product.
-- 3. save_product: takes size_label and unit purchase_price. A key that is ABSENT keeps the stored
--    value, so the CSV import and older clients change nothing. An empty value clears it.
-- Selling prices (product_units.sale_price) and their guard are unchanged.
-- =============================================================================

alter table public.products add column if not exists size_label text
  check (size_label is null or char_length(size_label) between 1 and 40);

create table if not exists public.product_unit_costs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  product_id     uuid not null,
  unit_id        uuid not null,
  purchase_price numeric(18, 4) not null check (purchase_price >= 0),
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  row_version    bigint not null default 1,
  constraint product_unit_costs_uq unique (product_id, unit_id),
  unique (id, org_id),
  foreign key (product_id, unit_id) references public.product_units (product_id, unit_id) on delete cascade,
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade
);

create trigger product_unit_costs_touch before insert or update on public.product_unit_costs
  for each row execute function app.touch_row();
create trigger product_unit_costs_audit after insert or update or delete on public.product_unit_costs
  for each row execute function app.audit_row_change();

alter table public.product_unit_costs enable row level security;
create policy product_unit_costs_read on public.product_unit_costs for select to authenticated
  using (app.has_permission(org_id, 'catalog.price_write'));
create policy product_unit_costs_write on public.product_unit_costs for all to authenticated
  using (app.has_permission(org_id, 'catalog.price_write'))
  with check (app.has_permission(org_id, 'catalog.price_write'));
revoke all on public.product_unit_costs from anon;
grant select, insert, update, delete on public.product_unit_costs to authenticated;

create or replace function public.save_product(
  p_product jsonb,
  p_units jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := coalesce(nullif(p_product->>'id', '')::uuid, gen_random_uuid());
  v_org uuid := (p_product->>'org_id')::uuid;
  v_existing public.products%rowtype;
  v_base_unit uuid := (p_product->>'base_unit_id')::uuid;
  v_unit jsonb;
  v_base_rows int;
  v_constraint text;
  v_version bigint;
begin
  -- Re-defer the unit invariants: an earlier call in the same transaction (e.g. a
  -- batched offline replay) may have switched them to immediate.
  set constraints public.products_unit_invariants, public.product_units_invariants deferred;

  if v_org is null then
    perform app.fail('validation', 'org_id');
  end if;
  if not app.has_permission(v_org, 'catalog.write') then
    perform app.fail('forbidden', 'catalog.write');
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) = 0 then
    perform app.fail('product.units_required');
  end if;

  select count(*) into v_base_rows
  from jsonb_array_elements(p_units) u
  where coalesce((u->>'is_base')::boolean, false);
  if v_base_rows <> 1 or not exists (
    select 1 from jsonb_array_elements(p_units) u
    where coalesce((u->>'is_base')::boolean, false) and (u->>'unit_id')::uuid = v_base_unit
  ) then
    perform app.fail('product.base_unit_mismatch');
  end if;

  if (select count(distinct u->>'unit_id') from jsonb_array_elements(p_units) u) <> jsonb_array_length(p_units) then
    perform app.fail('product.duplicate_unit');
  end if;

  select * into v_existing from public.products where id = v_id for update;

  begin
    if not found then
      if p_expected_version is not null then
        perform app.fail('not_found');
      end if;
      insert into public.products (id, org_id, sku, name_en, name_ar, name_bn, description,
        category_id, brand_id, product_type, base_unit_id, tax_category,
        tax_exemption_reason_code, reorder_level, size_label)
      values (v_id, v_org, upper(btrim(p_product->>'sku')), btrim(p_product->>'name_en'),
        btrim(p_product->>'name_ar'), nullif(btrim(p_product->>'name_bn'), ''),
        nullif(btrim(p_product->>'description'), ''),
        nullif(p_product->>'category_id', '')::uuid, nullif(p_product->>'brand_id', '')::uuid,
        coalesce(p_product->>'product_type', 'stock'), v_base_unit,
        coalesce(p_product->>'tax_category', 'S'), nullif(p_product->>'tax_exemption_reason_code', ''),
        nullif(p_product->>'reorder_level', '')::numeric, nullif(btrim(p_product->>'size_label'), ''));
    else
      if v_existing.org_id <> v_org then
        perform app.fail('not_found');
      end if;
      if p_expected_version is null or v_existing.row_version <> p_expected_version then
        perform app.fail('concurrency_conflict', v_existing.row_version::text);
      end if;
      update public.products set
        sku = upper(btrim(p_product->>'sku')),
        name_en = btrim(p_product->>'name_en'),
        name_ar = btrim(p_product->>'name_ar'),
        name_bn = nullif(btrim(p_product->>'name_bn'), ''),
        description = nullif(btrim(p_product->>'description'), ''),
        category_id = nullif(p_product->>'category_id', '')::uuid,
        brand_id = nullif(p_product->>'brand_id', '')::uuid,
        product_type = coalesce(p_product->>'product_type', 'stock'),
        base_unit_id = v_base_unit,
        tax_category = coalesce(p_product->>'tax_category', 'S'),
        tax_exemption_reason_code = nullif(p_product->>'tax_exemption_reason_code', ''),
        reorder_level = nullif(p_product->>'reorder_level', '')::numeric,
        -- Absent key: keep the stored size (older callers, the CSV import, do not send it).
        size_label = case when p_product ? 'size_label' then nullif(btrim(p_product->>'size_label'), '') else size_label end
      where id = v_id;

      -- Remove units no longer listed
      delete from public.product_units pu
      where pu.product_id = v_id
        and pu.unit_id not in (select (u->>'unit_id')::uuid from jsonb_array_elements(p_units) u);

      -- Clear barcodes and the base flag first so that swapping them between
      -- units of the same product does not trip the unique indexes mid-statement.
      update public.product_units set barcode = null
      where product_id = v_id and barcode is not null;
      update public.product_units set is_base = false
      where product_id = v_id and is_base;
    end if;

    -- Explicit update-then-insert (not ON CONFLICT): BEFORE INSERT triggers fire
    -- for the proposed row of an upsert, which would misreport unchanged prices
    -- as price changes in app.guard_price_change().
    for v_unit in select * from jsonb_array_elements(p_units) loop
      update public.product_units set
        factor = (v_unit->>'factor')::numeric,
        is_base = coalesce((v_unit->>'is_base')::boolean, false),
        barcode = nullif(btrim(v_unit->>'barcode'), ''),
        sale_price = nullif(v_unit->>'sale_price', '')::numeric,
        is_sale_unit = coalesce((v_unit->>'is_sale_unit')::boolean, true),
        is_purchase_unit = coalesce((v_unit->>'is_purchase_unit')::boolean, true)
      where product_id = v_id and unit_id = (v_unit->>'unit_id')::uuid;
      if not found then
        insert into public.product_units (org_id, product_id, unit_id, factor, is_base, barcode,
          sale_price, is_sale_unit, is_purchase_unit)
        values (v_org, v_id, (v_unit->>'unit_id')::uuid, (v_unit->>'factor')::numeric,
          coalesce((v_unit->>'is_base')::boolean, false), nullif(btrim(v_unit->>'barcode'), ''),
          nullif(v_unit->>'sale_price', '')::numeric,
          coalesce((v_unit->>'is_sale_unit')::boolean, true),
          coalesce((v_unit->>'is_purchase_unit')::boolean, true));
      end if;
    end loop;

    -- Purchase prices (cost) live in product_unit_costs, which only catalog.price_write can read or
    -- change (row policies). An absent key leaves the stored cost alone; an empty value clears it.
    for v_unit in select * from jsonb_array_elements(p_units) loop
      if v_unit ? 'purchase_price' then
        if nullif(btrim(v_unit->>'purchase_price'), '') is null then
          delete from public.product_unit_costs
          where product_id = v_id and unit_id = (v_unit->>'unit_id')::uuid;
        else
          insert into public.product_unit_costs (org_id, product_id, unit_id, purchase_price)
          values (v_org, v_id, (v_unit->>'unit_id')::uuid, (v_unit->>'purchase_price')::numeric)
          on conflict (product_id, unit_id) do update set purchase_price = excluded.purchase_price;
        end if;
      end if;
    end loop;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'products_sku_uq' then
        perform app.fail('product.sku_taken', upper(btrim(p_product->>'sku')));
      elsif v_constraint = 'product_units_barcode_uq' then
        perform app.fail('product.barcode_taken');
      end if;
      raise;
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'products_exemption_reason_required' then
        perform app.fail('product.exemption_reason_required');
      end if;
      raise;
  end;

  -- Check the deferred invariants now so the caller gets the error from this call.
  set constraints public.products_unit_invariants, public.product_units_invariants immediate;

  select row_version into v_version from public.products where id = v_id;
  return jsonb_build_object('id', v_id, 'row_version', v_version);
end;
$$;

revoke all on function public.save_product(jsonb, jsonb, bigint) from public, anon;
grant execute on function public.save_product(jsonb, jsonb, bigint) to authenticated;

notify pgrst, 'reload schema';
