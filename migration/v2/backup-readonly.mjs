// Read-only session guard shared by backup-uat-pg.mjs and its regression test.
//
// Why this exists: the hosted UAT connection goes through the Supabase pooler (Supavisor), which does not apply
// libpq startup options. PGOPTIONS='-c default_transaction_read_only=on' therefore silently has no effect there,
// and a bare `select current_setting('transaction_read_only')` in an autocommit psql session reports 'off'.
// Read-only mode must be established INSIDE the transaction that runs the work, and verified in that same transaction.
export const NOT_READ_ONLY = 'VNO_NOT_READ_ONLY';

// txMode is a parameter only so the regression test can prove the guard rejects a read-write transaction.
export const wrapReadOnly = (query, txMode = 'READ ONLY') => `begin transaction isolation level repeatable read ${txMode};
set local statement_timeout = 0;
do $vno_guard$ begin
  if current_setting('transaction_read_only') <> 'on' then raise exception '${NOT_READ_ONLY}: transaction_read_only=%', current_setting('transaction_read_only'); end if;
end $vno_guard$;
${query}
;
rollback;
`;
