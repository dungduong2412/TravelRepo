-- Phase D10B: additive Merchant details and governed media approval.
-- REVIEW ONLY until the owner separately authorizes application to UAT.
-- Existing media is preserved as legacy/pre-governance effective media; it is
-- intentionally not relabelled as Platform-Admin approved.

begin;

alter table public.merchant_details
  add column if not exists owner_tax_code text,
  add column if not exists merchant_description_format text not null default 'plain_text',
  add column if not exists new_address_country text,
  add column if not exists new_address_province text,
  add column if not exists new_address_district text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.merchant_details'::regclass
      and conname = 'merchant_details_description_format_ck'
  ) then
    alter table public.merchant_details
      add constraint merchant_details_description_format_ck
      check (merchant_description_format in ('plain_text', 'markdown'));
  end if;
end
$constraints$;

alter table public.merchant_update_requests
  add column if not exists request_status text,
  add column if not exists requested_by uuid references auth.users(id),
  add column if not exists decided_by uuid references auth.users(id),
  add column if not exists decided_at timestamptz,
  add column if not exists decision_reason text,
  add column if not exists request_source text;

update public.merchant_update_requests
set request_status = 'legacy_preserved', request_source = 'v1_import'
where request_status is null;
alter table public.merchant_update_requests
  alter column request_status set default 'pending',
  alter column request_status set not null,
  alter column request_source set default 'v2',
  alter column request_source set not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.merchant_update_requests'::regclass
      and conname = 'merchant_update_requests_status_ck'
  ) then
    alter table public.merchant_update_requests
      add constraint merchant_update_requests_status_ck
      check (request_status in ('legacy_preserved', 'pending', 'approved', 'rejected', 'cancelled'));
  end if;
end
$constraints$;

-- New V2 category assignments are limited to three distinct categories. Existing
-- and imported V1 associations retain explicit provenance and are never removed
-- merely because their historical cardinality exceeds the V2 limit.
alter table public.merchant_category_links
  add column if not exists association_source text;

update public.merchant_category_links
set association_source = 'legacy_preserved'
where association_source is null;

alter table public.merchant_category_links
  alter column association_source set default 'v2',
  alter column association_source set not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.merchant_category_links'::regclass
      and conname = 'merchant_category_links_source_ck'
  ) then
    alter table public.merchant_category_links
      add constraint merchant_category_links_source_ck
      check (association_source in ('legacy_preserved', 'v1_import', 'v2'));
  end if;
end
$constraints$;

create or replace function public.enforce_merchant_category_limit()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  existing_count integer;
begin
  -- Idempotent V1-import upserts do not change the category assignment.
  if tg_op = 'UPDATE'
    and new.merchant_id = old.merchant_id
    and new.category_id = old.category_id then
    return new;
  end if;

  -- Only the controlled importer may create new historical associations. The
  -- stable V1 identities prevent ordinary V2 rows from claiming this exemption.
  if tg_op = 'INSERT' and new.association_source = 'v1_import' then
    if not exists (
      select 1
      from public.merchant_details merchant
      join public.categories category on category.id = new.category_id
      where merchant.merchant_system_id = new.merchant_id
        and merchant.legacy_restaurant_id is not null
        and category.legacy_category_id is not null
        and (
          new.legacy_tenant_id is null
          or (
            merchant.legacy_tenant_id is not distinct from new.legacy_tenant_id
            and category.legacy_tenant_id is not distinct from new.legacy_tenant_id
          )
        )
    ) then
      raise exception 'invalid V1 category association provenance' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.association_source <> 'v2' then
    raise exception 'historical category associations are immutable' using errcode = '23514';
  end if;

  -- Serialize direct SQL/API writes per merchant so concurrent inserts cannot
  -- independently pass the count check and create a fourth V2 association.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-categories:' || new.merchant_id::text, 0)
  );

  if tg_op = 'UPDATE' then
    select count(*) into existing_count
    from public.merchant_category_links link
    where link.merchant_id = new.merchant_id
      and (link.merchant_id, link.category_id)
          is distinct from (old.merchant_id, old.category_id);
  else
    select count(*) into existing_count
    from public.merchant_category_links link
    where link.merchant_id = new.merchant_id;
  end if;

  if existing_count >= 3 then
    raise exception 'a merchant may have at most 3 categories' using errcode = '23514';
  end if;
  return new;
end
$function$;

drop trigger if exists merchant_category_links_limit_trg
  on public.merchant_category_links;
create trigger merchant_category_links_limit_trg
before insert or update of merchant_id, category_id
on public.merchant_category_links
for each row execute function public.enforce_merchant_category_limit();

create or replace function public.set_merchant_categories(
  p_merchant_id uuid,
  p_actor_user_id uuid,
  p_category_ids uuid[]
) returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  profile_row public.user_profiles;
  requested_count integer;
  distinct_count integer;
  previous_category_ids uuid[];
begin
  select * into profile_row from public.user_profiles
  where user_id = p_actor_user_id and user_profiles_status = 'active';
  if not found or not (
    profile_row.role = 'admin'
    or (profile_row.role = 'merchant' and profile_row.merchant_id = p_merchant_id)
  ) then
    raise exception 'merchant category update denied' using errcode = '42501';
  end if;
  requested_count := pg_catalog.cardinality(coalesce(p_category_ids, '{}'::uuid[]));
  select count(distinct requested.category_id)
    into distinct_count
  from unnest(coalesce(p_category_ids, '{}'::uuid[])) as requested(category_id);
  if requested_count <> distinct_count then
    raise exception 'merchant categories must be distinct' using errcode = '22023';
  end if;
  if requested_count > 3 then
    raise exception 'a merchant may have at most 3 categories' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_category_ids, '{}'::uuid[])) as requested(category_id)
    where not exists (select 1 from public.categories c where c.id = requested.category_id)
  ) then
    raise exception 'unknown category' using errcode = '23503';
  end if;
  select coalesce(array_agg(link.category_id order by link.category_id), '{}'::uuid[])
    into previous_category_ids
  from public.merchant_category_links link
  where link.merchant_id = p_merchant_id;
  delete from public.merchant_category_links where merchant_id = p_merchant_id;
  insert into public.merchant_category_links
    (merchant_id, category_id, legacy_tenant_id, association_source)
  select p_merchant_id, requested.category_id, null, 'v2'
  from unnest(coalesce(p_category_ids, '{}'::uuid[])) as requested(category_id)
  order by requested.category_id;
  insert into public.audit_events
    (actor_auth_user_id, actor_role, action, entity_type, entity_id, source, details)
  values
    (p_actor_user_id, profile_row.role, 'merchant.categories_updated', 'merchant',
     p_merchant_id::text, 'v2-admin-api',
     jsonb_build_object(
       'previous_category_ids', previous_category_ids,
       'category_ids', coalesce(p_category_ids, '{}'::uuid[])
     ));
end
$function$;

alter table public.media_assets
  add column if not exists uploaded_by uuid references auth.users(id),
  add column if not exists publication_status text,
  add column if not exists publication_version bigint not null default 0,
  add column if not exists effective_from timestamptz,
  add column if not exists effective_until timestamptz,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz;

update public.media_assets
set publication_status = case
    when transfer_status = 'failed' then 'failed'
    when legacy_image_id is not null
      or legacy_merchant_image_id is not null
      or legacy_media_asset_id is not null
      or legacy_blob_id is not null then 'legacy_effective'
    else 'preexisting_effective'
  end,
  effective_from = case
    when transfer_status = 'verified' then coalesce(effective_from, created_at)
    else effective_from
  end
where publication_status is null;

alter table public.media_assets
  alter column publication_status set default 'pending',
  alter column publication_status set not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.media_assets'::regclass
      and conname = 'media_assets_publication_status_ck'
  ) then
    alter table public.media_assets
      add constraint media_assets_publication_status_ck check (
        publication_status in (
          'legacy_effective', 'preexisting_effective', 'pending', 'approved',
          'rejected', 'cancelled', 'superseded', 'removed', 'failed'
        )
      );
  end if;
end
$constraints$;

create table if not exists public.media_approval_requests (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null,
  merchant_id uuid references public.merchant_details(merchant_system_id),
  collaborator_id uuid references public.collaborators(id),
  action text not null,
  slot text not null,
  proposed_media_id uuid references public.media_assets(id),
  target_media_id uuid references public.media_assets(id),
  requested_display_order integer,
  expected_target_version bigint,
  status text not null default 'pending',
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_approval_requests_owner_ck check (
    (owner_type = 'merchant' and merchant_id is not null and collaborator_id is null)
    or
    (owner_type = 'collaborator' and collaborator_id is not null and merchant_id is null)
  ),
  constraint media_approval_requests_action_ck check (
    action in ('add', 'replace', 'remove', 'reorder')
  ),
  constraint media_approval_requests_slot_ck check (slot in ('main', 'gallery')),
  constraint media_approval_requests_status_ck check (
    status in ('pending', 'approved', 'rejected', 'cancelled')
  ),
  constraint media_approval_requests_shape_ck check (
    (action = 'add' and proposed_media_id is not null and target_media_id is null)
    or
    (action = 'replace' and proposed_media_id is not null and target_media_id is not null)
    or
    (action in ('remove', 'reorder') and proposed_media_id is null and target_media_id is not null)
  ),
  constraint media_approval_requests_order_ck check (
    requested_display_order is null or requested_display_order >= 0
  )
);

create unique index if not exists media_approval_requests_proposed_media_uq
  on public.media_approval_requests (proposed_media_id)
  where proposed_media_id is not null;
create unique index if not exists media_approval_requests_pending_target_uq
  on public.media_approval_requests (target_media_id)
  where status = 'pending' and target_media_id is not null;
create index if not exists media_approval_requests_queue_idx
  on public.media_approval_requests (status, requested_at);
create index if not exists media_approval_requests_merchant_history_idx
  on public.media_approval_requests (merchant_id, requested_at desc)
  where merchant_id is not null;
create index if not exists media_approval_requests_collaborator_history_idx
  on public.media_approval_requests (collaborator_id, requested_at desc)
  where collaborator_id is not null;
create index if not exists media_approval_requests_requested_by_idx
  on public.media_approval_requests (requested_by, requested_at desc);
create index if not exists media_approval_requests_decided_by_idx
  on public.media_approval_requests (decided_by, decided_at desc)
  where decided_by is not null;
create index if not exists media_assets_uploaded_by_idx
  on public.media_assets (uploaded_by, created_at desc)
  where uploaded_by is not null;
create index if not exists media_assets_approved_by_idx
  on public.media_assets (approved_by, approved_at desc)
  where approved_by is not null;
create index if not exists merchant_update_requests_requested_by_idx
  on public.merchant_update_requests (requested_by, requested_at desc)
  where requested_by is not null;
create index if not exists merchant_update_requests_decided_by_idx
  on public.merchant_update_requests (decided_by, decided_at desc)
  where decided_by is not null;
create index if not exists media_assets_effective_merchant_idx
  on public.media_assets (merchant_id, is_hero desc, display_order, created_at)
  where publication_status in ('legacy_effective', 'preexisting_effective', 'approved');
create index if not exists media_assets_effective_collaborator_idx
  on public.media_assets (collaborator_id, is_hero desc, display_order, created_at)
  where publication_status in ('legacy_effective', 'preexisting_effective', 'approved');

create or replace function public.approve_media_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_reason text default null
) returns public.media_approval_requests
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  request_row public.media_approval_requests;
  target_row public.media_assets;
  result_row public.media_approval_requests;
  owner_lock text;
begin
  if not exists (
    select 1 from public.user_profiles
    where user_id = p_actor_user_id
      and role = 'admin'
      and user_profiles_status = 'active'
  ) then
    raise exception 'active Platform Admin required' using errcode = '42501';
  end if;

  select * into request_row
  from public.media_approval_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'media approval request not found' using errcode = 'P0002'; end if;
  if request_row.status <> 'pending' then raise exception 'media approval request already decided' using errcode = 'P0001'; end if;

  owner_lock := request_row.owner_type || ':' || coalesce(request_row.merchant_id::text, request_row.collaborator_id::text);
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_lock, 0));

  if request_row.target_media_id is not null then
    select * into target_row from public.media_assets
    where id = request_row.target_media_id for update;
    if not found
      or target_row.merchant_id is distinct from request_row.merchant_id
      or target_row.collaborator_id is distinct from request_row.collaborator_id then
      raise exception 'target media owner mismatch' using errcode = 'P0001';
    end if;
    if request_row.expected_target_version is distinct from target_row.publication_version then
      raise exception 'stale media replacement request' using errcode = '40001';
    end if;
    if target_row.publication_status not in ('legacy_effective', 'preexisting_effective', 'approved') then
      raise exception 'target media is no longer effective' using errcode = '40001';
    end if;
  end if;

  if request_row.proposed_media_id is not null and not exists (
    select 1 from public.media_assets
    where id = request_row.proposed_media_id
      and merchant_id is not distinct from request_row.merchant_id
      and collaborator_id is not distinct from request_row.collaborator_id
      and publication_status = 'pending'
      and transfer_status = 'verified'
  ) then
    raise exception 'proposed media owner or state mismatch' using errcode = 'P0001';
  end if;

  if request_row.action = 'add' and request_row.slot = 'main' then
    update public.media_assets
    set publication_status = 'superseded', effective_until = now(),
        is_hero = false, publication_version = publication_version + 1
    where merchant_id is not distinct from request_row.merchant_id
      and collaborator_id is not distinct from request_row.collaborator_id
      and is_hero
      and publication_status in ('legacy_effective', 'preexisting_effective', 'approved');
  elsif request_row.action = 'replace' then
    update public.media_assets
    set publication_status = 'superseded', effective_until = now(),
        is_hero = false, publication_version = publication_version + 1
    where id = request_row.target_media_id;
  elsif request_row.action = 'remove' then
    update public.media_assets
    set publication_status = 'removed', effective_until = now(),
        is_hero = false, publication_version = publication_version + 1
    where id = request_row.target_media_id;
  elsif request_row.action = 'reorder' then
    update public.media_assets
    set display_order = request_row.requested_display_order,
        publication_version = publication_version + 1
    where id = request_row.target_media_id;
  end if;

  if request_row.proposed_media_id is not null then
    update public.media_assets
    set publication_status = 'approved',
        is_hero = request_row.slot = 'main',
        display_order = coalesce(request_row.requested_display_order, case when request_row.slot = 'main' then 0 else display_order end),
        effective_from = now(), effective_until = null,
        approved_by = p_actor_user_id, approved_at = now(),
        publication_version = publication_version + 1
    where id = request_row.proposed_media_id;
  end if;

  update public.media_approval_requests
  set status = 'approved', decided_by = p_actor_user_id, decided_at = now(),
      decision_reason = nullif(pg_catalog.btrim(p_reason), ''), updated_at = now()
  where id = p_request_id
  returning * into result_row;

  insert into public.audit_events
    (actor_auth_user_id, actor_role, action, entity_type, entity_id, source, details)
  values
    (p_actor_user_id, 'admin', 'media.approved', 'media_approval_request', p_request_id::text,
     'v2-admin-api', jsonb_build_object('owner_type', request_row.owner_type,
       'merchant_id', request_row.merchant_id, 'collaborator_id', request_row.collaborator_id,
       'operation', request_row.action, 'proposed_media_id', request_row.proposed_media_id,
       'target_media_id', request_row.target_media_id));
  return result_row;
end
$function$;

create or replace function public.reject_media_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_reason text
) returns public.media_approval_requests
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  request_row public.media_approval_requests;
  result_row public.media_approval_requests;
begin
  if nullif(pg_catalog.btrim(p_reason), '') is null then
    raise exception 'rejection reason is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.user_profiles
    where user_id = p_actor_user_id and role = 'admin' and user_profiles_status = 'active'
  ) then
    raise exception 'active Platform Admin required' using errcode = '42501';
  end if;
  select * into request_row from public.media_approval_requests
  where id = p_request_id for update;
  if not found then raise exception 'media approval request not found' using errcode = 'P0002'; end if;
  if request_row.status <> 'pending' then raise exception 'media approval request already decided' using errcode = 'P0001'; end if;

  if request_row.proposed_media_id is not null then
    update public.media_assets
    set publication_status = 'rejected', publication_version = publication_version + 1
    where id = request_row.proposed_media_id and publication_status = 'pending';
  end if;
  update public.media_approval_requests
  set status = 'rejected', decided_by = p_actor_user_id, decided_at = now(),
      decision_reason = pg_catalog.btrim(p_reason), updated_at = now()
  where id = p_request_id returning * into result_row;
  insert into public.audit_events
    (actor_auth_user_id, actor_role, action, entity_type, entity_id, source, details)
  values
    (p_actor_user_id, 'admin', 'media.rejected', 'media_approval_request', p_request_id::text,
     'v2-admin-api', jsonb_build_object('reason', pg_catalog.btrim(p_reason),
       'proposed_media_id', request_row.proposed_media_id,
       'target_media_id', request_row.target_media_id));
  return result_row;
end
$function$;

create or replace function public.cancel_media_request(
  p_request_id uuid,
  p_actor_user_id uuid
) returns public.media_approval_requests
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  request_row public.media_approval_requests;
  result_row public.media_approval_requests;
  profile_row public.user_profiles;
begin
  select * into profile_row from public.user_profiles
  where user_id = p_actor_user_id and user_profiles_status = 'active';
  if not found then raise exception 'active profile required' using errcode = '42501'; end if;

  select * into request_row from public.media_approval_requests
  where id = p_request_id for update;
  if not found then raise exception 'media approval request not found' using errcode = 'P0002'; end if;
  if request_row.status <> 'pending' then raise exception 'only pending requests can be cancelled' using errcode = 'P0001'; end if;
  if profile_row.role <> 'admin'
    and request_row.requested_by <> p_actor_user_id then
    raise exception 'media approval request cancellation denied' using errcode = '42501';
  end if;

  if request_row.proposed_media_id is not null then
    update public.media_assets
    set publication_status = 'cancelled', publication_version = publication_version + 1
    where id = request_row.proposed_media_id and publication_status = 'pending';
  end if;
  update public.media_approval_requests
  set status = 'cancelled', decided_by = p_actor_user_id, decided_at = now(),
      decision_reason = 'cancelled by requester', updated_at = now()
  where id = p_request_id returning * into result_row;
  insert into public.audit_events
    (actor_auth_user_id, actor_role, action, entity_type, entity_id, source, details)
  values
    (p_actor_user_id, profile_row.role, 'media.cancelled', 'media_approval_request',
     p_request_id::text, 'v2-admin-api',
     jsonb_build_object('proposed_media_id', request_row.proposed_media_id,
       'target_media_id', request_row.target_media_id));
  return result_row;
end
$function$;

alter table public.media_approval_requests enable row level security;
revoke all on table public.media_approval_requests from anon, authenticated;
grant all on table public.media_approval_requests to service_role;
grant all on table public.media_assets to service_role;
revoke all on function public.approve_media_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reject_media_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_media_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_merchant_categories(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.enforce_merchant_category_limit() from public, anon, authenticated;
grant execute on function public.approve_media_request(uuid, uuid, text) to service_role;
grant execute on function public.reject_media_request(uuid, uuid, text) to service_role;
grant execute on function public.cancel_media_request(uuid, uuid) to service_role;
grant execute on function public.set_merchant_categories(uuid, uuid, uuid[]) to service_role;
grant execute on function public.enforce_merchant_category_limit() to service_role;

commit;
