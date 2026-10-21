-- Cross-tenant isolation for identity & tenancy tables (F-02 AC5, PRD §4.4).
-- Runs on fixtures from scripts/db/test-fixtures.sql. Plain SQL: a failed assertion raises.
begin;

-- ===== Viewer of org A, active org A =================================================
set local role authenticated;
select tests.login('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'viewer');

select tests.eq((select count(*) from public.organizations where id = 'b0000000-0000-0000-0000-000000000001'), 0::bigint,
  'A viewer cannot select org B organizations row');
select tests.eq((select array_agg(slug order by slug) from public.organizations), array['demo', 'org-a'],
  'A viewer sees exactly org A + demo organizations');
select tests.eq((select count(*) from public.memberships where org_id <> 'a0000000-0000-0000-0000-000000000001'), 0::bigint,
  'A viewer cannot select other orgs'' memberships');
select tests.eq((select count(*) from public.memberships), 4::bigint,
  'A viewer sees all 4 org A memberships');
select tests.eq((select count(*) from public.invitations where org_id = 'b0000000-0000-0000-0000-000000000001'), 0::bigint,
  'A viewer cannot select org B invitations');
select tests.eq((select count(*) from public.invitations), 1::bigint,
  'A viewer sees org A invitation');
select tests.eq((select count(*) from public.org_settings where org_id = 'b0000000-0000-0000-0000-000000000001'), 0::bigint,
  'A viewer cannot select org B org_settings');
select tests.eq((select count(*) from public.org_settings), 2::bigint,
  'A viewer sees org A + demo org_settings');
select tests.eq((select count(*) from public.profiles), 1::bigint,
  'A viewer sees only their own profile');

-- Viewer cannot write anything except their own profile's safe columns.
select tests.throws($$insert into public.organizations (name, slug) values ('Evil', 'evil-org')$$, '42501',
  'viewer cannot insert organizations');
select tests.throws($$update public.organizations set name = 'Hacked' where id = 'a0000000-0000-0000-0000-000000000001'$$, '42501',
  'viewer cannot update own organization');
select tests.throws($$insert into public.memberships (org_id, user_id, role) values ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'viewer')$$, '42501',
  'viewer cannot insert memberships');
select tests.throws($$update public.memberships set role = 'owner' where user_id = 'a4000000-0000-0000-0000-000000000001'$$, '42501',
  'viewer cannot promote themselves');
select tests.throws($$delete from public.memberships where org_id = 'a0000000-0000-0000-0000-000000000001'$$, '42501',
  'viewer cannot delete memberships');
select tests.throws($$insert into public.invitations (org_id, email, role, token_hash) values ('a0000000-0000-0000-0000-000000000001', 'x@example.test', 'admin', 'zz')$$, '42501',
  'viewer cannot create invitations');
select tests.throws($$update public.org_settings set horizon_days_default = 30$$, '42501',
  'viewer cannot update org_settings');
select tests.throws($$update public.profiles set active_org_id = 'b0000000-0000-0000-0000-000000000001' where id = 'a4000000-0000-0000-0000-000000000001'$$, '42501',
  'user cannot set active_org_id directly (API only)');
select tests.lives($$update public.profiles set full_name = 'Viewer A', timezone = 'Europe/London' where id = 'a4000000-0000-0000-0000-000000000001'$$,
  'user can update own full_name/timezone');
select tests.lives($$update public.profiles set full_name = 'Hacked' where id = 'b1000000-0000-0000-0000-000000000001'$$,
  'update of another user''s profile runs but ...');
reset role;
select tests.eq((select full_name from public.profiles where id = 'b1000000-0000-0000-0000-000000000001'), null::text,
  '... does not change another user''s profile');
select tests.eq((select full_name from public.profiles where id = 'a4000000-0000-0000-0000-000000000001'), 'Viewer A',
  'own profile update persisted');

-- ===== Owner of org A: even owners write only through the API (service role) =========
set local role authenticated;
select tests.login('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'owner');
select tests.throws($$update public.organizations set name = 'Renamed' where id = 'b0000000-0000-0000-0000-000000000001'$$, '42501',
  'A owner cannot update org B');
select tests.throws($$delete from public.invitations where org_id = 'b0000000-0000-0000-0000-000000000001'$$, '42501',
  'A owner cannot delete org B invitations');
select tests.throws($$insert into public.memberships (org_id, user_id, role) values ('b0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'admin')$$, '42501',
  'A owner cannot add themselves to org B');

-- ===== Forged org claim: user of A presents org_id = B ================================
select tests.login('a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'owner');
select tests.eq((select count(*) from public.organizations where not is_demo), 0::bigint,
  'forged org_id claim (no membership) sees no non-demo organizations');
select tests.eq((select count(*) from public.memberships), 0::bigint,
  'forged org_id claim sees no memberships');
select tests.eq((select count(*) from public.invitations), 0::bigint,
  'forged org_id claim sees no invitations');
select tests.eq((select count(*) from public.org_settings where org_id <> 'd0000000-0000-0000-0000-000000000001'), 0::bigint,
  'forged org_id claim sees no non-demo org_settings');

-- ===== Membership removed: access revoked immediately (has_role re-checks the table) ==
reset role;
delete from public.memberships where user_id = 'a4000000-0000-0000-0000-000000000001';
set local role authenticated;
select tests.login('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'viewer');
select tests.eq((select count(*) from public.memberships), 0::bigint,
  'removed member with a still-valid token sees no memberships');
select tests.eq((select array_agg(slug) from public.organizations), array['demo'],
  'removed member with a still-valid token sees only the demo org');

-- ===== anon sees nothing ===========================================================
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select tests.throws($$select 1 from public.organizations$$, '42501', 'anon has no access to organizations');
select tests.throws($$select 1 from public.profiles$$, '42501', 'anon has no access to profiles');

reset role;
rollback;
