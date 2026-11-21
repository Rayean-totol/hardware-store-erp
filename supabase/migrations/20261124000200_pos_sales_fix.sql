-- =============================================================================
-- POS/Sales forward fix: 20261124000200
-- =============================================================================
-- Why this file exists: the first version of 20261124000100_pos_sales.sql (merged) was later
-- edited in place by two open pull requests. An edited migration does not re-run on a database
-- that already applied it, so those changes would never reach live. This file carries the same
-- changes forward, as a new step. 20261124000100 is restored to its merged form.
--
-- Changes (all DDL on constraints and functions; no business row is read, updated or deleted):
--   1. sale_lines: the single-column unique on movement_client_id becomes unique (org_id, movement_client_id).
--      The old constraint is dropped only if it is exactly that single column. Adding the composite
--      key cannot fail on existing data: the old key was global, so it already implied it.
--   2. finalize_sale: serialises two submits of the same checkout (advisory lock) and refuses a replay
--      to someone who may not see the sale's branch.
--   3. cancel_sale: a repeated cancel of an already voided sale returns the stored state and reverses nothing.
--   4. app.sale_summary: no longer executable by the authenticated role directly (it is only called from
--      finalize_sale and cancel_sale, which run with definer rights).
--
-- Safe to run on each of these states (the file checks before it changes anything):
--   a) no POS objects yet: apply 20261124000100 first, then this file;
--   b) the merged 20261124000100 applied: apply this file;
--   c) the in-place edited version applied by hand: this file is a no-op for the constraint
--      and replaces the functions with the same text.
--
-- Prerequisite: migrations 20261120000100 to 20261124000100 applied. The preflight block stops
-- with a clear message if they are not.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Preflight (read-only). Stops before any change if a prerequisite is missing.
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing text[] := '{}';
  v_dupes   integer;
begin
  if to_regclass('public.sales') is null then v_missing := array_append(v_missing, 'table public.sales'); end if;
  if to_regclass('public.sale_lines') is null then v_missing := array_append(v_missing, 'table public.sale_lines'); end if;
  if to_regclass('public.sale_payments') is null then v_missing := array_append(v_missing, 'table public.sale_payments'); end if;
  if to_regclass('public.customers') is null then v_missing := array_append(v_missing, 'table public.customers'); end if;
  if to_regclass('public.invoice_counters') is null then v_missing := array_append(v_missing, 'table public.invoice_counters'); end if;
  if to_regprocedure('app.sale_summary(uuid,text)') is null then v_missing := array_append(v_missing, 'function app.sale_summary'); end if;
  if to_regprocedure('public.finalize_sale(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb)') is null then v_missing := array_append(v_missing, 'function public.finalize_sale'); end if;
  if to_regprocedure('public.cancel_sale(uuid,uuid,text,text)') is null then v_missing := array_append(v_missing, 'function public.cancel_sale'); end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'POS v2 prerequisites are missing: %. Apply 20261120000100 to 20261124000100 first. No change was made.',
      array_to_string(v_missing, ', ')
      using errcode = 'P0001', hint = 'No POS object was changed.';
  end if;

  -- The composite key must not fail: refuse to continue if the data already breaks it (it cannot, but check).
  select count(*) into v_dupes from (
    select org_id, movement_client_id from public.sale_lines
    group by org_id, movement_client_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'sale_lines has % duplicate (org_id, movement_client_id) rows. No change was made.', v_dupes
      using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. sale_lines: unique key per organisation (replaces the global single-column key)
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.sale_lines'::regclass
      and c.contype = 'u'
      and array_length(c.conkey, 1) = 1
      and a.attname = 'movement_client_id'
  loop
    execute format('alter table public.sale_lines drop constraint %I', r.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sale_lines'::regclass and conname = 'sale_lines_org_movement_client_key'
  ) then
    alter table public.sale_lines
      add constraint sale_lines_org_movement_client_key unique (org_id, movement_client_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Functions (text identical to the in-place edited version; create or replace is idempotent)
-- -----------------------------------------------------------------------------
create or replace function app.sale_summary(p_sale_id uuid, p_status text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'status', p_status,
    'sale_id', s.id,
    'invoice_number', s.invoice_number,
    'sale_status', s.status,
    'net_total', s.net_total::text,
    'discount_total', s.discount_total::text,
    'vat_total', s.vat_total::text,
    'gross_total', s.gross_total::text,
    'paid_total', s.paid_total::text,
    'change_given', s.change_given::text,
    'balance_due', s.balance_due::text)
  from public.sales s
  where s.id = p_sale_id;
$$;

-- -----------------------------------------------------------------------------
-- 7. finalize_sale: one atomic checkout
-- -----------------------------------------------------------------------------
-- p_lines    : [{product_id, unit_id, quantity, unit_price?, discount_type?, discount_value?}]
-- p_payments : [{method: cash|card|transfer, amount, tendered?, reference?}]
--              Any remaining balance becomes a credit payment (needs sales.credit and a customer).
-- Returns the sale summary. A replay with the same p_client_id returns status 'duplicate'.
create or replace function public.finalize_sale(
  p_org_id      uuid,
  p_client_id   uuid,
  p_branch_id   uuid,
  p_warehouse_id uuid,
  p_device_id   text,
  p_customer_id uuid,
  p_note        text,
  p_lines       jsonb,
  p_payments    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale        public.sales%rowtype;
  v_existing    public.sales%rowtype;
  v_wh          public.warehouses%rowtype;
  v_org         public.organizations%rowtype;
  v_cust        public.customers%rowtype;
  v_product     public.products%rowtype;
  v_pu          public.product_units%rowtype;
  v_allow_frac  boolean;
  v_branch_code text;
  v_line        jsonb;
  v_pay         jsonb;
  v_stock       record;
  v_idx         integer := 0;
  v_qty         numeric;
  v_base        numeric;
  v_list        numeric;
  v_price       numeric;
  v_ext         numeric;
  v_disc_type   text;
  v_disc_val    numeric;
  v_disc        numeric;
  v_after       numeric;
  v_rate        numeric;
  v_net         numeric;
  v_vat         numeric;
  v_gross       numeric;
  v_net_t       numeric := 0;
  v_disc_t      numeric := 0;
  v_vat_t       numeric := 0;
  v_gross_t     numeric := 0;
  v_method      text;
  v_amt         numeric;
  v_tend        numeric;
  v_ref         text;
  v_paid        numeric := 0;
  v_change      numeric := 0;
  v_credit      numeric;
  v_year        integer;
  v_count       bigint;
  v_invoice     text;
  v_avail       numeric;
  v_moves       jsonb;
  v_results     jsonb;
  v_r           jsonb;
  v_built       jsonb := '[]'::jsonb;
begin
  if not app.is_org_member(p_org_id) then
    perform app.fail('forbidden', 'membership');
  end if;
  if p_client_id is null then
    perform app.fail('validation', 'client_id');
  end if;
  if not app.has_permission(p_org_id, 'sales.create') then
    perform app.fail('forbidden', 'sales.create');
  end if;
  if not app.can_access_branch(p_branch_id) then
    perform app.fail('forbidden', 'branch');
  end if;

  -- Two submits of the same checkout run one after the other: the second waits here, then sees the first sale.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':sale:' || p_client_id::text, 0));

  -- Replay of a request that already succeeded: return the stored sale (only to someone who may see its branch).
  select * into v_existing from public.sales where org_id = p_org_id and client_id = p_client_id;
  if found then
    if not app.can_access_branch(v_existing.branch_id) then
      perform app.fail('forbidden', 'branch');
    end if;
    return app.sale_summary(v_existing.id, 'duplicate');
  end if;

  select * into v_wh from public.warehouses where id = p_warehouse_id and branch_id = p_branch_id and org_id = p_org_id;
  if not found then
    perform app.fail('warehouse.not_found');
  end if;
  if not v_wh.is_active then
    perform app.fail('warehouse.inactive');
  end if;
  select code into v_branch_code from public.branches where id = p_branch_id;

  select * into v_org from public.organizations where id = p_org_id;

  if p_customer_id is not null then
    select * into v_cust from public.customers where id = p_customer_id and org_id = p_org_id and is_active;
    if not found then
      perform app.fail('customer.not_found');
    end if;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform app.fail('validation', 'lines');
  end if;
  if jsonb_array_length(p_lines) > 200 then
    perform app.fail('validation', 'too_many_lines');
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' then
    perform app.fail('validation', 'payments');
  end if;
  if p_note is not null and length(p_note) > 500 then
    perform app.fail('validation', 'note');
  end if;

  -- Invoice number: atomic counter per branch and fiscal year (row lock serialises concurrent checkouts).
  v_year := extract(year from (now() at time zone 'Asia/Riyadh'))::integer;
  insert into public.invoice_counters (org_id, branch_id, fiscal_year, last_value)
  values (p_org_id, p_branch_id, v_year, 1)
  on conflict (org_id, branch_id, fiscal_year)
  do update set last_value = public.invoice_counters.last_value + 1
  returning last_value into v_count;
  v_invoice := 'INV-' || v_branch_code || '-' || v_year::text || '-' || lpad(v_count::text, 6, '0');

  insert into public.sales (
    org_id, branch_id, warehouse_id, client_id, invoice_number, fiscal_year, customer_id,
    prices_include_vat, note, cashier_id, device_id)
  values (
    p_org_id, p_branch_id, p_warehouse_id, p_client_id, v_invoice, v_year, p_customer_id,
    v_org.prices_include_vat, nullif(btrim(p_note), ''), auth.uid(), nullif(p_device_id, ''))
  returning * into v_sale;

  -- Lines: validate, price, discount and tax each line on the server.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;

    select * into v_product from public.products
    where id = nullif(v_line->>'product_id', '')::uuid and org_id = p_org_id;
    if not found then
      perform app.fail('product.not_found');
    end if;
    if v_product.product_type <> 'stock' then
      perform app.fail('product.not_stock');
    end if;
    if v_product.archived_at is not null then
      perform app.fail('product.archived');
    end if;

    select * into v_pu from public.product_units
    where product_id = v_product.id and unit_id = nullif(v_line->>'unit_id', '')::uuid;
    if not found or not v_pu.is_sale_unit then
      perform app.fail('unit.not_sale_unit', v_product.sku);
    end if;
    if v_pu.sale_price is null then
      perform app.fail('price.missing', v_product.sku);
    end if;

    v_qty := nullif(v_line->>'quantity', '')::numeric;
    if v_qty is null or v_qty <= 0 then
      perform app.fail('quantity.invalid');
    end if;
    v_qty := trim_scale(v_qty);
    if scale(v_qty) > 6 then
      perform app.fail('quantity.precision');
    end if;
    v_base := trim_scale(v_qty * v_pu.factor);
    if scale(v_base) > 6 then
      perform app.fail('quantity.precision');
    end if;
    select u.allow_fraction into v_allow_frac from public.units u where u.id = v_product.base_unit_id;
    if not v_allow_frac and v_base <> trunc(v_base) then
      perform app.fail('quantity.fraction_not_allowed', v_product.sku);
    end if;

    v_list := v_pu.sale_price;
    v_price := coalesce(nullif(v_line->>'unit_price', '')::numeric, v_list);
    if v_price < 0 then
      perform app.fail('price.negative');
    end if;
    if v_price <> v_list and not app.has_permission(p_org_id, 'sales.price_override') then
      perform app.fail('forbidden', 'sales.price_override');
    end if;

    v_ext := round(v_qty * v_price, 2);

    v_disc_type := nullif(v_line->>'discount_type', '');
    v_disc_val := coalesce(nullif(v_line->>'discount_value', '')::numeric, 0);
    if v_disc_type is null or v_disc_val = 0 then
      v_disc := 0;
      v_disc_type := null;
    else
      if not app.has_permission(p_org_id, 'sales.discount') then
        perform app.fail('forbidden', 'sales.discount');
      end if;
      if v_disc_type = 'percent' then
        if v_disc_val < 0 or v_disc_val > 100 then
          perform app.fail('discount.invalid');
        end if;
        v_disc := round(v_ext * v_disc_val / 100, 2);
      elsif v_disc_type = 'fixed' then
        if v_disc_val < 0 or v_disc_val > v_ext then
          perform app.fail('discount.invalid');
        end if;
        v_disc := round(v_disc_val, 2);
      else
        perform app.fail('discount.invalid');
      end if;
    end if;

    -- Discount first, then VAT on the discounted amount.
    v_after := v_ext - v_disc;
    v_rate := case when v_product.tax_category = 'S' then v_org.standard_vat_rate else 0 end;
    if v_org.prices_include_vat then
      v_gross := v_after;
      v_net := round(v_gross / (1 + v_rate), 2);
      v_vat := v_gross - v_net;
    else
      v_net := v_after;
      v_vat := round(v_net * v_rate, 2);
      v_gross := v_net + v_vat;
    end if;

    -- Buffered in memory; written after the stock balances are locked.
    v_built := v_built || jsonb_build_array(jsonb_build_object(
      'idx', v_idx, 'product_id', v_product.id, 'unit_id', v_pu.unit_id, 'sku', v_product.sku,
      'name_en', v_product.name_en, 'name_ar', v_product.name_ar, 'name_bn', v_product.name_bn,
      'tax_category', v_product.tax_category, 'qty', v_qty, 'factor', v_pu.factor, 'base', v_base,
      'list_price', v_list, 'unit_price', v_price, 'overridden', v_price <> v_list,
      'discount_type', v_disc_type, 'discount_value', case when v_disc_type is null then null else v_disc_val end,
      'discount', v_disc, 'net', v_net, 'rate', v_rate, 'vat', v_vat, 'gross', v_gross,
      'movement_client_id', md5(p_client_id::text || ':sale:' || v_idx::text)));

    v_net_t := v_net_t + v_net;
    v_disc_t := v_disc_t + v_disc;
    v_vat_t := v_vat_t + v_vat;
    v_gross_t := v_gross_t + v_gross;
  end loop;

  -- Stock: lock the balances of every product sold (in product order to avoid deadlocks),
  -- then check the total requested quantity per product.
  for v_stock in
    select x.product_id, x.sku, sum(x.base) as need
    from jsonb_to_recordset(v_built) as x(product_id uuid, sku text, base numeric)
    group by x.product_id, x.sku
    order by x.product_id
  loop
    select sl.quantity into v_avail from public.stock_levels sl
    where sl.warehouse_id = p_warehouse_id and sl.product_id = v_stock.product_id
    for update;
    if coalesce(v_avail, 0) < v_stock.need then
      perform app.fail('stock.insufficient', v_stock.sku);
    end if;
  end loop;

  -- Lines are written now that the stock is locked. Cost = locked average cost per entered unit.
  insert into public.sale_lines (
    sale_id, org_id, line_no, product_id, unit_id, sku, name_en, name_ar, name_bn, tax_category,
    entered_quantity, factor, base_quantity, list_price, unit_price, price_overridden,
    discount_type, discount_value, discount_amount, net_amount, vat_rate, vat_amount, gross_amount,
    unit_cost, movement_client_id)
  select v_sale.id, p_org_id, x.idx, x.product_id, x.unit_id, x.sku, x.name_en, x.name_ar, x.name_bn,
    x.tax_category, x.qty, x.factor, x.base, x.list_price, x.unit_price, x.overridden,
    x.discount_type, x.discount_value, x.discount, x.net, x.rate, x.vat, x.gross,
    round(coalesce((select sl.average_cost from public.stock_levels sl
                    where sl.warehouse_id = p_warehouse_id and sl.product_id = x.product_id), 0) * x.factor, 4),
    x.movement_client_id
  from jsonb_to_recordset(v_built) as x(
    idx integer, product_id uuid, unit_id uuid, sku text, name_en text, name_ar text, name_bn text,
    tax_category text, qty numeric, factor numeric, base numeric, list_price numeric, unit_price numeric,
    overridden boolean, discount_type text, discount_value numeric, discount numeric,
    net numeric, rate numeric, vat numeric, gross numeric, movement_client_id uuid);

  -- Payments: cash may be tendered above the amount (change). Overpayment by any other method is refused.
  for v_pay in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_method := v_pay->>'method';
    if v_method not in ('cash', 'card', 'transfer') then
      perform app.fail('payment.method');
    end if;
    v_amt := nullif(v_pay->>'amount', '')::numeric;
    if v_amt is null or v_amt <= 0 or scale(v_amt) > 2 then
      perform app.fail('payment.amount');
    end if;
    v_tend := coalesce(nullif(v_pay->>'tendered', '')::numeric, v_amt);
    if v_tend < v_amt or scale(v_tend) > 2 then
      perform app.fail('payment.amount');
    end if;
    if v_method <> 'cash' and v_tend <> v_amt then
      perform app.fail('payment.tendered_not_cash');
    end if;
    v_ref := nullif(btrim(v_pay->>'reference'), '');
    insert into public.sale_payments (sale_id, org_id, method, amount, tendered, reference, recorded_by)
    values (v_sale.id, p_org_id, v_method, v_amt, v_tend, v_ref, auth.uid());
    v_paid := v_paid + v_amt;
    v_change := v_change + (v_tend - v_amt);
  end loop;

  if v_paid > v_gross_t then
    perform app.fail('payment.exceeds_total');
  end if;

  v_credit := v_gross_t - v_paid;
  if v_credit > 0 then
    if p_customer_id is null then
      perform app.fail('payment.insufficient');
    end if;
    if not app.has_permission(p_org_id, 'sales.credit') or not v_cust.credit_allowed then
      perform app.fail('forbidden', 'sales.credit');
    end if;
    insert into public.sale_payments (sale_id, org_id, method, amount, tendered, reference, recorded_by)
    values (v_sale.id, p_org_id, 'credit', v_credit, v_credit, null, auth.uid());
  end if;

  update public.sales set
    net_total = v_net_t, discount_total = v_disc_t, vat_total = v_vat_t, gross_total = v_gross_t,
    paid_total = v_paid, change_given = v_change, balance_due = greatest(v_credit, 0)
  where id = v_sale.id;

  -- Stock deduction through the single stock writer (idempotent per line).
  select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', l.movement_client_id,
      'warehouse_id', p_warehouse_id,
      'product_id', l.product_id,
      'movement_type', 'stock_out',
      'unit_id', l.unit_id,
      'quantity', l.entered_quantity::text,
      'reference', v_invoice,
      'occurred_at', now()::text) order by l.line_no), '[]'::jsonb)
  into v_moves
  from public.sale_lines l
  where l.sale_id = v_sale.id;

  v_results := public.apply_stock_movements(p_org_id, p_device_id, v_moves);
  for v_r in select value from jsonb_array_elements(v_results) loop
    if v_r->>'status' = 'rejected' then
      perform app.fail(coalesce(v_r->>'code', 'stock.rejected'), v_r->>'message');
    end if;
  end loop;

  return app.sale_summary(v_sale.id, 'created');
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. cancel_sale: controlled reversal (no deletion). Stock returns at the recorded cost.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_sale(
  p_org_id    uuid,
  p_sale_id   uuid,
  p_reason    text,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale    public.sales%rowtype;
  v_moves   jsonb;
  v_results jsonb;
  v_r       jsonb;
  v_reason  text := left(btrim(coalesce(p_reason, '')), 500);
begin
  if not app.is_org_member(p_org_id) then
    perform app.fail('forbidden', 'membership');
  end if;
  if not app.has_permission(p_org_id, 'sales.void') then
    perform app.fail('forbidden', 'sales.void');
  end if;
  if v_reason = '' then
    perform app.fail('validation', 'reason');
  end if;

  select * into v_sale from public.sales where id = p_sale_id and org_id = p_org_id for update;
  if not found then
    perform app.fail('sale.not_found');
  end if;
  if not app.can_access_branch(v_sale.branch_id) then
    perform app.fail('forbidden', 'branch');
  end if;
  if v_sale.status = 'voided' then
    -- Already cancelled (double submit or retry): return the stored state, reverse nothing.
    return app.sale_summary(p_sale_id, 'duplicate');
  end if;
  if v_sale.status <> 'finalized' then
    perform app.fail('sale.not_finalized');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', md5(p_sale_id::text || ':void:' || l.line_no::text)::uuid,
      'warehouse_id', v_sale.warehouse_id,
      'product_id', l.product_id,
      'movement_type', 'stock_in',
      'unit_id', l.unit_id,
      'quantity', l.entered_quantity::text,
      'unit_cost', l.unit_cost::text,
      'reason_code', 'return',
      'reference', v_sale.invoice_number,
      'note', v_reason,
      'occurred_at', now()::text) order by l.line_no), '[]'::jsonb)
  into v_moves
  from public.sale_lines l
  where l.sale_id = p_sale_id;

  v_results := public.apply_stock_movements(p_org_id, p_device_id, v_moves);
  for v_r in select value from jsonb_array_elements(v_results) loop
    if v_r->>'status' = 'rejected' then
      perform app.fail(coalesce(v_r->>'code', 'stock.rejected'), v_r->>'message');
    end if;
  end loop;

  update public.sales set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_sale_id;

  return app.sale_summary(p_sale_id, 'voided');
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Privileges for the changed function
-- -----------------------------------------------------------------------------
revoke all on function app.sale_summary(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Version marker (read with: select obj_description('public.sales'::regclass);)
-- -----------------------------------------------------------------------------
comment on table public.sales is 'Phase 3 POS/Sales: 20261124000100 with forward fix 20261124000200 (per-organisation sale_lines key, branch-checked replays, idempotent cancel).';

notify pgrst, 'reload schema';
