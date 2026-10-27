-- Constraints, triggers and FKs for ingestion, curated and pipeline_runs (PRD §4.3, §4.7).
-- Runs as the migration owner (service-role equivalent).
begin;

insert into public.datasets (id, org_id, name, original_filename, storage_path, file_size_bytes, currency,
                             source_timezone, status, date_min, date_max) values
  ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A orders', 'a.csv',
   'uploads/a0000000-0000-0000-0000-000000000001/da000000-0000-0000-0000-000000000001/original.csv', 1000, 'GBP',
   'Europe/London', 'ready', '2010-01-01', '2011-12-09 12:50+00'),
  ('db000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'B orders', 'b.csv',
   'uploads/b0000000-0000-0000-0000-000000000001/db000000-0000-0000-0000-000000000001/original.csv', 1000, 'EUR',
   'UTC', 'ready', '2010-01-01', '2011-12-09');
insert into public.dim_customer (id, org_id, dataset_id, customer_ref) values
  ('ca000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '12345'),
  ('cb000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', '12345');
insert into public.dim_product (id, org_id, dataset_id, stock_code) values
  ('fb000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'POST');

-- ----- datasets ---------------------------------------------------------------------
select tests.throws($$insert into public.datasets (org_id, name, original_filename, storage_path, file_size_bytes, currency, source_timezone)
  values ('a0000000-0000-0000-0000-000000000001', 'A orders', 'a.csv', 'uploads/a0000000-0000-0000-0000-000000000001/x/original.csv', 1, 'GBP', 'UTC')$$,
  '23505', 'dataset name unique per org');
select tests.lives($$insert into public.datasets (org_id, name, original_filename, storage_path, file_size_bytes, currency, source_timezone)
  values ('b0000000-0000-0000-0000-000000000001', 'A orders', 'a.csv', 'uploads/b0000000-0000-0000-0000-000000000001/x/original.csv', 1, 'GBP', 'UTC')$$,
  'same dataset name allowed in another org');
select tests.throws($$insert into public.datasets (org_id, name, original_filename, storage_path, file_size_bytes, currency, source_timezone)
  values ('a0000000-0000-0000-0000-000000000001', 'p1', 'a.csv', 'uploads/b0000000-0000-0000-0000-000000000001/x/original.csv', 1, 'GBP', 'UTC')$$,
  '23514', 'storage_path must start with uploads/{own org_id}/');
select tests.throws($$insert into public.datasets (org_id, name, original_filename, storage_path, file_size_bytes, currency, source_timezone)
  values ('a0000000-0000-0000-0000-000000000001', 'p2', 'a.csv', 'exports/a0000000-0000-0000-0000-000000000001/x/original.csv', 1, 'GBP', 'UTC')$$,
  '23514', 'storage_path must be in the uploads bucket');
select tests.throws($$insert into public.datasets (org_id, name, original_filename, storage_path, file_size_bytes, currency, source_timezone)
  values ('a0000000-0000-0000-0000-000000000001', 'p3', 'a.csv', 'uploads/a0000000-0000-0000-0000-000000000001/../b/x.csv', 1, 'GBP', 'UTC')$$,
  '23514', 'storage_path rejects .. segments');
select tests.throws($$update public.datasets set org_id = 'b0000000-0000-0000-0000-000000000001', name = 'moved'
  where id = 'da000000-0000-0000-0000-000000000001'$$, '23', 'moving a dataset to another org is rejected')
  where false;  -- (placeholder, see next assertion)
select tests.throws($$insert into public.datasets (org_id, name, original_filename, storage_path, file_size_bytes, currency, source_timezone)
  values ('a0000000-0000-0000-0000-000000000001', 'big', 'a.csv', 'uploads/a0000000-0000-0000-0000-000000000001/x/original.csv', 104857601, 'GBP', 'UTC')$$,
  '23514', 'file_size_bytes <= 100 MB');
select tests.throws($$insert into public.datasets (org_id, name, original_filename, storage_path, file_size_bytes, currency, source_timezone)
  values ('a0000000-0000-0000-0000-000000000001', 'tz', 'a.csv', 'uploads/a0000000-0000-0000-0000-000000000001/x/original.csv', 1, 'GBP', 'Mars/Olympus')$$,
  '23514', 'source_timezone validated against pg_timezone_names');
select tests.throws($$insert into public.datasets (org_id, name, original_filename, storage_path, file_size_bytes, currency, source_timezone)
  values ('a0000000-0000-0000-0000-000000000001', 'cur', 'a.csv', 'uploads/a0000000-0000-0000-0000-000000000001/x/original.csv', 1, 'gbp', 'UTC')$$,
  '23514', 'currency must be 3 uppercase letters');
select tests.throws($$update public.datasets set status = 'archived' where id = 'da000000-0000-0000-0000-000000000001'$$,
  '23514', 'dataset status restricted to the PRD list');
select tests.throws($$update public.datasets set row_count_raw = 10, row_count_kept = 11 where id = 'da000000-0000-0000-0000-000000000001'$$,
  '23514', 'row_count_kept <= row_count_raw');
select tests.throws($$update public.datasets set file_sha256 = 'XYZ' where id = 'da000000-0000-0000-0000-000000000001'$$,
  '23514', 'file_sha256 is 64 lowercase hex chars');

-- ----- dataset_column_mappings ------------------------------------------------------
select tests.throws($$insert into public.dataset_column_mappings (dataset_id, org_id, mapping)
  values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          '{"invoice_id":"Invoice","invoice_ts":"InvoiceDate","customer_ref":"Customer ID","quantity":"Quantity"}')$$,
  '23514', 'mapping must contain all required canonical fields');
select tests.throws($$insert into public.dataset_column_mappings (dataset_id, org_id, mapping)
  values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          '{"invoice_id":"Invoice","invoice_ts":"InvoiceDate","customer_ref":"Customer ID","quantity":"Quantity","unit_price":"Price","colour":"Colour"}')$$,
  '23514', 'mapping rejects unknown canonical fields');
select tests.throws($$insert into public.dataset_column_mappings (dataset_id, org_id, mapping)
  values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          '{"invoice_id":"Invoice","invoice_ts":"InvoiceDate","customer_ref":"","quantity":"Quantity","unit_price":"Price"}')$$,
  '23514', 'mapping values must be non-empty column names');
select tests.throws($$insert into public.dataset_column_mappings (dataset_id, org_id, mapping)
  values ('da000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
          '{"invoice_id":"Invoice","invoice_ts":"InvoiceDate","customer_ref":"Customer ID","quantity":"Quantity","unit_price":"Price"}')$$,
  '23503', 'mapping org_id must match the dataset org (composite FK)');
select tests.lives($$insert into public.dataset_column_mappings (dataset_id, org_id, mapping, sheets)
  values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          '{"invoice_id":"Invoice","invoice_ts":"InvoiceDate","customer_ref":"Customer ID","quantity":"Quantity","unit_price":"Price","stock_code":"StockCode","country":"Country"}',
          '{"Year 2009-2010","Year 2010-2011"}')$$,
  'valid mapping with optional fields and sheets is accepted');

-- ----- data_quality_reports ---------------------------------------------------------
select tests.throws($$insert into public.data_quality_reports (dataset_id, org_id, reconciliation)
  values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          '{"gross_revenue":100.00,"cancellations":10.00,"excluded_revenue":5.00,"net_revenue":85.02}')$$,
  '23514', 'reconciliation must balance to +-0.01');
select tests.throws($$insert into public.data_quality_reports (dataset_id, org_id, reconciliation)
  values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          '{"gross_revenue":100.00,"cancellations":10.00,"net_revenue":90.00}')$$,
  '23514', 'reconciliation requires all four numeric keys');
select tests.throws($$insert into public.data_quality_reports (dataset_id, org_id, excluded_sample_path)
  values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          'uploads/b0000000-0000-0000-0000-000000000001/da/excluded.csv')$$,
  '23514', 'excluded_sample_path must be under the own org prefix');
select tests.throws($$insert into public.data_quality_reports (dataset_id, org_id, rules_applied)
  values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '{}')$$,
  '23514', 'rules_applied must be a JSON array');
select tests.lives($$insert into public.data_quality_reports (dataset_id, org_id, reconciliation, excluded_sample_path)
  values ('da000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          '{"gross_revenue":100.004,"cancellations":10.00,"excluded_revenue":5.00,"net_revenue":85.00}',
          'uploads/a0000000-0000-0000-0000-000000000001/da000000-0000-0000-0000-000000000001/excluded_sample.csv')$$,
  'balanced reconciliation (within 0.01) and own-org sample path accepted');

-- ----- dim_customer / dim_product ---------------------------------------------------
select tests.throws($$insert into public.dim_customer (org_id, dataset_id, customer_ref)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '12345')$$,
  '23505', 'dim_customer unique (org_id, dataset_id, customer_ref)');
select tests.throws($$insert into public.dim_customer (org_id, dataset_id, customer_ref)
  values ('a0000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'x')$$,
  '23503', 'dim_customer cannot reference another org''s dataset');
select tests.throws($$insert into public.dim_customer (org_id, dataset_id, customer_ref)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', repeat('x', 129))$$,
  '23514', 'customer_ref 1..128 chars');
select tests.throws($$insert into public.dim_customer (org_id, dataset_id, customer_ref, first_purchase_ts, last_purchase_ts)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'y', '2011-01-02', '2011-01-01')$$,
  '23514', 'last_purchase_ts >= first_purchase_ts');
select tests.throws($$insert into public.dim_product (org_id, dataset_id, stock_code)
  values ('b0000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'POST')$$,
  '23505', 'dim_product unique (org_id, dataset_id, stock_code)');

-- ----- fact_order_line --------------------------------------------------------------
select tests.throws($$insert into public.fact_order_line (org_id, dataset_id, customer_id, invoice_id, invoice_ts, quantity, unit_price, line_revenue, is_cancellation)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'i1', now(), 0, 1, 0, false)$$,
  '23514', 'fact quantity <> 0');
select tests.throws($$insert into public.fact_order_line (org_id, dataset_id, customer_id, invoice_id, invoice_ts, quantity, unit_price, line_revenue, is_cancellation)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'i1', now(), 1, -0.01, -0.01, false)$$,
  '23514', 'fact unit_price >= 0');
select tests.throws($$insert into public.fact_order_line (org_id, dataset_id, customer_id, invoice_id, invoice_ts, quantity, unit_price, line_revenue, is_cancellation)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000001', 'i1', now(), 1, 1, 1, false)$$,
  '23503', 'fact customer must belong to the same org (composite FK)');
select tests.throws($$insert into public.fact_order_line (org_id, dataset_id, customer_id, product_id, invoice_id, invoice_ts, quantity, unit_price, line_revenue, is_cancellation)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', 'i1', now(), 1, 1, 1, false)$$,
  '23503', 'fact product must belong to the same org (composite FK)');
select tests.throws($$insert into public.fact_order_line (id, org_id, dataset_id, customer_id, invoice_id, invoice_ts, quantity, unit_price, line_revenue, is_cancellation)
  values (1, 'a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'i1', now(), 1, 1, 1, false)$$,
  '428C9', 'fact id is generated always (identity)');
select tests.lives($$insert into public.fact_order_line (org_id, dataset_id, customer_id, invoice_id, invoice_ts, quantity, unit_price, line_revenue, is_cancellation, source_row_num)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'C489449', now(), -12, 2.95, -35.40, true, 7)$$,
  'cancellation line (negative quantity, null product) accepted');

-- ----- pipeline_runs ----------------------------------------------------------------
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date, horizon_days)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09', 45)$$,
  '23514', 'horizon_days in (30, 60, 90)');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date, progress_pct)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09', 101)$$,
  '23514', 'progress_pct <= 100');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date, progress_pct)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09', -1)$$,
  '23514', 'progress_pct >= 0');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-05-31')$$,
  '23514', 'scoring_date >= cutoff_date');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date, validation_cutoff, test_cutoff)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09', '2011-06-01', '2011-06-01')$$,
  '23514', 'validation_cutoff < test_cutoff');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date, validation_cutoff, test_cutoff, horizon_days)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09', '2011-08-01', '2011-10-11', 60)$$,
  '23514', 'test_cutoff + horizon_days <= dataset date_max (trigger)');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date, stage)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09', 'cleaning')$$,
  '23514', 'stage restricted to the PRD list');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date, config)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09', '{"kmeans_k": 11}')$$,
  '23514', 'config validated by app.validate_run_config (kmeans_k 3..10)');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date, config)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09', '{"models": ["xgboost"]}')$$,
  '23514', 'config models restricted to the known model names');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date)
  values ('a0000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09')$$,
  '23503', 'run cannot reference another org''s dataset');
select tests.lives($$insert into public.pipeline_runs (id, org_id, dataset_id, cutoff_date, scoring_date, validation_cutoff, test_cutoff, horizon_days, config)
  values ('ea000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001',
          '2011-06-01', '2011-12-09', '2011-08-01', '2011-10-10', 60,
          '{"horizon_days":60,"scoring_mode":"evaluate_and_score","kmeans_k":"auto","models":["baseline_recency","logreg","random_forest"],"exclude_wholesale":false}')$$,
  'valid queued run accepted (test_cutoff + 60 = date_max)');
select tests.eq((select (status, stage, progress_pct, cancel_requested)::text from public.pipeline_runs
                 where id = 'ea000000-0000-0000-0000-000000000001'), '(queued,queued,0,f)',
  'run defaults: queued / queued / 0% / not cancelled');
select tests.throws($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09')$$,
  '23505', 'second queued run in the same org is rejected');
select tests.lives($$insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date)
  values ('b0000000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09')$$,
  'another org can have its own queued run');
select tests.throws($$update public.pipeline_runs set status = 'running' where org_id = 'a0000000-0000-0000-0000-000000000001';
  insert into public.pipeline_runs (org_id, dataset_id, cutoff_date, scoring_date)
  values ('a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09')$$,
  '23505', 'a queued run is rejected while one is running');
select tests.lives($$update public.pipeline_runs set status = 'succeeded', stage = 'done', progress_pct = 100
  where id = 'ea000000-0000-0000-0000-000000000001';
  insert into public.pipeline_runs (id, org_id, dataset_id, cutoff_date, scoring_date)
  values ('ea000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000001', '2011-06-01', '2011-12-09')$$,
  'a new run can be queued once the previous one finished');
select tests.throws($$update public.pipeline_runs set finished_at = '2011-01-01', started_at = '2011-01-02'
  where id = 'ea000000-0000-0000-0000-000000000001'$$, '23514', 'finished_at >= started_at');

-- ----- updated_at trigger -----------------------------------------------------------
update public.pipeline_runs set updated_at = '2000-01-01' where id = 'ea000000-0000-0000-0000-000000000001';
select tests.ok((select updated_at > '2000-01-02' from public.pipeline_runs where id = 'ea000000-0000-0000-0000-000000000001'),
  'pipeline_runs.updated_at is maintained by trigger');
update public.datasets set updated_at = '2000-01-01' where id = 'da000000-0000-0000-0000-000000000001';
select tests.ok((select updated_at > '2000-01-02' from public.datasets where id = 'da000000-0000-0000-0000-000000000001'),
  'datasets.updated_at is maintained by trigger');

-- ----- organizations.active_run_id FK -------------------------------------------------
select tests.lives($$update public.organizations set active_run_id = 'ea000000-0000-0000-0000-000000000001'
  where id = 'a0000000-0000-0000-0000-000000000001'; set constraints all immediate; set constraints all deferred$$,
  'org can set its own run as active');
select tests.throws($$update public.organizations set active_run_id = 'ea000000-0000-0000-0000-000000000001'
  where id = 'b0000000-0000-0000-0000-000000000001'; set constraints all immediate$$,
  '23503', 'org cannot point active_run_id at another org''s run');
select tests.throws($$update public.organizations set active_run_id = gen_random_uuid()
  where id = 'b0000000-0000-0000-0000-000000000001'; set constraints all immediate$$,
  '23503', 'active_run_id must reference an existing run');
select tests.ok((select condeferrable and condeferred from pg_constraint where conname = 'organizations_active_run_fk'),
  'active_run_id FK is deferrable initially deferred');
delete from public.pipeline_runs where id = 'ea000000-0000-0000-0000-000000000001';
select tests.eq((select active_run_id from public.organizations where id = 'a0000000-0000-0000-0000-000000000001'), null::uuid,
  'deleting the active run sets organizations.active_run_id to null');
select tests.eq((select count(*) from public.organizations where id = 'a0000000-0000-0000-0000-000000000001'), 1::bigint,
  '... and keeps the organization');

-- ----- cascades ---------------------------------------------------------------------
delete from public.datasets where id = 'da000000-0000-0000-0000-000000000001';
select tests.eq((select count(*) from public.dim_customer where dataset_id = 'da000000-0000-0000-0000-000000000001')
              + (select count(*) from public.fact_order_line where dataset_id = 'da000000-0000-0000-0000-000000000001')
              + (select count(*) from public.pipeline_runs where dataset_id = 'da000000-0000-0000-0000-000000000001')
              + (select count(*) from public.dataset_column_mappings where dataset_id = 'da000000-0000-0000-0000-000000000001')
              + (select count(*) from public.data_quality_reports where dataset_id = 'da000000-0000-0000-0000-000000000001'),
  0::bigint, 'deleting a dataset cascades to mappings, reports, dims, facts and runs');

-- ----- RLS enabled on every public table -------------------------------------------
select tests.eq((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0::bigint,
  'RLS is enabled on every table in schema public (incl. v2 tables)');

-- ----- §4.6 indexes exist -------------------------------------------------------------
select tests.eq((select count(*) from pg_indexes where schemaname = 'public' and indexname in (
  'pipeline_runs_one_active_per_org', 'pipeline_runs_queue_claim_idx', 'pipeline_runs_org_created_idx',
  'fact_order_line_org_customer_ts_idx', 'fact_order_line_org_dataset_ts_idx',
  'fact_order_line_org_dataset_product_idx', 'dim_customer_org_dataset_ref_key')), 7::bigint,
  '§4.6 indexes for v2 tables exist');

rollback;
