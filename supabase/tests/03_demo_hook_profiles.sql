-- Demo org visibility (F-15 / PRD §4.4), custom access-token hook (F-01), profile trigger (F-01 AC5).
begin;

-- ===== Demo org readable (read-only) by any authenticated user ======================
set local role authenticated;
select tests.login('c1000000-0000-0000-0000-000000000001');   -- outsider, no org claim
select tests.eq((select array_agg(slug) from public.organizations), array['demo'],
  'user with no org sees only the demo organization');
select tests.eq((select array_agg(org_id) from public.org_settings), array['d0000000-0000-0000-0000-000000000001'::uuid],
  'user with no org sees only the demo org_settings');
select tests.eq((select count(*) from public.memberships) + (select count(*) from public.invitations), 0::bigint,
  'user with no org sees no memberships or invitations');
select tests.throws($$update public.organizations set name = 'Defaced' where is_demo$$, '42501',
  'non-member cannot write the demo organization');
select tests.throws($$update public.org_settings set cancellation_mode = 'exclude' where org_id = 'd0000000-0000-0000-0000-000000000001'$$, '42501',
  'non-member cannot write demo org_settings');
reset role;

-- ===== Access-token hook ===========================================================
select tests.ok(not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'authenticated cannot execute the hook');
select tests.ok(not has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'anon cannot execute the hook');
select tests.ok(has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'supabase_auth_admin can execute the hook');

set local role supabase_auth_admin;

-- member with active org -> claims added, other claims preserved
select tests.eq(
  (select public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'a3000000-0000-0000-0000-000000000001',
     'claims', jsonb_build_object('sub', 'a3000000-0000-0000-0000-000000000001', 'aud', 'authenticated', 'role', 'authenticated')))
   -> 'claims'),
  jsonb_build_object('sub', 'a3000000-0000-0000-0000-000000000001', 'aud', 'authenticated', 'role', 'authenticated',
                     'org_id', 'a0000000-0000-0000-0000-000000000001', 'org_role', 'analyst'),
  'hook adds org_id/org_role for a real membership and keeps other claims');

-- user with no active org -> no claims; forged incoming claims are stripped
select tests.eq(
  (select public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'c1000000-0000-0000-0000-000000000001',
     'claims', jsonb_build_object('sub', 'c1000000-0000-0000-0000-000000000001', 'org_id', 'b0000000-0000-0000-0000-000000000001', 'org_role', 'owner')))
   -> 'claims'),
  jsonb_build_object('sub', 'c1000000-0000-0000-0000-000000000001'),
  'hook emits no org claims for a user without an active org');

reset role;
-- active_org_id pointing at an org the user is NOT a member of (e.g. removed member)
update public.profiles set active_org_id = 'b0000000-0000-0000-0000-000000000001'
  where id = 'a3000000-0000-0000-0000-000000000001';
set local role supabase_auth_admin;
select tests.eq(
  (select public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'a3000000-0000-0000-0000-000000000001',
     'claims', jsonb_build_object('sub', 'a3000000-0000-0000-0000-000000000001')))
   -> 'claims'),
  jsonb_build_object('sub', 'a3000000-0000-0000-0000-000000000001'),
  'hook emits no org claims when active_org_id has no matching membership');
select tests.eq(
  (select public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'b1000000-0000-0000-0000-000000000001', 'claims', '{}'::jsonb)) -> 'claims' ->> 'org_role'),
  'owner',
  'hook reports the owner role');
reset role;

-- ===== Profile auto-create trigger on auth.users ===================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000001', 'new@example.test', jsonb_build_object('full_name', repeat('x', 200))),
  ('e2000000-0000-0000-0000-000000000001', 'new2@example.test', '{}');
select tests.eq((select count(*) from public.profiles where id in ('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001')), 2::bigint,
  'profile rows created by the auth.users trigger');
select tests.eq((select char_length(full_name) from public.profiles where id = 'e1000000-0000-0000-0000-000000000001'), 120,
  'full_name from user metadata truncated to 120 chars');
select tests.ok((select full_name is null and active_org_id is null and email_notifications
                 from public.profiles where id = 'e2000000-0000-0000-0000-000000000001'),
  'profile defaults: no name, no active org, notifications on');
delete from auth.users where id = 'e2000000-0000-0000-0000-000000000001';
select tests.eq((select count(*) from public.profiles where id = 'e2000000-0000-0000-0000-000000000001'), 0::bigint,
  'profile deleted with its auth user');

-- ===== RLS enabled on every public table ===========================================
select tests.eq(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint,
  'RLS is enabled on every table in schema public');

rollback;
