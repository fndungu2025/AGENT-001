-- =====================================================================================
-- 20261021025145_ingestion_curated.sql  (schema v2: roadmap M1 deliverables 3 + 4;
-- F-03, F-04, F-05; PRD §4.3 "Data ingestion", "Curated (star schema)", pipeline_runs
-- from "Analytics outputs"; §4.4 RLS + Storage RLS; §4.6 indexes; §4.7 validation)
--
-- Creates:
--   * app.validate_mapping(jsonb), app.validate_run_config(jsonb),
--     app.reconciliation_balanced(jsonb), trigger fns app.validate_storage_path(),
--     app.validate_source_timezone(), app.validate_run_test_cutoff()
--   * public.datasets, dataset_column_mappings, data_quality_reports
--   * schema staging + UNLOGGED staging.raw_transactions (service role only, no RLS)
--   * public.dim_customer, dim_product, fact_order_line
--   * public.pipeline_runs (+ one queued/running run per org, queue-claim index)
--   * FK organizations(id, active_run_id) -> pipeline_runs(org_id, id)
--       on delete set null (active_run_id) deferrable initially deferred
--   * private storage buckets uploads / models / exports + storage.objects policies
--
-- Not here (later milestones): customer_* / kmeans_clusters / model_evaluations (M2),
-- the pg_trgm GIN index on dim_customer.customer_ref (needs extension pg_trgm: escalated).
-- =====================================================================================

-- ---------------------------------------------------------------------------------
-- Validation helpers
-- ---------------------------------------------------------------------------------

-- F-03 canonical fields: 5 required + 5 optional. Values are source column names
-- (non-empty strings). Unknown keys are rejected.
create function app.validate_mapping(m jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
begin
  if m is null or jsonb_typeof(m) <> 'object' then
    return false;
  end if;
  if not (m ?& array['invoice_id', 'invoice_ts', 'customer_ref', 'quantity', 'unit_price']) then
    return false;
  end if;
  for k, v in select * from jsonb_each(m) loop
    if k not in ('invoice_id', 'invoice_ts', 'customer_ref', 'quantity', 'unit_price',
                 'stock_code', 'description', 'country', 'is_cancellation', 'line_total') then
      return false;
    end if;
    if jsonb_typeof(v) <> 'string' or btrim(v #>> '{}') = '' then
      return false;
    end if;
  end loop;
  return true;
end
$$;

-- F-05 run configuration. Validates the known keys' types/ranges; extra keys are allowed
-- (forward compatibility; the API validates strictly with Pydantic).
create function app.validate_run_config(c jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  m jsonb;
begin
  if c is null or jsonb_typeof(c) <> 'object' then
    return false;
  end if;
  if c ? 'horizon_days' and (jsonb_typeof(c -> 'horizon_days') <> 'number'
                             or (c ->> 'horizon_days') not in ('30', '60', '90')) then
    return false;
  end if;
  if c ? 'scoring_mode' and (c ->> 'scoring_mode') is distinct from 'evaluate_and_score' then
    return false;
  end if;
  if c ? 'kmeans_k' then
    if jsonb_typeof(c -> 'kmeans_k') = 'string' then
      if (c ->> 'kmeans_k') <> 'auto' then return false; end if;
    elsif jsonb_typeof(c -> 'kmeans_k') = 'number' then
      if (c ->> 'kmeans_k') !~ '^[0-9]+$' or (c ->> 'kmeans_k')::int not between 3 and 10 then
        return false;
      end if;
    else
      return false;
    end if;
  end if;
  if c ? 'models' then
    if jsonb_typeof(c -> 'models') <> 'array' or jsonb_array_length(c -> 'models') = 0 then
      return false;
    end if;
    for m in select * from jsonb_array_elements(c -> 'models') loop
      if jsonb_typeof(m) <> 'string'
         or (m #>> '{}') not in ('baseline_recency', 'logreg', 'random_forest', 'bgnbd') then
        return false;
      end if;
    end loop;
  end if;
  if c ? 'exclude_wholesale' and jsonb_typeof(c -> 'exclude_wholesale') <> 'boolean' then
    return false;
  end if;
  if c ? 'cutoff_date' and (jsonb_typeof(c -> 'cutoff_date') <> 'string'
                            or (c ->> 'cutoff_date') !~ '^\d{4}-\d{2}-\d{2}$') then
    return false;
  end if;
  if c ? 'dataset_id' and (jsonb_typeof(c -> 'dataset_id') <> 'string'
       or (c ->> 'dataset_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    return false;
  end if;
  return true;
end
$$;

-- data_quality_reports.reconciliation: net = gross - cancellations - excluded (±0.01).
-- All four keys must be JSON numbers. NULL (report not yet computed) passes.
create function app.reconciliation_balanced(r jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if r is null then
    return true;
  end if;
  if jsonb_typeof(r) <> 'object'
     or coalesce(jsonb_typeof(r -> 'gross_revenue'), '')    <> 'number'
     or coalesce(jsonb_typeof(r -> 'cancellations'), '')    <> 'number'
     or coalesce(jsonb_typeof(r -> 'excluded_revenue'), '') <> 'number'
     or coalesce(jsonb_typeof(r -> 'net_revenue'), '')      <> 'number' then
    return false;
  end if;
  return abs((r ->> 'net_revenue')::numeric
             - ((r ->> 'gross_revenue')::numeric
                - (r ->> 'cancellations')::numeric
                - (r ->> 'excluded_revenue')::numeric)) <= 0.01;
end
$$;

-- Storage path prefix equals the row's org (PRD §4.3 datasets, §4.7):
--   TG_ARGV[0] = column name, TG_ARGV[1] = required bucket ('' / omitted = any bucket).
-- Path format: '{bucket}/{org_id}/...'. NULL paths pass (use NOT NULL where required).
create function app.validate_storage_path() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_col    text := tg_argv[0];
  v_bucket text := nullif(coalesce(tg_argv[1], ''), '');
  v_path   text := to_jsonb(new) ->> v_col;
  v_org    text := to_jsonb(new) ->> 'org_id';
begin
  if v_path is null then
    return new;
  end if;
  if split_part(v_path, '/', 2) is distinct from v_org
     or split_part(v_path, '/', 3) = ''
     or (v_bucket is not null and split_part(v_path, '/', 1) <> v_bucket)
     or (v_bucket is null and split_part(v_path, '/', 1) not in ('uploads', 'models', 'exports'))
     or v_path ~ '(^|/)\.\.?(/|$)' then
    raise exception '%.% must start with %/%/ (got %)', tg_table_name, v_col,
      coalesce(v_bucket, '{bucket}'), v_org, v_path
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- datasets.source_timezone validated against pg_timezone_names (same rule as v1 timezones).
create function app.validate_source_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.source_timezone) then
    raise exception 'invalid source_timezone: %', new.source_timezone
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke execute on function app.validate_mapping(jsonb), app.validate_run_config(jsonb),
  app.reconciliation_balanced(jsonb), app.validate_storage_path(),
  app.validate_source_timezone() from public;
-- CHECK constraints call these as the writing role (service role / table owner).
grant execute on function app.validate_mapping(jsonb), app.validate_run_config(jsonb),
  app.reconciliation_balanced(jsonb) to service_role;

-- ---------------------------------------------------------------------------------
-- datasets
-- ---------------------------------------------------------------------------------
create table public.datasets (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 120),
  source_type       text not null default 'upload' check (source_type in ('upload', 'demo', 'connector')),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  storage_path      text not null,
  file_size_bytes   bigint not null check (file_size_bytes between 1 and 104857600),
  file_sha256       text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  currency          char(3) not null check (currency ~ '^[A-Z]{3}$'),
  source_timezone   text not null,
  status            text not null default 'uploaded'
                      check (status in ('uploaded', 'mapping', 'processing', 'ready', 'failed', 'deleting')),
  row_count_raw     int check (row_count_raw >= 0),
  row_count_kept    int check (row_count_kept >= 0),
  date_min          timestamptz,
  date_max          timestamptz,
  error_message     text,
  uploaded_by       uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint datasets_org_name_key unique (org_id, name),
  constraint datasets_org_id_id_key unique (org_id, id),          -- target of composite FKs
  constraint datasets_kept_le_raw check (row_count_kept <= row_count_raw),
  constraint datasets_date_range check (date_max >= date_min)
);
create index datasets_org_created_idx on public.datasets (org_id, created_at desc);
-- Duplicate-upload detection (warn, don't block).
create index datasets_org_sha256_idx on public.datasets (org_id, file_sha256) where file_sha256 is not null;
create index datasets_uploaded_by_idx on public.datasets (uploaded_by);

create trigger datasets_set_updated_at before update on public.datasets
  for each row execute function app.set_updated_at();
create trigger datasets_validate_storage_path before insert or update of storage_path, org_id
  on public.datasets for each row execute function app.validate_storage_path('storage_path', 'uploads');
create trigger datasets_validate_timezone before insert or update of source_timezone
  on public.datasets for each row execute function app.validate_source_timezone();

-- ---------------------------------------------------------------------------------
-- dataset_column_mappings (1:1 with datasets)
-- ---------------------------------------------------------------------------------
create table public.dataset_column_mappings (
  dataset_id       uuid primary key,
  org_id           uuid not null references public.organizations (id) on delete cascade,
  mapping          jsonb not null check (app.validate_mapping(mapping)),
  date_format      text not null default 'auto' check (char_length(date_format) between 1 and 64),
  sheets           text[],
  header_signature text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint dataset_column_mappings_dataset_fk foreign key (org_id, dataset_id)
    references public.datasets (org_id, id) on delete cascade
);
-- Mapping reuse lookup (F-03 AC6).
create index dataset_column_mappings_org_signature_idx
  on public.dataset_column_mappings (org_id, header_signature);
create index dataset_column_mappings_org_dataset_idx
  on public.dataset_column_mappings (org_id, dataset_id);

create trigger dataset_column_mappings_set_updated_at before update on public.dataset_column_mappings
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------
-- data_quality_reports (1:1 with datasets)
-- ---------------------------------------------------------------------------------
create table public.data_quality_reports (
  dataset_id           uuid primary key,
  org_id               uuid not null references public.organizations (id) on delete cascade,
  rules_applied        jsonb not null default '[]' check (jsonb_typeof(rules_applied) = 'array'),
  reconciliation       jsonb check (app.reconciliation_balanced(reconciliation)),
  profile              jsonb not null default '{}' check (jsonb_typeof(profile) = 'object'),
  warnings             jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  excluded_sample_path text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint data_quality_reports_dataset_fk foreign key (org_id, dataset_id)
    references public.datasets (org_id, id) on delete cascade
);
create index data_quality_reports_org_dataset_idx on public.data_quality_reports (org_id, dataset_id);

create trigger data_quality_reports_set_updated_at before update on public.data_quality_reports
  for each row execute function app.set_updated_at();
create trigger data_quality_reports_validate_path before insert or update of excluded_sample_path, org_id
  on public.data_quality_reports for each row
  execute function app.validate_storage_path('excluded_sample_path', '');

-- ---------------------------------------------------------------------------------
-- staging.raw_transactions: UNLOGGED COPY target, truncated after each load.
-- Not exposed through the API: no grants to anon/authenticated, no RLS.
-- ---------------------------------------------------------------------------------
create schema staging;
revoke all on schema staging from public;
grant usage on schema staging to service_role;

create unlogged table staging.raw_transactions (
  load_id          uuid not null,
  org_id           uuid not null,
  dataset_id       uuid not null,
  row_num          int not null,
  invoice_id       text,
  invoice_ts_raw   text,
  customer_ref_raw text,
  stock_code       text,
  description      text,
  quantity_raw     text,
  unit_price_raw   text,
  country          text,
  line_total_raw   text
);
revoke all on staging.raw_transactions from public, anon, authenticated;
grant all on staging.raw_transactions to service_role;

-- ---------------------------------------------------------------------------------
-- Curated star schema. Written only by the worker (delete + re-insert per dataset).
-- Rows are immutable once loaded, so no updated_at.
-- ---------------------------------------------------------------------------------
create table public.dim_customer (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  dataset_id        uuid not null,
  customer_ref      text not null check (char_length(customer_ref) between 1 and 128),
  country           text,
  first_purchase_ts timestamptz,
  last_purchase_ts  timestamptz,
  is_wholesale      boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint dim_customer_dataset_fk foreign key (org_id, dataset_id)
    references public.datasets (org_id, id) on delete cascade,
  constraint dim_customer_org_dataset_ref_key unique (org_id, dataset_id, customer_ref),
  constraint dim_customer_org_id_id_key unique (org_id, id),
  constraint dim_customer_purchase_order check (last_purchase_ts >= first_purchase_ts)
);

create table public.dim_product (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  dataset_id     uuid not null,
  stock_code     text not null check (char_length(stock_code) between 1 and 64),
  description    text,
  is_non_product boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint dim_product_dataset_fk foreign key (org_id, dataset_id)
    references public.datasets (org_id, id) on delete cascade,
  constraint dim_product_org_dataset_code_key unique (org_id, dataset_id, stock_code),
  constraint dim_product_org_id_id_key unique (org_id, id)
);

create table public.fact_order_line (
  id              bigint generated always as identity primary key,
  org_id          uuid not null references public.organizations (id) on delete cascade,
  dataset_id      uuid not null,
  customer_id     uuid not null,
  product_id      uuid,
  invoice_id      text not null check (char_length(invoice_id) >= 1),
  invoice_ts      timestamptz not null,
  quantity        numeric(14, 3) not null check (quantity <> 0),
  unit_price      numeric(14, 4) not null check (unit_price >= 0),
  line_revenue    numeric(16, 4) not null,
  is_cancellation boolean not null,
  source_row_num  int check (source_row_num >= 0),
  created_at      timestamptz not null default now(),
  constraint fact_order_line_dataset_fk foreign key (org_id, dataset_id)
    references public.datasets (org_id, id) on delete cascade,
  constraint fact_order_line_customer_fk foreign key (org_id, customer_id)
    references public.dim_customer (org_id, id) on delete cascade,
  constraint fact_order_line_product_fk foreign key (org_id, product_id)
    references public.dim_product (org_id, id) on delete cascade
);
-- §4.6
create index fact_order_line_org_customer_ts_idx on public.fact_order_line (org_id, customer_id, invoice_ts);
create index fact_order_line_org_dataset_ts_idx  on public.fact_order_line (org_id, dataset_id, invoice_ts);
create index fact_order_line_org_dataset_product_idx on public.fact_order_line (org_id, dataset_id, product_id);

-- ---------------------------------------------------------------------------------
-- pipeline_runs
-- ---------------------------------------------------------------------------------
create table public.pipeline_runs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  dataset_id        uuid not null,
  status            text not null default 'queued'
                      check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stage             text not null default 'queued'
                      check (stage in ('queued', 'loading', 'features', 'segmentation', 'training',
                                       'evaluation', 'scoring', 'publishing', 'done')),
  progress_pct      smallint not null default 0 check (progress_pct between 0 and 100),
  config            jsonb not null default '{}' check (app.validate_run_config(config)),
  cutoff_date       date not null,
  scoring_date      date not null,
  horizon_days      smallint not null default 60 check (horizon_days in (30, 60, 90)),
  train_cutoffs     date[],
  validation_cutoff date,
  test_cutoff       date,
  kmeans_k          smallint check (kmeans_k between 3 and 10),
  selected_model    text check (selected_model in ('baseline_recency', 'logreg', 'random_forest', 'bgnbd')),
  flags             text[] not null default '{}',
  summary           jsonb,
  environment       jsonb,
  error_code        text check (error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  error_message     text check (char_length(error_message) <= 2000),
  created_by        uuid references public.profiles (id) on delete set null,
  started_at        timestamptz,
  finished_at       timestamptz,
  cancel_requested  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint pipeline_runs_dataset_fk foreign key (org_id, dataset_id)
    references public.datasets (org_id, id) on delete cascade,
  constraint pipeline_runs_org_id_id_key unique (org_id, id),     -- target of composite FKs
  constraint pipeline_runs_scoring_after_cutoff check (scoring_date >= cutoff_date),
  constraint pipeline_runs_validation_before_test check (validation_cutoff < test_cutoff),
  constraint pipeline_runs_finished_after_started check (finished_at >= started_at)
);
-- §4.6: one active (queued/running) run per org (MVP); worker queue claim; history.
create unique index pipeline_runs_one_active_per_org on public.pipeline_runs (org_id)
  where status in ('queued', 'running');
create index pipeline_runs_queue_claim_idx on public.pipeline_runs (created_at) where status = 'queued';
create index pipeline_runs_org_created_idx on public.pipeline_runs (org_id, created_at desc);
create index pipeline_runs_org_dataset_idx on public.pipeline_runs (org_id, dataset_id);
create index pipeline_runs_created_by_idx on public.pipeline_runs (created_by);

create trigger pipeline_runs_set_updated_at before update on public.pipeline_runs
  for each row execute function app.set_updated_at();

-- test_cutoff + horizon_days <= dataset.date_max (PRD §4.3; date_max compared as a UTC date).
create function app.validate_run_test_cutoff() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_date_max timestamptz;
begin
  if new.test_cutoff is null then
    return new;
  end if;
  select d.date_max into v_date_max
  from public.datasets d where d.id = new.dataset_id and d.org_id = new.org_id;
  if v_date_max is not null
     and new.test_cutoff + new.horizon_days > (v_date_max at time zone 'UTC')::date then
    raise exception 'test_cutoff % + horizon % days is after dataset date_max %',
      new.test_cutoff, new.horizon_days, v_date_max
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke execute on function app.validate_run_test_cutoff() from public;

create trigger pipeline_runs_validate_test_cutoff
  before insert or update of test_cutoff, horizon_days, dataset_id on public.pipeline_runs
  for each row execute function app.validate_run_test_cutoff();

-- Deferred from v1: organizations.active_run_id -> pipeline_runs. Composite with the org id
-- so an org can only point at its own run; deleting the run nulls only active_run_id.
alter table public.organizations
  add constraint organizations_active_run_fk foreign key (id, active_run_id)
    references public.pipeline_runs (org_id, id)
    on delete set null (active_run_id)
    deferrable initially deferred;
comment on column public.organizations.active_run_id is
  'Active analysis run. FK (id, active_run_id) -> pipeline_runs(org_id, id) on delete set null, deferrable.';

-- Realtime (F-05 AC3): publish run rows (RLS applies to Realtime subscribers).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.pipeline_runs;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------
-- Privileges: end users only read. Ingestion writes go through FastAPI (service role);
-- curated tables and runs are written only by the worker (service role).
-- ---------------------------------------------------------------------------------
revoke all on public.datasets, public.dataset_column_mappings, public.data_quality_reports,
  public.dim_customer, public.dim_product, public.fact_order_line, public.pipeline_runs
  from anon, authenticated;
revoke all on sequence public.fact_order_line_id_seq from anon, authenticated;
grant select on public.datasets, public.dataset_column_mappings, public.data_quality_reports,
  public.dim_customer, public.dim_product, public.fact_order_line, public.pipeline_runs
  to authenticated;
grant all on public.datasets, public.dataset_column_mappings, public.data_quality_reports,
  public.dim_customer, public.dim_product, public.fact_order_line, public.pipeline_runs
  to service_role;
grant usage, select on sequence public.fact_order_line_id_seq to service_role;

-- ---------------------------------------------------------------------------------
-- RLS (PRD §4.4). Helper calls are wrapped in (select ...) so they are evaluated once
-- per statement (initplan), not once per row: matters on fact_order_line.
-- ---------------------------------------------------------------------------------
alter table public.datasets                enable row level security;
alter table public.dataset_column_mappings enable row level security;
alter table public.data_quality_reports    enable row level security;
alter table public.dim_customer            enable row level security;
alter table public.dim_product             enable row level security;
alter table public.fact_order_line         enable row level security;
alter table public.pipeline_runs           enable row level security;

-- datasets, mappings, quality reports: viewer+ of the active org (no demo per §4.4).
create policy "read own org" on public.datasets for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_role('viewer')));
create policy "read own org" on public.dataset_column_mappings for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_role('viewer')));
create policy "read own org" on public.data_quality_reports for select to authenticated
  using (org_id = (select app.current_org_id()) and (select app.has_role('viewer')));

-- dim_*, fact_*, analytics outputs: viewer+ of the active org, plus the demo org.
create policy "read own org or demo" on public.dim_customer for select to authenticated
  using ((org_id = (select app.current_org_id()) and (select app.has_role('viewer')))
         or org_id = (select app.demo_org_id()));
create policy "read own org or demo" on public.dim_product for select to authenticated
  using ((org_id = (select app.current_org_id()) and (select app.has_role('viewer')))
         or org_id = (select app.demo_org_id()));
create policy "read own org or demo" on public.fact_order_line for select to authenticated
  using ((org_id = (select app.current_org_id()) and (select app.has_role('viewer')))
         or org_id = (select app.demo_org_id()));
create policy "read own org or demo" on public.pipeline_runs for select to authenticated
  using ((org_id = (select app.current_org_id()) and (select app.has_role('viewer')))
         or org_id = (select app.demo_org_id()));

-- ---------------------------------------------------------------------------------
-- Storage (PRD §4.4 Storage RLS). Object names are '{org_id}/...' inside each bucket.
--   uploads: original files (browser upload via signed URL), normalized.parquet,
--            excluded-row samples. 100 MB limit, CSV/XLSX (+ parquet for the worker).
--   models, exports: written only by the service role.
-- ---------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('uploads', 'uploads', false, 104857600,
   array['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.apache.parquet']),
  ('models',  'models',  false, null, null),
  ('exports', 'exports', false, null, null)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "ciq uploads: read own org (viewer+)" on storage.objects for select to authenticated
  using (bucket_id = 'uploads'
         and (storage.foldername(name))[1] = (select app.current_org_id())::text
         and (select app.has_role('viewer')));
create policy "ciq uploads: insert own org (analyst+)" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads'
              and (storage.foldername(name))[1] = (select app.current_org_id())::text
              and (select app.has_role('analyst')));
create policy "ciq models: read own org (viewer+)" on storage.objects for select to authenticated
  using (bucket_id = 'models'
         and (storage.foldername(name))[1] = (select app.current_org_id())::text
         and (select app.has_role('viewer')));
create policy "ciq exports: read own org (analyst+)" on storage.objects for select to authenticated
  using (bucket_id = 'exports'
         and (storage.foldername(name))[1] = (select app.current_org_id())::text
         and (select app.has_role('analyst')));
