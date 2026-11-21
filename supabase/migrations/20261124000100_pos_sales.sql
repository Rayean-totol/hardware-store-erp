-- =============================================================================
-- Phase 3: POS and sales (additive)
-- =============================================================================
-- Reuses products, product_units, units, warehouses, branches, organizations and the
-- stock ledger. Nothing existing is dropped or altered except:
--   * organizations gets standard_vat_rate (default 15%), a new column only.
--   * new permissions and role grants (rows added, existing rows untouched).
--
-- Writes happen ONLY inside finalize_sale() and cancel_sale() (security definer,
-- permission-checked). Tables grant SELECT to authenticated, guarded by RLS.
--
-- Money: numeric(18,2) per document amount, rounded half-up per line. Line VAT is
-- derived so that net + vat = gross. This must match packages/domain/src/vat.ts.
-- Timestamps: stored as timestamptz; business_date uses Asia/Riyadh.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissions and role grants
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  ('sales.read',            'sales', 'View sales invoices'),
  ('sales.create',          'sales', 'Ring up sales at the till (POS checkout)'),
  ('sales.discount',        'sales', 'Give line discounts (percent or fixed)'),
  ('sales.price_override',  'sales', 'Sell at a price different from the catalogue price'),
  ('sales.credit',          'sales', 'Sell on credit to a customer with credit allowed'),
  ('sales.void',            'sales', 'Cancel a finalized sale (stock is returned by a reversal movement)'),
  ('customers.manage',      'sales', 'Create and edit customers')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, v.code
from public.roles r
join (values
  ('owner',      'sales.read'), ('owner',      'sales.create'), ('owner',      'sales.discount'),
  ('owner',      'sales.price_override'), ('owner', 'sales.credit'), ('owner', 'sales.void'), ('owner', 'customers.manage'),
  ('admin',      'sales.read'), ('admin',      'sales.create'), ('admin',      'sales.discount'),
  ('admin',      'sales.price_override'), ('admin', 'sales.credit'), ('admin', 'sales.void'), ('admin', 'customers.manage'),
  ('manager',    'sales.read'), ('manager',    'sales.create'), ('manager',    'sales.discount'),
  ('manager',    'sales.price_override'), ('manager', 'sales.credit'), ('manager', 'sales.void'), ('manager', 'customers.manage'),
  ('cashier',    'sales.read'), ('cashier',    'sales.create'),
  ('accountant', 'sales.read'),
  ('auditor',    'sales.read')
) as v(role_code, code) on v.role_code = r.code and r.is_system
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Organization VAT rate (configurable; 15% Saudi standard rate by default)
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column if not exists standard_vat_rate numeric(5, 4) not null default 0.1500
  check (standard_vat_rate >= 0 and standard_vat_rate < 1);

-- -----------------------------------------------------------------------------
-- 3. Customers (minimal; the Customer Ledger module extends this later)
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete restrict,
  name          text not null check (length(btrim(name)) between 1 and 200),
  phone         text check (phone is null or length(phone) <= 30),
  -- Saudi VAT registration number of a business customer (format check only)
  vat_number    text check (vat_number is null or vat_number ~ '^3[0-9]{13}3$'),
  credit_allowed boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  row_version   bigint not null default 1,
  unique (id, org_id)
);
create index if not exists customers_org_name_idx on public.customers (org_id, name);

drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before insert or update on public.customers
  for each row execute function app.touch_row();
drop trigger if exists customers_audit on public.customers;
create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function app.audit_row_change('id');

alter table public.customers enable row level security;
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using (app.has_permission(org_id, 'sales.read') or app.has_permission(org_id, 'customers.manage'));
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check (app.has_permission(org_id, 'customers.manage'));
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using (app.has_permission(org_id, 'customers.manage'))
  with check (app.has_permission(org_id, 'customers.manage'));

-- -----------------------------------------------------------------------------
-- 4. Invoice counters: one row per organization, branch and fiscal year
-- -----------------------------------------------------------------------------
create table if not exists public.invoice_counters (
  org_id       uuid not null,
  branch_id    uuid not null references public.branches (id) on delete restrict,
  fiscal_year  integer not null check (fiscal_year between 2000 and 2999),
  last_value   bigint not null default 0 check (last_value >= 0),
  primary key (org_id, branch_id, fiscal_year)
);
alter table public.invoice_counters enable row level security;
-- No policies: only the security-definer functions below touch this table.

-- -----------------------------------------------------------------------------
-- 5. Sales (invoice header), lines and payments
-- -----------------------------------------------------------------------------
create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete restrict,
  branch_id       uuid not null,
  warehouse_id    uuid not null,
  -- Idempotency key generated on the device. A replayed checkout returns the same sale.
  client_id       uuid not null,
  invoice_number  text not null check (invoice_number ~ '^INV-[A-Z0-9_-]{1,16}-[0-9]{4}-[0-9]{6,}$'),
  fiscal_year     integer not null,
  customer_id     uuid,
  status          text not null default 'finalized' check (status in ('finalized', 'voided')),
  prices_include_vat boolean not null,
  net_total       numeric(18, 2) not null default 0 check (net_total >= 0),
  discount_total  numeric(18, 2) not null default 0 check (discount_total >= 0),
  vat_total       numeric(18, 2) not null default 0 check (vat_total >= 0),
  gross_total     numeric(18, 2) not null default 0 check (gross_total >= 0),
  paid_total      numeric(18, 2) not null default 0 check (paid_total >= 0),
  change_given    numeric(18, 2) not null default 0 check (change_given >= 0),
  balance_due     numeric(18, 2) not null default 0 check (balance_due >= 0),
  note            text check (note is null or length(note) <= 500),
  cashier_id      uuid not null,
  device_id       text check (device_id is null or length(device_id) <= 64),
  business_date   date not null default ((now() at time zone 'Asia/Riyadh')::date),
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text check (void_reason is null or length(void_reason) <= 500),
  unique (org_id, client_id),
  unique (org_id, invoice_number),
  unique (id, org_id),
  check ((status = 'voided') = (voided_at is not null)),
  foreign key (warehouse_id, branch_id, org_id) references public.warehouses (id, branch_id, org_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id)
);
create index if not exists sales_branch_date_idx on public.sales (branch_id, business_date desc, created_at desc);
create index if not exists sales_customer_idx on public.sales (customer_id) where customer_id is not null;

drop trigger if exists sales_audit on public.sales;
create trigger sales_audit after insert or update on public.sales
  for each row execute function app.audit_row_change('id');

create table if not exists public.sale_lines (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid not null,
  org_id              uuid not null,
  line_no             integer not null check (line_no > 0),
  product_id          uuid not null,
  unit_id             uuid not null references public.units (id),
  -- Snapshot of the product at the time of sale (later catalogue edits do not change history)
  sku                 text not null,
  name_en             text not null,
  name_ar             text,
  name_bn             text,
  tax_category        text not null check (tax_category in ('S', 'Z', 'E', 'O')),
  entered_quantity    numeric(18, 6) not null check (entered_quantity > 0),
  factor              numeric(18, 6) not null check (factor > 0),
  base_quantity       numeric(18, 6) not null check (base_quantity > 0),
  list_price          numeric(18, 4) not null check (list_price >= 0),
  -- Price per entered unit actually charged (net if prices are VAT-exclusive, gross if inclusive)
  unit_price          numeric(18, 4) not null check (unit_price >= 0),
  price_overridden    boolean not null default false,
  discount_type       text check (discount_type is null or discount_type in ('percent', 'fixed')),
  discount_value      numeric(18, 4) check (discount_value is null or discount_value >= 0),
  discount_amount     numeric(18, 2) not null default 0 check (discount_amount >= 0),
  net_amount          numeric(18, 2) not null check (net_amount >= 0),
  vat_rate            numeric(5, 4) not null check (vat_rate >= 0 and vat_rate < 1),
  vat_amount          numeric(18, 2) not null check (vat_amount >= 0),
  gross_amount        numeric(18, 2) not null check (gross_amount >= 0),
  -- Average cost per entered unit at the time of sale. Used to reverse stock on cancellation.
  unit_cost           numeric(18, 4) not null default 0 check (unit_cost >= 0),
  movement_client_id  uuid not null unique,
  unique (sale_id, line_no),
  check (net_amount + vat_amount = gross_amount),
  foreign key (sale_id, org_id) references public.sales (id, org_id) on delete restrict,
  foreign key (product_id, org_id) references public.products (id, org_id)
);
create index if not exists sale_lines_sale_idx on public.sale_lines (sale_id);
create index if not exists sale_lines_product_idx on public.sale_lines (org_id, product_id);

create table if not exists public.sale_payments (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null,
  org_id      uuid not null,
  method      text not null check (method in ('cash', 'card', 'transfer', 'credit')),
  -- Amount applied to the invoice and the amount tendered (cash may exceed the amount: change)
  amount      numeric(18, 2) not null check (amount > 0),
  tendered    numeric(18, 2) not null check (tendered >= amount),
  reference   text check (reference is null or length(reference) <= 64),
  recorded_at timestamptz not null default now(),
  recorded_by uuid,
  check (method <> 'credit' or tendered = amount),
  check (method = 'cash' or tendered = amount),
  foreign key (sale_id, org_id) references public.sales (id, org_id) on delete restrict
);
create index if not exists sale_payments_sale_idx on public.sale_payments (sale_id);

-- Immutable documents: no role may update or delete sale lines or payments.
create or replace function app.sale_documents_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'sale documents are append-only' using errcode = '42501', hint = 'sales.immutable';
end;
$$;
drop trigger if exists sale_lines_immutable on public.sale_lines;
create trigger sale_lines_immutable before update or delete on public.sale_lines
  for each row execute function app.sale_documents_immutable();
drop trigger if exists sale_payments_immutable on public.sale_payments;
create trigger sale_payments_immutable before update or delete on public.sale_payments
  for each row execute function app.sale_documents_immutable();
-- sale_lines.unit_cost is set when the line is inserted (from the locked stock balance),
-- so no update is ever needed.

-- Row-level security: read only, through the permission and branch model.
alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_payments enable row level security;

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales for select to authenticated
  using (app.has_permission(org_id, 'sales.read') and app.can_access_branch(branch_id));

drop policy if exists sale_lines_select on public.sale_lines;
create policy sale_lines_select on public.sale_lines for select to authenticated
  using (exists (select 1 from public.sales s
                 where s.id = sale_lines.sale_id and s.org_id = sale_lines.org_id
                   and app.has_permission(s.org_id, 'sales.read') and app.can_access_branch(s.branch_id)));

drop policy if exists sale_payments_select on public.sale_payments;
create policy sale_payments_select on public.sale_payments for select to authenticated
  using (exists (select 1 from public.sales s
                 where s.id = sale_payments.sale_id and s.org_id = sale_payments.org_id
                   and app.has_permission(s.org_id, 'sales.read') and app.can_access_branch(s.branch_id)));

-- -----------------------------------------------------------------------------
-- 6. Helper: summary of a sale header (used in RPC results)
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

  -- Replay of a request that already succeeded: return the stored sale, write nothing.
  select * into v_existing from public.sales where org_id = p_org_id and client_id = p_client_id;
  if found then
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
-- 9. Privileges (least privilege; see docs/security.md)
-- -----------------------------------------------------------------------------
revoke all on public.customers, public.sales, public.sale_lines, public.sale_payments, public.invoice_counters
  from public, anon, authenticated;
grant select, insert, update on public.customers to authenticated;
grant select on public.sales, public.sale_lines, public.sale_payments to authenticated;

revoke all on function public.finalize_sale(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.finalize_sale(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, jsonb) to authenticated;
revoke all on function public.cancel_sale(uuid, uuid, text, text) from public, anon;
grant execute on function public.cancel_sale(uuid, uuid, text, text) to authenticated;
revoke all on function app.sale_summary(uuid, text) from public, anon;
grant execute on function app.sale_summary(uuid, text) to authenticated;
revoke all on function app.sale_documents_immutable() from public, anon;

notify pgrst, 'reload schema';
