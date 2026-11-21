-- =============================================================================
-- READ-ONLY verification for the DEMO product import (docs/demo-products).
-- Run in the Supabase SQL editor. Only SELECT statements. Changes nothing.
-- Expected after a correct import: 10 demo products, no duplicates, 0 stock rows
-- on demo products, names/category/unit/price as listed. Image column: 'no' until
-- the images are uploaded in the app. Totals at the bottom must not change because of the import.
-- =============================================================================
with demo as (
  select p.id, p.sku, p.name_en, p.name_ar, p.archived_at, p.image_path,
         c.name_en as category,
         u.code as unit,
         (select pu.sale_price from public.product_units pu where pu.product_id = p.id and pu.is_base) as price,
         (select count(*) from public.stock_levels sl where sl.product_id = p.id) as stock_rows
  from public.products p
  left join public.product_categories c on c.id = p.category_id
  left join public.units u on u.id = p.base_unit_id
  where p.sku like 'DEMO-%'
)
select 0 as ord, 'DEMO products found (expect 10)' as item, (select count(*)::text from demo) as result
union all
select 1, 'duplicate DEMO SKUs (expect 0)',
  (select count(*)::text from (select sku from public.products where sku like 'DEMO-%' group by sku having count(*) > 1) d)
union all
select 2, 'stock rows on DEMO products (expect 0)', (select coalesce(sum(stock_rows), 0)::text from demo)
union all
select 3, 'DEMO products with an image (after uploads)', (select count(*)::text from demo where image_path is not null)
union all
select 4, 'DEMO products archived (expect 0)', (select count(*)::text from demo where archived_at is not null)
union all
select 10 + row_number() over (order by sku),
  sku,
  name_en || ' | ' || coalesce(name_ar, '-') || ' | ' || coalesce(category, 'NO CATEGORY') || ' | unit ' || coalesce(unit, '?')
    || ' | SAR ' || coalesce(price::text, '?') || ' | image ' || case when image_path is null then 'no' else 'yes' end
    || ' | stock rows ' || stock_rows
from demo
union all
select 100, 'TOTAL products (all, for before/after comparison)', (select count(*)::text from public.products)
union all
select 101, 'TOTAL stock_levels rows', (select count(*)::text from public.stock_levels)
union all
select 102, 'TOTAL stock_movements rows', (select count(*)::text from public.stock_movements)
union all
select 103, 'TOTAL sales rows', (select count(*)::text from public.sales)
order by ord, item;
