-- Repair findings produced by the Supabase performance advisor after the
-- reconciliation migrations. No table data is changed.

begin;

drop index if exists public.legacy_source_records_source_identity_uq;

create index if not exists legacy_migration_batches_legacy_tenant_id_idx
  on public.legacy_migration_batches (legacy_tenant_id);

commit;
