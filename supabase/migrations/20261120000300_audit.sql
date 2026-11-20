-- =============================================================================
-- Append-only audit log
-- =============================================================================
create table public.audit_log (
  id             bigint generated always as identity primary key,
  org_id         uuid not null,
  table_name     text not null,
  record_id      uuid,
  action         text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],
  actor_id       uuid,
  db_role        text not null default current_user,
  device_id      text,
  txid           bigint not null default txid_current(),
  occurred_at    timestamptz not null default now()
);
create index audit_log_org_time_idx on public.audit_log (org_id, occurred_at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

-- Generic audit trigger. TG_ARGV[0] = name of the column holding the org id
-- (defaults to 'org_id'; the organizations table passes 'id').
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_col text := coalesce(tg_argv[0], 'org_id');
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_headers jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.key not in ('updated_at', 'updated_by', 'row_version')
      and n.value is distinct from v_old -> n.key;
    -- Nothing but bookkeeping changed: skip the noise.
    if v_changed is null then
      return null;
    end if;
  end if;

  -- Rows without a tenant (system reference data) are changed only by migrations.
  if (coalesce(v_new, v_old) ->> v_org_col) is null then
    return null;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  insert into public.audit_log (org_id, table_name, record_id, action, old_data, new_data,
                                changed_fields, actor_id, device_id)
  values (
    (coalesce(v_new, v_old) ->> v_org_col)::uuid,
    tg_table_name,
    (coalesce(v_new, v_old) ->> 'id')::uuid,
    tg_op,
    v_old,
    v_new,
    v_changed,
    auth.uid(),
    left(v_headers ->> 'x-device-id', 64)
  );
  return null;
end;
$$;

-- Append-only: block UPDATE/DELETE/TRUNCATE for every role (incl. service_role).
create or replace function app.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501', hint = 'audit.immutable';
end;
$$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function app.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_log_immutable();

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create policy audit_log_read on public.audit_log
  for select to authenticated using (app.has_permission(org_id, 'audit.read'));

-- Attach to the tables created so far
create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function app.audit_row_change('id');
create trigger branches_audit after insert or update or delete on public.branches
  for each row execute function app.audit_row_change();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function app.audit_row_change();
create trigger membership_branches_audit after insert or update or delete on public.membership_branches
  for each row execute function app.audit_row_change();
