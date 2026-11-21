-- =============================================================================
-- READ-ONLY verification after 20261124000200_pos_sales_fix.sql
-- Run in the Supabase SQL editor. Only SELECT statements. Changes nothing.
-- Expected: every 'result' is 'ok'. Compare the row counts with the preflight output:
-- they must be identical (the fix does not change business rows).
-- =============================================================================
with checks(item, result) as (
  select 'sale_lines has the per-organisation key',
    case when exists (select 1 from pg_constraint where conrelid = 'public.sale_lines'::regclass
      and conname = 'sale_lines_org_movement_client_key' and pg_get_constraintdef(oid) = 'UNIQUE (org_id, movement_client_id)') then 'ok' else 'FAIL' end
  union all select 'old single-column key is gone',
    case when not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = 'public.sale_lines'::regclass and c.contype = 'u' and array_length(c.conkey,1) = 1 and a.attname = 'movement_client_id') then 'ok' else 'FAIL' end
  union all select 'authenticated cannot run app.sale_summary directly',
    case when not has_function_privilege('authenticated', 'app.sale_summary(uuid,text)', 'EXECUTE') then 'ok' else 'FAIL' end
  union all select 'finalize_sale is security definer with empty search_path',
    case when exists (select 1 from pg_proc p where p.oid = 'public.finalize_sale(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb)'::regprocedure
      and p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%') then 'ok' else 'FAIL' end
  union all select 'cancel_sale is security definer with empty search_path',
    case when exists (select 1 from pg_proc p where p.oid = 'public.cancel_sale(uuid,uuid,text,text)'::regprocedure
      and p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%') then 'ok' else 'FAIL' end
  union all select 'anon cannot run finalize_sale',
    case when not has_function_privilege('anon', 'public.finalize_sale(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb)', 'EXECUTE') then 'ok' else 'FAIL' end
  union all select 'version marker updated',
    case when obj_description('public.sales'::regclass) like '%20261124000200%' then 'ok' else 'FAIL' end
)
select item, result from checks
union all select 'row count: sales', (select case when to_regclass('public.sales') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.sales', false, true, '')))[1]::text end)
union all select 'row count: sale_lines', (select case when to_regclass('public.sale_lines') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.sale_lines', false, true, '')))[1]::text end)
union all select 'row count: stock_movements', (select case when to_regclass('public.stock_movements') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.stock_movements', false, true, '')))[1]::text end)
union all select 'row count: suppliers', (select case when to_regclass('public.suppliers') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.suppliers', false, true, '')))[1]::text end)
union all select 'row count: purchase_orders', (select case when to_regclass('public.purchase_orders') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.purchase_orders', false, true, '')))[1]::text end)
union all select 'row count: products', (select case when to_regclass('public.products') is null then 'n/a (table not present)' else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.products', false, true, '')))[1]::text end);
