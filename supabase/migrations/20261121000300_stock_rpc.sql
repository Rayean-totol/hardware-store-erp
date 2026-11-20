-- =============================================================================
-- Phase 2: stock write path (idempotent batch) and inventory read functions
-- =============================================================================
-- apply_stock_movements() is the ONLY writer of stock_movements and stock_levels.
--   * Idempotent: each movement carries a device-generated client_id. Re-sending a
--     movement that was already applied returns status "duplicate" and changes nothing.
--     This is what makes retries after lost responses safe.
--   * Ordered: items are applied in array order inside one transaction, so the
--     moving-average cost is computed exactly as the device recorded the sequence.
--   * Item isolation: each item runs in its own savepoint. A business rejection
--     (unknown product, insufficient stock, missing permission ...) rolls back only that
--     item and is returned with a machine-readable code, so the device can show it.
--   * Server authoritative: base quantity, factor, cost and balances are computed here,
--     never trusted from the client.
-- Output numbers are TEXT so 6-decimal quantities survive JSON intact.

create or replace function app.apply_one_stock_movement(
  p_org_id uuid,
  p_device_id text,
  p_item jsonb,
  p_allow_negative boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client      uuid := (p_item->>'client_id')::uuid;
  v_type        text := p_item->>'movement_type';
  v_reason      text := nullif(btrim(p_item->>'reason_code'), '');
  v_note        text := nullif(btrim(p_item->>'note'), '');
  v_reference   text := nullif(btrim(p_item->>'reference'), '');
  v_occurred    timestamptz := coalesce(nullif(p_item->>'occurred_at', '')::timestamptz, now());
  v_wh          public.warehouses%rowtype;
  v_product     public.products%rowtype;
  v_pu          public.product_units%rowtype;
  v_existing    public.stock_movements%rowtype;
  v_base_fraction boolean;
  v_input       numeric;
  v_entered     numeric;
  v_base_qty    numeric;
  v_change      numeric;
  v_unit_cost   numeric;
  v_base_cost   numeric;
  v_level_qty   numeric := 0;
  v_level_avg   numeric := 0;
  v_new_qty     numeric;
  v_new_avg     numeric;
  v_warnings    text[] := '{}';
  v_movement_id uuid;
begin
  if v_client is null then
    perform app.fail('validation', 'client_id');
  end if;

  -- Already applied? Return the stored outcome; nothing is written.
  select * into v_existing from public.stock_movements
  where org_id = p_org_id and client_id = v_client;
  if found then
    return jsonb_build_object(
      'client_id', v_client, 'status', 'duplicate', 'movement_id', v_existing.id,
      'balance_after', trim_scale(v_existing.balance_after)::text,
      'average_cost_after', trim_scale(v_existing.average_cost_after)::text, 'warnings', '[]'::jsonb);
  end if;

  if v_type is null or v_type not in ('stock_in', 'stock_out', 'adjustment') then
    perform app.fail('stock.invalid_type');
  end if;

  select * into v_wh from public.warehouses
  where id = nullif(p_item->>'warehouse_id', '')::uuid and org_id = p_org_id;
  if not found then
    perform app.fail('warehouse.not_found');
  end if;
  if not app.can_access_branch(v_wh.branch_id) then
    perform app.fail('forbidden', 'branch');
  end if;
  if v_type = 'adjustment' then
    if not app.has_permission(p_org_id, 'inventory.adjust') then
      perform app.fail('forbidden', 'inventory.adjust');
    end if;
  elsif not app.has_permission(p_org_id, 'inventory.move') then
    perform app.fail('forbidden', 'inventory.move');
  end if;
  if not v_wh.is_active then
    perform app.fail('warehouse.inactive');
  end if;

  select * into v_product from public.products
  where id = nullif(p_item->>'product_id', '')::uuid and org_id = p_org_id;
  if not found then
    perform app.fail('product.not_found');
  end if;
  if v_product.product_type <> 'stock' then
    perform app.fail('product.not_stock');
  end if;
  if v_product.archived_at is not null then
    perform app.fail('product.archived');
  end if;

  select * into v_pu from public.product_units
  where product_id = v_product.id and unit_id = nullif(p_item->>'unit_id', '')::uuid;
  if not found then
    perform app.fail('unit.not_configured');
  end if;

  -- Quantity: in/out are positive as entered; adjustments may be negative.
  v_input := nullif(p_item->>'quantity', '')::numeric;
  if v_input is null or v_input = 0 then
    perform app.fail('quantity.invalid');
  end if;
  if v_type <> 'adjustment' and v_input < 0 then
    perform app.fail('quantity.not_positive');
  end if;
  -- trim_scale: numeric multiplication adds scales (1.5 * 1.000000 has scale 7+), so normalise first
  v_entered := trim_scale(abs(v_input));
  if scale(v_entered) > 6 then
    perform app.fail('quantity.precision');
  end if;
  v_base_qty := trim_scale(v_entered * v_pu.factor);
  if scale(v_base_qty) > 6 then
    perform app.fail('quantity.precision');
  end if;
  select u.allow_fraction into v_base_fraction from public.units u where u.id = v_product.base_unit_id;
  if not v_base_fraction and v_base_qty <> trunc(v_base_qty) then
    perform app.fail('quantity.fraction_not_allowed');
  end if;
  v_change := case
    when v_type = 'stock_in' then v_base_qty
    when v_type = 'stock_out' then -v_base_qty
    else sign(v_input) * v_base_qty end;

  -- Reasons
  if v_reason is not null and v_reason not in (
       'purchase', 'opening', 'return', 'transfer_in', 'count_correction',
       'damage', 'theft', 'expired', 'found', 'other') then
    perform app.fail('stock.reason_invalid', v_reason);
  end if;
  if v_type = 'adjustment' and v_reason is null then
    perform app.fail('stock.reason_required');
  end if;

  -- Cost: given per entered unit, stored per base unit (rounded to 4 dp)
  v_unit_cost := nullif(p_item->>'unit_cost', '')::numeric;
  if v_unit_cost is not null and v_unit_cost < 0 then
    perform app.fail('cost.negative');
  end if;
  if v_type = 'stock_in' and v_unit_cost is null then
    perform app.fail('cost.required');
  end if;
  v_base_cost := case when v_unit_cost is null then null
                      else round(v_unit_cost / v_pu.factor, 4) end;

  -- Current balance, locked for the rest of the transaction
  select sl.quantity, sl.average_cost into v_level_qty, v_level_avg
  from public.stock_levels sl
  where sl.warehouse_id = v_wh.id and sl.product_id = v_product.id
  for update;
  if not found then
    v_level_qty := 0;
    v_level_avg := 0;
  end if;

  -- Moving-average cost (mirrors applyStockChange in packages/domain/src/stock.ts)
  if v_change > 0 then
    v_base_cost := coalesce(v_base_cost, v_level_avg);
    if v_level_qty <= 0 then
      v_new_avg := v_base_cost;
    else
      v_new_avg := round((v_level_qty * v_level_avg + v_change * v_base_cost) / (v_level_qty + v_change), 4);
    end if;
  else
    v_base_cost := v_level_avg;
    v_new_avg := v_level_avg;
  end if;

  v_new_qty := v_level_qty + v_change;
  if v_new_qty < 0 then
    if v_change < 0 and not p_allow_negative then
      perform app.fail('stock.insufficient', v_level_qty::text);
    end if;
    v_warnings := array_append(v_warnings, 'negative_stock');
  end if;

  insert into public.stock_movements (
    org_id, client_id, branch_id, warehouse_id, product_id, movement_type, unit_id,
    entered_quantity, factor, quantity_change, unit_cost, base_unit_cost,
    balance_after, average_cost_after, reason_code, note, reference, device_id,
    occurred_at, recorded_by)
  values (
    p_org_id, v_client, v_wh.branch_id, v_wh.id, v_product.id, v_type, v_pu.unit_id,
    v_entered, v_pu.factor, v_change, v_unit_cost, v_base_cost,
    v_new_qty, v_new_avg, v_reason, v_note, v_reference, left(p_device_id, 64),
    v_occurred, auth.uid())
  returning id into v_movement_id;

  insert into public.stock_levels as sl (
    org_id, branch_id, warehouse_id, product_id, quantity, average_cost, last_movement_at)
  values (p_org_id, v_wh.branch_id, v_wh.id, v_product.id, v_new_qty, v_new_avg, now())
  on conflict (warehouse_id, product_id) do update set
    quantity = excluded.quantity,
    average_cost = excluded.average_cost,
    last_movement_at = excluded.last_movement_at,
    row_version = sl.row_version + 1,
    updated_at = now();

  return jsonb_build_object(
    'client_id', v_client, 'status', 'applied', 'movement_id', v_movement_id,
    'balance_after', trim_scale(v_new_qty)::text, 'average_cost_after', trim_scale(v_new_avg)::text,
    'warnings', to_jsonb(v_warnings));
end;
$$;

create or replace function public.apply_stock_movements(
  p_org_id uuid,
  p_device_id text,
  p_movements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item    jsonb;
  v_result  jsonb;
  v_results jsonb := '[]'::jsonb;
  v_allow_negative boolean;
  v_msg text;
  v_detail text;
  v_state text;
begin
  if not app.is_org_member(p_org_id) then
    perform app.fail('forbidden', 'membership');
  end if;
  if p_movements is null or jsonb_typeof(p_movements) <> 'array' then
    perform app.fail('validation', 'movements');
  end if;
  if jsonb_array_length(p_movements) > 500 then
    perform app.fail('validation', 'batch_too_large');
  end if;

  select o.allow_negative_stock into v_allow_negative from public.organizations o where o.id = p_org_id;

  for v_item in select value from jsonb_array_elements(p_movements) loop
    begin
      v_result := app.apply_one_stock_movement(p_org_id, p_device_id, v_item, v_allow_negative);
    exception when others then
      -- Only this item's work is rolled back (savepoint). Surface the cause; never hide it.
      get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_state = returned_sqlstate;
      v_result := jsonb_build_object(
        'client_id', v_item->>'client_id',
        'status', 'rejected',
        'code', case when v_state = 'P0001' then v_msg else 'unknown' end,
        'message', v_msg,
        'detail', nullif(v_detail, ''),
        'sqlstate', v_state);
    end;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return v_results;
end;
$$;

revoke all on function app.apply_one_stock_movement(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.apply_stock_movements(uuid, text, jsonb) from public, anon;
grant execute on function public.apply_stock_movements(uuid, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Read functions (SECURITY INVOKER: RLS on warehouses/stock/products applies)
-- -----------------------------------------------------------------------------
create or replace function public.list_stock_levels(p_warehouse_id uuid)
returns table (
  product_id uuid, sku text, name_en text, name_ar text, name_bn text,
  base_unit_id uuid, quantity text, average_cost text, reorder_level text,
  last_movement_at timestamptz, is_low boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.sku, p.name_en, p.name_ar, p.name_bn, p.base_unit_id,
         trim_scale(sl.quantity)::text, trim_scale(sl.average_cost)::text, trim_scale(p.reorder_level)::text, sl.last_movement_at,
         (p.reorder_level is not null and sl.quantity <= p.reorder_level)
  from public.stock_levels sl
  join public.products p on p.id = sl.product_id
  where sl.warehouse_id = p_warehouse_id
  order by p.name_en, p.id;
$$;

-- Low stock: products with a reorder level whose balance is at or below it. Products that
-- have never been stocked in a warehouse count as zero, so they are alerted too.
create or replace function public.list_low_stock(p_org_id uuid, p_branch_id uuid default null)
returns table (
  warehouse_id uuid, branch_id uuid, product_id uuid, sku text, name_en text, name_ar text,
  quantity text, reorder_level text, shortage text)
language sql
stable
security invoker
set search_path = ''
as $$
  select w.id, w.branch_id, p.id, p.sku, p.name_en, p.name_ar,
         trim_scale(coalesce(sl.quantity, 0))::text,
         trim_scale(p.reorder_level)::text,
         trim_scale(p.reorder_level - coalesce(sl.quantity, 0))::text
  from public.warehouses w
  cross join public.products p
  left join public.stock_levels sl on sl.warehouse_id = w.id and sl.product_id = p.id
  where w.org_id = p_org_id
    and w.is_active
    and (p_branch_id is null or w.branch_id = p_branch_id)
    and p.org_id = p_org_id
    and p.product_type = 'stock'
    and p.archived_at is null
    and p.reorder_level is not null
    and coalesce(sl.quantity, 0) <= p.reorder_level
  order by (p.reorder_level - coalesce(sl.quantity, 0)) desc, p.name_en;
$$;

create or replace function public.list_stock_movements(
  p_warehouse_id uuid default null,
  p_product_id uuid default null,
  p_movement_type text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid, client_id uuid, warehouse_id uuid, product_id uuid, movement_type text, unit_id uuid,
  entered_quantity text, factor text, quantity_change text, unit_cost text, base_unit_cost text,
  balance_after text, average_cost_after text, reason_code text, note text, reference text,
  device_id text, occurred_at timestamptz, recorded_at timestamptz, recorded_by uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.client_id, m.warehouse_id, m.product_id, m.movement_type, m.unit_id,
         trim_scale(m.entered_quantity)::text, trim_scale(m.factor)::text, trim_scale(m.quantity_change)::text,
         trim_scale(m.unit_cost)::text, trim_scale(m.base_unit_cost)::text, trim_scale(m.balance_after)::text,
         trim_scale(m.average_cost_after)::text,
         m.reason_code, m.note, m.reference, m.device_id, m.occurred_at, m.recorded_at, m.recorded_by
  from public.stock_movements m
  where (p_warehouse_id is null or m.warehouse_id = p_warehouse_id)
    and (p_product_id is null or m.product_id = p_product_id)
    and (p_movement_type is null or m.movement_type = p_movement_type)
  order by m.recorded_at desc, m.id desc
  limit least(greatest(p_limit, 1), 500)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.list_stock_levels(uuid), public.list_low_stock(uuid, uuid),
  public.list_stock_movements(uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.list_stock_levels(uuid), public.list_low_stock(uuid, uuid),
  public.list_stock_movements(uuid, uuid, text, integer, integer) to authenticated;
