-- PHASE C STRUCTURAL PARITY PROPOSAL -- intentionally not applied.
-- Additive and idempotent. Application/API work is still required before this
-- schema can provide operational parity.

begin;

-- Preserve the original relationship IDs even when a V1 parent is missing or
-- cannot yet be mapped to a V2 row.
alter table public.referral_transactions
  add column if not exists legacy_restaurant_id uuid,
  add column if not exists legacy_middleman_id uuid;

create index if not exists referral_transactions_legacy_restaurant_id_idx
  on public.referral_transactions (legacy_restaurant_id);
create index if not exists referral_transactions_legacy_middleman_id_idx
  on public.referral_transactions (legacy_middleman_id);

-- Enforce stable source identities. Source evidence shows each referenced or
-- archive-only blob is unique by database + blob ID.
create unique index if not exists media_assets_legacy_media_asset_id_uq
  on public.media_assets (legacy_media_asset_id)
  where legacy_media_asset_id is not null;
create unique index if not exists media_assets_legacy_blob_source_uq
  on public.media_assets (legacy_blob_database, legacy_blob_id)
  where legacy_blob_database is not null and legacy_blob_id is not null;

-- The backend performs profile lookup by email and role. Active V1 users have
-- no normalized-email duplicates; deleted legacy collisions remain archive-only.
create unique index if not exists user_profiles_email_ci_uq
  on public.user_profiles (lower(email));
create index if not exists user_profiles_role_user_idx
  on public.user_profiles (role, user_id);

-- Preserve the numbering definitions and tenant configurations used by VNO.
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

-- V1 has tenant audit history and AuditLogging.Enable=True. This append-only
-- target is the minimum structural destination; every V2 mutation path must
-- still be instrumented by application work before parity is achieved.
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

alter table public.legacy_numbering_definitions enable row level security;
alter table public.legacy_numbering_configs enable row level security;
alter table public.legacy_numbering_config_details enable row level security;
alter table public.audit_events enable row level security;

revoke all on table public.legacy_numbering_definitions from anon, authenticated;
revoke all on table public.legacy_numbering_configs from anon, authenticated;
revoke all on table public.legacy_numbering_config_details from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;

grant all on table public.legacy_numbering_definitions to service_role;
grant all on table public.legacy_numbering_configs to service_role;
grant all on table public.legacy_numbering_config_details to service_role;
grant all on table public.audit_events to service_role;

commit;
