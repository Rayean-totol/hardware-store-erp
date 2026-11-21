-- =============================================================================
-- READ-ONLY verification for Phase 4B (migration 20261126000100_purchase_orders.sql).
-- Changes nothing. Run in the Supabase SQL editor after the migration.
-- Part 1: installation and security. Every row should show TRUE.
-- Part 2: data quality. Every count should be 0.
-- =============================================================================

-- Part 1 -------------------------------------------------------------------------
select check_name, ok
from (values
  ('table public.purchase_orders exists',            to_regclass('public.purchase_orders') is not null),
  ('table public.purchase_order_lines exists',       to_regclass('public.purchase_order_lines') is not null),
  ('table public.purchase_order_events exists',      to_regclass('public.purchase_order_events') is not null),
  ('table public.purchase_order_counters exists',    to_regclass('public.purchase_order_counters') is not null),
  ('row-level security on all four tables',          case when to_regclass('public.purchase_orders') is null then false else
        (select bool_and(c.relrowsecurity) from pg_class c where c.oid in (to_regclass('public.purchase_orders'), to_regclass('public.purchase_order_lines'),
                                                                            to_regclass('public.purchase_order_events'), to_regclass('public.purchase_order_counters'))) end),
  ('signed-in and anonymous users have no table privileges', case when to_regclass('public.purchase_orders') is null then false else
        not (has_table_privilege('authenticated', 'public.purchase_orders', 'SELECT') or has_table_privilege('authenticated', 'public.purchase_orders', 'INSERT')
          or has_table_privilege('authenticated', 'public.purchase_order_lines', 'SELECT') or has_table_privilege('authenticated', 'public.purchase_order_events', 'SELECT')
          or has_table_privilege('anon', 'public.purchase_orders', 'SELECT')) end),
  ('the seven purchase functions exist', to_regprocedure('public.create_purchase_order(uuid,uuid,uuid,uuid,uuid,date,text,jsonb)') is not null
        and to_regprocedure('public.update_purchase_order(uuid,uuid,bigint,jsonb,jsonb)') is not null
        and to_regprocedure('public.submit_purchase_order(uuid,uuid,bigint)') is not null
        and to_regprocedure('public.approve_purchase_order(uuid,uuid,bigint)') is not null
        and to_regprocedure('public.cancel_purchase_order(uuid,uuid,bigint,text)') is not null
        and to_regprocedure('public.list_purchase_orders(uuid,text,uuid,uuid,date,date,integer,integer)') is not null
        and to_regprocedure('public.get_purchase_order(uuid,uuid)') is not null),
  ('signed-in users may execute the seven functions, anonymous users may not', case when to_regprocedure('public.get_purchase_order(uuid,uuid)') is null then false else
        has_function_privilege('authenticated', 'public.create_purchase_order(uuid,uuid,uuid,uuid,uuid,date,text,jsonb)', 'EXECUTE')
        and has_function_privilege('authenticated', 'public.get_purchase_order(uuid,uuid)', 'EXECUTE')
        and not has_function_privilege('anon', 'public.create_purchase_order(uuid,uuid,uuid,uuid,uuid,date,text,jsonb)', 'EXECUTE')
        and not has_function_privilege('anon', 'public.get_purchase_order(uuid,uuid)', 'EXECUTE') end),
  ('the purchase functions are SECURITY DEFINER with a fixed search_path', case when to_regprocedure('public.get_purchase_order(uuid,uuid)') is null then false else
        (select bool_and(p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%')
           from pg_proc p where p.oid in (to_regprocedure('public.create_purchase_order(uuid,uuid,uuid,uuid,uuid,date,text,jsonb)'),
                                          to_regprocedure('public.approve_purchase_order(uuid,uuid,bigint)'),
                                          to_regprocedure('public.get_purchase_order(uuid,uuid)'))) end),
  ('permissions purchase.read/create/approve/void/cost_view exist', (select count(*) from public.permissions where code in
        ('purchase.read', 'purchase.create', 'purchase.approve', 'purchase.void', 'purchase.cost_view')) = 5),
  ('owner holds all five purchase permissions', (select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
        where r.is_system and r.code = 'owner' and rp.permission_code in ('purchase.read', 'purchase.create', 'purchase.approve', 'purchase.void', 'purchase.cost_view')) = 5),
  ('cashier holds no purchase permission', not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
        where r.is_system and r.code = 'cashier' and rp.permission_code like 'purchase.%')),
  ('storekeeper cannot approve or see costs', not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
        where r.is_system and r.code = 'storekeeper' and rp.permission_code in ('purchase.approve', 'purchase.cost_view'))),
  ('separation of duties enforced by a table check', exists (select 1 from pg_constraint where conname = 'purchase_orders_no_self_approval')),
  ('history is append-only (trigger present)',       exists (select 1 from pg_trigger where tgname = 'purchase_order_events_immutable')),
  ('draft-only lines (trigger present)',             exists (select 1 from pg_trigger where tgname = 'purchase_order_lines_draft_only')),
  ('no-delete on orders (trigger present)',          exists (select 1 from pg_trigger where tgname = 'purchase_orders_no_delete')),
  ('audit trigger on orders',                        exists (select 1 from pg_trigger where tgname = 'purchase_orders_audit'))
) as checks(check_name, ok)
order by check_name;

-- Part 2 -------------------------------------------------------------------------
-- Reported counts (not TRUE/FALSE). Each should be 0.
select issue, row_count
from (
  select 'orders approved by their own creator' as issue,
         (select count(*) from public.purchase_orders o where o.approved_by is not null and o.approved_by = o.created_by) as row_count
  union all
  select 'cancelled orders without a reason',
         (select count(*) from public.purchase_orders o where o.status = 'cancelled' and nullif(btrim(coalesce(o.cancel_reason, '')), '') is null)
  union all
  select 'orders whose total differs from the sum of their lines',
         (select count(*) from public.purchase_orders o
           where o.grand_total <> coalesce((select sum(l.gross_amount) from public.purchase_order_lines l where l.po_id = o.id), 0))
  union all
  select 'lines received beyond the ordered quantity',
         (select count(*) from public.purchase_order_lines l where l.received_base_quantity > l.base_quantity)
  union all
  select 'orders with no lines',
         (select count(*) from public.purchase_orders o where not exists (select 1 from public.purchase_order_lines l where l.po_id = o.id))
  union all
  select 'PO numbers used twice in one organisation',
         (select count(*) from (select org_id, po_number from public.purchase_orders group by 1, 2 having count(*) > 1) d)
) q
order by issue;
