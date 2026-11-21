-- READ-ONLY preflight for 20261127000100 (product size and purchase price). SELECT only.
with checks(item, result) as (
  select 'size_label column present (expect no before the migration)',
    case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'size_label') then 'yes' else 'no' end
  union all select 'product_unit_costs table present (expect no before the migration)',
    case when to_regclass('public.product_unit_costs') is not null then 'yes' else 'no' end
  union all select 'products have the save_product function with 3 arguments',
    case when to_regprocedure('public.save_product(jsonb,jsonb,bigint)') is not null then 'yes' else 'no' end
)
select item, result from checks
union all select 'row count: products', (select count(*)::text from public.products)
union all select 'row count: product_units', (select count(*)::text from public.product_units)
union all select 'row count: stock_levels', (select count(*)::text from public.stock_levels)
union all select 'row count: stock_movements', (select count(*)::text from public.stock_movements)
union all select 'row count: sales', (select count(*)::text from public.sales)
order by 1;
