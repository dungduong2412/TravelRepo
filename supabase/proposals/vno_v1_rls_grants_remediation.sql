-- SECURITY REMEDIATION PROPOSAL -- intentionally not applied during the
-- schema-reconciliation pass. The backend currently performs these reads and
-- writes with the service role, while anonymous users consume public data via
-- backend endpoints. Public SELECT is retained for categories and organization
-- profile to avoid breaking any existing direct Data API readers.

begin;

alter function public.update_organization_profile_updated_at()
  set search_path = pg_catalog, public;
alter function public.update_updated_at_column()
  set search_path = pg_catalog, public;
alter function public.update_categories_updated_at()
  set search_path = pg_catalog, public;

alter table public.categories enable row level security;
alter table public.organization_profile enable row level security;

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read
  on public.categories
  for select
  to anon, authenticated
  using (true);

drop policy if exists organization_profile_public_read on public.organization_profile;
create policy organization_profile_public_read
  on public.organization_profile
  for select
  to anon, authenticated
  using (true);

revoke all on table public.categories from anon, authenticated;
grant select on table public.categories to anon, authenticated;
revoke all on table public.organization_profile from anon, authenticated;
grant select on table public.organization_profile to anon, authenticated;

drop policy if exists "Anyone can create profile" on public.user_profiles;
drop policy if exists "Users can update own profile" on public.user_profiles;
drop policy if exists "Users can view own profile" on public.user_profiles;

create policy user_profiles_select_own
  on public.user_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy user_profiles_update_own
  on public.user_profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.user_profiles from anon, authenticated;
grant select, update on table public.user_profiles to authenticated;

revoke all on table public.collaborators from anon, authenticated;
revoke all on table public.merchant_details from anon, authenticated;
revoke all on table public.merchant_category_links from anon, authenticated;
revoke all on table public.merchant_user_links from anon, authenticated;
revoke all on table public.referral_transactions from anon, authenticated;
revoke all on table public.media_assets from anon, authenticated;
revoke all on table public.merchant_update_requests from anon, authenticated;
revoke all on table public.legacy_identity_map from anon, authenticated;
revoke all on table public.legacy_migration_runs from anon, authenticated;
revoke all on table public.legacy_source_records from anon, authenticated;

grant all on table public.categories to service_role;
grant all on table public.organization_profile to service_role;
grant all on table public.user_profiles to service_role;
grant all on table public.collaborators to service_role;
grant all on table public.merchant_details to service_role;
grant all on table public.merchant_category_links to service_role;
grant all on table public.merchant_user_links to service_role;
grant all on table public.referral_transactions to service_role;
grant all on table public.media_assets to service_role;
grant all on table public.merchant_update_requests to service_role;
grant all on table public.legacy_identity_map to service_role;
grant all on table public.legacy_migration_runs to service_role;
grant all on table public.legacy_source_records to service_role;

commit;
