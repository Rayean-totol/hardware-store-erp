-- =============================================================================
-- Phase 4B: purchase orders (additive)
-- =============================================================================
-- A purchase order records what we intend to buy from a supplier. It NEVER changes stock:
-- stock moves only when goods are received (Phase 4C), through the existing stock writer.
--
-- Lifecycle: draft -> submitted -> approved -> cancelled.
-- partially_received and fully_received are reserved for Phase 4C and are set only by receiving.
--
-- Controls enforced here (not only in the UI):
--   * Only drafts can change; lines are locked by trigger once an order leaves draft.
--   * Nobody approves their own order (function check AND table check).
--   * Orders are never deleted; cancellation is a recorded status change.
--   * Every transition is written to purchase_order_events (append-only) and to audit_log.
--   * Costs and amounts are returned only to holders of purchase.cost_view.
--   * Client tables have no grants; every read and write goes through a security-definer function.
--
-- Money: the same rules as POS sales and the domain package (discount before VAT, per-line rounding
-- to 2 dp, net + VAT = gross). The VAT-inclusive flag and the rate are copied onto each order.
--
-- Re-runnable. Run after 20261125000100 (suppliers). See docs/phase-4b-purchase-orders.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Preflight: stop with one clear message if a prerequisite is missing. Read-only.
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.suppliers') is null then v_missing := array_append(v_missing, 'table public.suppliers (migration 20261125000100)'); end if;
  if to_regclass('public.supplier_ledger_entries') is null then v_missing := array_append(v_missing, 'table public.supplier_ledger_entries (migration 20261125000100)'); end if;
  if to_regclass('public.warehouses') is null then v_missing := array_append(v_missing, 'table public.warehouses'); end if;
  if to_regclass('public.branches') is null then v_missing := array_append(v_missing, 'table public.branches'); end if;
  if to_regclass('public.products') is null then v_missing := array_append(v_missing, 'table public.products'); end if;
  if to_regclass('public.product_units') is null then v_missing := array_append(v_missing, 'table public.product_units'); end if;
  if to_regclass('public.units') is null then v_missing := array_append(v_missing, 'table public.units'); end if;
  if to_regclass('public.organizations') is null then v_missing := array_append(v_missing, 'table public.organizations'); end if;
  if to_regclass('public.permissions') is null then v_missing := array_append(v_missing, 'table public.permissions'); end if;
  if to_regclass('public.audit_log') is null then v_missing := array_append(v_missing, 'table public.audit_log'); end if;
  if to_regprocedure('app.fail(text,text)') is null then v_missing := array_append(v_missing, 'function app.fail'); end if;
  if to_regprocedure('app.is_org_member(uuid)') is null then v_missing := array_append(v_missing, 'function app.is_org_member'); end if;
  if to_regprocedure('app.has_permission(uuid,text)') is null then v_missing := array_append(v_missing, 'function app.has_permission'); end if;
  if to_regprocedure('app.can_access_branch(uuid)') is null then v_missing := array_append(v_missing, 'function app.can_access_branch'); end if;
  if to_regprocedure('app.touch_row()') is null then v_missing := array_append(v_missing, 'function app.touch_row'); end if;
  if to_regprocedure('app.audit_row_change()') is null then v_missing := array_append(v_missing, 'function app.audit_row_change'); end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'Phase 4B prerequisites are missing: %. Apply the earlier migrations first.', array_to_string(v_missing, ', ')
      using errcode = 'P0001', hint = 'No purchase-order objects were created.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Permissions and role grants (rows added; existing rows untouched)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('purchase.read',      'purchase', 'View purchase orders (costs need purchase.cost_view)'),
  ('purchase.create',    'purchase', 'Create and edit draft purchase orders and submit them for approval'),
  ('purchase.approve',   'purchase', 'Approve purchase orders that someone else created'),
  ('purchase.void',      'purchase', 'Cancel purchase orders that have no goods received'),
  ('purchase.cost_view', 'purchase', 'See unit costs, discounts, VAT and totals on purchase orders')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, v.code
from public.roles r
join (values
  ('owner',       'purchase.read'), ('owner',       'purchase.create'), ('owner',       'purchase.approve'), ('owner',       'purchase.void'), ('owner',       'purchase.cost_view'),
  ('admin',       'purchase.read'), ('admin',       'purchase.create'), ('admin',       'purchase.approve'), ('admin',       'purchase.void'), ('admin',       'purchase.cost_view'),
  ('manager',     'purchase.read'), ('manager',     'purchase.create'), ('manager',     'purchase.approve'), ('manager',     'purchase.void'), ('manager',     'purchase.cost_view'),
  ('storekeeper', 'purchase.read'),
  ('accountant',  'purchase.read'), ('accountant',  'purchase.cost_view'),
  ('auditor',     'purchase.read'), ('auditor',     'purchase.cost_view')
) as v(role_code, code) on v.role_code = r.code and r.is_system
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Numbering (one counter per organisation; PO-000001)
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_order_counters (
  org_id     uuid primary key references public.organizations (id) on delete restrict,
  last_value bigint not null default 0 check (last_value >= 0)
);
alter table public.purchase_order_counters enable row level security;

-- -----------------------------------------------------------------------------
-- 3. Purchase orders (header)
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete restrict,
  po_number            text not null check (po_number ~ '^PO-[0-9]{6,}$'),
  -- Idempotency key from the client: a repeated create returns the same order.
  client_id            uuid not null,
  supplier_id          uuid not null,
  branch_id            uuid not null,
  warehouse_id         uuid not null,
  status               text not null default 'draft'
                         check (status in ('draft', 'submitted', 'approved', 'partially_received', 'fully_received', 'cancelled')),
  prices_include_vat   boolean not null,
  vat_rate             numeric(5, 4) not null check (vat_rate >= 0 and vat_rate < 1),
  expected_delivery_date date,
  delivery_notes       text check (delivery_notes is null or length(delivery_notes) <= 500),
  subtotal_net         numeric(18, 2) not null default 0 check (subtotal_net >= 0),
  discount_total       numeric(18, 2) not null default 0 check (discount_total >= 0),
  vat_total            numeric(18, 2) not null default 0 check (vat_total >= 0),
  grand_total          numeric(18, 2) not null default 0 check (grand_total >= 0),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  submitted_by         uuid,
  submitted_at         timestamptz,
  approved_by          uuid,
  approved_at          timestamptz,
  cancelled_by         uuid,
  cancelled_at         timestamptz,
  cancel_reason        text check (cancel_reason is null or length(cancel_reason) <= 500),
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  row_version          bigint not null default 1,
  constraint purchase_orders_number_uq unique (org_id, po_number),
  constraint purchase_orders_client_uq unique (org_id, client_id),
  constraint purchase_orders_id_org_uq unique (id, org_id),
  -- Separation of duties, checked by the table as well as by the approval function.
  constraint purchase_orders_no_self_approval check (approved_by is null or created_by is null or approved_by <> created_by),
  constraint purchase_orders_cancel_reason check (status <> 'cancelled' or cancel_reason is not null),
  foreign key (warehouse_id, branch_id, org_id) references public.warehouses (id, branch_id, org_id),
  foreign key (supplier_id, org_id) references public.suppliers (id, org_id)
);
create index if not exists purchase_orders_branch_idx on public.purchase_orders (org_id, branch_id, created_at desc);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id, status);

drop trigger if exists purchase_orders_touch on public.purchase_orders;
create trigger purchase_orders_touch before insert or update on public.purchase_orders
  for each row execute function app.touch_row();
drop trigger if exists purchase_orders_audit on public.purchase_orders;
create trigger purchase_orders_audit after insert or update on public.purchase_orders
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- 4. Purchase order lines
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_order_lines (
  id                      uuid primary key default gen_random_uuid(),
  po_id                   uuid not null,
  org_id                  uuid not null,
  line_no                 integer not null check (line_no > 0),
  product_id              uuid not null,
  unit_id                 uuid not null references public.units (id),
  sku                     text not null,
  name_en                 text not null,
  name_ar                 text,
  name_bn                 text,
  tax_category            text not null check (tax_category in ('S', 'Z', 'E', 'O')),
  entered_quantity        numeric(18, 6) not null check (entered_quantity > 0),
  factor                  numeric(18, 6) not null check (factor > 0),
  base_quantity           numeric(18, 6) not null check (base_quantity > 0),
  -- Purchase price per entered unit (net if prices are VAT-exclusive, gross if inclusive)
  unit_cost               numeric(18, 4) not null check (unit_cost >= 0),
  base_unit_cost          numeric(18, 4) not null check (base_unit_cost >= 0),
  discount_type           text check (discount_type is null or discount_type in ('percent', 'fixed')),
  discount_value          numeric(18, 4) check (discount_value is null or discount_value >= 0),
  discount_amount         numeric(18, 2) not null default 0 check (discount_amount >= 0),
  net_amount              numeric(18, 2) not null check (net_amount >= 0),
  vat_rate                numeric(5, 4) not null check (vat_rate >= 0 and vat_rate < 1),
  vat_amount              numeric(18, 2) not null check (vat_amount >= 0),
  gross_amount            numeric(18, 2) not null check (gross_amount >= 0),
  -- Filled by Phase 4C receiving. Always zero in Phase 4B.
  received_base_quantity  numeric(18, 6) not null default 0 check (received_base_quantity >= 0),
  constraint purchase_order_lines_no_over_receipt check (received_base_quantity <= base_quantity),
  constraint purchase_order_lines_amounts check (net_amount + vat_amount = gross_amount),
  constraint purchase_order_lines_line_uq unique (po_id, line_no),
  foreign key (po_id, org_id) references public.purchase_orders (id, org_id) on delete restrict,
  foreign key (product_id, org_id) references public.products (id, org_id)
);
create index if not exists purchase_order_lines_po_idx on public.purchase_order_lines (po_id);

-- Lines are part of the order: they change only while it is a draft. Orders are never deleted.
create or replace function app.purchase_lines_draft_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_po     uuid := coalesce(new.po_id, old.po_id);
begin
  select o.status into v_status from public.purchase_orders o where o.id = v_po;
  if v_status is distinct from 'draft' then
    raise exception 'purchase order lines can change only while the order is a draft' using errcode = 'P0001', hint = 'purchase.not_draft';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists purchase_order_lines_draft_only on public.purchase_order_lines;
create trigger purchase_order_lines_draft_only before insert or update or delete on public.purchase_order_lines
  for each row execute function app.purchase_lines_draft_only();

create or replace function app.purchase_orders_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'purchase orders are never deleted; cancel them instead' using errcode = '42501', hint = 'purchase.no_delete';
end;
$$;
drop trigger if exists purchase_orders_no_delete on public.purchase_orders;
create trigger purchase_orders_no_delete before delete on public.purchase_orders
  for each row execute function app.purchase_orders_no_delete();

-- -----------------------------------------------------------------------------
-- 5. Events (append-only history of every transition)
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_order_events (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null,
  org_id      uuid not null,
  event       text not null check (event in ('created', 'updated', 'submitted', 'approved', 'cancelled')),
  from_status text,
  to_status   text not null,
  note        text check (note is null or length(note) <= 500),
  actor_id    uuid,
  -- clock_timestamp, not now(): several transitions can happen in one transaction and must keep their order.
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (po_id, org_id) references public.purchase_orders (id, org_id) on delete restrict
);
create index if not exists purchase_order_events_po_idx on public.purchase_order_events (po_id, occurred_at);

create or replace function app.purchase_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'purchase order history is append-only' using errcode = '42501', hint = 'purchase.history_immutable';
end;
$$;
drop trigger if exists purchase_order_events_immutable on public.purchase_order_events;
create trigger purchase_order_events_immutable before update or delete on public.purchase_order_events
  for each row execute function app.purchase_events_immutable();
drop trigger if exists purchase_order_events_audit on public.purchase_order_events;
create trigger purchase_order_events_audit after insert on public.purchase_order_events
  for each row execute function app.audit_row_change();

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_events enable row level security;
-- No policies and no grants: every read and write goes through the security-definer functions below.

-- -----------------------------------------------------------------------------
-- 6. Helpers (not callable by clients)
-- -----------------------------------------------------------------------------

-- A client-supplied id: blank gives null, a malformed one is a validation error (never a cast error).
create or replace function app.uuid_or_fail(p_text text, p_field text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_text, '')), '') is null then
    return null;
  end if;
  if btrim(p_text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('validation', p_field);
  end if;
  return btrim(p_text)::uuid;
end;
$$;

-- Validates and prices a list of lines. Returns a jsonb array with every amount computed on the server.
-- Each line: {product_id, unit_id, quantity, unit_cost, discount_type?, discount_value?}.
create or replace function app.purchase_build_lines(
  p_org_id uuid,
  p_lines  jsonb,
  p_prices_include_vat boolean,
  p_rate   numeric
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_line      jsonb;
  v_idx       integer := 0;
  v_product   public.products%rowtype;
  v_pu        public.product_units%rowtype;
  v_allow     boolean;
  v_qty       text;
  v_qty_num   numeric;
  v_base      numeric;
  v_cost_text text;
  v_cost      numeric;
  v_base_cost numeric;
  v_disc_type text;
  v_disc_text text;
  v_disc_val  numeric;
  v_disc      numeric;
  v_ext       numeric;
  v_after     numeric;
  v_rate      numeric;
  v_net       numeric;
  v_vat       numeric;
  v_gross     numeric;
  v_out       jsonb := '[]'::jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform app.fail('validation', 'lines');
  end if;
  if jsonb_array_length(p_lines) > 200 then
    perform app.fail('validation', 'too_many_lines');
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_line) <> 'object' then perform app.fail('validation', 'lines'); end if;

    select * into v_product from public.products
    where id = app.uuid_or_fail(v_line->>'product_id', 'product_id') and org_id = p_org_id;
    if not found then perform app.fail('product.not_found'); end if;
    if v_product.product_type <> 'stock' then perform app.fail('product.not_stock'); end if;
    if v_product.archived_at is not null then perform app.fail('product.archived'); end if;

    select * into v_pu from public.product_units
    where product_id = v_product.id and unit_id = app.uuid_or_fail(v_line->>'unit_id', 'unit_id');
    if not found or not v_pu.is_purchase_unit then perform app.fail('unit.not_purchase_unit', v_product.sku); end if;

    v_qty := btrim(coalesce(v_line->>'quantity', ''));
    if v_qty !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' then perform app.fail('quantity.invalid'); end if;
    v_qty_num := v_qty::numeric;
    if v_qty_num <= 0 then perform app.fail('quantity.invalid'); end if;
    v_base := trim_scale(v_qty_num * v_pu.factor);
    if scale(v_base) > 6 then perform app.fail('quantity.precision'); end if;
    select u.allow_fraction into v_allow from public.units u where u.id = v_product.base_unit_id;
    if not v_allow and v_base <> trunc(v_base) then perform app.fail('quantity.fraction_not_allowed', v_product.sku); end if;

    v_cost_text := btrim(coalesce(v_line->>'unit_cost', ''));
    if v_cost_text !~ '^[0-9]{1,12}(\.[0-9]{1,4})?$' then perform app.fail('cost.invalid'); end if;
    v_cost := v_cost_text::numeric;
    v_base_cost := round(v_cost / v_pu.factor, 4);

    v_disc_type := nullif(btrim(coalesce(v_line->>'discount_type', '')), '');
    v_disc_text := btrim(coalesce(v_line->>'discount_value', ''));
    if v_disc_text !~ '^[0-9]{0,12}(\.[0-9]{1,4})?$' then perform app.fail('discount.invalid'); end if;
    v_disc_val := coalesce(nullif(v_disc_text, '')::numeric, 0);

    v_ext := round(v_qty_num * v_cost, 2);
    if v_disc_type is null or v_disc_val = 0 then
      v_disc := 0;
      v_disc_type := null;
    elsif v_disc_type = 'percent' then
      if v_disc_val > 100 then perform app.fail('discount.invalid'); end if;
      v_disc := round(v_ext * v_disc_val / 100, 2);
    elsif v_disc_type = 'fixed' then
      if v_disc_val > v_ext then perform app.fail('discount.invalid'); end if;
      v_disc := round(v_disc_val, 2);
    else
      perform app.fail('discount.invalid');
    end if;

    v_after := v_ext - v_disc;
    v_rate := case when v_product.tax_category = 'S' then p_rate else 0 end;
    if p_prices_include_vat then
      v_gross := v_after;
      v_net := round(v_gross / (1 + v_rate), 2);
      v_vat := v_gross - v_net;
    else
      v_net := v_after;
      v_vat := round(v_net * v_rate, 2);
      v_gross := v_net + v_vat;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line_no', v_idx, 'product_id', v_product.id, 'unit_id', v_pu.unit_id,
      'sku', v_product.sku, 'name_en', v_product.name_en, 'name_ar', v_product.name_ar, 'name_bn', v_product.name_bn,
      'tax_category', v_product.tax_category, 'entered_quantity', v_qty_num::text, 'factor', v_pu.factor::text,
      'base_quantity', v_base::text, 'unit_cost', v_cost::text, 'base_unit_cost', v_base_cost::text,
      'discount_type', v_disc_type, 'discount_value', case when v_disc_type is null then null else v_disc_val::text end,
      'discount_amount', v_disc::text, 'net_amount', v_net::text, 'vat_rate', v_rate::text,
      'vat_amount', v_vat::text, 'gross_amount', v_gross::text));
  end loop;
  return v_out;
end;
$$;

-- The order as JSON. Costs and amounts are included only when p_cost_view is true.
create or replace function app.purchase_order_json(o public.purchase_orders, p_cost_view boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', o.id,
    'po_number', o.po_number,
    'status', o.status,
    'supplier_id', o.supplier_id,
    'supplier_name_en', (select s.name_en from public.suppliers s where s.id = o.supplier_id),
    'supplier_no', (select s.supplier_no from public.suppliers s where s.id = o.supplier_id),
    'branch_id', o.branch_id,
    'warehouse_id', o.warehouse_id,
    'expected_delivery_date', o.expected_delivery_date,
    'delivery_notes', o.delivery_notes,
    'created_at', o.created_at,
    'created_by', o.created_by,
    'submitted_at', o.submitted_at,
    'approved_at', o.approved_at,
    'cancelled_at', o.cancelled_at,
    'cancel_reason', o.cancel_reason,
    'row_version', o.row_version,
    'lines', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                'id', l.id, 'line_no', l.line_no, 'product_id', l.product_id, 'unit_id', l.unit_id,
                'sku', l.sku, 'name_en', l.name_en, 'name_ar', l.name_ar, 'name_bn', l.name_bn,
                'entered_quantity', trim_scale(l.entered_quantity)::text, 'factor', trim_scale(l.factor)::text,
                'base_quantity', trim_scale(l.base_quantity)::text, 'received_base_quantity', trim_scale(l.received_base_quantity)::text)
                || case when p_cost_view then jsonb_build_object(
                     'tax_category', l.tax_category, 'unit_cost', l.unit_cost::text, 'base_unit_cost', l.base_unit_cost::text,
                     'discount_type', l.discount_type, 'discount_value', l.discount_value::text, 'discount_amount', l.discount_amount::text,
                     'net_amount', l.net_amount::text, 'vat_rate', l.vat_rate::text, 'vat_amount', l.vat_amount::text, 'gross_amount', l.gross_amount::text)
                else '{}'::jsonb end)
              order by l.line_no), '[]'::jsonb)
              from public.purchase_order_lines l where l.po_id = o.id)
    )
    || case when p_cost_view then jsonb_build_object(
         'prices_include_vat', o.prices_include_vat,
         'subtotal_net', o.subtotal_net::text,
         'discount_total', o.discount_total::text,
         'vat_total', o.vat_total::text,
         'grand_total', o.grand_total::text)
       else '{}'::jsonb end);
$$;

-- Records a transition: history row plus the status change itself.
create or replace function app.purchase_record_event(p_org_id uuid, p_po_id uuid, p_event text, p_from text, p_to text, p_note text)
returns void
language sql
set search_path = ''
as $$
  insert into public.purchase_order_events (po_id, org_id, event, from_status, to_status, note, actor_id)
  values (p_po_id, p_org_id, p_event, p_from, p_to, p_note, auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- 7. Common checks for a purchase order action
-- -----------------------------------------------------------------------------
create or replace function app.purchase_check_access(p_org_id uuid, p_permission text, p_branch_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not app.is_org_member(p_org_id) then
    perform app.fail('forbidden', 'membership');
  end if;
  if not app.has_permission(p_org_id, p_permission) then
    perform app.fail('forbidden', p_permission);
  end if;
  if not app.can_access_branch(p_branch_id) then
    perform app.fail('forbidden', 'branch');
  end if;
end;
$$;

-- Supplier and warehouse must belong to the organisation; the warehouse must be an active warehouse of the branch.
create or replace function app.purchase_check_refs(p_org_id uuid, p_supplier uuid, p_branch uuid, p_warehouse uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from public.suppliers s where s.id = p_supplier and s.org_id = p_org_id) then
    perform app.fail('supplier.not_found');
  end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier and s.org_id = p_org_id and s.is_active) then
    perform app.fail('supplier.inactive');
  end if;
  if not exists (select 1 from public.warehouses w where w.id = p_warehouse and w.branch_id = p_branch and w.org_id = p_org_id) then
    perform app.fail('warehouse.not_found');
  end if;
  if not exists (select 1 from public.warehouses w where w.id = p_warehouse and w.is_active) then
    perform app.fail('warehouse.inactive');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. create_purchase_order (draft). Idempotent by client_id.
-- -----------------------------------------------------------------------------
create or replace function public.create_purchase_order(
  p_org_id          uuid,
  p_client_id       uuid,
  p_supplier_id     uuid,
  p_branch_id       uuid,
  p_warehouse_id    uuid,
  p_expected_delivery date,
  p_delivery_notes  text,
  p_lines           jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      public.organizations%rowtype;
  v_existing public.purchase_orders%rowtype;
  v_built    jsonb;
  v_next     bigint;
  v_po       public.purchase_orders%rowtype;
  v_notes    text := nullif(btrim(coalesce(p_delivery_notes, '')), '');
  v_sub      numeric := 0;
  v_disc     numeric := 0;
  v_vat      numeric := 0;
  v_gross    numeric := 0;
  v_line     jsonb;
begin
  if p_client_id is null then perform app.fail('validation', 'client_id'); end if;
  perform app.purchase_check_access(p_org_id, 'purchase.create', p_branch_id);

  -- Replay: the same request returns the order it created.
  select * into v_existing from public.purchase_orders where org_id = p_org_id and client_id = p_client_id;
  if found then
    if not app.can_access_branch(v_existing.branch_id) then perform app.fail('forbidden', 'branch'); end if;
    return jsonb_build_object('status', 'duplicate', 'id', v_existing.id, 'po_number', v_existing.po_number, 'row_version', v_existing.row_version);
  end if;

  perform app.purchase_check_refs(p_org_id, p_supplier_id, p_branch_id, p_warehouse_id);
  if v_notes is not null and length(v_notes) > 500 then perform app.fail('validation', 'delivery_notes'); end if;

  select * into v_org from public.organizations where id = p_org_id;
  v_built := app.purchase_build_lines(p_org_id, p_lines, v_org.prices_include_vat, v_org.standard_vat_rate);

  for v_line in select value from jsonb_array_elements(v_built) loop
    v_sub   := v_sub + (v_line->>'net_amount')::numeric;
    v_disc  := v_disc + (v_line->>'discount_amount')::numeric;
    v_vat   := v_vat + (v_line->>'vat_amount')::numeric;
    v_gross := v_gross + (v_line->>'gross_amount')::numeric;
  end loop;

  insert into public.purchase_order_counters (org_id, last_value) values (p_org_id, 1)
  on conflict (org_id) do update set last_value = public.purchase_order_counters.last_value + 1
  returning last_value into v_next;

  insert into public.purchase_orders (
    org_id, po_number, client_id, supplier_id, branch_id, warehouse_id, status, prices_include_vat, vat_rate,
    expected_delivery_date, delivery_notes, subtotal_net, discount_total, vat_total, grand_total, created_by)
  values (
    p_org_id, 'PO-' || lpad(v_next::text, 6, '0'), p_client_id, p_supplier_id, p_branch_id, p_warehouse_id, 'draft',
    v_org.prices_include_vat, v_org.standard_vat_rate, p_expected_delivery, v_notes, v_sub, v_disc, v_vat, v_gross, auth.uid())
  returning * into v_po;

  insert into public.purchase_order_lines (
    po_id, org_id, line_no, product_id, unit_id, sku, name_en, name_ar, name_bn, tax_category,
    entered_quantity, factor, base_quantity, unit_cost, base_unit_cost, discount_type, discount_value, discount_amount,
    net_amount, vat_rate, vat_amount, gross_amount)
  select v_po.id, p_org_id, (x->>'line_no')::integer, (x->>'product_id')::uuid, (x->>'unit_id')::uuid, x->>'sku',
         x->>'name_en', x->>'name_ar', x->>'name_bn', x->>'tax_category',
         (x->>'entered_quantity')::numeric, (x->>'factor')::numeric, (x->>'base_quantity')::numeric,
         (x->>'unit_cost')::numeric, (x->>'base_unit_cost')::numeric, x->>'discount_type',
         nullif(x->>'discount_value', '')::numeric, (x->>'discount_amount')::numeric,
         (x->>'net_amount')::numeric, (x->>'vat_rate')::numeric, (x->>'vat_amount')::numeric, (x->>'gross_amount')::numeric
  from jsonb_array_elements(v_built) as x;

  perform app.purchase_record_event(p_org_id, v_po.id, 'created', null, 'draft', null);

  return jsonb_build_object('status', 'created', 'id', v_po.id, 'po_number', v_po.po_number, 'row_version', v_po.row_version);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. update_purchase_order (drafts only). Header keys sent are changed; lines are replaced when sent.
-- -----------------------------------------------------------------------------
create or replace function public.update_purchase_order(
  p_org_id           uuid,
  p_po_id            uuid,
  p_expected_version bigint,
  p_header           jsonb,
  p_lines            jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po    public.purchase_orders%rowtype;
  v_org   public.organizations%rowtype;
  v_supplier uuid;
  v_branch   uuid;
  v_wh       uuid;
  v_date     date;
  v_notes    text;
  v_built    jsonb;
  v_sub      numeric := 0;
  v_disc     numeric := 0;
  v_vat      numeric := 0;
  v_gross    numeric := 0;
  v_line     jsonb;
  v_row      public.purchase_orders%rowtype;
begin
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = p_org_id for update;
  if not found then perform app.fail('purchase.not_found'); end if;
  perform app.purchase_check_access(p_org_id, 'purchase.create', v_po.branch_id);
  if v_po.created_by is distinct from auth.uid() and not app.has_permission(p_org_id, 'purchase.approve') then
    perform app.fail('forbidden', 'purchase.create');
  end if;
  if v_po.status <> 'draft' then perform app.fail('purchase.not_draft'); end if;
  if p_expected_version is null or p_expected_version <> v_po.row_version then
    perform app.fail('concurrency_conflict', v_po.row_version::text);
  end if;
  if p_header is null or jsonb_typeof(p_header) <> 'object' then perform app.fail('validation', 'header'); end if;
  if p_header ? 'po_number' or p_header ? 'status' or p_header ? 'org_id' then perform app.fail('validation', 'header'); end if;

  -- Header: keys not sent keep their values.
  v_supplier := coalesce(app.uuid_or_fail(p_header->>'supplier_id', 'supplier_id'), v_po.supplier_id);
  v_branch   := v_po.branch_id;
  v_wh       := coalesce(app.uuid_or_fail(p_header->>'warehouse_id', 'warehouse_id'), v_po.warehouse_id);
  v_date     := case when p_header ? 'expected_delivery_date' then
                       (case when nullif(btrim(coalesce(p_header->>'expected_delivery_date', '')), '') is null then null
                             when btrim(p_header->>'expected_delivery_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then btrim(p_header->>'expected_delivery_date')::date
                             else null end)
                     else v_po.expected_delivery_date end;
  if p_header ? 'expected_delivery_date' and nullif(btrim(coalesce(p_header->>'expected_delivery_date', '')), '') is not null and v_date is null then
    perform app.fail('validation', 'expected_delivery_date');
  end if;
  v_notes    := case when p_header ? 'delivery_notes' then nullif(btrim(coalesce(p_header->>'delivery_notes', '')), '')
                     else v_po.delivery_notes end;
  if v_notes is not null and length(v_notes) > 500 then perform app.fail('validation', 'delivery_notes'); end if;
  perform app.purchase_check_refs(p_org_id, v_supplier, v_branch, v_wh);

  select * into v_org from public.organizations where id = p_org_id;
  if p_lines is not null then
    v_built := app.purchase_build_lines(p_org_id, p_lines, v_po.prices_include_vat, v_po.vat_rate);
  else
    -- Lines unchanged: totals are recalculated from the stored lines.
    select coalesce(jsonb_agg(jsonb_build_object(
      'net_amount', l.net_amount::text, 'discount_amount', l.discount_amount::text,
      'vat_amount', l.vat_amount::text, 'gross_amount', l.gross_amount::text)), '[]'::jsonb)
    into v_built from public.purchase_order_lines l where l.po_id = v_po.id;
  end if;
  for v_line in select value from jsonb_array_elements(v_built) loop
    v_sub   := v_sub + (v_line->>'net_amount')::numeric;
    v_disc  := v_disc + (v_line->>'discount_amount')::numeric;
    v_vat   := v_vat + (v_line->>'vat_amount')::numeric;
    v_gross := v_gross + (v_line->>'gross_amount')::numeric;
  end loop;

  update public.purchase_orders set
    supplier_id = v_supplier, warehouse_id = v_wh, expected_delivery_date = v_date, delivery_notes = v_notes,
    subtotal_net = v_sub, discount_total = v_disc, vat_total = v_vat, grand_total = v_gross
  where id = v_po.id
  returning * into v_row;

  if p_lines is not null then
    delete from public.purchase_order_lines where po_id = v_po.id;
    insert into public.purchase_order_lines (
      po_id, org_id, line_no, product_id, unit_id, sku, name_en, name_ar, name_bn, tax_category,
      entered_quantity, factor, base_quantity, unit_cost, base_unit_cost, discount_type, discount_value, discount_amount,
      net_amount, vat_rate, vat_amount, gross_amount)
    select v_po.id, p_org_id, (x->>'line_no')::integer, (x->>'product_id')::uuid, (x->>'unit_id')::uuid, x->>'sku',
           x->>'name_en', x->>'name_ar', x->>'name_bn', x->>'tax_category',
           (x->>'entered_quantity')::numeric, (x->>'factor')::numeric, (x->>'base_quantity')::numeric,
           (x->>'unit_cost')::numeric, (x->>'base_unit_cost')::numeric, x->>'discount_type',
           nullif(x->>'discount_value', '')::numeric, (x->>'discount_amount')::numeric,
           (x->>'net_amount')::numeric, (x->>'vat_rate')::numeric, (x->>'vat_amount')::numeric, (x->>'gross_amount')::numeric
    from jsonb_array_elements(v_built) as x;
  end if;

  perform app.purchase_record_event(p_org_id, v_po.id, 'updated', 'draft', 'draft', null);
  return jsonb_build_object('status', 'updated', 'id', v_row.id, 'po_number', v_row.po_number, 'row_version', v_row.row_version);
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Transitions: submit, approve, cancel. Each takes the order's row lock and checks its version.
-- -----------------------------------------------------------------------------
create or replace function public.submit_purchase_order(p_org_id uuid, p_po_id uuid, p_expected_version bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po  public.purchase_orders%rowtype;
  v_row public.purchase_orders%rowtype;
begin
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = p_org_id for update;
  if not found then perform app.fail('purchase.not_found'); end if;
  perform app.purchase_check_access(p_org_id, 'purchase.create', v_po.branch_id);
  if v_po.status = 'submitted' then
    return jsonb_build_object('status', 'duplicate', 'id', v_po.id, 'po_number', v_po.po_number, 'row_version', v_po.row_version);
  end if;
  if v_po.status <> 'draft' then perform app.fail('purchase.bad_transition'); end if;
  if p_expected_version is null or p_expected_version <> v_po.row_version then
    perform app.fail('concurrency_conflict', v_po.row_version::text);
  end if;
  perform app.purchase_check_refs(p_org_id, v_po.supplier_id, v_po.branch_id, v_po.warehouse_id);
  if not exists (select 1 from public.purchase_order_lines where po_id = v_po.id) then perform app.fail('validation', 'lines'); end if;

  update public.purchase_orders set status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
  where id = v_po.id returning * into v_row;
  perform app.purchase_record_event(p_org_id, v_po.id, 'submitted', 'draft', 'submitted', null);
  return jsonb_build_object('status', 'submitted', 'id', v_row.id, 'po_number', v_row.po_number, 'row_version', v_row.row_version);
end;
$$;

create or replace function public.approve_purchase_order(p_org_id uuid, p_po_id uuid, p_expected_version bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po  public.purchase_orders%rowtype;
  v_row public.purchase_orders%rowtype;
begin
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = p_org_id for update;
  if not found then perform app.fail('purchase.not_found'); end if;
  perform app.purchase_check_access(p_org_id, 'purchase.approve', v_po.branch_id);
  if v_po.status = 'approved' then
    return jsonb_build_object('status', 'duplicate', 'id', v_po.id, 'po_number', v_po.po_number, 'row_version', v_po.row_version);
  end if;
  if v_po.status <> 'submitted' then perform app.fail('purchase.bad_transition'); end if;
  -- Separation of duties: the creator never approves their own order.
  if v_po.created_by is not distinct from auth.uid() then perform app.fail('purchase.self_approval'); end if;
  if p_expected_version is null or p_expected_version <> v_po.row_version then
    perform app.fail('concurrency_conflict', v_po.row_version::text);
  end if;
  perform app.purchase_check_refs(p_org_id, v_po.supplier_id, v_po.branch_id, v_po.warehouse_id);

  update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = v_po.id returning * into v_row;
  perform app.purchase_record_event(p_org_id, v_po.id, 'approved', 'submitted', 'approved', null);
  return jsonb_build_object('status', 'approved', 'id', v_row.id, 'po_number', v_row.po_number, 'row_version', v_row.row_version);
end;
$$;

create or replace function public.cancel_purchase_order(p_org_id uuid, p_po_id uuid, p_expected_version bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po     public.purchase_orders%rowtype;
  v_row    public.purchase_orders%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = p_org_id for update;
  if not found then perform app.fail('purchase.not_found'); end if;
  perform app.purchase_check_access(p_org_id, 'purchase.void', v_po.branch_id);
  if v_po.status = 'cancelled' then
    return jsonb_build_object('status', 'duplicate', 'id', v_po.id, 'po_number', v_po.po_number, 'row_version', v_po.row_version);
  end if;
  if v_po.status not in ('draft', 'submitted', 'approved') then perform app.fail('purchase.bad_transition'); end if;
  -- Goods already received cannot be cancelled with the order; they are returned through a purchase return (Phase 4E).
  if exists (select 1 from public.purchase_order_lines l where l.po_id = v_po.id and l.received_base_quantity > 0) then
    perform app.fail('purchase.has_receipts');
  end if;
  if length(v_reason) < 5 or length(v_reason) > 500 then perform app.fail('purchase.reason_required'); end if;
  if p_expected_version is null or p_expected_version <> v_po.row_version then
    perform app.fail('concurrency_conflict', v_po.row_version::text);
  end if;

  update public.purchase_orders set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = v_reason
  where id = v_po.id returning * into v_row;
  perform app.purchase_record_event(p_org_id, v_po.id, 'cancelled', v_po.status, 'cancelled', v_reason);
  return jsonb_build_object('status', 'cancelled', 'id', v_row.id, 'po_number', v_row.po_number, 'row_version', v_row.row_version);
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Reads: list and get. Branch access is applied to every row; costs only with purchase.cost_view.
-- -----------------------------------------------------------------------------
create or replace function public.list_purchase_orders(
  p_org_id      uuid,
  p_status      text default 'all',
  p_supplier_id uuid default null,
  p_branch_id   uuid default null,
  p_from        date default null,
  p_to          date default null,
  p_limit       integer default 50,
  p_offset      integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost  boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off   integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  if not app.is_org_member(p_org_id) then perform app.fail('forbidden', 'membership'); end if;
  if not app.has_permission(p_org_id, 'purchase.read') then perform app.fail('forbidden', 'purchase.read'); end if;
  if coalesce(p_status, 'all') not in ('all', 'draft', 'submitted', 'approved', 'partially_received', 'fully_received', 'cancelled') then
    perform app.fail('validation', 'status');
  end if;
  v_cost := app.has_permission(p_org_id, 'purchase.cost_view');

  select count(*) into v_total from public.purchase_orders o
  where o.org_id = p_org_id
    and app.can_access_branch(o.branch_id)
    and (coalesce(p_status, 'all') = 'all' or o.status = p_status)
    and (p_supplier_id is null or o.supplier_id = p_supplier_id)
    and (p_branch_id is null or o.branch_id = p_branch_id)
    and (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Asia/Riyadh'))
    and (p_to is null or o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Riyadh'));

  select coalesce(jsonb_agg(page.j), '[]'::jsonb) into v_items from (
    select app.purchase_order_json(o, v_cost) as j
    from public.purchase_orders o
    where o.org_id = p_org_id
      and app.can_access_branch(o.branch_id)
      and (coalesce(p_status, 'all') = 'all' or o.status = p_status)
      and (p_supplier_id is null or o.supplier_id = p_supplier_id)
      and (p_branch_id is null or o.branch_id = p_branch_id)
      and (p_from is null or o.created_at >= (p_from::timestamp at time zone 'Asia/Riyadh'))
      and (p_to is null or o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Riyadh'))
    order by o.created_at desc, o.id
    limit v_limit offset v_off
  ) page;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_off);
end;
$$;

create or replace function public.get_purchase_order(p_org_id uuid, p_po_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
begin
  if not app.is_org_member(p_org_id) then perform app.fail('forbidden', 'membership'); end if;
  if not app.has_permission(p_org_id, 'purchase.read') then perform app.fail('forbidden', 'purchase.read'); end if;
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = p_org_id;
  if not found then perform app.fail('purchase.not_found'); end if;
  if not app.can_access_branch(v_po.branch_id) then perform app.fail('forbidden', 'branch'); end if;
  return app.purchase_order_json(v_po, app.has_permission(p_org_id, 'purchase.cost_view'));
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Privileges (least privilege; see docs/security.md)
-- -----------------------------------------------------------------------------
revoke all on public.purchase_order_counters, public.purchase_orders, public.purchase_order_lines, public.purchase_order_events
  from public, anon, authenticated;

revoke all on function app.uuid_or_fail(text, text) from public, anon, authenticated;
revoke all on function app.purchase_build_lines(uuid, jsonb, boolean, numeric) from public, anon, authenticated;
revoke all on function app.purchase_order_json(public.purchase_orders, boolean) from public, anon, authenticated;
revoke all on function app.purchase_record_event(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function app.purchase_check_access(uuid, text, uuid) from public, anon, authenticated;
revoke all on function app.purchase_check_refs(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app.purchase_lines_draft_only() from public, anon, authenticated;
revoke all on function app.purchase_orders_no_delete() from public, anon, authenticated;
revoke all on function app.purchase_events_immutable() from public, anon, authenticated;

revoke all on function public.create_purchase_order(uuid, uuid, uuid, uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.create_purchase_order(uuid, uuid, uuid, uuid, uuid, date, text, jsonb) to authenticated;
revoke all on function public.update_purchase_order(uuid, uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.update_purchase_order(uuid, uuid, bigint, jsonb, jsonb) to authenticated;
revoke all on function public.submit_purchase_order(uuid, uuid, bigint) from public, anon;
grant execute on function public.submit_purchase_order(uuid, uuid, bigint) to authenticated;
revoke all on function public.approve_purchase_order(uuid, uuid, bigint) from public, anon;
grant execute on function public.approve_purchase_order(uuid, uuid, bigint) to authenticated;
revoke all on function public.cancel_purchase_order(uuid, uuid, bigint, text) from public, anon;
grant execute on function public.cancel_purchase_order(uuid, uuid, bigint, text) to authenticated;
revoke all on function public.list_purchase_orders(uuid, text, uuid, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.list_purchase_orders(uuid, text, uuid, uuid, date, date, integer, integer) to authenticated;
revoke all on function public.get_purchase_order(uuid, uuid) from public, anon;
grant execute on function public.get_purchase_order(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- Version marker
comment on table public.purchase_orders is 'Phase 4B purchase orders, migration 20261126000100.';
