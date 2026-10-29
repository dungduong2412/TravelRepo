#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const container = process.env.VNO_LOCAL_DB_CONTAINER || 'supabase_db_vno-phase-d2-rehearsal';
if (!/^supabase_db_[a-z0-9_-]+$/.test(container)) throw new Error('Refusing a non-local Supabase database target');

const migration = readFileSync(new URL('../../supabase/migrations/20261027030914_vno_phase_d13a_fractional_rate_guard.sql', import.meta.url), 'utf8')
  .replace(/^begin;\s*$/m, '')
  .replace(/^commit;\s*$/m, '');

const sql = `
begin;
${migration}
create temporary table d13a_rate_guard_test (
  merchant_commission_type text,
  merchant_commission_value numeric(18,4),
  merchant_discount_type text,
  merchant_discount_value numeric(18,4),
  unrelated text
);
create trigger d13a_rate_guard_test_trg
before insert or update of merchant_commission_type, merchant_commission_value,
  merchant_discount_type, merchant_discount_value
on d13a_rate_guard_test for each row execute function public.enforce_fractional_merchant_rates();
insert into d13a_rate_guard_test values ('percentage', 0.1000, 'percentage', 1.0000, 'valid');
insert into d13a_rate_guard_test values ('fixed', 100000.0000, 'fixed', 200000.0000, 'fixed');
do $test$
begin
  begin
    insert into d13a_rate_guard_test values ('percentage', 1.0001, null, null, 'invalid');
    raise exception 'expected percentage guard to reject 1.0001';
  exception when check_violation then null;
  end;
end
$test$;
alter table d13a_rate_guard_test disable trigger d13a_rate_guard_test_trg;
insert into d13a_rate_guard_test values ('percentage', 10.0000, null, null, 'historical');
alter table d13a_rate_guard_test enable trigger d13a_rate_guard_test_trg;
update d13a_rate_guard_test set unrelated = 'unrelated edit allowed' where unrelated = 'historical';
do $test$
declare n integer;
begin
  select count(*) into n from d13a_rate_guard_test;
  if n <> 3 then raise exception 'unexpected row count %', n; end if;
end
$test$;
rollback;
`;

const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {
  input: sql,
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
console.log('D13A fractional-rate migration rehearsal: PASS (transaction rolled back)');
