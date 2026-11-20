-- =============================================================================
-- Supabase compatibility shim — TEST USE ONLY. Never apply to a Supabase project.
-- =============================================================================
-- Lets the migrations run on a plain PostgreSQL 15+ server (CI service container,
-- local install) without the Docker-based Supabase stack. It reproduces just what
-- the migrations depend on:
--   * roles anon / authenticated / service_role / authenticator
--   * auth.users (minimal columns) and auth.uid() / auth.jwt() / auth.role(),
--     which read the JWT claims the same way Supabase's do (request.jwt.claims)
--   * Supabase's permissive default grants on schema public, so RLS — not grants —
--     is what the tests exercise.
-- Supabase Auth (GoTrue) itself is NOT emulated: sign-up, login, e-mails and
-- token refresh are not covered by tests that use this shim.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator-test-only';
  end if;
end;
$$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), auth.jwt() ->> 'sub'), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.role', true), auth.jwt() ->> 'role'), '')::text;
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Supabase's defaults for objects created by the migration role in schema public
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
