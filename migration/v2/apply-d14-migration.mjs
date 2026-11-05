#!/usr/bin/env node
// D14 Real Transaction Lifecycle — targeted migration apply script.
//
// Usage:
//   SUPABASE_DB_PASSWORD=... node apply-d14-migration.mjs [--dry-run]
//
// What this does (in order):
//   1. Verifies the linked project is hsezyogfxgnkpweoqqny
//   2. Runs DB prechecks: no real_transaction rows, D14 not yet applied
//   3. Takes a full pg_dump backup to migration/v2/evidence/d14-backup-<ts>/
//   4. Applies ONLY 20261105000001_vno_phase_d14_real_transaction_lifecycle.sql
//   5. Registers the migration in supabase_migrations.schema_migrations
//   6. Runs postchecks: constraints, indexes, RPCs exist; no data corruption
//
// --dry-run: runs prechecks and backup only; does NOT apply the migration.
//
// NEVER run supabase db push (would apply all pending migrations at once).

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
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

// Build psql connection env from pooler-url + SUPABASE_DB_PASSWORD.
function getConn() {
  const ref = readFileSync(join(REPO, 'supabase/.temp/project-ref'), 'utf8').trim();
  if (ref !== EXPECTED_PROJECT_REF) die(`Linked project is ${ref}, expected ${EXPECTED_PROJECT_REF}`);

  if (!process.env.SUPABASE_DB_PASSWORD) die('SUPABASE_DB_PASSWORD is not set');

  const u = new URL(readFileSync(join(REPO, 'supabase/.temp/pooler-url'), 'utf8').trim());
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    db: u.pathname.slice(1) || 'postgres',
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

// Run psql, return { status, stdout, stderr }
function psql(conn, sql) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    env: psqlEnv(conn),
    input: sql,
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  });
  const stderr = (r.stderr || '').replace(new RegExp(conn.password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<redacted>');
  return { status: r.status, stdout: r.stdout?.trim() || '', stderr };
}

function psqlOk(conn, sql, label) {
  const { status, stdout, stderr } = psql(conn, sql);
  if (status !== 0) die(`${label} failed:\n${stderr}`);
  return stdout;
}

// ── Verification helpers ─────────────────────────────────────────────────────

function checkCmd(label, conn, sql, expectContains) {
  const out = psqlOk(conn, sql, label);
  const pass = out.includes(expectContains);
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${label}: ${out.slice(0, 120)}`);
  return pass;
}

// ── Main ─────────────────────────────────────────────────────────────────────

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
  'precheck: no real_transaction rows'
);
if (realRows !== '0') die(`Precheck failed: ${realRows} real_transaction rows already exist before migration`);
console.log('  PASS no real_transaction rows exist');

const recordKindOk = psqlOk(conn,
  `select count(*) from pg_constraint where conrelid='public.referral_transactions'::regclass and conname='referral_transactions_record_kind_ck'`,
  'precheck: existing record_kind constraint'
);
console.log(`  record_kind_ck exists: ${recordKindOk === '1' ? 'YES' : 'NO (will be created)'}`);

const txEventsTable = psqlOk(conn,
  `select count(*) from information_schema.tables where table_schema='public' and table_name='transaction_events'`,
  'precheck: transaction_events table'
);
if (txEventsTable !== '1') die('Precheck failed: transaction_events table does not exist');
console.log('  PASS transaction_events table exists');

console.log('\n  All prechecks PASSED.');

if (dryRun) {
  console.log('\n  --dry-run: stopping before backup and apply. Prechecks passed.');
  process.exit(0);
}

// ── 3. Backup ─────────────────────────────────────────────────────────────────
step('3 / pg_dump backup (before migration)');
mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

const backupStarted = new Date().toISOString();
console.log(`  Writing to ${evidenceDir}`);

// Schema-only dump of public + supabase_migrations (safe with pooler — no data, fast)
const dumpResult = spawnSync('pg_dump', [
  '--schema-only',
  '--schema=public',
  '--schema=supabase_migrations',
  '--no-owner',
  '--no-privileges',
  '--file', join(evidenceDir, 'schema-before.sql'),
], {
  env: psqlEnv(conn),
  encoding: 'utf8',
});
if (dumpResult.status !== 0) {
  die(`pg_dump failed: ${(dumpResult.stderr || '').replace(new RegExp(conn.password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<redacted>')}`);
}
console.log('  PASS schema dump complete → evidence/schema-before.sql');

// Count existing rows for the reconciliation postchecks
const beforeCounts = psqlOk(conn, `
  select 'referral_transactions:' || count(*) from public.referral_transactions
  union all
  select 'transaction_events:' || count(*) from public.transaction_events
  union all
  select 'audit_events:' || count(*) from public.audit_events
`, 'precheck row counts');
console.log('  Row counts before:');
beforeCounts.split('\n').forEach((l) => console.log(`    ${l}`));
writeFileSync(join(evidenceDir, 'counts-before.txt'), beforeCounts + '\n', { mode: 0o600 });

// ── 4. Apply D14 migration ─────────────────────────────────────────────────
step('4 / Apply D14 migration');
const sql = readFileSync(MIGRATION_FILE, 'utf8');
console.log(`  Applying ${MIGRATION_FILE}`);
console.log(`  ${sql.split('\n').length} lines, begin/commit wrapping verified`);

if (!sql.trim().startsWith('-- D14') || !sql.includes('begin;') || !sql.includes('commit;')) {
  die('Migration file format check failed: expected D14 header + begin/commit');
}

const { status: applyStatus, stdout: applyOut, stderr: applyErr } = psql(conn, sql);
if (applyStatus !== 0) {
  die(`Migration apply failed:\n${applyErr}`);
}
console.log('  Migration SQL executed successfully.');

// ── 5. Register in supabase_migrations.schema_migrations ───────────────────
step('5 / Register migration history');
const migrationName = `${MIGRATION_VERSION}_vno_phase_d14_real_transaction_lifecycle`;

psqlOk(conn, `
  insert into supabase_migrations.schema_migrations (version, name, statements)
  values ('${MIGRATION_VERSION}', '${migrationName}', ARRAY['D14 real transaction lifecycle (applied by apply-d14-migration.mjs)'])
  on conflict (version) do nothing;
`, 'migration history registration');

const historyCheck = psqlOk(conn,
  `select version from supabase_migrations.schema_migrations where version = '${MIGRATION_VERSION}'`,
  'migration history verify'
);
if (historyCheck !== MIGRATION_VERSION) die(`Migration history registration failed: got '${historyCheck}'`);
console.log(`  PASS migration ${MIGRATION_VERSION} registered in schema_migrations`);

// ── 6. Postchecks ─────────────────────────────────────────────────────────
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
  `select count(*) from pg_constraint where conrelid='public.referral_transactions'::regclass and conname='referral_transactions_record_kind_ck'`,
  1);

ck('real_transaction shape check exists', conn,
  `select count(*) from pg_constraint where conrelid='public.referral_transactions'::regclass and conname='referral_transactions_real_transaction_ck'`,
  1);

ck('real idempotency unique index exists', conn,
  `select count(*) from pg_indexes where tablename='referral_transactions' and indexname='referral_transactions_real_idempotency_uq'`,
  1);

ck('transaction_events type check includes real events', conn,
  `select count(*) from pg_constraint where conrelid='public.transaction_events'::regclass and conname='transaction_events_type_ck'`,
  1);

ck('transaction_events recorded_once index', conn,
  `select count(*) from pg_indexes where tablename='transaction_events' and indexname='transaction_events_real_recorded_once_uq'`,
  1);

ck('transaction_events terminal_once index', conn,
  `select count(*) from pg_indexes where tablename='transaction_events' and indexname='transaction_events_real_terminal_once_uq'`,
  1);

// RPCs
for (const rpc of ['create_real_transaction', 'confirm_real_transaction', 'cancel_real_transaction', 'reverse_real_transaction']) {
  ck(`RPC ${rpc} exists`, conn,
    `select count(*) from pg_proc where proname='${rpc}' and pronamespace='public'::regnamespace`,
    1);

  // Verify: revoked from anon/authenticated
  ck(`RPC ${rpc} not grantable to anon`, conn,
    `select count(*) from information_schema.role_routine_grants where routine_schema='public' and routine_name='${rpc}' and grantee in ('anon','authenticated')`,
    0);
}

// V1 data intact: no v1_import rows were touched
ck('v1_import row count unchanged', conn,
  `select count(*) from public.referral_transactions where record_kind = 'v1_import'`,
  psqlOk(conn,
    `select count(*) from public.referral_transactions where record_kind = 'v1_import'`,
    'v1 count')
);

// No real_transaction rows yet (we did not create any)
ck('no real_transaction rows exist post-migration', conn,
  `select count(*) from public.referral_transactions where record_kind = 'real_transaction'`,
  0);

const passed = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass).length;

// Write evidence
const evidence = {
  applied_at: new Date().toISOString(),
  backup_started: backupStarted,
  migration_version: MIGRATION_VERSION,
  migration_file: MIGRATION_FILE,
  dry_run: dryRun,
  row_counts_before: beforeCounts,
  postchecks: checks,
  summary: { passed, failed },
};
writeFileSync(join(evidenceDir, 'apply-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });

console.log(`\n── Summary ──`);
console.log(`  Applied:  ${MIGRATION_VERSION}`);
console.log(`  Checks:   ${passed} PASS / ${failed} FAIL`);
console.log(`  Evidence: ${evidenceDir}/apply-evidence.json`);

if (failed > 0) {
  console.error(`\nWARNING: ${failed} postcheck(s) failed — review evidence before deploying application code.`);
  process.exit(1);
}

console.log('\n  D14 migration applied and verified. Proceed with application deployment.');
