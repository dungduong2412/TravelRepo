-- Additive controls and provenance needed for a lossless, repeatable V1 import.
-- This migration does not import customer data or assign business meanings to
-- legacy numeric status values.

begin;

create table if not exists public.legacy_tenant_evidence (
  legacy_tenant_id uuid primary key,
  source_tenant_name text,
  source_normalized_name text,
  source_domain text,
  evidence jsonb not null default '{}'::jsonb,
  identification_status text not null default 'candidate',
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint legacy_tenant_evidence_status_ck check (
    identification_status in ('candidate', 'verified', 'rejected')
  )
);

create table if not exists public.legacy_migration_batches (
  id uuid primary key default gen_random_uuid(),
  legacy_tenant_id uuid references public.legacy_tenant_evidence(legacy_tenant_id),
  source_snapshot_at timestamptz,
  source_inventory_sha256 char(64),
  status text not null default 'planned',
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  constraint legacy_migration_batches_status_ck check (
    status in ('planned', 'extracting', 'extracted', 'loading', 'validating', 'validated', 'failed', 'cancelled')
  )
);

create table if not exists public.legacy_status_codes (
  id bigint generated always as identity primary key,
  source_database text not null,
  source_schema text not null default 'dbo',
  source_table text not null,
  source_column text not null,
  legacy_numeric_value integer not null,
  observed_row_count bigint,
  proposed_meaning text,
  evidence text,
  interpretation_status text not null default 'unresolved',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_database, source_schema, source_table, source_column, legacy_numeric_value),
  constraint legacy_status_codes_interpretation_ck check (
    interpretation_status in ('unresolved', 'inferred', 'verified')
  )
);

create table if not exists public.legacy_field_map (
  id bigint generated always as identity primary key,
  source_database text not null,
  source_schema text not null default 'dbo',
  source_table text not null,
  source_column text not null,
  source_type text not null,
  classification text not null,
  destination_relation text,
  destination_column text,
  transformation text,
  justification text,
  verification_status text not null default 'unverified',
  verified_at timestamptz,
  unique (source_database, source_schema, source_table, source_column),
  constraint legacy_field_map_classification_ck check (
    classification in ('direct', 'transformed_lossless', 'legacy_archive', 'excluded', 'unresolved')
  ),
  constraint legacy_field_map_verification_ck check (
    verification_status in ('unverified', 'verified', 'blocked')
  )
);

alter table public.legacy_migration_runs
  add column if not exists import_batch_id uuid,
  add column if not exists source_schema text not null default 'dbo';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'legacy_migration_runs_import_batch_id_fkey'
      and conrelid = 'public.legacy_migration_runs'::regclass
  ) then
    alter table public.legacy_migration_runs
      add constraint legacy_migration_runs_import_batch_id_fkey
      foreign key (import_batch_id)
      references public.legacy_migration_batches(id);
  end if;
end
$$;

alter table public.legacy_identity_map
  add column if not exists source_email_sha256 char(64),
  add column if not exists auth_strategy text not null default 'password_reset',
  add column if not exists password_reset_required boolean not null default true,
  add column if not exists migrated_at timestamptz;

alter table public.media_assets
  add column if not exists legacy_merchant_image_id uuid,
  add column if not exists legacy_media_asset_id uuid,
  add column if not exists legacy_cms_media_descriptor_id uuid,
  add column if not exists legacy_file_descriptor_id uuid,
  add column if not exists legacy_blob_database text,
  add column if not exists legacy_blob_container_name text,
  add column if not exists legacy_blob_name text,
  add column if not exists alt_text text,
  add column if not exists title text,
  add column if not exists caption text,
  add column if not exists description text,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists duration_seconds integer,
  add column if not exists legacy_asset_type integer,
  add column if not exists legacy_is_archived boolean,
  add column if not exists legacy_last_accessed_at timestamp without time zone;

create unique index if not exists media_assets_legacy_merchant_image_id_uq
  on public.media_assets (legacy_merchant_image_id)
  where legacy_merchant_image_id is not null;
create index if not exists media_assets_legacy_media_asset_id_idx
  on public.media_assets (legacy_media_asset_id);
create index if not exists media_assets_legacy_blob_id_idx
  on public.media_assets (legacy_blob_id);
create index if not exists collaborators_merchant_system_id_idx
  on public.collaborators (merchant_system_id);
create index if not exists merchant_category_links_category_id_idx
  on public.merchant_category_links (category_id);
create index if not exists merchant_user_links_user_profile_id_idx
  on public.merchant_user_links (user_profile_id);
create index if not exists merchant_user_links_legacy_user_id_idx
  on public.merchant_user_links (legacy_user_id);
create index if not exists legacy_identity_map_tenant_idx
  on public.legacy_identity_map (legacy_tenant_id);
create index if not exists legacy_migration_runs_batch_idx
  on public.legacy_migration_runs (import_batch_id);
create index if not exists legacy_status_codes_lookup_idx
  on public.legacy_status_codes (source_database, source_table, source_column);

alter table public.legacy_tenant_evidence enable row level security;
alter table public.legacy_migration_batches enable row level security;
alter table public.legacy_status_codes enable row level security;
alter table public.legacy_field_map enable row level security;

revoke all on table public.legacy_tenant_evidence from anon, authenticated;
revoke all on table public.legacy_migration_batches from anon, authenticated;
revoke all on table public.legacy_status_codes from anon, authenticated;
revoke all on table public.legacy_field_map from anon, authenticated;
grant all on table public.legacy_tenant_evidence to service_role;
grant all on table public.legacy_migration_batches to service_role;
grant all on table public.legacy_status_codes to service_role;
grant all on table public.legacy_field_map to service_role;

commit;
