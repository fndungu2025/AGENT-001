-- Cross-tenant isolation for ingestion, curated and pipeline_runs tables (PRD §4.4, F-03..F-05).
-- Fixture rows are inserted as the migration owner (service-role equivalent) and rolled back.
-- ids: datasets da/db/dd, customers ca/cb/cd, products fa/fb/fd, runs ea/eb/ed (A/B/demo).
begin;

-- ----- fixtures: one dataset per org (A, B, demo) with mapping, report, dims, fact, run -----
insert into public.datasets (id, org_id, name, original_filename, storage_path, file_size_bytes, currency,
                             source_timezone, status, date_min, date_max) values
  ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A orders', 'a.csv',
   'uploads/a0000000-0000-0000-0000-000000000001/da000000-0000-0000-0000-000000000001/original.csv', 1000, 'GBP',
   'Europe/London', 'ready', '2010-01-01', '2011-12-09'),
  ('db000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'B orders', 'b.csv',
   'uploads/b0000000-0000-0000-0000-000000000001/db000000-0000-0000-0000-000000000001/original.csv', 1000, 'EUR',
   'UTC', 'ready', '2010-01-01', '2011-12-09'),
  ('dd000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'UCI', 'online_retail_II.xlsx',
   'uploads/d0000000-0000-0000-0000-000000000001/dd000000-0000-0000-0000-000000000001/original.xlsx', 1000, 'GBP',
   'Europe/London', 'ready', '2009-12-01', '2011-12-09');

insert into public.dataset_column_mappings (dataset_id, org_id, mapping)
select id, org_id, '{"invoice_id":"Invoice","invoice_ts":"InvoiceDate","customer_ref":"Customer ID","quantity":"Quantity","unit_price":"Price"}'
from public.datasets;

insert into public.data_quality_reports (dataset_id, org_id, reconciliation)
select id, org_id, '{"gross_revenue":100.00,"cancellations":10.00,"excluded_revenue":5.00,"net_revenue":85.00}'
from public.datasets;

insert into public.dim_customer (id, org_id, dataset_id, customer_ref) values
  ('ca000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '12345'),
  ('cb000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', '12345'),
  ('cd000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', '12345');

insert into public.dim_product (id, org_id, dataset_id, stock_code) values
  ('fa000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '85123A'),
  ('fb000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', '85123A'),
  ('fd000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', '85123A');

insert into public.fact_order_line (org_id, dataset_id, customer_id, product_id, invoice_id, invoice_ts,
                                    quantity, unit_price, line_revenue, is_cancellation)
select c.org_id, c.dataset_id, c.id, p.id, '489434', '2010-12-01 07:45+00', 6, 2.55, 15.30, false
from public.dim_customer c join public.dim_product p on p.org_id = c.org_id;

insert into public.pipeline_runs (id, org_id, dataset_id, status, cutoff_date, scoring_date) values
  ('ea000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'succeeded', '2011-09-01', '2011-12-09'),
  ('eb000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'succeeded', '2011-09-01', '2011-12-09'),
  ('ed000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000001', 'succeeded', '2011-09-01', '2011-12-09');

select tests.eq((select count(*) from public.fact_order_line), 3::bigint, 'fixtures: one fact row per org');

-- ===== Viewer of org A ================================================================
set local role authenticated;
select tests.login('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'viewer');

-- ingestion tables: own org only (no demo, PRD §4.4 "viewer+")
select tests.eq((select array_agg(org_id::text) from public.datasets), array['a0000000-0000-0000-0000-000000000001'],
  'A viewer sees only org A datasets (not B, not demo)');
select tests.eq((select array_agg(org_id::text) from public.dataset_column_mappings), array['a0000000-0000-0000-0000-000000000001'],
  'A viewer sees only org A column mappings');
select tests.eq((select array_agg(org_id::text) from public.data_quality_reports), array['a0000000-0000-0000-0000-000000000001'],
  'A viewer sees only org A data-quality reports');

-- curated + runs: own org + demo
select tests.eq((select array_agg(org_id::text order by org_id) from public.dim_customer),
  array['a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'],
  'A viewer sees org A + demo dim_customer, not B');
select tests.eq((select array_agg(org_id::text order by org_id) from public.dim_product),
  array['a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'],
  'A viewer sees org A + demo dim_product, not B');
select tests.eq((select array_agg(org_id::text order by org_id) from public.fact_order_line),
  array['a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'],
  'A viewer sees org A + demo fact_order_line, not B');
select tests.eq((select array_agg(org_id::text order by org_id) from public.pipeline_runs),
  array['a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'],
  'A viewer sees org A + demo pipeline_runs, not B');

-- viewer cannot write any of the new tables (no end-user write grants)
select tests.throws($$insert into public.datasets (org_id, name, original_filename, storage_path, file_size_bytes, currency, source_timezone)
  values ('a0000000-0000-0000-0000-000000000001', 'x', 'x.csv', 'uploads/a0000000-0000-0000-0000-000000000001/x/original.csv', 1, 'GBP', 'UTC')$$,
  '42501', 'viewer cannot insert datasets');
select tests.throws($$update public.datasets set name = 'renamed'$$, '42501', 'viewer cannot update datasets');
select tests.throws($$delete from public.datasets$$, '42501', 'viewer cannot delete datasets');
select tests.throws($$update public.dataset_column_mappings set date_format = '%d/%m/%Y'$$, '42501', 'viewer cannot update mappings');
select tests.throws($$delete from public.data_quality_reports$$, '42501', 'viewer cannot delete quality reports');
select tests.throws($$insert into public.dim_customer (org_id, dataset_id, customer_ref)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'x')$$, '42501', 'viewer cannot insert dim_customer');
select tests.throws($$update public.dim_product set is_non_product = true$$, '42501', 'viewer cannot update dim_product');
select tests.throws($$delete from public.fact_order_line$$, '42501', 'viewer cannot delete fact_order_line');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09')$$,
  '42501', 'viewer cannot insert pipeline_runs');
select tests.throws($$update public.pipeline_runs set cancel_requested = true$$, '42501', 'viewer cannot update pipeline_runs');

-- ===== Owner of org A: still read-only (writes via API / worker) and cannot touch org B ====
select tests.login('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'owner');
select tests.throws($$update public.datasets set status = 'failed' where org_id = 'b0000000-0000-0000-0000-000000000001'$$, '42501',
  'A owner cannot update org B datasets');
select tests.throws($$delete from public.dim_customer where org_id = 'b0000000-0000-0000-0000-000000000001'$$, '42501',
  'A owner cannot delete org B dim_customer');
select tests.throws($$insert into public.fact_order_line (org_id, dataset_id, customer_id, invoice_id, invoice_ts, quantity, unit_price, line_revenue, is_cancellation)
  values ('b0000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000001', 'x', now(), 1, 1, 1, false)$$, '42501',
  'A owner cannot insert org B fact_order_line');
select tests.throws($$update public.pipeline_runs set status = 'cancelled' where org_id = 'b0000000-0000-0000-0000-000000000001'$$, '42501',
  'A owner cannot update org B pipeline_runs');
select tests.throws($$delete from public.pipeline_runs where org_id = 'd0000000-0000-0000-0000-000000000001'$$, '42501',
  'A owner cannot delete demo pipeline_runs');
select tests.throws($$update public.dim_product set description = 'x' where org_id = 'd0000000-0000-0000-0000-000000000001'$$, '42501',
  'A owner cannot update demo dim_product');

-- ===== Analyst of org A: dataset writes go through the API, not PostgREST ==============
select tests.login('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'analyst');
select tests.throws($$insert into public.dataset_column_mappings (dataset_id, org_id, mapping)
  values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '{}')$$, '42501',
  'analyst cannot insert mappings directly (API only)');

-- ===== Forged org claim: user of A presents org_id = B =================================
select tests.login('a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'owner');
select tests.eq((select count(*) from public.datasets) + (select count(*) from public.dataset_column_mappings)
                + (select count(*) from public.data_quality_reports), 0::bigint,
  'forged org_id claim sees no datasets, mappings or reports');
select tests.eq((select count(*) from public.fact_order_line where org_id <> 'd0000000-0000-0000-0000-000000000001')
                + (select count(*) from public.dim_customer where org_id <> 'd0000000-0000-0000-0000-000000000001')
                + (select count(*) from public.dim_product where org_id <> 'd0000000-0000-0000-0000-000000000001')
                + (select count(*) from public.pipeline_runs where org_id <> 'd0000000-0000-0000-0000-000000000001'), 0::bigint,
  'forged org_id claim sees no non-demo curated rows or runs');

-- ===== Non-member (no org claim): demo curated data + runs only ========================
select tests.login('c1000000-0000-0000-0000-000000000001');
select tests.eq((select count(*) from public.datasets), 0::bigint, 'non-member sees no datasets (demo datasets not exposed)');
select tests.eq((select array_agg(distinct org_id::text) from public.fact_order_line), array['d0000000-0000-0000-0000-000000000001'],
  'non-member sees only demo fact_order_line');
select tests.eq((select array_agg(distinct org_id::text) from public.dim_customer), array['d0000000-0000-0000-0000-000000000001'],
  'non-member sees only demo dim_customer');
select tests.eq((select array_agg(id::text) from public.pipeline_runs), array['ed000000-0000-0000-0000-000000000001'],
  'non-member sees only the demo run');
select tests.throws($$update public.fact_order_line set quantity = 1 where org_id = 'd0000000-0000-0000-0000-000000000001'$$, '42501',
  'non-member cannot write demo fact_order_line');

-- ===== Removed member loses access immediately ========================================
reset role;
delete from public.memberships where user_id = 'a4000000-0000-0000-0000-000000000001';
set local role authenticated;
select tests.login('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'viewer');
select tests.eq((select count(*) from public.datasets) + (select count(*) from public.fact_order_line where org_id = 'a0000000-0000-0000-0000-000000000001'),
  0::bigint, 'removed member with a still-valid token sees no org A datasets or facts');

-- ===== anon and the staging schema ====================================================
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select tests.throws($$select 1 from public.datasets$$, '42501', 'anon has no access to datasets');
select tests.throws($$select 1 from public.fact_order_line$$, '42501', 'anon has no access to fact_order_line');
select tests.throws($$select 1 from public.pipeline_runs$$, '42501', 'anon has no access to pipeline_runs');
select tests.throws($$select 1 from staging.raw_transactions$$, '42501', 'anon has no access to staging');
reset role;
set local role authenticated;
select tests.login('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'owner');
select tests.throws($$select 1 from staging.raw_transactions$$, '42501', 'authenticated has no access to staging');
reset role;

select tests.ok((select relpersistence = 'u' from pg_class where oid = 'staging.raw_transactions'::regclass),
  'staging.raw_transactions is UNLOGGED');
select tests.ok(not (select relrowsecurity from pg_class where oid = 'staging.raw_transactions'::regclass)
                and has_table_privilege('service_role', 'staging.raw_transactions', 'insert')
                and not has_table_privilege('authenticated', 'staging.raw_transactions', 'select'),
  'staging.raw_transactions: no RLS, service_role only');
select tests.ok(not has_table_privilege('authenticated', 'public.fact_order_line', 'insert')
                and not has_table_privilege('authenticated', 'public.pipeline_runs', 'update')
                and not has_table_privilege('authenticated', 'public.datasets', 'delete')
                and not has_sequence_privilege('authenticated', 'public.fact_order_line_id_seq', 'usage'),
  'authenticated holds no write privileges on the new tables');

-- ===== service_role (bypasses RLS) can do the worker's writes ==========================
set local role service_role;
select tests.lives($$
  delete from public.fact_order_line where dataset_id = 'da000000-0000-0000-0000-000000000001';
  insert into staging.raw_transactions (load_id, org_id, dataset_id, row_num, invoice_id)
    values (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 1, '489434');
  insert into public.fact_order_line (org_id, dataset_id, customer_id, invoice_id, invoice_ts, quantity, unit_price, line_revenue, is_cancellation)
    values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '489434', now(), 1, 1, 1, false);
  update public.pipeline_runs set progress_pct = 50 where id = 'ea000000-0000-0000-0000-000000000001';
  insert into public.dataset_column_mappings (dataset_id, org_id, mapping)
    values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
            '{"invoice_id":"I","invoice_ts":"D","customer_ref":"C","quantity":"Q","unit_price":"P"}')
    on conflict (dataset_id) do update set mapping = excluded.mapping$$,
  'service_role can load staging/curated rows, update runs and upsert mappings (CHECK fns executable)');
reset role;

rollback;
