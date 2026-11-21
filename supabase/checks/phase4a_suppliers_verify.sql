-- READ-ONLY verification for Phase 4A (migration 20261125000100_suppliers.sql). Changes nothing.
-- Every row should show TRUE. Any FALSE row names what is missing.
select check_name, ok
from (values
  ('table public.suppliers exists',                  to_regclass('public.suppliers') is not null),
  ('table public.supplier_counters exists',          to_regclass('public.supplier_counters') is not null),
  ('function public.list_suppliers exists',          to_regprocedure('public.list_suppliers(uuid,text,text,integer,integer)') is not null),
  ('function public.get_supplier exists',            to_regprocedure('public.get_supplier(uuid,uuid)') is not null),
  ('function public.save_supplier exists',           to_regprocedure('public.save_supplier(uuid,jsonb,bigint)') is not null),
  ('function app.supplier_issue exists',             to_regprocedure('app.supplier_issue(jsonb)') is not null),
  ('row-level security enabled on suppliers',        coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.suppliers')), false)),
  ('row-level security enabled on supplier_counters', coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.supplier_counters')), false)),
  ('suppliers: no direct privileges for signed-in users', case when to_regclass('public.suppliers') is null then false else not has_table_privilege('authenticated', 'public.suppliers', 'SELECT') and not has_table_privilege('authenticated', 'public.suppliers', 'INSERT') end),
  ('suppliers: no direct privileges for anonymous users', case when to_regclass('public.suppliers') is null then false else not has_table_privilege('anon', 'public.suppliers', 'SELECT') end),
  ('save_supplier callable by signed-in users only',  case when to_regprocedure('public.save_supplier(uuid,jsonb,bigint)') is null then false else has_function_privilege('authenticated', 'public.save_supplier(uuid,jsonb,bigint)', 'EXECUTE') and not has_function_privilege('anon', 'public.save_supplier(uuid,jsonb,bigint)', 'EXECUTE') end),
  ('permissions suppliers.read and suppliers.manage exist', (select count(*) from public.permissions where code in ('suppliers.read','suppliers.manage')) = 2),
  ('owner holds suppliers.manage',                   exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.is_system and r.code = 'owner' and rp.permission_code = 'suppliers.manage')),
  ('cashier holds no supplier permission',           not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.is_system and r.code = 'cashier' and rp.permission_code like 'suppliers.%')),
  ('audit trigger on suppliers',                     exists (select 1 from pg_trigger where tgname = 'suppliers_audit'))
) as checks(check_name, ok)
order by check_name;
