-- D13 integrated UAT simulation engine.
-- This is deliberately not a production payment/state-transition engine.
-- Imported V1 records keep their raw statuses and financial values unchanged.

begin;

alter table public.referral_transactions
  add column if not exists record_kind text not null default 'v1_import',
  add column if not exists idempotency_key uuid,
  add column if not exists created_by_auth_user_id uuid,
  add column if not exists simulation_status text,
  add column if not exists external_settlement_enabled boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referral_transactions'::regclass
      and conname = 'referral_transactions_created_by_auth_user_fkey'
  ) then
    alter table public.referral_transactions
      add constraint referral_transactions_created_by_auth_user_fkey
      foreign key (created_by_auth_user_id) references auth.users(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referral_transactions'::regclass
      and conname = 'referral_transactions_record_kind_ck'
  ) then
    alter table public.referral_transactions
      add constraint referral_transactions_record_kind_ck
      check (record_kind in ('v1_import', 'uat_simulation')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referral_transactions'::regclass
      and conname = 'referral_transactions_uat_simulation_ck'
  ) then
    alter table public.referral_transactions
      add constraint referral_transactions_uat_simulation_ck
      check (
        record_kind <> 'uat_simulation'
        or (
          idempotency_key is not null
          and created_by_auth_user_id is not null
          and merchant_id is not null
          and collaborator_id is not null
          and legacy_transaction_id is null
          and legacy_status is null
          and simulation_status = 'OPEN'
          and lifecycle_status = 'uat_simulation_open'
          and payment_status = 'unverified'
          and external_settlement_enabled = false
          and document_total > 0
          and document_discount_percent between 0 and 1
          and commission_percent between 0 and 1
          and document_discount_amount = round(document_total * document_discount_percent, 4)
          and commission_amount = round(document_total * commission_percent, 4)
        )
      ) not valid;
  end if;
end
$$;

create unique index if not exists referral_transactions_uat_idempotency_uq
  on public.referral_transactions (merchant_id, idempotency_key)
  where record_kind = 'uat_simulation';

create index if not exists referral_transactions_record_kind_date_idx
  on public.referral_transactions (record_kind, document_date_utc desc);

create table if not exists public.transaction_events (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.referral_transactions(id) on delete cascade,
  event_type text not null,
  actor_auth_user_id uuid not null references auth.users(id),
  from_status text,
  to_status text,
  idempotency_key uuid,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  constraint transaction_events_type_ck check (event_type in ('uat_simulation_created')),
  constraint transaction_events_status_ck check (
    event_type <> 'uat_simulation_created'
    or (from_status is null and to_status = 'OPEN')
  )
);

create unique index if not exists transaction_events_created_once_uq
  on public.transaction_events (transaction_id, event_type)
  where event_type = 'uat_simulation_created';
create index if not exists transaction_events_transaction_time_idx
  on public.transaction_events (transaction_id, occurred_at desc);
create index if not exists transaction_events_actor_time_idx
  on public.transaction_events (actor_auth_user_id, occurred_at desc);

alter table public.transaction_events enable row level security;
revoke all on table public.transaction_events from public, anon, authenticated;
grant all on table public.transaction_events to service_role;
grant usage, select on sequence public.transaction_events_id_seq to service_role;

create or replace function public.create_uat_simulation_transaction(
  p_actor_user_id uuid,
  p_collaborator_code text,
  p_gross_amount numeric,
  p_idempotency_key uuid
)
returns table (
  transaction_id uuid,
  document_number text,
  merchant_id uuid,
  collaborator_id uuid,
  gross_amount numeric,
  discount_rate numeric,
  discount_amount numeric,
  commission_rate numeric,
  commission_amount numeric,
  simulation_status text,
  idempotent_replay boolean
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_profile public.user_profiles%rowtype;
  v_merchant public.merchant_details%rowtype;
  v_collaborator public.collaborators%rowtype;
  v_transaction public.referral_transactions%rowtype;
  v_inserted boolean := false;
  v_gross numeric(18,4);
  v_discount_rate numeric(18,4);
  v_commission_rate numeric(18,4);
begin
  if p_actor_user_id is null or p_idempotency_key is null then
    raise exception 'Actor and idempotency key are required' using errcode = '22023';
  end if;
  if p_collaborator_code is null or btrim(p_collaborator_code) = '' then
    raise exception 'Collaborator code is required' using errcode = '22023';
  end if;
  if p_gross_amount is null or p_gross_amount <= 0
     or p_gross_amount > 99999999999999.9999
     or p_gross_amount <> round(p_gross_amount, 4) then
    raise exception 'Gross amount must be positive with at most four decimal places' using errcode = '22003';
  end if;
  v_gross := p_gross_amount::numeric(18,4);

  select up.* into v_profile
  from public.user_profiles up
  where up.user_id = p_actor_user_id
    and up.role = 'merchant'
    and up.user_profiles_status = 'active';
  if not found or v_profile.merchant_id is null then
    raise exception 'Active Merchant profile required' using errcode = '42501';
  end if;

  select md.* into v_merchant
  from public.merchant_details md
  where md.merchant_system_id = v_profile.merchant_id
    and md.merchant_verified = true
    and md.merchants_status = 'active';
  if not found then
    raise exception 'Active verified Merchant required' using errcode = '42501';
  end if;
  if v_merchant.merchant_discount_type <> 'percentage'
     or v_merchant.merchant_commission_type <> 'percentage'
     or v_merchant.merchant_discount_value is null
     or v_merchant.merchant_commission_value is null
     or v_merchant.merchant_discount_value not between 0 and 1
     or v_merchant.merchant_commission_value not between 0 and 1 then
    raise exception 'Reviewed fractional Merchant rates are required for UAT simulation' using errcode = '22023';
  end if;
  v_discount_rate := v_merchant.merchant_discount_value::numeric(18,4);
  v_commission_rate := v_merchant.merchant_commission_value::numeric(18,4);

  select c.* into v_collaborator
  from public.collaborators c
  where c.collaborators_code = btrim(p_collaborator_code)
    and c.collaborators_verified = true
    and c.collaborators_status = 'active';
  if not found then
    raise exception 'Active verified Collaborator required' using errcode = '22023';
  end if;
  if v_collaborator.merchant_system_id is distinct from v_merchant.merchant_system_id then
    raise exception 'Collaborator is not assigned to this Merchant' using errcode = '42501';
  end if;

  select rt.* into v_transaction
  from public.referral_transactions rt
  where rt.record_kind = 'uat_simulation'
    and rt.merchant_id = v_merchant.merchant_system_id
    and rt.idempotency_key = p_idempotency_key;
  if found then
    if v_transaction.collaborator_id is distinct from v_collaborator.id
       or v_transaction.document_total is distinct from v_gross then
      raise exception 'Idempotency key was already used with different input' using errcode = '23505';
    end if;
  else
    insert into public.referral_transactions (
      record_kind, idempotency_key, created_by_auth_user_id,
      merchant_id, collaborator_id, legacy_status, lifecycle_status,
      payment_status, simulation_status, external_settlement_enabled,
      document_number, document_date_utc, source_timezone,
      document_total, document_discount_percent, document_discount_amount,
      commission_percent, commission_amount, currency_code
    ) values (
      'uat_simulation', p_idempotency_key, p_actor_user_id,
      v_merchant.merchant_system_id, v_collaborator.id, null, 'uat_simulation_open',
      'unverified', 'OPEN', false,
      'UAT-SIM-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 12)),
      clock_timestamp(), 'UTC',
      v_gross, v_discount_rate, round(v_gross * v_discount_rate, 4),
      v_commission_rate, round(v_gross * v_commission_rate, 4), 'VND'
    )
    on conflict do nothing
    returning * into v_transaction;

    if found then
      v_inserted := true;
      insert into public.transaction_events (
        transaction_id, event_type, actor_auth_user_id,
        from_status, to_status, idempotency_key, details
      ) values (
        v_transaction.id, 'uat_simulation_created', p_actor_user_id,
        null, 'OPEN', p_idempotency_key,
        jsonb_build_object(
          'record_kind', 'uat_simulation',
          'external_settlement_enabled', false,
          'gross_amount', v_transaction.document_total,
          'discount_rate', v_transaction.document_discount_percent,
          'discount_amount', v_transaction.document_discount_amount,
          'commission_rate', v_transaction.commission_percent,
          'commission_amount', v_transaction.commission_amount
        )
      );
      insert into public.audit_events (
        actor_auth_user_id, actor_role, action, entity_type, entity_id,
        request_id, source, details
      ) values (
        p_actor_user_id, 'merchant', 'transaction.uat_simulation_created',
        'referral_transaction', v_transaction.id::text,
        p_idempotency_key::text, 'v2-uat-simulation',
        jsonb_build_object('document_number', v_transaction.document_number)
      );
    else
      select rt.* into v_transaction
      from public.referral_transactions rt
      where rt.record_kind = 'uat_simulation'
        and rt.merchant_id = v_merchant.merchant_system_id
        and rt.idempotency_key = p_idempotency_key;
      if not found then
        raise exception 'Concurrent idempotency resolution failed' using errcode = '40001';
      end if;
      if v_transaction.collaborator_id is distinct from v_collaborator.id
         or v_transaction.document_total is distinct from v_gross then
        raise exception 'Idempotency key was already used with different input' using errcode = '23505';
      end if;
    end if;
  end if;

  return query select
    v_transaction.id,
    v_transaction.document_number,
    v_transaction.merchant_id,
    v_transaction.collaborator_id,
    v_transaction.document_total,
    v_transaction.document_discount_percent,
    v_transaction.document_discount_amount,
    v_transaction.commission_percent,
    v_transaction.commission_amount,
    v_transaction.simulation_status,
    not v_inserted;
end;
$$;

revoke all on function public.create_uat_simulation_transaction(uuid, text, numeric, uuid)
  from public, anon, authenticated;
grant execute on function public.create_uat_simulation_transaction(uuid, text, numeric, uuid)
  to service_role;

comment on function public.create_uat_simulation_transaction(uuid, text, numeric, uuid) is
  'D13 UAT-only synthetic transaction creation. No confirmation, payment, settlement, payout, cancellation, or historical-status mutation.';

commit;
