-- =====================================================================================
-- 20261021020657_identity_tenancy.sql  (schema v1: F-01, F-02; PRD §4.3 "Identity &
-- tenancy" and §4.4 RLS)
--
-- Creates: schema app (helpers), organizations, profiles, memberships, invitations,
-- org_settings; RLS on all of them; profile auto-create trigger on auth.users; the custom
-- access-token hook public.custom_access_token_hook(jsonb).
--
-- Deferred to a later migration (M1):
--   * organizations.active_run_id FK -> pipeline_runs(id) on delete set null deferrable
--     (pipeline_runs does not exist yet; the column is created here without the FK).
-- =====================================================================================

-- ---------------------------------------------------------------------------------
-- Schemas & extensions
-- ---------------------------------------------------------------------------------
create schema if not exists app;
create schema if not exists extensions;          -- exists already on Supabase
create extension if not exists citext with schema extensions;
-- gen_random_uuid() is core since PG13: pgcrypto is not required.

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- Generic trigger functions
-- ---------------------------------------------------------------------------------
create function app.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Validates a `timezone` column against pg_timezone_names (PRD §4.3 organizations).
create function app.validate_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.timezone is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid timezone: %', new.timezone
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------------
create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 2 and 100),
  slug             text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  plan             text not null default 'free' check (plan in ('free', 'pilot', 'pro', 'system')),
  timezone         text not null default 'UTC',
  default_currency char(3) not null default 'GBP' check (default_currency ~ '^[A-Z]{3}$'),
  -- FK to pipeline_runs(id) on delete set null deferrable is added in M1.
  active_run_id    uuid,
  is_demo          boolean not null default false,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on column public.organizations.active_run_id is
  'Active analysis run. FK -> pipeline_runs(id) on delete set null deferrable: added in M1.';

-- Exactly one demo org (at most one enforced here; the seed creates it).
create unique index organizations_one_demo on public.organizations ((true)) where is_demo;

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function app.set_updated_at();
create trigger organizations_validate_timezone before insert or update of timezone
  on public.organizations for each row execute function app.validate_timezone();

-- ---------------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text check (char_length(full_name) <= 120),
  timezone            text,
  active_org_id       uuid references public.organizations (id) on delete set null,
  email_notifications boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index profiles_active_org_id_idx on public.profiles (active_org_id);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();
create trigger profiles_validate_timezone before insert or update of timezone
  on public.profiles for each row execute function app.validate_timezone();

-- Auto-create a profile when Supabase Auth creates a user (F-01 AC5).
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name',
                         new.raw_user_meta_data ->> 'name', ''), 120), '')
  )
  on conflict (id) do nothing;
  return new;
end
$$;
revoke execute on function app.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------------
create table public.memberships (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'analyst', 'viewer')),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);
-- At most one owner per org ...
create unique index memberships_one_owner_per_org on public.memberships (org_id)
  where role = 'owner';

create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function app.set_updated_at();

-- ... and at least one owner per org, checked at commit (deferred), so ownership transfer
-- (demote + promote) and org creation (insert org + insert owner) work in one transaction.
-- The demo org (is_demo, plan 'system') is owned by the platform and is exempt.
-- Deleting the organization itself cascades and is allowed.
create function app.ensure_org_has_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if tg_table_name = 'organizations' then
    v_org := new.id;
  else
    v_org := old.org_id;
  end if;

  if exists (select 1 from public.organizations o where o.id = v_org and not o.is_demo)
     and not exists (select 1 from public.memberships m
                     where m.org_id = v_org and m.role = 'owner') then
    raise exception 'organization % must have exactly one owner', v_org
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;
revoke execute on function app.ensure_org_has_owner() from public;

create constraint trigger memberships_owner_exists
  after update or delete on public.memberships
  deferrable initially deferred
  for each row execute function app.ensure_org_has_owner();

create constraint trigger organizations_owner_exists
  after insert on public.organizations
  deferrable initially deferred
  for each row execute function app.ensure_org_has_owner();

-- ---------------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------------
create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  email       extensions.citext not null
                check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role        text not null check (role in ('admin', 'analyst', 'viewer')),
  token_hash  text not null unique,   -- SHA-256 (hex) of the raw token; raw token only in email
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  invited_by  uuid references public.profiles (id) on delete set null,
  accepted_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index invitations_org_id_idx on public.invitations (org_id);
create unique index invitations_one_pending_per_email on public.invitations (org_id, lower(email))
  where status = 'pending';

create trigger invitations_set_updated_at before update on public.invitations
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------
-- org_settings (one row per org, created automatically with the org)
-- ---------------------------------------------------------------------------------
create table public.org_settings (
  org_id               uuid primary key references public.organizations (id) on delete cascade,
  non_product_codes    text[] not null default '{POST,DOT,M,D,C2,CRUK,"BANK CHARGES",AMAZONFEE,ADJUST,ADJUST2,TEST001,TEST002,PADS,B,S}',
  wholesale_rule       jsonb not null
                         default '{"type":"percentile_monetary","value":0.99,"or_avg_qty_per_line_gt":50}',
  cancellation_mode    text not null default 'net' check (cancellation_mode in ('net', 'exclude')),
  risk_bands           jsonb not null default '{"high":0.6,"medium":0.3}',
  horizon_days_default int not null default 60 check (horizon_days_default in (30, 60, 90)),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger org_settings_set_updated_at before update on public.org_settings
  for each row execute function app.set_updated_at();

create function app.create_org_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.org_settings (org_id) values (new.id) on conflict (org_id) do nothing;
  return new;
end
$$;
revoke execute on function app.create_org_settings() from public;

create trigger organizations_create_settings after insert on public.organizations
  for each row execute function app.create_org_settings();

-- ---------------------------------------------------------------------------------
-- RLS helper functions (PRD §4.4)
-- ---------------------------------------------------------------------------------
create function app.current_org_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(auth.jwt() ->> 'org_id', '')::uuid
$$;

create function app.role_rank(r text) returns int
language sql immutable set search_path = '' as $$
  select case r when 'viewer' then 1 when 'analyst' then 2 when 'admin' then 3
                when 'owner' then 4 else 0 end
$$;

-- Re-checks the membership table (not just the org_role claim), so a removed member loses
-- access immediately for direct PostgREST reads.
create function app.has_role(min_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id  = app.current_org_id()
      and app.role_rank(m.role) >= app.role_rank(min_role))
$$;

-- SECURITY DEFINER (deviation from the PRD sketch): it is used inside RLS policies,
-- including the one on organizations itself, so it must not be subject to RLS.
create function app.demo_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.organizations where is_demo
$$;

revoke execute on all functions in schema app from public;
grant execute on function app.current_org_id(), app.role_rank(text), app.has_role(text),
  app.demo_org_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- Privileges: end users only read (plus own-profile updates on safe columns).
-- All other writes go through FastAPI (service role, explicit checks).
-- ---------------------------------------------------------------------------------
revoke all on public.organizations, public.profiles, public.memberships,
  public.invitations, public.org_settings from anon, authenticated;
grant select on public.organizations, public.profiles, public.memberships,
  public.invitations, public.org_settings to authenticated;
-- active_org_id is changed only via POST /v1/me/active-org (membership checked there).
grant update (full_name, timezone, email_notifications) on public.profiles to authenticated;
grant all on public.organizations, public.profiles, public.memberships,
  public.invitations, public.org_settings to service_role;

-- ---------------------------------------------------------------------------------
-- RLS policies (PRD §4.4 table)
-- ---------------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.memberships   enable row level security;
alter table public.invitations   enable row level security;
alter table public.org_settings  enable row level security;

-- organizations: members of the active org (+ demo). Updates via the API only.
create policy "read own org or demo" on public.organizations for select to authenticated
  using ((id = app.current_org_id() and app.has_role('viewer')) or is_demo);

-- org_settings: members of the active org (+ demo; it holds no personal data and the demo
-- dashboards need risk_bands). Updates via the API only.
create policy "read own org or demo" on public.org_settings for select to authenticated
  using ((org_id = app.current_org_id() and app.has_role('viewer'))
         or org_id = app.demo_org_id());

-- memberships, invitations: members (viewer+) of the active org. Writes via the API only.
create policy "read own org" on public.memberships for select to authenticated
  using (org_id = app.current_org_id() and app.has_role('viewer'));

create policy "read own org" on public.invitations for select to authenticated
  using (org_id = app.current_org_id() and app.has_role('viewer'));

-- profiles: a user reads and updates only their own profile.
create policy "read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------------
-- Custom access-token hook (F-01): adds org_id + org_role claims.
-- Docs: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
-- org_id comes from profiles.active_org_id and is emitted ONLY if the user has a
-- membership in that org; otherwise both claims are removed.
-- ---------------------------------------------------------------------------------
create function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user   uuid  := nullif(event ->> 'user_id', '')::uuid;
  v_org    uuid;
  v_role   text;
begin
  select p.active_org_id, m.role
    into v_org, v_role
  from public.profiles p
  join public.memberships m on m.org_id = p.active_org_id and m.user_id = p.id
  where p.id = v_user;

  if v_org is not null and v_role is not null then
    v_claims := v_claims || jsonb_build_object('org_id', v_org, 'org_role', v_role);
  else
    v_claims := v_claims - 'org_id' - 'org_role';
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

grant select on public.profiles, public.memberships to supabase_auth_admin;
create policy "auth admin reads profiles" on public.profiles as permissive for select
  to supabase_auth_admin using (true);
create policy "auth admin reads memberships" on public.memberships as permissive for select
  to supabase_auth_admin using (true);
