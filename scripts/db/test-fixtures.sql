-- scripts/db/test-fixtures.sql
--
-- Test-only helpers and fixture data, applied by scripts/db/test-local.sh to a throwaway
-- database AFTER the migrations and BEFORE supabase/tests/*.sql. Never applied to a real
-- Supabase project. Synthetic data only (example.test addresses, no personal data).

-- ---------------------------------------------------------------------------------
-- Assertion helpers (schema tests). Every failed assertion RAISEs, which makes psql
-- (ON_ERROR_STOP=1) exit non-zero.
-- ---------------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to public;

create function tests.ok(cond boolean, description text) returns void
language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAILED: %', description;
  end if;
  raise notice 'ok - %', description;
end
$$;

create function tests.eq(got anyelement, expected anyelement, description text) returns void
language plpgsql as $$
begin
  if got is distinct from expected then
    raise exception 'FAILED: % (got %, expected %)', description, got, expected;
  end if;
  raise notice 'ok - %', description;
end
$$;

-- Runs `stmt` as the CURRENT role and asserts it fails with SQLSTATE `state`.
-- Any effects are rolled back (the block runs in a subtransaction).
create function tests.throws(stmt text, state text, description text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = state then
      raise notice 'ok - % (% %)', description, sqlstate, sqlerrm;
      return;
    end if;
    raise exception 'FAILED: % (expected SQLSTATE %, got %: %)', description, state, sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % (expected SQLSTATE %, statement succeeded)', description, state;
end
$$;

-- Runs `stmt` as the CURRENT role and asserts it succeeds.
create function tests.lives(stmt text, description text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise notice 'ok - %', description;
exception when others then
  raise exception 'FAILED: % (%: %)', description, sqlstate, sqlerrm;
end
$$;

-- Simulates PostgREST: sets the request.jwt.claims GUC for the current transaction.
create function tests.login(user_id uuid, org_id uuid default null, org_role text default null)
returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object(
      'sub', user_id, 'role', 'authenticated', 'aud', 'authenticated',
      'org_id', org_id, 'org_role', org_role))::text,
    true)
$$;

grant execute on all functions in schema tests to public;

-- ---------------------------------------------------------------------------------
-- Fixture ids
--   orgs:  A = a0..01, B = b0..01, Demo = d0..01
--   users: A owner a1, A admin a2, A analyst a3, A viewer a4; B owner b1; outsider c1
-- ---------------------------------------------------------------------------------
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000001', 'owner-a@example.test',   '{"full_name":"Owner A"}'),
  ('a2000000-0000-0000-0000-000000000001', 'admin-a@example.test',   '{}'),
  ('a3000000-0000-0000-0000-000000000001', 'analyst-a@example.test', '{}'),
  ('a4000000-0000-0000-0000-000000000001', 'viewer-a@example.test',  '{}'),
  ('b1000000-0000-0000-0000-000000000001', 'owner-b@example.test',   '{}'),
  ('c1000000-0000-0000-0000-000000000001', 'outsider@example.test',  '{}');

insert into public.organizations (id, name, slug, plan, is_demo) values
  ('a0000000-0000-0000-0000-000000000001', 'Org A', 'org-a', 'pilot', false),
  ('b0000000-0000-0000-0000-000000000001', 'Org B', 'org-b', 'free', false),
  ('d0000000-0000-0000-0000-000000000001', 'Demo - UCI Online Retail II', 'demo', 'system', true);

insert into public.memberships (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'owner'),
  ('a0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'admin'),
  ('a0000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'analyst'),
  ('a0000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'viewer'),
  ('b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'owner');

update public.profiles set active_org_id = 'a0000000-0000-0000-0000-000000000001'
  where id in ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001',
               'a3000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001');
update public.profiles set active_org_id = 'b0000000-0000-0000-0000-000000000001'
  where id = 'b1000000-0000-0000-0000-000000000001';

insert into public.invitations (org_id, email, role, token_hash, invited_by) values
  ('a0000000-0000-0000-0000-000000000001', 'invitee-a@example.test', 'analyst',
   repeat('a', 64), 'a1000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000001', 'invitee-b@example.test', 'viewer',
   repeat('b', 64), 'b1000000-0000-0000-0000-000000000001');

commit;
