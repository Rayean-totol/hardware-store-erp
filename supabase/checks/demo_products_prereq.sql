-- =============================================================================
-- READ-ONLY prerequisite check for the DEMO product import. SELECT only; changes nothing.
-- Every 'categories' and 'units' row should show at least 1 (the import matches categories by
-- name, ignoring case, and units by code). 'DEMO SKUs already present' and 'same name' must be 0.
-- If a category shows 0, the import would reject those rows; send me this table instead of importing.
-- =============================================================================
with req(kind, name) as (values
  ('category', 'Plumbing'), ('category', 'Electrical'), ('category', 'Cables & wires'),
  ('category', 'Building materials'), ('category', 'Hand tools'), ('category', 'Bolts & nuts'),
  ('unit', 'pcs'), ('unit', 'm'), ('unit', 'bag'), ('unit', 'bucket'))
select 0 as ord, kind || ': ' || name as item,
  case when kind = 'category'
    then (select count(*) from public.product_categories c where lower(c.name_en) = lower(req.name))::text || ' (matching rows)'
    else (select count(*) from public.units u where u.code = req.name and u.is_active)::text || ' (matching rows)'
  end as result
from req
union all
select 1, 'DEMO SKUs already present (expect 0)', (select count(*)::text from public.products where sku like 'DEMO-%')
union all
select 2, 'products already using a demo English name (expect 0)',
  (select count(*)::text from public.products where name_en in (
    'PVC Pipe (DEMO)', 'PVC Elbow (DEMO)', 'LED Bulb (DEMO)', 'Electrical Cable (DEMO)', 'Cement Bag (DEMO)',
    'Hammer (DEMO)', 'Adjustable Wrench (DEMO)', 'Measuring Tape (DEMO)', 'Bolt & Nut (DEMO)', 'Plastic Bucket (DEMO)'))
union all
select 3, 'organisations in this database', (select count(*)::text from public.organizations)
union all
select 4, 'existing products (unchanged by the import)', (select count(*)::text from public.products)
order by ord, item;
