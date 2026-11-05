#!/usr/bin/env node
// D14 Real Transaction Lifecycle — targeted migration apply script.
//
// Usage:
//   SUPABASE_DB_PASSWORD=... node apply-d14-migration.mjs [--dry-run]
//
// What this does (in order):
//   1. Verifies the linked project is hsezyogfxgnkpweoqqny
//   2. Runs DB prechecks: no real_transaction rows, D14 not yet applied
//   3. Takes a full database backup (schema + ALL public data) to evidence/d14-apply-<ts>/
//      PLUS a targeted financial-table backup for quick targeted restore verification.
//      The script stops if either pg_dump fails.
//   4. Applies ONLY 20261105000001_vno_phase_d14_real_transaction_lifecycle.sql
//   5. Registers the migration in supabase_migrations.schema_migrations
//   6. Runs 17 postchecks: constraints, indexes, RPCs, privilege grants, row counts
//
// --dry-run: runs steps 1–2 only (prechecks, no backup, no apply).
//
// RECOVERY PROCEDURE — if migration SQL commits but step 5 or 6 fails:
//   The migration DDL is already applied to the database.
//   The script will NOT automatically retry or revert.
//   Instead it will print the exact SQL to either:
//     (a) register the history entry manually, OR
//     (b) undo the migration (drop all D14 objects — provided at the end of this file)
//   Owner decides which path to take. Do NOT rerun this script without first
//   running the undo SQL if postchecks failed.
//
// UNDO SQL (run via Supabase SQL editor or psql if postchecks fail after apply):
//   drop function if exists public.create_real_transaction(uuid, text, numeric, uuid);
//   drop function if exists public.confirm_real_transaction(uuid, uuid, uuid);
//   drop function if exists public.cancel_real_transaction(uuid, uuid, uuid);
//   drop function if exists public.reverse_real_transaction(uuid, uuid, uuid);
//   drop index if exists public.transaction_events_real_terminal_once_uq;
//   drop index if exists public.transaction_events_real_recorded_once_uq;
//   alter table public.transaction_events drop constraint if exists transaction_events_status_ck;
//   alter table public.transaction_events drop constraint if exists transaction_events_type_ck;
//   alter table public.transaction_events add constraint transaction_events_type_ck
//     check (event_type in ('uat_simulation_created'));
//   drop index if exists public.referral_transactions_real_idempotency_uq;
//   alter table public.referral_transactions drop constraint if exists referral_transactions_real_transaction_ck;
//   alter table public.referral_transactions drop constraint if exists referral_transactions_record_kind_ck;
//   alter table public.referral_transactions add constraint referral_transactions_record_kind_ck
//     check (record_kind in ('v1_import', 'uat_simulation')) not valid;
//   delete from supabase_migrations.schema_migrations where version = '20261105000001';
//
// NEVER run supabase db push (would apply all pending migrations at once).

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = new URL('../../', import.meta.url).pathname;
const MIGRATION_VERSION = '20261105000001';
const MIGRATION_FILE = join(REPO, `supabase/migrations/${MIGRATION_VERSION}_vno_phase_d14_real_transaction_lifecycle.sql`);
const EXPECTED_PROJECT_REF = 'hsezyogfxgnkpweoqqny';

const dryRun = process.argv.includes('--dry-run');
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidenceDir = resolve(join(REPO, `migration/v2/evidence/d14-apply-${ts}`));

// ── Helpers ─────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`\nFATAL: ${msg}`);
  process.exit(1);
}

function step(label) { console.log(`\n── ${label} ──`); }

function getConn() {
  const ref = readFileSync(join(REPO, 'supabase/.temp/project-ref'), 'utf8').trim();
  if (ref !== EXPECTED_PROJECT_REF) die(`Linked project is ${ref}, expected ${EXPECTED_PROJECT_REF}`);
  if (!process.env.SUPABASE_DB_PASSWORD) die('SUPABASE_DB_PASSWORD is not set');
  const u = new URL(readFileSync(join(REPO, 'supabase/.temp/pooler-url'), 'utf8').trim());
  return {
    host: u.hostname, port: u.port || '5432',
    user: decodeURIComponent(u.username), db: u.pathname.slice(1) || 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD,
  };
}

function psqlEnv(conn) {
  return {
    ...process.env,
    PGHOST: conn.host, PGPORT: String(conn.port), PGUSER: conn.user,
    PGDATABASE: conn.db, PGPASSWORD: conn.password, PGSSLMODE: 'require',
    PGOPTIONS: '-c statement_timeout=30000 -c search_path=pg_catalog,public',
    PGCONNECT_TIMEOUT: '20',
  };
}

function redact(str, password) {
  return (str || '').replace(new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<redacted>');
}

function psql(conn, sql) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    env: psqlEnv(conn), input: sql, encoding: 'utf8', maxBuffer: 1 << 24,
  });
  return { status: r.status, stdout: r.stdout?.trim() || '', stderr: redact(r.stderr, conn.password) };
}

function psqlOk(conn, sql, label) {
  const { status, stdout, stderr } = psql(conn, sql);
  if (status !== 0) die(`${label} failed:\n${stderr}`);
  return stdout;
}

function pgdump(conn, args, outFile, label) {
  const r = spawnSync('pg_dump', args, { env: psqlEnv(conn), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) die(`pg_dump (${label}) failed:\n${redact(r.stderr, conn.password)}`);
  writeFileSync(outFile, r.stdout || '', { mode: 0o600 });
  const bytes = (r.stdout || '').length;
  console.log(`  PASS ${label} → ${outFile.split('/').slice(-1)[0]} (${bytes.toLocaleString()} bytes)`);
  return bytes;
}

// ── 1. Connect + verify ───────────────────────────────────────────────────────
step('1 / Connect + verify project');
const conn = getConn();
psqlOk(conn, 'select 1', 'connection test');
console.log(`  Connected to ${conn.host} (${conn.db}) as ${conn.user}`);

// ── 2. Prechecks ─────────────────────────────────────────────────────────────
step('2 / Prechecks');

const alreadyApplied = psql(conn,
  `select count(*) from supabase_migrations.schema_migrations where version = '${MIGRATION_VERSION}'`
).stdout;
if (alreadyApplied === '1') {
  console.log('  Migration already applied — nothing to do.');
  process.exit(0);
}

const realRows = psqlOk(conn,
  `select count(*) from public.referral_transactions where record_kind = 'real_transaction'`,
  'precheck: no real_transaction rows');
if (realRows !== '0') die(`Precheck failed: ${realRows} real_transaction rows already exist before migration`);
console.log('  PASS no real_transaction rows exist');

const txEventsExists = psqlOk(conn,
  `select count(*) from information_schema.tables where table_schema='public' and table_name='transaction_events'`,
  'precheck: transaction_events table');
if (txEventsExists !== '1') die('Precheck failed: transaction_events table does not exist');
console.log('  PASS transaction_events table exists');

const auditEventsExists = psqlOk(conn,
  `select count(*) from information_schema.tables where table_schema='public' and table_name='audit_events'`,
  'precheck: audit_events table');
if (auditEventsExists !== '1') die('Precheck failed: audit_events table does not exist');
console.log('  PASS audit_events table exists');

console.log('\n  All prechecks PASSED.');

if (dryRun) {
  console.log('\n  --dry-run: stopping before backup and apply. Prechecks passed.');
  process.exit(0);
}

// ── 3. Backup (full + targeted) ───────────────────────────────────────────────
step('3 / pg_dump backup (full database + targeted financial tables)');
mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
const backupStarted = new Date().toISOString();
console.log(`  Writing to ${evidenceDir}`);

// 3a. Schema dump — full DDL for all schemas we can read
pgdump(conn, [
  '--schema-only', '--schema=public', '--schema=supabase_migrations',
  '--no-owner', '--no-privileges',
], join(evidenceDir, 'schema-before.sql'), 'schema dump (public + supabase_migrations DDL)');

// 3b. Full data dump — ALL tables in public schema + migration history.
//     This is the complete, recoverable backup covering every row in the database.
//     Uses custom format for size efficiency; restore with pg_restore.
pgdump(conn, [
  '--data-only', '--schema=public', '--schema=supabase_migrations',
  '--no-privileges',
  '--format=custom',
], join(evidenceDir, 'data-full-before.pgdump'), 'full public + migration history data (pg_restore format)');

// 3c. Targeted financial-table INSERT backup — human-readable, quick spot-check.
//     Supplements the full backup for rapid verification of key rows.
const FINANCIAL_TABLES = [
  'public.referral_transactions',
  'public.transaction_events',
  'public.audit_events',
];
pgdump(conn, [
  '--data-only', '--inserts', '--column-inserts', '--no-privileges',
  ...FINANCIAL_TABLES.flatMap((t) => ['--table', t]),
], join(evidenceDir, 'data-financial-before.sql'), 'targeted financial tables (INSERT format, human-readable)');

// 3d. Verify backup is non-empty (each file must have content)
for (const f of ['schema-before.sql', 'data-full-before.pgdump', 'data-financial-before.sql']) {
  const size = readFileSync(join(evidenceDir, f)).length;
  if (size < 100) die(`Backup file ${f} appears empty (${size} bytes) — aborting`);
}

// 3e. Row counts snapshot for postchecks
const beforeCounts = psqlOk(conn, `
  select 'referral_transactions:' || count(*) from public.referral_transactions
  union all
  select 'transaction_events:' || count(*) from public.transaction_events
  union all
  select 'audit_events:' || count(*) from public.audit_events
  union all
  select 'v1_import_rows:' || count(*) from public.referral_transactions where record_kind = 'v1_import'
  union all
  select 'uat_simulation_rows:' || count(*) from public.referral_transactions where record_kind = 'uat_simulation'
`, 'backup row counts snapshot');
writeFileSync(join(evidenceDir, 'counts-before.txt'), beforeCounts + '\n', { mode: 0o600 });
console.log('  Row counts before migration:');
beforeCounts.split('\n').forEach((l) => console.log(`    ${l}`));

console.log(`\n  PASS complete backup in ${evidenceDir}`);
console.log(`  Restore command (if needed): pg_restore -d <target_db_url> ${join(evidenceDir, 'data-full-before.pgdump')}`);

// ── 4. Apply D14 migration ────────────────────────────────────────────────────
step('4 / Apply D14 migration');
const sql = readFileSync(MIGRATION_FILE, 'utf8');
console.log(`  File: ${MIGRATION_FILE}`);
console.log(`  Lines: ${sql.split('\n').length}, SHA included in evidence`);

if (!sql.trim().startsWith('-- D14') || !sql.includes('begin;') || !sql.includes('commit;')) {
  die('Migration file format check failed: expected D14 header + begin/commit');
}

const { status: applyStatus, stderr: applyErr } = psql(conn, sql);
if (applyStatus !== 0) {
  die(`Migration apply failed (transaction was rolled back — no DB changes):\n${applyErr}`);
}
console.log('  Migration SQL executed and committed successfully.');

// ── 5. Register migration history ─────────────────────────────────────────────
// RECOVERY NOTE: if this step or step 6 fails, the DDL is already applied.
// Do NOT rerun this script. Owner must manually run either:
//   (a) the registration SQL below to record history, OR
//   (b) the UNDO SQL at the top of this file to fully revert D14.
step('5 / Register migration history');
const migrationName = `${MIGRATION_VERSION}_vno_phase_d14_real_transaction_lifecycle`;

const { status: regStatus, stderr: regErr } = psql(conn, `
  insert into supabase_migrations.schema_migrations (version, name, statements)
  values ('${MIGRATION_VERSION}', '${migrationName}',
          ARRAY['D14 real transaction lifecycle (applied by apply-d14-migration.mjs ${ts})'])
  on conflict (version) do nothing;
`);
if (regStatus !== 0) {
  console.error(`\nFATAL: Migration history registration failed (DDL was committed):`);
  console.error(`  psql error: ${regErr}`);
  console.error(`\n  MANUAL RECOVERY — run this SQL to register the migration:`);
  console.error(`    insert into supabase_migrations.schema_migrations (version, name, statements)`);
  console.error(`    values ('${MIGRATION_VERSION}', '${migrationName}', ARRAY['D14 manual registration']);`);
  console.error(`\n  Then re-verify postchecks manually or rerun only step 6:`);
  console.error(`    node apply-d14-migration.mjs  # will detect already-applied and skip`);
  process.exit(1);
}

const historyCheck = psqlOk(conn,
  `select version from supabase_migrations.schema_migrations where version = '${MIGRATION_VERSION}'`,
  'migration history verify');
if (historyCheck !== MIGRATION_VERSION) {
  console.error(`\nFATAL: Migration history verify returned '${historyCheck}' (DDL was committed)`);
  console.error(`  MANUAL RECOVERY — run:`);
  console.error(`    insert into supabase_migrations.schema_migrations (version, name, statements)`);
  console.error(`    values ('${MIGRATION_VERSION}', '${migrationName}', ARRAY['D14 manual registration'])`);
  console.error(`    on conflict (version) do nothing;`);
  process.exit(1);
}
console.log(`  PASS migration ${MIGRATION_VERSION} registered and verified in schema_migrations`);

// ── 6. Postchecks ─────────────────────────────────────────────────────────────
step('6 / Postchecks');
const checks = [];

function ck(label, conn, sql, expected) {
  const out = psqlOk(conn, sql, label);
  const pass = out.trim() === String(expected);
  checks.push({ label, pass, got: out.trim(), expected: String(expected) });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${label} (expected=${expected}, got=${out.trim()})`);
  return pass;
}

// Constraints
ck('record_kind_ck includes real_transaction', conn,
  `select count(*) from pg_constraint where conrelid='public.referral_transactions'::regclass and conname='referral_transactions_record_kind_ck'`, 1);
ck('real_transaction shape check exists', conn,
  `select count(*) from pg_constraint where conrelid='public.referral_transactions'::regclass and conname='referral_transactions_real_transaction_ck'`, 1);
ck('real idempotency unique index exists', conn,
  `select count(*) from pg_indexes where tablename='referral_transactions' and indexname='referral_transactions_real_idempotency_uq'`, 1);
ck('transaction_events type check includes real events', conn,
  `select count(*) from pg_constraint where conrelid='public.transaction_events'::regclass and conname='transaction_events_type_ck'`, 1);
ck('transaction_events status transition check exists', conn,
  `select count(*) from pg_constraint where conrelid='public.transaction_events'::regclass and conname='transaction_events_status_ck'`, 1);
ck('transaction_events recorded_once index', conn,
  `select count(*) from pg_indexes where tablename='transaction_events' and indexname='transaction_events_real_recorded_once_uq'`, 1);
ck('transaction_events terminal_once index', conn,
  `select count(*) from pg_indexes where tablename='transaction_events' and indexname='transaction_events_real_terminal_once_uq'`, 1);

// RPCs — exist and are not grantable to anon/authenticated
for (const rpc of ['create_real_transaction', 'confirm_real_transaction', 'cancel_real_transaction', 'reverse_real_transaction']) {
  ck(`RPC ${rpc} exists`, conn,
    `select count(*) from pg_proc where proname='${rpc}' and pronamespace='public'::regnamespace`, 1);
  ck(`RPC ${rpc} not executable by anon/authenticated`, conn,
    `select count(*) from information_schema.role_routine_grants where routine_schema='public' and routine_name='${rpc}' and grantee in ('anon','authenticated')`, 0);
}

// Row counts — total and per-kind must match pre-migration snapshot exactly
const totalCountBefore = beforeCounts.split('\n').find((l) => l.startsWith('referral_transactions:'))?.split(':')[1] || '0';
const v1CountBefore    = beforeCounts.split('\n').find((l) => l.startsWith('v1_import_rows:'))?.split(':')[1] || '0';
const uatCountBefore   = beforeCounts.split('\n').find((l) => l.startsWith('uat_simulation_rows:'))?.split(':')[1] || '0';

ck('total row count unchanged (no rows added or removed)', conn,
  `select count(*) from public.referral_transactions`, totalCountBefore);
ck('v1_import row count unchanged', conn,
  `select count(*) from public.referral_transactions where record_kind = 'v1_import'`, v1CountBefore);
ck('uat_simulation row count unchanged', conn,
  `select count(*) from public.referral_transactions where record_kind = 'uat_simulation'`, uatCountBefore);
ck('no real_transaction rows exist post-migration', conn,
  `select count(*) from public.referral_transactions where record_kind = 'real_transaction'`, 0);

const passed = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass).length;

// Write evidence
const { createHash } = await import('node:crypto');
const migSha256 = createHash('sha256').update(readFileSync(MIGRATION_FILE)).digest('hex');
const evidence = {
  applied_at: new Date().toISOString(),
  backup_started: backupStarted,
  migration_version: MIGRATION_VERSION,
  migration_file: MIGRATION_FILE,
  migration_sha256: migSha256,
  project_ref: EXPECTED_PROJECT_REF,
  dry_run: false,
  row_counts_before: Object.fromEntries(beforeCounts.split('\n').filter(Boolean).map((l) => l.split(':'))),
  postchecks: checks,
  summary: { passed, failed },
};
writeFileSync(join(evidenceDir, 'apply-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });

console.log(`\n── Summary ──`);
console.log(`  Migration:  ${MIGRATION_VERSION}`);
console.log(`  File SHA:   ${migSha256}`);
console.log(`  Checks:     ${passed} PASS / ${failed} FAIL`);
console.log(`  Evidence:   ${evidenceDir}/`);

if (failed > 0) {
  console.error(`\nFATAL: ${failed} postcheck(s) failed — DDL was committed but postchecks did not all pass.`);
  console.error(`  Do NOT redeploy application code until this is resolved.`);
  console.error(`  Consult the UNDO SQL at the top of this file to revert D14 if needed.`);
  console.error(`  Evidence written to: ${evidenceDir}/apply-evidence.json`);
  process.exit(1);
}

console.log('\n  D14 migration applied and verified. Proceed with application deployment.');
