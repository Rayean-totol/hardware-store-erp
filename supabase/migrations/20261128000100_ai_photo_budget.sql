-- =============================================================================
-- AI product photo suggestions: monthly budget (additive, new table and function only).
-- =============================================================================
-- Nothing in existing tables changes. The Edge Function calls ai_photo_reserve before each provider
-- call. It checks catalog.write for the caller and reserves the worst-case cost in SAR micro-units
-- (millionths of a riyal). If the month's total would pass the cap, it refuses. Costs are counted even
-- when the provider later fails, so the cap is never exceeded.
-- The table has no policies for anon or authenticated: only the function below reads or writes it.
-- =============================================================================

create table if not exists public.ai_photo_usage (
  org_id          uuid not null references public.organizations (id) on delete cascade,
  month           date not null,
  spent_sar_micro bigint not null default 0 check (spent_sar_micro >= 0),
  calls           integer not null default 0 check (calls >= 0),
  primary key (org_id, month)
);

alter table public.ai_photo_usage enable row level security;
revoke all on public.ai_photo_usage from anon, authenticated;

create or replace function public.ai_photo_reserve(
  p_org_id uuid,
  p_cost_sar_micro bigint,
  p_cap_sar_micro bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'Asia/Riyadh')::date;
  v_spent bigint;
begin
  if not app.has_permission(p_org_id, 'catalog.write') then
    perform app.fail('forbidden', 'catalog.write');
  end if;
  if p_cost_sar_micro is null or p_cost_sar_micro <= 0 or p_cap_sar_micro is null or p_cap_sar_micro <= 0 then
    perform app.fail('validation', 'budget');
  end if;

  insert into public.ai_photo_usage (org_id, month) values (p_org_id, v_month)
  on conflict (org_id, month) do nothing;

  select spent_sar_micro into v_spent
  from public.ai_photo_usage
  where org_id = p_org_id and month = v_month
  for update;

  if v_spent + p_cost_sar_micro > p_cap_sar_micro then
    return jsonb_build_object('allowed', false, 'reason', 'monthly_cap', 'spent_sar_micro', v_spent);
  end if;

  update public.ai_photo_usage
  set spent_sar_micro = spent_sar_micro + p_cost_sar_micro,
      calls = calls + 1
  where org_id = p_org_id and month = v_month;

  return jsonb_build_object('allowed', true, 'spent_sar_micro', v_spent + p_cost_sar_micro);
end;
$$;

revoke all on function public.ai_photo_reserve(uuid, bigint, bigint) from public, anon;
grant execute on function public.ai_photo_reserve(uuid, bigint, bigint) to authenticated;

notify pgrst, 'reload schema';
