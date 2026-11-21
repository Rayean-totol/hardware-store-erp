-- =============================================================================
-- READ-ONLY preflight for 20261124000200_pos_sales_fix.sql
-- Run in the Supabase SQL editor. Only SELECT statements. Changes nothing.
-- Every row should read 'ok' before the fix is applied, except the 'current state' rows,
-- which only describe what is there now.
-- =============================================================================
with checks(item, result) as (
  select 'table public.sales', case when to_regclass('public.sales') is not null then 'ok' else 'MISSING' end
  union all select 'table public.sale_lines', case when to_regclass('public.sale_lines') is not null then 'ok' else 'MISSING' end
  union all select 'table public.sale_payments', case when to_regclass('public.sale_payments') is not null then 'ok' else 'MISSING' end
  union all select 'table public.customers', case when to_regclass('public.customers') is not null then 'ok' else 'MISSING' end
  union all select 'table public.invoice_counters', case when to_regclass('public.invoice_counters') is not null then 'ok' else 'MISSING' end
  union all select 'function app.sale_summary(uuid,text)', case when to_regprocedure('app.sale_summary(uuid,text)') is not null then 'ok' else 'MISSING' end
  union all select 'function public.finalize_sale(...)', case when to_regprocedure('public.finalize_sale(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb)') is not null then 'ok' else 'MISSING' end
  union all select 'function public.cancel_sale(uuid,uuid,text,text)', case when to_regprocedure('public.cancel_sale(uuid,uuid,text,text)') is not null then 'ok' else 'MISSING' end
  union all select 'sale_lines duplicate (org_id, movement_client_id) rows',
    case when (select count(*) from (select 1 from public.sale_lines group by org_id, movement_client_id having count(*) > 1) d) = 0 then 'ok' else 'DUPLICATES - stop' end
)
select item, result from checks
union all
select 'current state: sale_lines unique constraints',
  coalesce((select string_agg(conname, ', ' order by conname) from pg_constraint
            where conrelid = 'public.sale_lines'::regclass and contype = 'u'), 'none')
union all
select 'current state: authenticated may run app.sale_summary',
  case when to_regprocedure('app.sale_summary(uuid,text)') is null then 'n/a'
       when has_function_privilege('authenticated', 'app.sale_summary(uuid,text)', 'EXECUTE') then 'yes (fix will remove it)'
       else 'no (already removed)' end
union all
select 'current state: POS version marker', coalesce(obj_description('public.sales'::regclass), 'none')
union all
select 'row count: sales', (select case when to_regclass('public.sales') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.sales', false, true, '')))[1]::text end)
union all
select 'row count: sale_lines', (select case when to_regclass('public.sale_lines') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.sale_lines', false, true, '')))[1]::text end)
union all
select 'row count: stock_movements', (select case when to_regclass('public.stock_movements') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.stock_movements', false, true, '')))[1]::text end)
union all
select 'row count: suppliers', (select case when to_regclass('public.suppliers') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.suppliers', false, true, '')))[1]::text end)
union all
select 'row count: purchase_orders', (select case when to_regclass('public.purchase_orders') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.purchase_orders', false, true, '')))[1]::text end)
union all
select 'row count: products', (select case when to_regclass('public.products') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.products', false, true, '')))[1]::text end);
