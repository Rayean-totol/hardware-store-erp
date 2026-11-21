-- READ-ONLY verification after 20261127000100. SELECT only. Expect every 'result' to be 'ok'.
with checks(item, result) as (
  select 'size_label column exists',
    case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'size_label') then 'ok' else 'FAIL' end
  union all select 'product_unit_costs exists', case when to_regclass('public.product_unit_costs') is not null then 'ok' else 'FAIL' end
  union all select 'RLS enabled on product_unit_costs',
    case when (select relrowsecurity from pg_class where oid = 'public.product_unit_costs'::regclass) then 'ok' else 'FAIL' end
  union all select 'anon has no privilege on product_unit_costs',
    case when not has_table_privilege('anon', 'public.product_unit_costs', 'SELECT') then 'ok' else 'FAIL' end
  union all select 'selling price guard still present',
    case when exists (select 1 from pg_trigger where tgname = 'product_units_price_guard') then 'ok' else 'FAIL' end
)
select item, result from checks
union all select 'row count: products (must equal the preflight value)', (select count(*)::text from public.products)
union all select 'row count: stock_levels (must equal the preflight value)', (select count(*)::text from public.stock_levels)
union all select 'row count: stock_movements (must equal the preflight value)', (select count(*)::text from public.stock_movements)
union all select 'row count: sales (must equal the preflight value)', (select count(*)::text from public.sales)
order by 1;
