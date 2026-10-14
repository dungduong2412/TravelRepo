-- Reconcile the Phase 2 objects that were applied to VietnamNumberOne outside
-- Supabase's recorded migration history. Every statement is additive and safe
-- to run both against the current UAT project and a clean schema containing
-- only the recorded Phase 1 migrations.

begin;

alter table public.merchant_details
  add column if not exists legacy_short_name text,
  add column if not exists legacy_rating numeric(18,4),
  add column if not exists legacy_owner_user_id uuid,
  add column if not exists legacy_is_update_requesting boolean,
  add column if not exists legacy_last_banned_at timestamp without time zone,
  add column if not exists legacy_last_update_request_at timestamp without time zone,
  add column if not exists legacy_province text,
  add column if not exists legacy_district text,
  add column if not exists legacy_ward text,
  add column if not exists legacy_country text,
  add column if not exists legacy_country_id uuid,
  add column if not exists legacy_province_id uuid,
  add column if not exists legacy_district_id uuid,
  add column if not exists legacy_ward_id uuid;

alter table public.collaborators
  add column if not exists legacy_verified_at timestamp without time zone,
  add column if not exists legacy_last_banned_at timestamp without time zone,
  add column if not exists legacy_image_id uuid;

alter table public.referral_transactions
  add column if not exists legacy_creator_name text,
  add column if not exists legacy_restaurant_display_name text,
  add column if not exists legacy_middleman_display_name text,
  add column if not exists legacy_last_modified_at timestamp without time zone,
  add column if not exists legacy_last_modifier_id uuid,
  add column if not exists legacy_concurrency_stamp text,
  add column if not exists legacy_creation_time timestamp without time zone;

create table if not exists public.merchant_update_requests (
  id uuid primary key default gen_random_uuid(),
  legacy_request_id uuid unique,
  legacy_tenant_id uuid,
  merchant_id uuid references public.merchant_details(merchant_system_id),
  legacy_merchant_id uuid,
  legacy_status integer,
  requested_at timestamp without time zone,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.merchant_update_requests
  add column if not exists legacy_request_id uuid,
  add column if not exists legacy_tenant_id uuid,
  add column if not exists merchant_id uuid,
  add column if not exists legacy_merchant_id uuid,
  add column if not exists legacy_status integer,
  add column if not exists requested_at timestamp without time zone,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists merchant_update_requests_legacy_request_id_key
  on public.merchant_update_requests (legacy_request_id);
create index if not exists merchant_update_requests_merchant_idx
  on public.merchant_update_requests (merchant_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'merchant_update_requests_merchant_id_fkey'
      and conrelid = 'public.merchant_update_requests'::regclass
  ) then
    alter table public.merchant_update_requests
      add constraint merchant_update_requests_merchant_id_fkey
      foreign key (merchant_id)
      references public.merchant_details(merchant_system_id);
  end if;
end
$$;

create table if not exists public.legacy_source_records (
  id bigint generated always as identity primary key,
  source_database text not null,
  source_schema text not null default 'dbo',
  source_table text not null,
  source_primary_key text not null,
  legacy_tenant_id uuid,
  source_payload jsonb not null,
  source_payload_sha256 text,
  import_batch_id uuid,
  imported_at timestamptz not null default now(),
  unique (source_database, source_schema, source_table, source_primary_key)
);

alter table public.legacy_source_records
  add column if not exists source_database text,
  add column if not exists source_schema text not null default 'dbo',
  add column if not exists source_table text,
  add column if not exists source_primary_key text,
  add column if not exists legacy_tenant_id uuid,
  add column if not exists source_payload jsonb,
  add column if not exists source_payload_sha256 text,
  add column if not exists import_batch_id uuid,
  add column if not exists imported_at timestamptz not null default now();

create unique index if not exists legacy_source_records_source_identity_uq
  on public.legacy_source_records
  (source_database, source_schema, source_table, source_primary_key);
create index if not exists legacy_source_records_lookup_idx
  on public.legacy_source_records (source_database, source_table);
create index if not exists legacy_source_records_tenant_idx
  on public.legacy_source_records (legacy_tenant_id);

alter table public.merchant_update_requests enable row level security;
alter table public.legacy_source_records enable row level security;

commit;
