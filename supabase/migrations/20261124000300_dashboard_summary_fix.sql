-- =============================================================================
-- Dashboard: inventory summary read model (idempotent) - FORWARD FIX for 20261123000100.
-- The merged 20261123000100_dashboard_summary.sql is restored unchanged; this file carries the change.
-- Read-only function: drops and recreates dashboard_inventory_summary only. No business row is touched.
-- =============================================================================
-- Safe to run more than once. Creates or replaces public.dashboard_inventory_summary(p_org_id, p_branch_id)
-- and nothing else. It reads data only; it never inserts, updates or deletes business rows.
--
-- SECURITY INVOKER: row-level security on stock_levels, warehouses and products applies, so a
-- user only ever sums stock of branches they may access. Explicit checks run first:
--   1. the caller must hold inventory.read in the organization        -> 'forbidden'
--   2. the branch, if given, must belong to that organization         -> 'not_found'
--   3. the caller must be allowed to access that branch               -> 'forbidden'
--
-- Definitions (also shown to the owner on the dashboard):
--   stock_value        sum of quantity x average cost over positive balances of active stock products.
--                      Negative balances are excluded from value (they are reported as out of stock).
--   stock_positions    warehouse/product pairs with a positive balance.
--   low_stock_count    pairs at or below the reorder level, exactly as public.list_low_stock() counts them.
--   out_of_stock_count stocked pairs (a stock row exists) whose balance is zero or negative.
--                      Products never stocked in a warehouse are not counted here.
--   product_count      active stock products in the organization.
--
-- Parameter contract (must match packages/data inventory-repository.ts):
--   p_org_id uuid (required), p_branch_id uuid default null
-- =============================================================================

-- Drop only this exact signature, so the function can be recreated with the contract above.
-- Dropping a read-only function does not touch any business data.
drop function if exists public.dashboard_inventory_summary(uuid, uuid);

create function public.dashboard_inventory_summary(
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
  v_value     numeric;
  v_positions integer;
  v_out       integer;
  v_low       integer;
  v_products  integer;
begin
  if p_org_id is null then
    perform app.fail('validation', 'org_id');
  end if;
  if not app.has_permission(p_org_id, 'inventory.read') then
    perform app.fail('forbidden', 'inventory.read');
  end if;
  if p_branch_id is not null then
    if not exists (select 1 from public.branches b where b.id = p_branch_id and b.org_id = p_org_id) then
      perform app.fail('not_found', 'branch');
    end if;
    if not app.can_access_branch(p_branch_id) then
      perform app.fail('forbidden', 'branch');
    end if;
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

-- Ask PostgREST to reload its schema cache, so the new function is callable immediately.
notify pgrst, 'reload schema';
