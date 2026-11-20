-- =============================================================================
-- Catalog RPCs: atomic product save (product + units) and product search
-- =============================================================================
-- Both run as SECURITY INVOKER, so RLS and the field-level guard triggers apply.

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
        tax_exemption_reason_code, reorder_level)
      values (v_id, v_org, upper(btrim(p_product->>'sku')), btrim(p_product->>'name_en'),
        btrim(p_product->>'name_ar'), nullif(btrim(p_product->>'name_bn'), ''),
        nullif(btrim(p_product->>'description'), ''),
        nullif(p_product->>'category_id', '')::uuid, nullif(p_product->>'brand_id', '')::uuid,
        coalesce(p_product->>'product_type', 'stock'), v_base_unit,
        coalesce(p_product->>'tax_category', 'S'), nullif(p_product->>'tax_exemption_reason_code', ''),
        nullif(p_product->>'reorder_level', '')::numeric);
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
        reorder_level = nullif(p_product->>'reorder_level', '')::numeric
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

-- Search by SKU, any-language name, or exact barcode. Returns rows of the products
-- table so PostgREST can embed product_units / categories on the result.
create or replace function public.search_products(
  p_org_id uuid,
  p_query text default null,
  p_category_id uuid default null,
  p_include_archived boolean default false
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
revoke all on function public.search_products(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.search_products(uuid, text, uuid, boolean) to authenticated;
