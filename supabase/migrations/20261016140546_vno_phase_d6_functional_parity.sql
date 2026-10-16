-- Phase D6 is additive. NOT VALID preserves imported legacy rows while enforcing
-- the invariant for new and subsequently updated application records.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_profiles'::regclass
      and conname = 'user_profiles_role_allowed_chk'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_role_allowed_chk
      check (role in ('admin', 'merchant', 'collaborator')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_profiles'::regclass
      and conname = 'user_profiles_status_allowed_chk'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_status_allowed_chk
      check (user_profiles_status is null or user_profiles_status in ('active', 'pending', 'inactive', 'blocked')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_profiles'::regclass
      and conname = 'user_profiles_role_assignment_chk'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_role_assignment_chk
      check (
        (role = 'admin' and merchant_id is null and collaborator_id is null)
        or (role = 'merchant' and merchant_id is not null and collaborator_id is null)
        or (role = 'collaborator' and merchant_id is null and collaborator_id is not null)
      ) not valid;
  end if;
end
$$;

create index if not exists user_profiles_merchant_id_idx
  on public.user_profiles (merchant_id) where merchant_id is not null;
create index if not exists user_profiles_collaborator_id_idx
  on public.user_profiles (collaborator_id) where collaborator_id is not null;
create index if not exists collaborators_merchant_system_id_idx
  on public.collaborators (merchant_system_id) where merchant_system_id is not null;

create index if not exists referral_transactions_merchant_date_idx
  on public.referral_transactions (merchant_id, document_date_utc desc)
  where merchant_id is not null;
create index if not exists referral_transactions_collaborator_date_idx
  on public.referral_transactions (collaborator_id, document_date_utc desc)
  where collaborator_id is not null;

create index if not exists media_assets_merchant_created_idx
  on public.media_assets (merchant_id, created_at desc) where merchant_id is not null;
create index if not exists media_assets_collaborator_created_idx
  on public.media_assets (collaborator_id, created_at desc) where collaborator_id is not null;
create index if not exists audit_events_action_occurred_idx
  on public.audit_events (action, occurred_at desc);

comment on constraint user_profiles_role_assignment_chk on public.user_profiles is
  'D6 authorization invariant: exactly one role-appropriate business assignment; legacy rows remain available for explicit reconciliation.';
