-- Exactly-one-owner enforcement (F-02 AC2) and table constraints (PRD §4.3).
-- Runs as the migration owner (service-role equivalent) on fixtures.
begin;

-- ----- at most one owner (partial unique index) ------------------------------------
select tests.throws($$insert into public.memberships (org_id, user_id, role) values ('a0000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'owner')$$, '23505',
  'second owner insert is rejected');
select tests.throws($$update public.memberships set role = 'owner' where user_id = 'a2000000-0000-0000-0000-000000000001'$$, '23505',
  'promoting an admin while an owner exists is rejected');

-- ----- at least one owner (deferred constraint trigger, forced immediate) ------------
select tests.throws($$
  delete from public.memberships where user_id = 'a1000000-0000-0000-0000-000000000001'
    and org_id = 'a0000000-0000-0000-0000-000000000001';
  set constraints all immediate$$, '23514',
  'removing the only owner fails at commit');
select tests.throws($$
  update public.memberships set role = 'admin' where user_id = 'a1000000-0000-0000-0000-000000000001'
    and org_id = 'a0000000-0000-0000-0000-000000000001';
  set constraints all immediate$$, '23514',
  'demoting the only owner fails at commit');
select tests.throws($$
  insert into public.organizations (name, slug) values ('Ownerless', 'ownerless');
  set constraints all immediate$$, '23514',
  'creating an organization without an owner fails at commit');
select tests.throws($$
  delete from auth.users where id = 'b1000000-0000-0000-0000-000000000001';
  set constraints all immediate$$, '23514',
  'deleting the auth user who is the sole owner fails (F-26 guard)');
select tests.lives($$
  update public.memberships set role = 'admin' where user_id = 'a1000000-0000-0000-0000-000000000001'
    and org_id = 'a0000000-0000-0000-0000-000000000001';
  update public.memberships set role = 'owner' where user_id = 'a2000000-0000-0000-0000-000000000001'
    and org_id = 'a0000000-0000-0000-0000-000000000001';
  set constraints all immediate;
  set constraints all deferred$$,
  'ownership transfer (demote + promote) in one transaction succeeds');
select tests.lives($$
  with o as (insert into public.organizations (name, slug) values ('New Co', 'new-co') returning id)
  insert into public.memberships (org_id, user_id, role)
    select id, 'c1000000-0000-0000-0000-000000000001', 'owner' from o;
  set constraints all immediate;
  set constraints all deferred$$,
  'creating an organization together with its owner succeeds');
select tests.eq((select count(*) from public.org_settings s join public.organizations o on o.id = s.org_id where o.slug = 'new-co'), 1::bigint,
  'org_settings row auto-created with the organization');
select tests.lives($$
  delete from public.organizations where id = 'b0000000-0000-0000-0000-000000000001';
  set constraints all immediate;
  set constraints all deferred$$,
  'deleting an organization cascades its memberships without tripping the owner check');

-- ----- organizations constraints ----------------------------------------------------
select tests.throws($$insert into public.organizations (name, slug) values ('Bad Slug', 'Bad_Slug')$$, '23514',
  'slug must match ^[a-z0-9-]{3,40}$');
select tests.throws($$insert into public.organizations (name, slug) values ('X', 'xxx')$$, '23514',
  'name must be 2..100 chars');
select tests.throws($$insert into public.organizations (name, slug) values ('Dup', 'org-a')$$, '23505',
  'slug is unique');
select tests.throws($$insert into public.organizations (name, slug, plan) values ('Plan', 'plan-x', 'enterprise')$$, '23514',
  'plan must be free/pilot/pro/system');
select tests.throws($$insert into public.organizations (name, slug, default_currency) values ('Cur', 'cur-x', 'gb')$$, '23514',
  'default_currency must be 3 uppercase letters');
select tests.throws($$insert into public.organizations (name, slug, timezone) values ('Tz', 'tz-x', 'Mars/Olympus')$$, '23514',
  'timezone validated against pg_timezone_names');
select tests.throws($$insert into public.organizations (name, slug, is_demo, plan) values ('Demo 2', 'demo-2', true, 'system')$$, '23505',
  'only one demo organization');
select tests.throws($$update public.profiles set timezone = 'Not/AZone' where id = 'c1000000-0000-0000-0000-000000000001'$$, '23514',
  'profile timezone validated');

-- ----- invitations constraints ------------------------------------------------------
select tests.throws($$insert into public.invitations (org_id, email, role, token_hash) values ('a0000000-0000-0000-0000-000000000001', 'x@example.test', 'owner', 't1')$$, '23514',
  'cannot invite an owner');
select tests.throws($$insert into public.invitations (org_id, email, role, token_hash) values ('a0000000-0000-0000-0000-000000000001', 'not-an-email', 'viewer', 't2')$$, '23514',
  'email format checked');
select tests.throws($$insert into public.invitations (org_id, email, role, token_hash) values ('a0000000-0000-0000-0000-000000000001', 'INVITEE-A@Example.Test', 'viewer', 't3')$$, '23505',
  'one pending invitation per (org, email), case-insensitive');
select tests.throws($$insert into public.invitations (org_id, email, role, token_hash) values ('a0000000-0000-0000-0000-000000000001', 'other@example.test', 'viewer', repeat('a', 64))$$, '23505',
  'token_hash is unique');
select tests.lives($$
  update public.invitations set status = 'revoked' where email = 'invitee-a@example.test';
  insert into public.invitations (org_id, email, role, token_hash) values ('a0000000-0000-0000-0000-000000000001', 'Invitee-A@example.test', 'viewer', 't4')$$,
  're-inviting after revocation is allowed');
select tests.ok((select expires_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute'
                 from public.invitations where token_hash = 't4'),
  'invitation expires_at defaults to now() + 7 days');

-- ----- updated_at trigger -----------------------------------------------------------
update public.organizations set updated_at = '2000-01-01' where id = 'a0000000-0000-0000-0000-000000000001';
select tests.ok((select updated_at > '2000-01-02' from public.organizations where id = 'a0000000-0000-0000-0000-000000000001'),
  'updated_at maintained by trigger');

rollback;
