-- Rollback for 20261109000001_vno_global_partner_network.sql. NOT in supabase/migrations on purpose (it must never run automatically).
-- Restores the D14 create_real_transaction and D13 create_uat_simulation_transaction exactly as they were (assignment check included).
-- The table and the column are dropped ONLY when they hold no data; otherwise this script stops so the rows can be exported first.
begin;

do $$
begin
  if exists (select 1 from public.referral_transactions where scan_event_id is not null) then
    raise exception 'Rollback stopped: transactions reference scan events. Export public.partner_scan_events and clear referral_transactions.scan_event_id deliberately first.';
  end if;
end $$;

drop function if exists public.create_real_transaction(uuid, text, numeric, uuid, uuid);

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

comment on function public.create_uat_simulation_transaction(uuid, text, numeric, uuid) is
  'D13 UAT-only synthetic transaction creation. No confirmation, payment, settlement, payout, cancellation, or historical-status mutation.';

drop index if exists public.referral_transactions_scan_event_idx;
alter table public.referral_transactions drop column if exists scan_event_id;
-- scan rows are operational analytics only; drop them with the table (export first if they must be kept)
drop table if exists public.partner_scan_events;

notify pgrst, 'reload schema';

commit;
