-- scripts/db/auth-stub.sql
--
-- Minimal stand-in for what a Supabase project provides out of the box, so that
-- supabase/migrations/*.sql can be applied and tested on stock PostgreSQL 16
-- (e.g. a `postgres:16` GitHub Actions service container) without the Supabase stack.
--
-- NEVER run this against a real Supabase database: it would shadow nothing there
-- (everything is IF NOT EXISTS / OR REPLACE), but it is meaningless and untested there.
--
-- Emulates:
--   * roles anon, authenticated, service_role (BYPASSRLS), supabase_auth_admin
--   * schema auth, table auth.users (subset of columns), auth.uid(), auth.jwt(), auth.role()
--     reading the same GUCs PostgREST sets (request.jwt.claims / request.jwt.claim.sub)
--   * Supabase's default privileges on schema public (anon/authenticated/service_role get
--     ALL on new tables/functions/sequences), so migrations' explicit REVOKEs are exercised.

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
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

create table if not exists auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
grant select on auth.users to service_role, supabase_auth_admin;

-- Same semantics as Supabase's auth.uid()/auth.jwt()/auth.role().
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant execute on function auth.uid(), auth.jwt(), auth.role()
  to anon, authenticated, service_role, supabase_auth_admin;

-- Supabase's default privileges on schema public.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
