-- =============================================================================
-- READ-ONLY check: is the Phase 3 POS migration (20261124000100_pos_sales.sql) live?
-- =============================================================================
-- Run in the Supabase SQL editor. It only reads catalogue tables; it changes nothing.
-- This file is deliberately outside supabase/migrations/, so it is never applied automatically.
--
-- Expected after the migration is applied: every row shows ok = true.
-- If "sales.read" or the owner/cashier rows are false, the POS / Sales menu stays hidden,
-- because the app shows the menu only when get_my_context() returns sales.read.
-- =============================================================================
select check_name, ok
from (values
  ('table public.sales exists',              to_regclass('public.sales') is not null),
  ('table public.sale_lines exists',         to_regclass('public.sale_lines') is not null),
  ('table public.sale_payments exists',      to_regclass('public.sale_payments') is not null),
  ('table public.customers exists',          to_regclass('public.customers') is not null),
  ('function finalize_sale exists',          exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'finalize_sale')),
  ('function cancel_sale exists',            exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'cancel_sale')),
  ('column organizations.standard_vat_rate', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'standard_vat_rate')),
  ('permission sales.read exists',           exists (select 1 from public.permissions where code = 'sales.read')),
  ('owner role has sales.read',              exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.is_system and r.code = 'owner' and rp.permission_code = 'sales.read')),
  ('cashier role has sales.read',            exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.is_system and r.code = 'cashier' and rp.permission_code = 'sales.read')),
  ('cashier role has sales.create',          exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.is_system and r.code = 'cashier' and rp.permission_code = 'sales.create'))
) as checks(check_name, ok);
