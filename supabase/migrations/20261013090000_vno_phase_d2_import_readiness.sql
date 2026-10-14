-- VNO Phase D2: additive import-readiness and authorization hardening.
-- This migration imports no V1 data and is safe to re-run.

begin;

-- Preserve source relationships even when the operational parent is absent.
alter table public.referral_transactions
  add column if not exists legacy_restaurant_id uuid,
  add column if not exists legacy_middleman_id uuid,
  add column if not exists source_timezone text,
  add column if not exists document_date_utc timestamptz,
  add column if not exists posting_date_utc timestamptz,
  add column if not exists confirmed_at_utc timestamptz,
  add column if not exists commission_date_utc timestamptz,
  add column if not exists legacy_creation_time_utc timestamptz,
  add column if not exists legacy_last_modified_at_utc timestamptz;

create index if not exists referral_transactions_legacy_restaurant_id_idx
  on public.referral_transactions (legacy_restaurant_id);
create index if not exists referral_transactions_legacy_middleman_id_idx
  on public.referral_transactions (legacy_middleman_id);

-- Stable source identities and the four active identity lookup equivalents.
create unique index if not exists media_assets_legacy_media_asset_id_uq
  on public.media_assets (legacy_media_asset_id)
  where legacy_media_asset_id is not null;
create unique index if not exists media_assets_legacy_blob_source_uq
  on public.media_assets (legacy_blob_database, legacy_blob_id)
  where legacy_blob_database is not null and legacy_blob_id is not null;
create unique index if not exists user_profiles_email_ci_uq
  on public.user_profiles (lower(email));
create index if not exists user_profiles_role_user_idx
  on public.user_profiles (role, user_id);

-- Restart checkpoints and conflicts are service-role-only migration controls.
create table if not exists public.legacy_import_checkpoints (
  import_batch_id uuid not null references public.legacy_migration_batches(id),
  import_stage text not null,
  source_database text not null default '',
  source_table text not null default '',
  source_cursor text,
  processed_rows bigint not null default 0,
  status text not null default 'pending',
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (import_batch_id, import_stage, source_database, source_table),
  constraint legacy_import_checkpoints_status_ck check
    (status in ('pending', 'running', 'complete', 'failed'))
);

create table if not exists public.legacy_import_conflicts (
  id bigint generated always as identity primary key,
  import_batch_id uuid not null references public.legacy_migration_batches(id),
  entity_type text not null,
  legacy_id text not null,
  candidate_v2_id text,
  reason_code text not null,
  evidence jsonb not null default '{}'::jsonb,
  resolution_status text not null default 'unresolved',
  created_at timestamptz not null default now(),
  unique (import_batch_id, entity_type, legacy_id, reason_code),
  constraint legacy_import_conflicts_resolution_ck check
    (resolution_status in ('unresolved', 'approved', 'rejected'))
);

alter table public.legacy_source_records
  add column if not exists source_payload_redacted boolean not null default false,
  add column if not exists redacted_fields text[] not null default '{}'::text[];

create table if not exists public.legacy_numbering_definitions (
  legacy_definition_id uuid primary key,
  type_name text not null,
  display_name text,
  owning_service text,
  default_prefix text,
  source_payload jsonb not null,
  import_batch_id uuid references public.legacy_migration_batches(id),
  imported_at timestamptz not null default now()
);

create table if not exists public.legacy_numbering_configs (
  legacy_config_id uuid primary key,
  legacy_tenant_id uuid not null,
  legacy_definition_id uuid not null
    references public.legacy_numbering_definitions(legacy_definition_id),
  is_system boolean,
  source_payload jsonb not null,
  import_batch_id uuid references public.legacy_migration_batches(id),
  imported_at timestamptz not null default now()
);

create table if not exists public.legacy_numbering_config_details (
  legacy_detail_id uuid primary key,
  legacy_config_id uuid not null
    references public.legacy_numbering_configs(legacy_config_id),
  legacy_tenant_id uuid not null,
  legacy_branch_id uuid,
  prefix text,
  suffix text,
  organization_code text,
  padding_width integer,
  current_number integer,
  active boolean,
  source_payload jsonb not null,
  import_batch_id uuid references public.legacy_migration_batches(id),
  imported_at timestamptz not null default now()
);

create index if not exists legacy_numbering_configs_tenant_idx
  on public.legacy_numbering_configs (legacy_tenant_id);
create index if not exists legacy_numbering_config_details_config_idx
  on public.legacy_numbering_config_details (legacy_config_id);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_auth_user_id uuid references auth.users(id),
  actor_role text,
  action text not null,
  entity_type text,
  entity_id text,
  request_id text,
  source text not null default 'v2',
  details jsonb not null default '{}'::jsonb,
  legacy_audit_id uuid,
  import_batch_id uuid references public.legacy_migration_batches(id)
);

create unique index if not exists audit_events_legacy_audit_id_uq
  on public.audit_events (legacy_audit_id)
  where legacy_audit_id is not null;
create index if not exists audit_events_entity_idx
  on public.audit_events (entity_type, entity_id, occurred_at desc);
create index if not exists audit_events_actor_idx
  on public.audit_events (actor_auth_user_id, occurred_at desc);

-- Pin SECURITY DEFINER/invoker helper search paths reported by the advisor.
alter function public.update_organization_profile_updated_at()
  set search_path = pg_catalog, public;
alter function public.update_updated_at_column()
  set search_path = pg_catalog, public;
alter function public.update_categories_updated_at()
  set search_path = pg_catalog, public;

-- Public catalogue reads remain compatible; all private/business and migration
-- data is reachable only through the service-role backend.
alter table public.categories enable row level security;
alter table public.organization_profile enable row level security;
alter table public.user_profiles enable row level security;
alter table public.collaborators enable row level security;
alter table public.merchant_details enable row level security;
alter table public.merchant_category_links enable row level security;
alter table public.merchant_user_links enable row level security;
alter table public.referral_transactions enable row level security;
alter table public.media_assets enable row level security;
alter table public.merchant_update_requests enable row level security;
alter table public.legacy_identity_map enable row level security;
alter table public.legacy_migration_runs enable row level security;
alter table public.legacy_source_records enable row level security;
alter table public.legacy_import_checkpoints enable row level security;
alter table public.legacy_import_conflicts enable row level security;
alter table public.legacy_numbering_definitions enable row level security;
alter table public.legacy_numbering_configs enable row level security;
alter table public.legacy_numbering_config_details enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select to anon, authenticated using (true);
drop policy if exists organization_profile_public_read on public.organization_profile;
create policy organization_profile_public_read on public.organization_profile
  for select to anon, authenticated using (true);

drop policy if exists "Anyone can create profile" on public.user_profiles;
drop policy if exists "Users can update own profile" on public.user_profiles;
drop policy if exists "Users can view own profile" on public.user_profiles;
drop policy if exists user_profiles_select_own on public.user_profiles;
drop policy if exists user_profiles_update_own on public.user_profiles;
create policy user_profiles_select_own on public.user_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy user_profiles_update_own on public.user_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.categories from anon, authenticated;
grant select on table public.categories to anon, authenticated;
revoke all on table public.organization_profile from anon, authenticated;
grant select on table public.organization_profile to anon, authenticated;
revoke all on table public.user_profiles from anon, authenticated;
grant select on table public.user_profiles to authenticated;
grant update (full_name) on table public.user_profiles to authenticated;

do $revoke$
declare relation_name text;
begin
  foreach relation_name in array array[
    'collaborators','merchant_details','merchant_category_links',
    'merchant_user_links','referral_transactions','media_assets',
    'merchant_update_requests','legacy_identity_map','legacy_migration_runs',
    'legacy_source_records','legacy_tenant_evidence','legacy_migration_batches',
    'legacy_status_codes','legacy_field_map','legacy_import_checkpoints',
    'legacy_import_conflicts','legacy_numbering_definitions',
    'legacy_numbering_configs','legacy_numbering_config_details','audit_events'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated', relation_name);
    execute format('grant all on table public.%I to service_role', relation_name);
  end loop;
end
$revoke$;

grant all on table public.categories, public.organization_profile,
  public.user_profiles to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Existing buckets stay private. Upsert is idempotent and does not expose them.
insert into storage.buckets (id, name, public)
values ('merchant-media', 'merchant-media', false),
       ('partner-media', 'partner-media', false)
on conflict (id) do update set public = false;

commit;
