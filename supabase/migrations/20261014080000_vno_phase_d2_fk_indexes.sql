-- Cover the additive Phase D2 foreign keys used by reconciliation cleanup.
begin;

create index if not exists audit_events_import_batch_id_idx
  on public.audit_events (import_batch_id);
create index if not exists legacy_numbering_definitions_import_batch_id_idx
  on public.legacy_numbering_definitions (import_batch_id);
create index if not exists legacy_numbering_configs_definition_id_idx
  on public.legacy_numbering_configs (legacy_definition_id);
create index if not exists legacy_numbering_configs_import_batch_id_idx
  on public.legacy_numbering_configs (import_batch_id);
create index if not exists legacy_numbering_config_details_import_batch_id_idx
  on public.legacy_numbering_config_details (import_batch_id);

commit;
