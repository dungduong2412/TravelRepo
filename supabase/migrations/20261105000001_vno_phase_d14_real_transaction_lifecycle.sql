-- D14 Real transaction lifecycle.
-- Adds record_kind='real_transaction' with RECORDED→CONFIRMED/CANCELLED→REVERSED states.
-- UAT simulation rows and V1 imports are untouched.
-- DO NOT apply to hosted UAT without explicit owner approval.
-- Pre-check: no production data exists yet (record_kind != 'real_transaction' in all existing rows).

begin;

-- ── 1. Extend record_kind check to allow 'real_transaction' ──────────────────
-- Drop the NOT VALID constraint (never validated against existing rows) and
-- recreate with the new value.
alter table public.referral_transactions
  drop constraint if exists referral_transactions_record_kind_ck;

alter table public.referral_transactions
  add constraint referral_transactions_record_kind_ck
  check (record_kind in ('v1_import', 'uat_simulation', 'real_transaction')) not valid;

-- ── 2. Shape / invariant check for real_transaction rows ────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.referral_transactions'::regclass
      and conname = 'referral_transactions_real_transaction_ck'
  ) then
    alter table public.referral_transactions
      add constraint referral_transactions_real_transaction_ck
      check (
        record_kind <> 'real_transaction'
        or (
          idempotency_key is not null
          and created_by_auth_user_id is not null
          and merchant_id is not null
          and collaborator_id is not null
          and legacy_transaction_id is null
          and legacy_status is null
          and simulation_status is null
          and external_settlement_enabled = false
          and lifecycle_status in ('recorded', 'confirmed', 'cancelled', 'reversed')
          and payment_status in ('unverified', 'void')
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

-- ── 3. Idempotency unique index for real transactions ───────────────────────
create unique index if not exists referral_transactions_real_idempotency_uq
  on public.referral_transactions (merchant_id, idempotency_key)
  where record_kind = 'real_transaction';

-- ── 4. Extend transaction_events event types ────────────────────────────────
alter table public.transaction_events
  drop constraint if exists transaction_events_type_ck;

alter table public.transaction_events
  add constraint transaction_events_type_ck
  check (event_type in (
    'uat_simulation_created',
    'real_transaction_recorded',
    'real_transaction_confirmed',
    'real_transaction_cancelled',
    'real_transaction_reversed'
  ));

-- ── 5. Status transition guard on transaction_events ────────────────────────
alter table public.transaction_events
  drop constraint if exists transaction_events_status_ck;

alter table public.transaction_events
  add constraint transaction_events_status_ck
  check (
    (event_type = 'uat_simulation_created'      and from_status is null          and to_status = 'OPEN')
    or (event_type = 'real_transaction_recorded'  and from_status is null          and to_status = 'recorded')
    or (event_type = 'real_transaction_confirmed' and from_status = 'recorded'     and to_status = 'confirmed')
    or (event_type = 'real_transaction_cancelled' and from_status = 'recorded'     and to_status = 'cancelled')
    or (event_type = 'real_transaction_reversed'  and from_status = 'confirmed'    and to_status = 'reversed')
  );

-- Each transition event may occur at most once per transaction.
create unique index if not exists transaction_events_real_recorded_once_uq
  on public.transaction_events (transaction_id)
  where event_type = 'real_transaction_recorded';

-- confirmed / cancelled / reversed are mutually exclusive per transaction.
create unique index if not exists transaction_events_real_terminal_once_uq
  on public.transaction_events (transaction_id)
  where event_type in ('real_transaction_confirmed', 'real_transaction_cancelled', 'real_transaction_reversed');

-- ── 6. create_real_transaction RPC ──────────────────────────────────────────
create or replace function public.create_real_transaction(
  p_actor_user_id  uuid,
  p_collaborator_code text,
  p_gross_amount   numeric,
  p_idempotency_key uuid
)
returns table (
  transaction_id   uuid,
  document_number  text,
  merchant_id      uuid,
  collaborator_id  uuid,
  gross_amount     numeric,
  discount_rate    numeric,
  discount_amount  numeric,
  commission_rate  numeric,
  commission_amount numeric,
  lifecycle_status text,
  idempotent_replay boolean
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_profile     public.user_profiles%rowtype;
  v_merchant    public.merchant_details%rowtype;
  v_collaborator public.collaborators%rowtype;
  v_transaction public.referral_transactions%rowtype;
  v_inserted    boolean := false;
  v_gross       numeric(18,4);
  v_discount_rate  numeric(18,4);
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
    raise exception 'Reviewed fractional Merchant rates are required for real transactions' using errcode = '22023';
  end if;
  v_discount_rate  := v_merchant.merchant_discount_value::numeric(18,4);
  v_commission_rate := v_merchant.merchant_commission_value::numeric(18,4);

  select c.* into v_collaborator
  from public.collaborators c
  where c.collaborators_code = btrim(p_collaborator_code)
    and c.collaborators_verified = true
    and c.collaborators_status = 'active';
  if not found then
    raise exception 'Active verified Partner required' using errcode = '22023';
  end if;
  if v_collaborator.merchant_system_id is distinct from v_merchant.merchant_system_id then
    raise exception 'Partner is not assigned to this Merchant' using errcode = '42501';
  end if;

  -- Idempotency check
  select rt.* into v_transaction
  from public.referral_transactions rt
  where rt.record_kind = 'real_transaction'
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
      'real_transaction', p_idempotency_key, p_actor_user_id,
      v_merchant.merchant_system_id, v_collaborator.id, null, 'recorded',
      'unverified', null, false,
      'VNO' || to_char(clock_timestamp(), 'YYMMDD') || '-' || upper(substr(replace(p_idempotency_key::text, '-', ''), 1, 10)),
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
        v_transaction.id, 'real_transaction_recorded', p_actor_user_id,
        null, 'recorded', p_idempotency_key,
        jsonb_build_object(
          'record_kind', 'real_transaction',
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
        p_actor_user_id, 'merchant', 'transaction.real_recorded',
        'referral_transaction', v_transaction.id::text,
        p_idempotency_key::text, 'v2-real-transaction',
        jsonb_build_object('document_number', v_transaction.document_number)
      );
    else
      select rt.* into v_transaction
      from public.referral_transactions rt
      where rt.record_kind = 'real_transaction'
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
    v_transaction.lifecycle_status,
    not v_inserted;
end;
$$;

revoke all on function public.create_real_transaction(uuid, text, numeric, uuid)
  from public, anon, authenticated;
grant execute on function public.create_real_transaction(uuid, text, numeric, uuid)
  to service_role;

comment on function public.create_real_transaction(uuid, text, numeric, uuid) is
  'D14 Real transaction creation (RECORDED state). Reuses V1-compatible calculation. Commission on gross amount.';

-- ── 7. confirm_real_transaction RPC ─────────────────────────────────────────
create or replace function public.confirm_real_transaction(
  p_actor_user_id   uuid,
  p_transaction_id  uuid,
  p_idempotency_key uuid
)
returns table (
  transaction_id   uuid,
  lifecycle_status text,
  idempotent_replay boolean
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_profile     public.user_profiles%rowtype;
  v_transaction public.referral_transactions%rowtype;
  v_already     boolean := false;
begin
  if p_actor_user_id is null or p_transaction_id is null or p_idempotency_key is null then
    raise exception 'Actor, transaction and idempotency key are required' using errcode = '22023';
  end if;

  select up.* into v_profile
  from public.user_profiles up
  where up.user_id = p_actor_user_id
    and up.role = 'merchant'
    and up.user_profiles_status = 'active';
  if not found or v_profile.merchant_id is null then
    raise exception 'Active Merchant profile required' using errcode = '42501';
  end if;

  select rt.* into v_transaction
  from public.referral_transactions rt
  where rt.id = p_transaction_id
    and rt.record_kind = 'real_transaction'
    and rt.merchant_id = v_profile.merchant_id;
  if not found then
    raise exception 'Transaction not found or not owned by this Merchant' using errcode = '42501';
  end if;

  -- Idempotent replay: already confirmed
  if v_transaction.lifecycle_status = 'confirmed' then
    v_already := true;
  elsif v_transaction.lifecycle_status <> 'recorded' then
    raise exception 'Only RECORDED transactions can be confirmed (current: %)', v_transaction.lifecycle_status using errcode = '23514';
  else
    update public.referral_transactions
      set lifecycle_status = 'confirmed'
    where id = p_transaction_id;

    insert into public.transaction_events (
      transaction_id, event_type, actor_auth_user_id,
      from_status, to_status, idempotency_key, details
    ) values (
      p_transaction_id, 'real_transaction_confirmed', p_actor_user_id,
      'recorded', 'confirmed', p_idempotency_key, '{}'::jsonb
    );
    insert into public.audit_events (
      actor_auth_user_id, actor_role, action, entity_type, entity_id,
      request_id, source, details
    ) values (
      p_actor_user_id, 'merchant', 'transaction.real_confirmed',
      'referral_transaction', p_transaction_id::text,
      p_idempotency_key::text, 'v2-real-transaction', '{}'::jsonb
    );
  end if;

  return query select p_transaction_id, 'confirmed'::text, v_already;
end;
$$;

revoke all on function public.confirm_real_transaction(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_real_transaction(uuid, uuid, uuid)
  to service_role;

-- ── 8. cancel_real_transaction RPC ──────────────────────────────────────────
create or replace function public.cancel_real_transaction(
  p_actor_user_id   uuid,
  p_transaction_id  uuid,
  p_idempotency_key uuid
)
returns table (
  transaction_id   uuid,
  lifecycle_status text,
  idempotent_replay boolean
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_profile     public.user_profiles%rowtype;
  v_transaction public.referral_transactions%rowtype;
  v_already     boolean := false;
begin
  if p_actor_user_id is null or p_transaction_id is null or p_idempotency_key is null then
    raise exception 'Actor, transaction and idempotency key are required' using errcode = '22023';
  end if;

  select up.* into v_profile
  from public.user_profiles up
  where up.user_id = p_actor_user_id
    and up.role = 'merchant'
    and up.user_profiles_status = 'active';
  if not found or v_profile.merchant_id is null then
    raise exception 'Active Merchant profile required' using errcode = '42501';
  end if;

  select rt.* into v_transaction
  from public.referral_transactions rt
  where rt.id = p_transaction_id
    and rt.record_kind = 'real_transaction'
    and rt.merchant_id = v_profile.merchant_id;
  if not found then
    raise exception 'Transaction not found or not owned by this Merchant' using errcode = '42501';
  end if;

  if v_transaction.lifecycle_status = 'cancelled' then
    v_already := true;
  elsif v_transaction.lifecycle_status <> 'recorded' then
    raise exception 'Only RECORDED transactions can be cancelled (current: %)', v_transaction.lifecycle_status using errcode = '23514';
  else
    update public.referral_transactions
      set lifecycle_status = 'cancelled',
          payment_status   = 'void'
    where id = p_transaction_id;

    insert into public.transaction_events (
      transaction_id, event_type, actor_auth_user_id,
      from_status, to_status, idempotency_key, details
    ) values (
      p_transaction_id, 'real_transaction_cancelled', p_actor_user_id,
      'recorded', 'cancelled', p_idempotency_key, '{}'::jsonb
    );
    insert into public.audit_events (
      actor_auth_user_id, actor_role, action, entity_type, entity_id,
      request_id, source, details
    ) values (
      p_actor_user_id, 'merchant', 'transaction.real_cancelled',
      'referral_transaction', p_transaction_id::text,
      p_idempotency_key::text, 'v2-real-transaction', '{}'::jsonb
    );
  end if;

  return query select p_transaction_id, 'cancelled'::text, v_already;
end;
$$;

revoke all on function public.cancel_real_transaction(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_real_transaction(uuid, uuid, uuid)
  to service_role;

-- ── 9. reverse_real_transaction RPC (admin only) ────────────────────────────
create or replace function public.reverse_real_transaction(
  p_actor_user_id   uuid,
  p_transaction_id  uuid,
  p_idempotency_key uuid
)
returns table (
  transaction_id   uuid,
  lifecycle_status text,
  idempotent_replay boolean
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_profile     public.user_profiles%rowtype;
  v_transaction public.referral_transactions%rowtype;
  v_already     boolean := false;
begin
  if p_actor_user_id is null or p_transaction_id is null or p_idempotency_key is null then
    raise exception 'Actor, transaction and idempotency key are required' using errcode = '22023';
  end if;

  select up.* into v_profile
  from public.user_profiles up
  where up.user_id = p_actor_user_id
    and up.role = 'admin'
    and up.user_profiles_status = 'active';
  if not found then
    raise exception 'Active Admin profile required' using errcode = '42501';
  end if;

  select rt.* into v_transaction
  from public.referral_transactions rt
  where rt.id = p_transaction_id
    and rt.record_kind = 'real_transaction';
  if not found then
    raise exception 'Real transaction not found' using errcode = '42501';
  end if;

  if v_transaction.lifecycle_status = 'reversed' then
    v_already := true;
  elsif v_transaction.lifecycle_status <> 'confirmed' then
    raise exception 'Only CONFIRMED transactions can be reversed (current: %)', v_transaction.lifecycle_status using errcode = '23514';
  else
    update public.referral_transactions
      set lifecycle_status = 'reversed',
          payment_status   = 'void'
    where id = p_transaction_id;

    insert into public.transaction_events (
      transaction_id, event_type, actor_auth_user_id,
      from_status, to_status, idempotency_key, details
    ) values (
      p_transaction_id, 'real_transaction_reversed', p_actor_user_id,
      'confirmed', 'reversed', p_idempotency_key, '{}'::jsonb
    );
    insert into public.audit_events (
      actor_auth_user_id, actor_role, action, entity_type, entity_id,
      request_id, source, details
    ) values (
      p_actor_user_id, 'admin', 'transaction.real_reversed',
      'referral_transaction', p_transaction_id::text,
      p_idempotency_key::text, 'v2-real-transaction', '{}'::jsonb
    );
  end if;

  return query select p_transaction_id, 'reversed'::text, v_already;
end;
$$;

revoke all on function public.reverse_real_transaction(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reverse_real_transaction(uuid, uuid, uuid)
  to service_role;

comment on function public.confirm_real_transaction(uuid, uuid, uuid) is
  'D14 Merchant confirms a RECORDED real transaction. Idempotent.';
comment on function public.cancel_real_transaction(uuid, uuid, uuid) is
  'D14 Merchant cancels a RECORDED real transaction. Sets payment_status=void. Idempotent.';
comment on function public.reverse_real_transaction(uuid, uuid, uuid) is
  'D14 Admin reverses a CONFIRMED real transaction. Sets payment_status=void. Idempotent.';

commit;
