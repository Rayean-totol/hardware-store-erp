-- =============================================================================
-- Phase 2: stock ledger (immutable movements) and stock levels (projection)
-- =============================================================================
-- Stock is held per warehouse and product, always in the product's BASE unit.
-- stock_movements is the source of truth and is append-only. stock_levels is a
-- projection maintained ONLY by apply_stock_movements() (see the next migration).
-- Costing: weighted moving average, rounded to 4 dp (must match packages/domain/src/stock.ts).

create table public.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  -- Idempotency key generated on the device. A replayed command with the same key is a no-op.
  client_id         uuid not null,
  branch_id         uuid not null,
  warehouse_id      uuid not null,
  product_id        uuid not null,
  movement_type     text not null check (movement_type in ('stock_in', 'stock_out', 'adjustment')),
  unit_id           uuid not null references public.units (id),
  -- As entered by the user (positive) and the factor used to convert to base units (snapshot)
  entered_quantity  numeric(18, 6) not null check (entered_quantity > 0),
  factor            numeric(18, 6) not null check (factor > 0),
  -- Signed change in base units: + receipts/increases, - issues/decreases
  quantity_change   numeric(18, 6) not null check (quantity_change <> 0),
  -- Cost per entered unit (stock in, optional for adjustments) and per base unit (derived)
  unit_cost         numeric(18, 4) check (unit_cost >= 0),
  base_unit_cost    numeric(18, 4) check (base_unit_cost >= 0),
  balance_after     numeric(18, 6) not null,
  average_cost_after numeric(18, 4) not null check (average_cost_after >= 0),
  reason_code       text check (reason_code is null or reason_code ~ '^[a-z_]{2,32}$'),
  note              text check (note is null or length(note) <= 500),
  reference         text check (reference is null or length(reference) <= 64),
  device_id         text check (device_id is null or length(device_id) <= 64),
  occurred_at       timestamptz not null,   -- when it happened on the device
  recorded_at       timestamptz not null default now(),
  recorded_by       uuid,
  constraint stock_movements_sign check (
       (movement_type = 'stock_in'    and quantity_change > 0)
    or (movement_type = 'stock_out'   and quantity_change < 0)
    or (movement_type = 'adjustment'  and quantity_change <> 0)),
  constraint stock_movements_adjustment_reason check (
       movement_type <> 'adjustment' or reason_code is not null),
  constraint stock_movements_idempotency unique (org_id, client_id),
  unique (id, org_id),
  foreign key (warehouse_id, branch_id, org_id) references public.warehouses (id, branch_id, org_id),
  foreign key (product_id, org_id) references public.products (id, org_id)
);
create index stock_movements_product_idx on public.stock_movements (warehouse_id, product_id, recorded_at desc);
create index stock_movements_branch_time_idx on public.stock_movements (branch_id, recorded_at desc);

-- Append-only: no role may update or delete a movement. Corrections are new movements.
create or replace function app.stock_movements_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'stock_movements is append-only' using errcode = '42501', hint = 'stock.immutable';
end;
$$;
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function app.stock_movements_immutable();

create table public.stock_levels (
  org_id            uuid not null,
  branch_id         uuid not null,
  warehouse_id      uuid not null,
  product_id        uuid not null,
  quantity          numeric(18, 6) not null default 0,
  average_cost      numeric(18, 4) not null default 0 check (average_cost >= 0),
  last_movement_at  timestamptz,
  row_version       bigint not null default 1,
  updated_at        timestamptz not null default now(),
  primary key (warehouse_id, product_id),
  foreign key (warehouse_id, branch_id, org_id) references public.warehouses (id, branch_id, org_id),
  foreign key (product_id, org_id) references public.products (id, org_id)
);
create index stock_levels_org_idx on public.stock_levels (org_id, branch_id);

-- -----------------------------------------------------------------------------
-- Audit: movements are audited on insert (the ledger itself is the history);
-- warehouse changes are audited in the warehouses migration.
-- -----------------------------------------------------------------------------
create trigger stock_movements_audit after insert on public.stock_movements
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- RLS: read only for clients. Writes happen exclusively inside the RPC (security definer).
-- -----------------------------------------------------------------------------
alter table public.stock_movements enable row level security;
alter table public.stock_levels enable row level security;

create policy stock_movements_read on public.stock_movements for select to authenticated
  using (app.has_permission(org_id, 'inventory.read') and app.can_access_branch(branch_id));

create policy stock_levels_read on public.stock_levels for select to authenticated
  using (app.has_permission(org_id, 'inventory.read') and app.can_access_branch(branch_id));

revoke all on public.stock_movements, public.stock_levels from anon, authenticated;
grant select on public.stock_movements, public.stock_levels to authenticated;
