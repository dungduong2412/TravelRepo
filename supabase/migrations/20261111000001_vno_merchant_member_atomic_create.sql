-- Atomic Merchant-member creation (post-release remediation of the audit-atomicity finding).
--
-- BEFORE: POST /merchants/members inserted the pending Partner application over REST (committed), re-read it, and only then wrote the creation audit event
-- with a SECOND REST call. If that second call failed the application stayed committed with no audit event, the client got a 500, and its retry was answered
-- as an idempotent replay without ever writing the missing audit event.
--
-- AFTER: the application row and its creation audit event are written by ONE function call = ONE database transaction. Either both commit or neither does.
--
--   public.create_merchant_member_application(...)  -> jsonb { outcome: CREATED | EMAIL_HELD | NOT_ALLOWED, member?: {...} }
--       * re-checks that the caller is an active Merchant profile bound to THIS Merchant and that the Merchant is active + verified
--       * serialises concurrent CALLS OF THIS FUNCTION for one e-mail, across API instances (transaction-scoped advisory lock), and re-checks the e-mail under the
--         lock. This replaces the previous "insert, re-read, delete my own row if I lost" convergence. It does NOT stop a writer that takes no lock (the
--         previous API during a rolling deploy, Partner registration, Admin create) from inserting the same e-mail at the same instant: closing that completely
--         needs a unique index, proposed for the next release once three existing duplicate groups are resolved (see the remediation document).
--       * inserts the application and the audit event; any failure of either aborts both (the insert is STRICT: an insert that yields no row aborts too)
--   public.reconcile_merchant_member_audit(...)     -> text   ALREADY_AUDITED | RECONCILED | IN_FLIGHT | NOT_ELIGIBLE | NOT_ALLOWED
--       * for an idempotent replay of an application CREATED BY THIS API (code shape COL + 7 hex) whose ORIGINAL creation audit is missing (a partial write from
--         before this change): records ONE distinct 'collaborator.member_application_audit_reconciled' event. It never writes a second 'created' event, never
--         repeats, and never touches a row created by another path (Admin create, Partner registration, V1 import: those have their own audit trail).
--         Rows younger than 30 seconds are IN_FLIGHT: nothing is written and the service answers a retryable 409, because their creator (the previous API during a
--         rolling deploy) may still be about to write its own audit event
--
-- Additive only: two new functions. No table, column, index, constraint, policy, trigger or data is created, changed or removed. The previously deployed API
-- does not call them, so applying this migration BEFORE the API is safe; the new API requires it (it fails closed with a 500 if the functions are missing).
-- Order: migration -> API.   Rollback: re-stage the API, then migration/v2/rollback/20261111000001_vno_merchant_member_atomic_create_rollback.sql.
begin;

create or replace function public.create_merchant_member_application(
  p_actor_user_id   uuid,
  p_merchant_id     uuid,
  p_code            text,
  p_name            text,
  p_phone           text,
  p_email           text,
  p_bank_name       text default null,
  p_bank_acc_number text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_email text;
  v_row   public.collaborators%rowtype;
begin
  if p_actor_user_id is null or p_merchant_id is null
     or coalesce(btrim(p_code,  E' \t\r\n'), '') = '' or coalesce(btrim(p_name,  E' \t\r\n'), '') = ''
     or coalesce(btrim(p_phone, E' \t\r\n'), '') = '' or coalesce(btrim(p_email, E' \t\r\n'), '') = '' then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;
  v_email := lower(btrim(p_email, E' \t\r\n'));

  -- who may add: an active Merchant profile bound to THIS Merchant, and the Merchant itself must be active + verified
  if not exists (
       select 1 from public.user_profiles up
       where up.user_id = p_actor_user_id and up.role = 'merchant' and up.merchant_id = p_merchant_id and up.user_profiles_status = 'active')
     or not exists (
       select 1 from public.merchant_details md
       where md.merchant_system_id = p_merchant_id and md.merchants_status = 'active' and md.merchant_verified = true) then
    return jsonb_build_object('outcome', 'NOT_ALLOWED');
  end if;

  -- one creation per e-mail at a time, across every API instance; released automatically at commit / rollback
  perform pg_advisory_xact_lock(hashtextextended('vno:merchant-member-email:' || v_email, 0));
  if exists (select 1 from public.collaborators c where lower(c.collaborators_email) = v_email) then
    return jsonb_build_object('outcome', 'EMAIL_HELD');
  end if;

  insert into public.collaborators
    (merchant_system_id, collaborators_code, collaborators_name, collaborators_phone, collaborators_email,
     collaborators_bank_name, collaborators_bank_acc_number, collaborators_password,
     collaborators_registered_date, collaborators_verified, collaborators_status)
  values
    (p_merchant_id, p_code, p_name, p_phone, v_email,
     p_bank_name, p_bank_acc_number, null,
     now(), false, 'pending')
  returning * into strict v_row;

  -- the audit event names WHO added a pending application and for which Merchant: no name, phone, e-mail or bank data
  insert into public.audit_events
    (actor_auth_user_id, actor_role, action, entity_type, entity_id, source, details)
  values
    (p_actor_user_id, 'merchant', 'collaborator.member_application_created', 'collaborator', v_row.id::text, 'v2-admin-api',
     jsonb_build_object('merchant_id', p_merchant_id, 'auth_invitation_required', true));

  return jsonb_build_object('outcome', 'CREATED', 'member', jsonb_build_object(
    'id', v_row.id,
    'merchant_system_id', v_row.merchant_system_id,
    'collaborators_code', v_row.collaborators_code,
    'collaborators_name', v_row.collaborators_name,
    'collaborators_phone', v_row.collaborators_phone,
    'collaborators_email', v_row.collaborators_email,
    'collaborators_bank_name', v_row.collaborators_bank_name,
    'collaborators_bank_acc_number', v_row.collaborators_bank_acc_number,
    'collaborators_status', v_row.collaborators_status,
    'collaborators_verified', v_row.collaborators_verified,
    'collaborators_registered_date', v_row.collaborators_registered_date));
end;
$$;

revoke all on function public.create_merchant_member_application(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_merchant_member_application(uuid, uuid, text, text, text, text, text, text)
  to service_role;

comment on function public.create_merchant_member_application(uuid, uuid, text, text, text, text, text, text) is
  'Atomic Merchant-member creation: the pending Partner application and its collaborator.member_application_created audit event are written in ONE transaction. Serialised per e-mail with an advisory lock. Returns outcome CREATED | EMAIL_HELD | NOT_ALLOWED.';

create or replace function public.reconcile_merchant_member_audit(
  p_actor_user_id uuid,
  p_merchant_id   uuid,
  p_member_id     uuid
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_row public.collaborators%rowtype;
begin
  if p_actor_user_id is null or p_merchant_id is null or p_member_id is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  if not exists (
       select 1 from public.user_profiles up
       where up.user_id = p_actor_user_id and up.role = 'merchant' and up.merchant_id = p_merchant_id and up.user_profiles_status = 'active')
     or not exists (
       select 1 from public.merchant_details md
       where md.merchant_system_id = p_merchant_id and md.merchants_status = 'active' and md.merchant_verified = true) then
    return 'NOT_ALLOWED';
  end if;

  -- only this Merchant's own still-pending application AND only one that this API created (its code shape): a pending row created by another path (Admin
  -- create, Partner registration, V1 import) has its own audit trail and must never receive a "creation audit missing" event from a Merchant's request
  select * into v_row from public.collaborators c
  where c.id = p_member_id and c.merchant_system_id = p_merchant_id
    and c.collaborators_status = 'pending' and c.collaborators_verified = false
    and c.collaborators_code ~ '^COL[0-9A-F]{7}$';
  if not found then
    return 'NOT_ELIGIBLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vno:merchant-member-audit:' || p_member_id::text, 0));

  -- an original creation event (or an earlier reconciliation) already exists: nothing to add, never a duplicate
  if exists (
       select 1 from public.audit_events a
       where a.entity_type = 'collaborator' and a.entity_id = p_member_id::text
         and a.action in ('collaborator.member_application_created', 'collaborator.member_application_audit_reconciled')) then
    return 'ALREADY_AUDITED';
  end if;

  -- a row this young may belong to a creator that is still about to write its own audit event (rolling deploy): leave it. Only a date within 30 s of now
  -- counts; a missing date, or one more than 30 s in the future (clock skew of the writer), is not "young"
  if v_row.collaborators_registered_date between now() - interval '30 seconds' and now() + interval '30 seconds' then
    return 'IN_FLIGHT';
  end if;

  insert into public.audit_events
    (actor_auth_user_id, actor_role, action, entity_type, entity_id, source, details)
  values
    (p_actor_user_id, 'merchant', 'collaborator.member_application_audit_reconciled', 'collaborator', p_member_id::text, 'v2-admin-api',
     jsonb_build_object('merchant_id', p_merchant_id, 'reason', 'creation_audit_missing',
                        'application_registered_at', v_row.collaborators_registered_date));
  return 'RECONCILED';
end;
$$;

revoke all on function public.reconcile_merchant_member_audit(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_merchant_member_audit(uuid, uuid, uuid)
  to service_role;

comment on function public.reconcile_merchant_member_audit(uuid, uuid, uuid) is
  'Records ONE collaborator.member_application_audit_reconciled event for a pending application created by the Merchant Members API (code COL+7 hex) whose original creation audit event is missing. Never writes a second created event, never repeats, never touches rows created by other paths. Returns ALREADY_AUDITED | RECONCILED | IN_FLIGHT | NOT_ELIGIBLE | NOT_ALLOWED.';

commit;

notify pgrst, 'reload schema';
