-- =============================================================================
-- READ-ONLY verification for Phase 4A (migration 20261125000100_suppliers.sql, v2).
-- Changes nothing. Run in the Supabase SQL editor. Run AFTER the migration; before it, Part 1 is expected to show FALSE.
-- Part 1: installation and security. Every row should show TRUE.
-- Part 2: data quality. Every count should be 0 (it reports rows; it changes nothing).
-- =============================================================================

-- Part 1 -------------------------------------------------------------------------
select check_name, ok
from (values
  ('table public.suppliers exists',                 to_regclass('public.suppliers') is not null),
  ('table public.supplier_counters exists',         to_regclass('public.supplier_counters') is not null),
  ('function public.list_suppliers exists',         to_regprocedure('public.list_suppliers(uuid,text,text,integer,integer)') is not null),
  ('function public.get_supplier exists',           to_regprocedure('public.get_supplier(uuid,uuid)') is not null),
  ('function public.save_supplier exists',          to_regprocedure('public.save_supplier(uuid,jsonb,bigint)') is not null),
  ('function app.supplier_issue exists',            to_regprocedure('app.supplier_issue(jsonb)') is not null),
  ('function app.iban_checksum_valid exists',       to_regprocedure('app.iban_checksum_valid(text)') is not null),
  ('row-level security enabled on suppliers',       coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.suppliers')), false)),
  ('row-level security enabled on supplier_counters', coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.supplier_counters')), false)),
  ('suppliers: signed-in users have no table privileges',  case when to_regclass('public.suppliers') is null then false
        else not (has_table_privilege('authenticated', 'public.suppliers', 'SELECT') or has_table_privilege('authenticated', 'public.suppliers', 'INSERT') or has_table_privilege('authenticated', 'public.suppliers', 'UPDATE') or has_table_privilege('authenticated', 'public.suppliers', 'DELETE')) end),
  ('suppliers: anonymous users have no table privileges',  case when to_regclass('public.suppliers') is null then false
        else not (has_table_privilege('anon', 'public.suppliers', 'SELECT') or has_table_privilege('anon', 'public.suppliers', 'INSERT')) end),
  ('supplier_counters: no client privileges',       case when to_regclass('public.supplier_counters') is null then false
        else not (has_table_privilege('authenticated', 'public.supplier_counters', 'SELECT') or has_table_privilege('anon', 'public.supplier_counters', 'SELECT')) end),
  ('list/get/save: signed-in users may execute',    case when to_regprocedure('public.save_supplier(uuid,jsonb,bigint)') is null then false
        else has_function_privilege('authenticated', 'public.list_suppliers(uuid,text,text,integer,integer)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.get_supplier(uuid,uuid)', 'EXECUTE')
         and has_function_privilege('authenticated', 'public.save_supplier(uuid,jsonb,bigint)', 'EXECUTE') end),
  ('list/get/save: anonymous users may not execute', case when to_regprocedure('public.save_supplier(uuid,jsonb,bigint)') is null then false
        else not has_function_privilege('anon', 'public.list_suppliers(uuid,text,text,integer,integer)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.get_supplier(uuid,uuid)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.save_supplier(uuid,jsonb,bigint)', 'EXECUTE') end),
  ('helpers: signed-in users may not execute',      case when to_regprocedure('app.iban_checksum_valid(text)') is null then false
        else not has_function_privilege('authenticated', 'app.iban_checksum_valid(text)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'app.supplier_issue(jsonb)', 'EXECUTE')
         and not has_function_privilege('authenticated', 'app.supplier_json(public.suppliers,boolean)', 'EXECUTE') end),
  ('list/get/save are SECURITY DEFINER with a fixed search_path', case when to_regprocedure('public.save_supplier(uuid,jsonb,bigint)') is null then false
        else (select bool_and(p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%')
              from pg_proc p where p.oid in (to_regprocedure('public.list_suppliers(uuid,text,text,integer,integer)'),
                                             to_regprocedure('public.get_supplier(uuid,uuid)'),
                                             to_regprocedure('public.save_supplier(uuid,jsonb,bigint)'))) end),
  ('permissions suppliers.read and suppliers.manage exist', (select count(*) from public.permissions where code in ('suppliers.read', 'suppliers.manage')) = 2),
  ('owner holds suppliers.manage',                  exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.is_system and r.code = 'owner' and rp.permission_code = 'suppliers.manage')),
  ('cashier holds no supplier permission',          not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.is_system and r.code = 'cashier' and rp.permission_code like 'suppliers.%')),
  ('audit trigger on suppliers',                    exists (select 1 from pg_trigger where tgname = 'suppliers_audit')),
  ('touch trigger on suppliers',                    exists (select 1 from pg_trigger where tgname = 'suppliers_touch')),
  ('table public.supplier_ledger_entries exists',   to_regclass('public.supplier_ledger_entries') is not null),
  ('ledger: row-level security enabled',            coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.supplier_ledger_entries')), false)),
  ('ledger: no privileges for signed-in or anonymous users', case when to_regclass('public.supplier_ledger_entries') is null then false
        else not (has_table_privilege('authenticated', 'public.supplier_ledger_entries', 'SELECT') or has_table_privilege('authenticated', 'public.supplier_ledger_entries', 'INSERT')
               or has_table_privilege('anon', 'public.supplier_ledger_entries', 'SELECT')) end),
  ('ledger: append-only trigger present',           exists (select 1 from pg_trigger where tgname = 'supplier_ledger_no_update_delete')),
  ('ledger: audit trigger present',                 exists (select 1 from pg_trigger where tgname = 'supplier_ledger_audit')),
  ('post_supplier_adjustment: signed-in users may execute, anonymous may not', case when to_regprocedure('public.post_supplier_adjustment(uuid,uuid,uuid,text,text)') is null then false
        else has_function_privilege('authenticated', 'public.post_supplier_adjustment(uuid,uuid,uuid,text,text)', 'EXECUTE')
         and not has_function_privilege('anon', 'public.post_supplier_adjustment(uuid,uuid,uuid,text,text)', 'EXECUTE') end),
  ('permission suppliers.adjust exists and is held by owner', exists (select 1 from public.permissions where code = 'suppliers.adjust')
        and exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.is_system and r.code = 'owner' and rp.permission_code = 'suppliers.adjust')),
  ('storekeeper and cashier hold no adjustment permission', not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.is_system and r.code in ('storekeeper', 'cashier') and rp.permission_code = 'suppliers.adjust'))
) as checks(check_name, ok)
order by check_name;

-- Part 2 -------------------------------------------------------------------------
-- Reported counts (not TRUE/FALSE). Each should be 0.
select issue, row_count
from (
  select 'suppliers with an IBAN that fails the checksum' as issue,
         (select count(*) from public.suppliers s where s.iban is not null and not app.iban_checksum_valid(s.iban)) as row_count
  union all
  select 'suppliers with a non-finite or negative opening balance',
         (select count(*) from public.suppliers s where s.opening_balance::text in ('NaN', 'Infinity', '-Infinity') or s.opening_balance < 0)
  union all
  select 'suppliers with a non-finite or negative credit limit',
         (select count(*) from public.suppliers s where s.credit_limit is not null and (s.credit_limit::text in ('NaN', 'Infinity', '-Infinity') or s.credit_limit < 0))
  union all
  select 'supplier numbers used twice in one organisation',
         (select count(*) from (select org_id, supplier_no from public.suppliers group by 1, 2 having count(*) > 1) d)
  union all
  select 'supplier codes used twice in one organisation (case-insensitive)',
         (select count(*) from (select org_id, upper(supplier_code) from public.suppliers group by 1, 2 having count(*) > 1) d)
  union all
  select 'VAT numbers used twice in one organisation',
         (select count(*) from (select org_id, vat_number from public.suppliers where vat_number is not null group by 1, 2 having count(*) > 1) d)
  union all
  select 'supplier counters behind the highest issued number',
         (select count(*) from public.supplier_counters c
           where c.last_value < coalesce((select max(substr(s.supplier_no, 5)::bigint) from public.suppliers s where s.org_id = c.org_id), 0))
) q
order by issue;
