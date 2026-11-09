#!/usr/bin/env node
// Global Partner network — targeted migration apply script (20261109000001_vno_global_partner_network.sql).
//
// Usage:
//   SUPABASE_DB_PASSWORD=... node apply-global-partner-network.mjs [--dry-run]
//
// What this does (in order):
//   1. Verifies the linked project is hsezyogfxgnkpweoqqny and connects through the pooler URL in supabase/.temp
//   2. Prechecks: D14 patch 3 applied, this migration NOT applied, the 4-argument create_real_transaction exists, partner_scan_events does not,
//      referral_transactions.scan_event_id does not
//   3. Backup into evidence/global-network-apply-<ts>/ : schema DDL, the CURRENT definitions of both transaction functions (pg_get_functiondef),
//      the financial tables as INSERTs and a row-count / assignment checksum snapshot. Stops if any dump fails.
//   4. Applies ONLY 20261109000001_vno_global_partner_network.sql (it carries its own begin/commit: all or nothing)
//   5. Registers the version in supabase_migrations.schema_migrations
//   6. Postchecks: new table + RLS + privileges, the new column, exactly one 5-argument create_real_transaction (not executable by anon/authenticated),
//      no remaining "not assigned" refusal in either function, and every pre-existing row count / the Partner-assignment checksum unchanged
//
// --dry-run: steps 1-2 only (no backup, no apply).
//
// ROLLBACK: migration/v2/rollback/20261109000001_vno_global_partner_network_rollback.sql (restores both functions exactly as they were; refuses to run if
// transactions already reference scan events). After it: delete from supabase_migrations.schema_migrations where version = '20261109000001';
// If the DDL commits but step 5 or 6 fails the script does NOT retry or revert: it prints the registration SQL and the owner decides.
// NEVER run `supabase db push` (it would apply every pending migration at once).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = new URL('../../', import.meta.url).pathname;
const VERSION = '20261109000001';
const NAME = `${VERSION}_vno_global_partner_network`;
const FILE = join(REPO, `supabase/migrations/${NAME}.sql`);
const EXPECTED_PROJECT_REF = 'hsezyogfxgnkpweoqqny';
const dryRun = process.argv.includes('--dry-run');
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidenceDir = resolve(join(REPO, `migration/v2/evidence/global-network-apply-${ts}`));

const die = (msg) => { console.error(`\nFATAL: ${msg}`); process.exit(1); };
const step = (label) => console.log(`\n── ${label} ──`);

function getConn() {
  const ref = readFileSync(join(REPO, 'supabase/.temp/project-ref'), 'utf8').trim();
  if (ref !== EXPECTED_PROJECT_REF) die(`Linked project is ${ref}, expected ${EXPECTED_PROJECT_REF}`);
  if (!process.env.SUPABASE_DB_PASSWORD) die('SUPABASE_DB_PASSWORD is not set');
  const u = new URL(readFileSync(join(REPO, 'supabase/.temp/pooler-url'), 'utf8').trim());
  return { host: u.hostname, port: u.port || '5432', user: decodeURIComponent(u.username), db: u.pathname.slice(1) || 'postgres', password: process.env.SUPABASE_DB_PASSWORD };
}
const psqlEnv = (c) => ({ ...process.env, PGHOST: c.host, PGPORT: String(c.port), PGUSER: c.user, PGDATABASE: c.db, PGPASSWORD: c.password, PGSSLMODE: 'require', PGOPTIONS: '-c statement_timeout=60000 -c search_path=pg_catalog,public', PGCONNECT_TIMEOUT: '20' });
const redact = (str, password) => (str || '').replace(new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<redacted>');
function psql(c, sql) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env: psqlEnv(c), input: sql, encoding: 'utf8', maxBuffer: 1 << 24 });
  return { status: r.status, stdout: r.stdout?.trim() || '', stderr: redact(r.stderr, c.password) };
}
function psqlOk(c, sql, label) { const r = psql(c, sql); if (r.status !== 0) die(`${label} failed:\n${r.stderr}`); return r.stdout; }
function pgdump(c, args, outFile, label) {
  const r = spawnSync('pg_dump', args, { env: psqlEnv(c), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) die(`pg_dump (${label}) failed:\n${redact(r.stderr, c.password)}`);
  writeFileSync(outFile, r.stdout || '', { mode: 0o600 });
  console.log(`  PASS ${label} → ${outFile.split('/').slice(-1)[0]} (${(r.stdout || '').length.toLocaleString()} bytes)`);
}

// 1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
step('1 / Connect + verify project');
const conn = getConn();
psqlOk(conn, 'select 1', 'connection test');
console.log(`  Connected to ${conn.host} (${conn.db}) as ${conn.user}`);

// 2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
step('2 / Prechecks');
if (psql(conn, `select count(*) from supabase_migrations.schema_migrations where version = '${VERSION}'`).stdout === '1') { console.log('  Migration already registered — nothing to do.'); process.exit(0); }
const pre = (label, sql, expected) => { const out = psqlOk(conn, sql, label); if (out !== String(expected)) die(`Precheck failed: ${label} (expected ${expected}, got ${out})`); console.log(`  PASS ${label}`); };
pre('D14 terminal-event patch (20261105000003) is applied', `select count(*) from supabase_migrations.schema_migrations where version = '20261105000003'`, 1);
pre('4-argument create_real_transaction exists (the version to be replaced)', `select count(*) from pg_proc where proname='create_real_transaction' and pronamespace='public'::regnamespace and pronargs = 4`, 1);
pre('no 5-argument create_real_transaction yet', `select count(*) from pg_proc where proname='create_real_transaction' and pronamespace='public'::regnamespace and pronargs = 5`, 0);
pre('create_uat_simulation_transaction exists', `select count(*) from pg_proc where proname='create_uat_simulation_transaction' and pronamespace='public'::regnamespace`, 1);
pre('partner_scan_events does not exist yet', `select count(*) from information_schema.tables where table_schema='public' and table_name='partner_scan_events'`, 0);
pre('referral_transactions.scan_event_id does not exist yet', `select count(*) from information_schema.columns where table_schema='public' and table_name='referral_transactions' and column_name='scan_event_id'`, 0);
pre('merchant_details.merchant_system_id and collaborators.id are primary keys (the new foreign keys target them)', `select count(*) from pg_constraint where contype='p' and conrelid in ('public.merchant_details'::regclass,'public.collaborators'::regclass)`, 2);
console.log('\n  All prechecks PASSED.');
if (dryRun) { console.log('\n  --dry-run: stopping before backup and apply.'); process.exit(0); }

// 3 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
step('3 / Backup');
mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
pgdump(conn, ['--schema-only', '--schema=public', '--schema=supabase_migrations', '--no-owner', '--no-privileges'], join(evidenceDir, 'schema-before.sql'), 'schema DDL');
const defs = psqlOk(conn, `select pg_get_functiondef(p.oid) || E';\\n' from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('create_real_transaction','create_uat_simulation_transaction') order by p.proname`, 'function definitions');
writeFileSync(join(evidenceDir, 'functions-before.sql'), defs + '\n', { mode: 0o600 });
console.log(`  PASS current function definitions → functions-before.sql (${defs.length.toLocaleString()} bytes)`);
pgdump(conn, ['--data-only', '--inserts', '--column-inserts', '--no-privileges', ...['public.referral_transactions', 'public.transaction_events', 'public.audit_events'].flatMap((t) => ['--table', t])],
  join(evidenceDir, 'data-financial-before.sql'), 'financial tables (INSERT format)');
for (const f of ['schema-before.sql', 'functions-before.sql', 'data-financial-before.sql']) if (readFileSync(join(evidenceDir, f)).length < 100) die(`Backup file ${f} appears empty — aborting`);
const snapshot = `
  select 'referral_transactions:' || count(*) from public.referral_transactions union all
  select 'transaction_events:' || count(*) from public.transaction_events union all
  select 'audit_events:' || count(*) from public.audit_events union all
  select 'collaborators:' || count(*) from public.collaborators union all
  select 'merchant_details:' || count(*) from public.merchant_details union all
  select 'transactions_checksum:' || coalesce(md5(string_agg(id::text || coalesce(document_total::text,'-') || coalesce(commission_amount::text,'-') || coalesce(lifecycle_status,'-'), ',' order by id)),'-') from public.referral_transactions union all
  select 'assignment_checksum:' || coalesce(md5(string_agg(id::text || coalesce(merchant_system_id::text,'-'), ',' order by id)),'-') from public.collaborators`;
const before = psqlOk(conn, snapshot, 'snapshot');
writeFileSync(join(evidenceDir, 'snapshot-before.txt'), before + '\n', { mode: 0o600 });
before.split('\n').forEach((l) => console.log(`    ${l}`));

// 4 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
step('4 / Apply');
const sql = readFileSync(FILE, 'utf8');
if (!sql.includes('\nbegin;') || !sql.includes('\ncommit;')) die('Migration file format check failed: expected begin/commit');
const sha = createHash('sha256').update(sql).digest('hex');
console.log(`  ${NAME}.sql — ${sql.split('\n').length} lines, sha256 ${sha}`);
const applied = psql(conn, sql);
if (applied.status !== 0) die(`Migration apply failed (the transaction was rolled back — no database change):\n${applied.stderr}`);
console.log('  Migration SQL executed and committed.');

// 5 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
step('5 / Register migration history');
const reg = psql(conn, `insert into supabase_migrations.schema_migrations (version, name, statements) values ('${VERSION}', 'vno_global_partner_network', ARRAY['Global Partner network (applied by apply-global-partner-network.mjs ${ts}; sha256 ${sha})']) on conflict (version) do nothing;`);
if (reg.status !== 0 || psql(conn, `select version from supabase_migrations.schema_migrations where version='${VERSION}'`).stdout !== VERSION) {
  console.error(`\nFATAL: history registration failed (the DDL IS committed). Do not rerun. Register manually:\n  insert into supabase_migrations.schema_migrations (version, name, statements) values ('${VERSION}', 'vno_global_partner_network', ARRAY['manual registration']) on conflict (version) do nothing;\n${reg.stderr}`);
  process.exit(1);
}
console.log(`  PASS ${VERSION} registered`);

// 6 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
step('6 / Postchecks');
const checks = [];
const ck = (label, query, expected) => { const out = psqlOk(conn, query, label); const pass = out === String(expected); checks.push({ label, pass, got: out, expected: String(expected) }); console.log(`  ${pass ? 'PASS' : 'FAIL'} ${label} (expected=${expected}, got=${out})`); };
ck('partner_scan_events exists', `select count(*) from information_schema.tables where table_schema='public' and table_name='partner_scan_events'`, 1);
ck('partner_scan_events has row level security', `select relrowsecurity from pg_class where oid='public.partner_scan_events'::regclass`, 't');
ck('partner_scan_events is not readable by anon / authenticated', `select (has_table_privilege('anon','public.partner_scan_events','select') or has_table_privilege('authenticated','public.partner_scan_events','select'))`, 'f');
ck('partner_scan_events unique (merchant, scan key)', `select count(*) from pg_constraint where conname='partner_scan_events_merchant_key_uq'`, 1);
ck('referral_transactions.scan_event_id exists', `select count(*) from information_schema.columns where table_schema='public' and table_name='referral_transactions' and column_name='scan_event_id'`, 1);
ck('exactly one create_real_transaction (5 arguments)', `select count(*) from pg_proc where proname='create_real_transaction' and pronamespace='public'::regnamespace and pronargs=5`, 1);
ck('no leftover 4-argument create_real_transaction', `select count(*) from pg_proc where proname='create_real_transaction' and pronamespace='public'::regnamespace and pronargs=4`, 0);
ck('create_real_transaction not executable by anon / authenticated', `select (has_function_privilege('anon','public.create_real_transaction(uuid,text,numeric,uuid,uuid)','execute') or has_function_privilege('authenticated','public.create_real_transaction(uuid,text,numeric,uuid,uuid)','execute'))`, 'f');
ck('create_real_transaction executable by service_role', `select has_function_privilege('service_role','public.create_real_transaction(uuid,text,numeric,uuid,uuid)','execute')`, 't');
ck('create_real_transaction no longer refuses on assignment', `select count(*) from pg_proc where proname in ('create_real_transaction','create_uat_simulation_transaction') and pronamespace='public'::regnamespace and pg_get_functiondef(oid) ilike '%not assigned%'`, 0);
const after = psqlOk(conn, snapshot, 'snapshot after');
for (const key of ['referral_transactions', 'transaction_events', 'audit_events', 'collaborators', 'merchant_details', 'transactions_checksum', 'assignment_checksum']) {
  const b = before.split('\n').find((l) => l.startsWith(`${key}:`)); const a = after.split('\n').find((l) => l.startsWith(`${key}:`));
  const pass = b === a; checks.push({ label: `${key} unchanged`, pass, got: a, expected: b }); console.log(`  ${pass ? 'PASS' : 'FAIL'} ${key} unchanged (${a})`);
}
const passed = checks.filter((c) => c.pass).length; const failed = checks.length - passed;
writeFileSync(join(evidenceDir, 'apply-evidence.json'), JSON.stringify({ applied_at: new Date().toISOString(), migration: NAME, sha256: sha, dry_run: false, postchecks: checks, summary: { passed, failed } }, null, 2), { mode: 0o600 });
console.log(`\n  Postchecks: ${passed} passed, ${failed} failed. Evidence: ${evidenceDir}`);
if (failed) { console.error('\nFATAL: some postchecks failed. The migration IS applied. Review the evidence; the rollback script is migration/v2/rollback/20261109000001_vno_global_partner_network_rollback.sql'); process.exit(1); }
console.log('\nGlobal Partner network migration applied and verified.');
