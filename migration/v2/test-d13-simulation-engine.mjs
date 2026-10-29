#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const migrationPath = new URL('../../supabase/migrations/20261028142324_vno_phase_d13_integrated_uat_simulation.sql', import.meta.url);
const migration = readFileSync(migrationPath, 'utf8')
  .replace(/^begin;\s*$/im, '')
  .replace(/^commit;\s*$/im, '');

const actor = '10000000-0000-5000-8000-000000000002';
const merchant = '20000000-0000-5000-8000-000000000002';
const collaborator = '20000000-0000-5000-8000-000000000003';
const key = '13000000-0000-5000-8000-000000000001';

const assertions = `
update public.merchant_details
set merchant_discount_type = 'percentage', merchant_discount_value = 0.1000,
    merchant_commission_type = 'percentage', merchant_commission_value = 0.0500
where merchant_system_id = '${merchant}';

do $test$
declare
  first_result record;
  replay_result record;
begin
  if has_function_privilege('anon', 'public.create_uat_simulation_transaction(uuid,text,numeric,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.create_uat_simulation_transaction(uuid,text,numeric,uuid)', 'execute') then
    raise exception 'Untrusted role can execute simulation RPC';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.transaction_events'::regclass) then
    raise exception 'Transaction event RLS is disabled';
  end if;
  select * into first_result from public.create_uat_simulation_transaction(
    '${actor}', 'D2-TEST-C', 1234.5678, '${key}'
  );
  if first_result.idempotent_replay or first_result.gross_amount <> 1234.5678
     or first_result.discount_rate <> 0.1000 or first_result.discount_amount <> 123.4568
     or first_result.commission_rate <> 0.0500 or first_result.commission_amount <> 61.7284
     or first_result.simulation_status <> 'OPEN' then
    raise exception 'Initial simulation result mismatch';
  end if;

  select * into replay_result from public.create_uat_simulation_transaction(
    '${actor}', 'D2-TEST-C', 1234.5678, '${key}'
  );
  if not replay_result.idempotent_replay or replay_result.transaction_id <> first_result.transaction_id then
    raise exception 'Idempotent replay mismatch';
  end if;

  begin
    perform public.create_uat_simulation_transaction('${actor}', 'D2-TEST-C', 999.0000, '${key}');
    raise exception 'Conflicting idempotency payload was accepted';
  exception when unique_violation then null;
  end;

  begin
    perform public.create_uat_simulation_transaction('10000000-0000-5000-8000-000000000001', 'D2-TEST-C', 10.0000, '13000000-0000-5000-8000-000000000002');
    raise exception 'Non-Merchant actor was accepted';
  exception when insufficient_privilege then null;
  end;

  update public.collaborators set merchant_system_id = null where id = '${collaborator}';
  begin
    perform public.create_uat_simulation_transaction('${actor}', 'D2-TEST-C', 10.0000, '13000000-0000-5000-8000-000000000003');
    raise exception 'Cross-relationship simulation was accepted';
  exception when insufficient_privilege then null;
  end;

  if (select count(*) from public.referral_transactions where record_kind = 'uat_simulation' and idempotency_key = '${key}') <> 1 then
    raise exception 'Simulation row count mismatch';
  end if;
  if (select count(*) from public.transaction_events te join public.referral_transactions rt on rt.id = te.transaction_id where rt.idempotency_key = '${key}') <> 1 then
    raise exception 'Transaction event count mismatch';
  end if;
  if (select count(*) from public.audit_events where request_id = '${key}' and source = 'v2-uat-simulation') <> 1 then
    raise exception 'Audit provenance count mismatch';
  end if;
  if exists (
    select 1 from public.referral_transactions
    where idempotency_key = '${key}'
      and (legacy_status is not null or payment_status <> 'unverified' or external_settlement_enabled)
  ) then
    raise exception 'Simulation separation invariant failed';
  end if;
end
$test$;
`;

const sql = `begin;\n${migration}\n${assertions}\nrollback;\n`;
const output = execFileSync('docker', [
  'exec', '-i', 'supabase_db_vno-phase-d2-rehearsal',
  'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
], { input: sql, encoding: 'utf8' });

if (!output.includes('ROLLBACK')) throw new Error('Simulation rehearsal did not roll back');
console.log('D13 UAT simulation migration and engine: PASS (transaction rolled back)');
