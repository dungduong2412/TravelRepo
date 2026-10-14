-- Rehearsal-only reconstruction of the live pre-Phase-2 V2 baseline.
-- Never apply this file to the hosted project.

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.update_updated_at_column() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create or replace function public.update_categories_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create or replace function public.update_organization_profile_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create table public.categories (
  id uuid primary key default extensions.uuid_generate_v4(),
  category_name varchar not null,
  category_name_vi varchar not null,
  category_description text,
  category_icon varchar,
  is_active boolean default true,
  display_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  legacy_category_id uuid unique,
  legacy_tenant_id uuid
);

create table public.organization_profile (
  id uuid primary key default extensions.uuid_generate_v4(),
  organization_name text,
  organization_description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.merchant_details (
  merchant_system_id uuid primary key default gen_random_uuid(),
  merchant_code text not null,
  merchant_name text not null,
  merchant_email text,
  merchant_phone text,
  merchant_commission_type text,
  merchant_commission_value numeric,
  merchant_discount_type text,
  merchant_discount_value numeric,
  merchant_priority integer default 0,
  merchant_registered_date timestamptz default now(),
  merchant_verified_date timestamptz,
  merchant_last_update timestamptz default now(),
  merchant_action text,
  merchant_verified boolean default false,
  owner_name varchar,
  owner_phone varchar,
  owner_email varchar,
  owner_password varchar,
  merchant_description text,
  merchant_category varchar,
  merchant_contact_phone varchar,
  new_address_city varchar,
  new_address_ward varchar,
  new_address_line text,
  old_address_city varchar,
  old_address_ward varchar,
  old_address_line text,
  merchant_pictures text[],
  "Merchants_status" text,
  merchants_status text,
  legacy_restaurant_id uuid unique,
  legacy_tenant_id uuid,
  legacy_status integer,
  legacy_is_banned boolean,
  legacy_min_commission numeric,
  legacy_tax_code text,
  legacy_geo_position text,
  legacy_extra_properties text
);

create table public.collaborators (
  id uuid primary key default gen_random_uuid(),
  merchant_system_id uuid references public.merchant_details(merchant_system_id),
  collaborators_actions text,
  collaborators_verified boolean,
  collaborators_code text,
  collaborators_name text,
  collaborators_rating numeric,
  collaborators_phone text,
  collaborators_email text,
  collaborators_bank_name text,
  collaborators_bank_acc_name text,
  collaborators_bank_acc_number text,
  collaborators_registered_date timestamptz,
  collaborators_remark_followup_action text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  collaborators_password varchar,
  collaborators_avatar_url text,
  collaborators_qr_code text,
  collaborators_status text,
  legacy_middleman_id uuid unique,
  legacy_tenant_id uuid,
  legacy_status integer,
  legacy_is_banned boolean,
  legacy_extra_properties text
);

create table public.user_profiles (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  email text not null,
  role text not null,
  full_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_login_at timestamptz,
  login_count integer default 0,
  merchant_id uuid references public.merchant_details(merchant_system_id),
  collaborator_id uuid references public.collaborators(id),
  user_profiles_status text
);

create table public.merchant_category_links (
  merchant_id uuid not null references public.merchant_details(merchant_system_id),
  category_id uuid not null references public.categories(id),
  legacy_tenant_id uuid,
  primary key (merchant_id, category_id)
);

create table public.merchant_user_links (
  merchant_id uuid not null references public.merchant_details(merchant_system_id),
  user_profile_id uuid not null references public.user_profiles(id),
  legacy_user_id uuid,
  primary key (merchant_id, user_profile_id)
);

create table public.referral_transactions (
  id uuid primary key default gen_random_uuid(),
  legacy_transaction_id uuid unique,
  legacy_tenant_id uuid,
  merchant_id uuid references public.merchant_details(merchant_system_id),
  collaborator_id uuid references public.collaborators(id),
  legacy_branch_id uuid,
  legacy_status integer,
  lifecycle_status text not null default 'unmapped',
  payment_status text not null default 'unverified',
  document_number text,
  document_index integer,
  document_date timestamp,
  posting_date timestamp,
  confirmed_at timestamp,
  commission_date timestamp,
  document_total numeric not null,
  document_discount_amount numeric not null default 0,
  document_discount_percent numeric,
  commission_percent numeric not null default 0,
  commission_amount numeric not null default 0,
  currency_code char(3) default 'VND',
  legacy_extra_properties text,
  legacy_creator_id uuid,
  legacy_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  legacy_image_id uuid unique,
  legacy_blob_id uuid,
  legacy_tenant_id uuid,
  merchant_id uuid references public.merchant_details(merchant_system_id),
  collaborator_id uuid references public.collaborators(id),
  bucket_id text not null,
  object_path text not null,
  original_filename text,
  mime_type text,
  sha256_hex char(64),
  size_bytes bigint,
  is_hero boolean not null default false,
  display_order integer not null default 0,
  transfer_status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

create table public.legacy_identity_map (
  legacy_user_id uuid primary key,
  legacy_tenant_id uuid,
  auth_user_id uuid references auth.users(id),
  migration_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.legacy_migration_runs (
  id uuid primary key default gen_random_uuid(),
  source_snapshot_at timestamptz,
  source_database text not null,
  source_table text not null,
  expected_rows bigint,
  imported_rows bigint,
  rejected_rows bigint,
  source_checksum text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
create policy "Anyone can create profile" on public.user_profiles for insert with check (true);
create policy "Users can view own profile" on public.user_profiles for select using (auth.uid() = user_id);
create policy "Users can update own profile" on public.user_profiles for update using (auth.uid() = user_id);

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
