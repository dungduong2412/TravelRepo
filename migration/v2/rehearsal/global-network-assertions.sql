-- Behaviour assertions for 20261109000001_vno_global_partner_network.sql on the REHEARSAL database (never hosted).
-- Sequence: start-rehearsal-stack.sh with SKIP=20261109000001; psql < global-network-seed.sql; make the one pre-migration transaction (see README);
--           apply the migration; psql < this file. Every row must read PASS.
\set ON_ERROR_STOP on
create temp table res(label text, ok boolean, detail text);
create or replace function pg_temp.expect_err(label text, sqlstate_ text, msg_like text, stmt text) returns void language plpgsql as $f$
declare s text; m text;
begin
  begin execute stmt; insert into res values (label, false, 'no error raised');
  exception when others then get stacked diagnostics s = returned_sqlstate, m = message_text;
    insert into res values (label, s = sqlstate_ and m like msg_like, s||' '||m);
  end;
end $f$;
-- ids
-- A: 5%/10%   B: 3%/8%   C: commission 0 explicit, no discount   D: nothing configured
do $$ declare r record; begin
  -- F: unassigned Partner (P2) at Merchant A succeeds, A's policy
  select * into r from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-P2',1000000,'a0000000-0000-4000-8000-000000000012');
  insert into res values ('F  unassigned P2 at A succeeds with A policy', r.discount_rate=0.05 and r.discount_amount=50000 and r.commission_rate=0.10 and r.commission_amount=100000 and not r.idempotent_replay and r.scan_event_id is null, row_to_json(r)::text);
  -- B/C: the SAME partner at a second Merchant uses that Merchant's own policy
  select * into r from public.create_real_transaction('00000000-0000-0000-0000-0000000000b1','COL-P2',1000000,'b0000000-0000-4000-8000-000000000012');
  insert into res values ('B/C same P2 at B uses B policy', r.discount_rate=0.03 and r.commission_rate=0.08 and r.commission_amount=80000, row_to_json(r)::text);
  -- commission independent of discount, on original amount; explicit 0 commission + no discount
  select * into r from public.create_real_transaction('00000000-0000-0000-0000-0000000000c1','COL-P2',250000.5,'c0000000-0000-4000-8000-000000000012');
  insert into res values ('explicit 0 commission + absent discount => 0 / 0', r.discount_rate=0 and r.discount_amount=0 and r.commission_rate=0 and r.commission_amount=0, row_to_json(r)::text);
  -- a Partner assigned to A (history) can also transact at B
  select * into r from public.create_real_transaction('00000000-0000-0000-0000-0000000000b1','COL-P1',100,'b0000000-0000-4000-8000-000000000013');
  insert into res values ('historical assignment is irrelevant (P1 at B)', r.commission_amount=8, row_to_json(r)::text);
  -- idempotent replay
  select * into r from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-P2',1000000,'a0000000-0000-4000-8000-000000000012');
  insert into res values ('replay: same key + same input is the same transaction', r.idempotent_replay, row_to_json(r)::text);
end $$;
select pg_temp.expect_err('G  idempotency key reused with different amount', '23505', '%different input%', $$select * from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-P2',999,'a0000000-0000-4000-8000-000000000012')$$);
select pg_temp.expect_err('no commission policy configured (D) is refused explicitly', '22023', '%commission policy is not configured%', $$select * from public.create_real_transaction('00000000-0000-0000-0000-0000000000d1','COL-P2',1000,'d0000000-0000-4000-8000-000000000012')$$);
select pg_temp.expect_err('G  pending Partner refused', '22023', '%Active verified Partner required%', $$select * from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-P3',1000,'a0000000-0000-4000-8000-000000000014')$$);
select pg_temp.expect_err('G  unknown Partner refused', '22023', '%Active verified Partner required%', $$select * from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-NOPE',1000,'a0000000-0000-4000-8000-000000000015')$$);
select pg_temp.expect_err('G  non-merchant actor refused', '42501', '%Active Merchant profile required%', $$select * from public.create_real_transaction('99999999-0000-0000-0000-000000000099','COL-P2',1000,'a0000000-0000-4000-8000-000000000016')$$);
select pg_temp.expect_err('amount must be positive', '22003', '%Gross amount%', $$select * from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-P2',0,'a0000000-0000-4000-8000-000000000017')$$);
-- legacy discount (points) on a Merchant is refused, not guessed
update public.merchant_details set merchant_discount_type='points', merchant_discount_value=8 where merchant_code='MB';
select pg_temp.expect_err('legacy points discount is refused, not guessed', '22023', '%discount policy is not a reviewed fraction%', $$select * from public.create_real_transaction('00000000-0000-0000-0000-0000000000b1','COL-P2',1000,'b0000000-0000-4000-8000-000000000018')$$);
update public.merchant_details set merchant_discount_type='percentage', merchant_discount_value=0.03 where merchant_code='MB';
-- scan link
insert into public.partner_scan_events (id, merchant_id, collaborator_id, scan_key, key_kind, source) values
 ('5ca00000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-00000000000a','22222222-0000-4000-8000-000000000002','s:one:P2','scan_id','camera');
do $$ declare r record; begin
  select * into r from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-P2',500000,'a0000000-0000-4000-8000-000000000021','5ca00000-0000-4000-8000-000000000001');
  insert into res values ('transaction links to its scan event', r.scan_event_id='5ca00000-0000-4000-8000-000000000001', row_to_json(r)::text);
  insert into res select 'scan link recorded in transaction_events + audit', (select count(*) from public.transaction_events where details->>'scan_event_id'='5ca00000-0000-4000-8000-000000000001')=1 and (select count(*) from public.audit_events where details->>'scan_event_id'='5ca00000-0000-4000-8000-000000000001')=1, '';
end $$;
select pg_temp.expect_err('scan of another Merchant cannot be used', '22023', '%Scan event does not belong%', $$select * from public.create_real_transaction('00000000-0000-0000-0000-0000000000b1','COL-P2',1000,'b0000000-0000-4000-8000-000000000022','5ca00000-0000-4000-8000-000000000001')$$);
select pg_temp.expect_err('scan of another Partner cannot be used', '22023', '%Scan event does not belong%', $$select * from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-P1',1000,'a0000000-0000-4000-8000-000000000023','5ca00000-0000-4000-8000-000000000001')$$);
insert into res select 'refused calls wrote nothing (6 real transactions: 1 pre-existing + 5 successful calls)', (select count(*) from public.referral_transactions where record_kind='real_transaction')=6, (select count(*)::text from public.referral_transactions where record_kind='real_transaction');
-- two transactions may reference one scan (cancel + corrected attempt)
do $$ declare r record; begin
  select * into r from public.create_real_transaction('00000000-0000-0000-0000-0000000000a1','COL-P2',510000,'a0000000-0000-4000-8000-000000000024','5ca00000-0000-4000-8000-000000000001');
  insert into res values ('a second transaction may reference the same scan (corrected attempt)', r.scan_event_id is not null, '');
end $$;
-- scan uniqueness
select pg_temp.expect_err('scan unique per (merchant, scan_key)', '23505', '%partner_scan_events_merchant_key_uq%', $$insert into public.partner_scan_events (merchant_id, collaborator_id, scan_key, key_kind) values ('aaaaaaaa-0000-4000-8000-00000000000a','22222222-0000-4000-8000-000000000002','s:one:P2','scan_id')$$);
insert into public.partner_scan_events (merchant_id, collaborator_id, scan_key, key_kind) values ('bbbbbbbb-0000-4000-8000-00000000000b','22222222-0000-4000-8000-000000000002','s:one:P2','scan_id');
insert into res values ('same scan key at ANOTHER Merchant is a different scan', true, '');
-- simulation function: no assignment needed; old behaviour otherwise
do $$ declare r record; begin
  select * into r from public.create_uat_simulation_transaction('00000000-0000-0000-0000-0000000000a1','COL-P2',1000000,'a0000000-0000-4000-8000-000000000031');
  insert into res values ('simulation: unassigned P2 at A succeeds', r.discount_rate=0.05, row_to_json(r)::text);
end $$;
-- privileges
insert into res select 'anon/authenticated cannot execute create_real_transaction', not has_function_privilege('anon','public.create_real_transaction(uuid,text,numeric,uuid,uuid)','execute') and not has_function_privilege('authenticated','public.create_real_transaction(uuid,text,numeric,uuid,uuid)','execute') and has_function_privilege('service_role','public.create_real_transaction(uuid,text,numeric,uuid,uuid)','execute'), '';
insert into res select 'scan table: RLS on, no anon/authenticated privileges', (select relrowsecurity from pg_class where oid='public.partner_scan_events'::regclass) and not has_table_privilege('anon','public.partner_scan_events','select') and not has_table_privilege('authenticated','public.partner_scan_events','select'), '';
insert into res select 'only the 5-arg create_real_transaction exists (no ambiguous overload)', (select count(*) from pg_proc where proname='create_real_transaction' and pronamespace='public'::regnamespace)=1, '';
select case when ok then 'PASS' else 'FAIL' end as r, label, case when ok then '' else detail end as detail from res order by 1 desc, 2;
