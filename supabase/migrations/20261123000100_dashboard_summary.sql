-- =============================================================================
-- Dashboard: inventory summary read model
-- =============================================================================
-- Read-only function. SECURITY INVOKER: row-level security on stock_levels, warehouses and
-- products applies, so a branch-restricted user only ever sums their own branches.
-- Explicit permission check first, so a user without inventory.read gets "forbidden"
-- rather than silent zeros.
--
-- Definitions (documented for the owner):
--   stock_value      sum of quantity x average cost over positive balances of active products.
--                    Negative balances are excluded from value (they are shown as a warning).
--   stock_positions  number of warehouse/product pairs with a positive balance.
--   low_stock_count  pairs at or below the reorder level, as in public.list_low_stock().
--   out_of_stock     stocked pairs (a row exists) whose balance is zero or negative.
--   product_count    active stock products in the organization.

create or replace function public.dashboard_inventory_summary(
  p_org_id uuid,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_value numeric;
  v_positions integer;
  v_out integer;
  v_low integer;
  v_products integer;
begin
  if not app.has_permission(p_org_id, 'inventory.read') then
    perform app.fail('forbidden', 'inventory.read');
  end if;

  select coalesce(sum(sl.quantity * sl.average_cost) filter (where sl.quantity > 0), 0),
         count(*) filter (where sl.quantity > 0),
         count(*) filter (where sl.quantity <= 0)
    into v_value, v_positions, v_out
  from public.stock_levels sl
  join public.products p on p.id = sl.product_id
  where sl.org_id = p_org_id
    and (p_branch_id is null or sl.branch_id = p_branch_id)
    and p.archived_at is null;

  select count(*) into v_low from public.list_low_stock(p_org_id, p_branch_id);

  select count(*) into v_products
  from public.products p
  where p.org_id = p_org_id and p.product_type = 'stock' and p.archived_at is null;

  return jsonb_build_object(
    'stock_value', trim_scale(v_value)::text,
    'stock_positions', v_positions,
    'out_of_stock_count', v_out,
    'low_stock_count', v_low,
    'product_count', v_products
  );
end;
$$;

revoke all on function public.dashboard_inventory_summary(uuid, uuid) from public, anon;
grant execute on function public.dashboard_inventory_summary(uuid, uuid) to authenticated;
