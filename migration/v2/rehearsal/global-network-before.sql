-- The ONE transaction created under the OLD rules (assigned Partner at its Merchant); its checksum must be identical after the migration.
select 'BEFORE: assigned partner at A' as t, transaction_id is not null as ok from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-P1',1000000,'a0000000-0000-4000-8000-000000000001');
-- and the old refusal, reproduced (expect: ERROR Partner is not assigned to this Merchant)
\set ON_ERROR_STOP off
select * from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-P2',1000000,'a0000000-0000-4000-8000-000000000002');
