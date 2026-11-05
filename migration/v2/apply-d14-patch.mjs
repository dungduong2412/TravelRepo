#!/usr/bin/env node
// apply-d14-patch.mjs
// Applies 20261105000002_vno_phase_d14_patch_payment_status_void.sql
// to the linked Supabase UAT project using the same secure psql pattern
// as apply-d14-migration.mjs.
//
// PREREQ: SUPABASE_DB_PASSWORD in environment.
// WHAT IT DOES:
//   1. Verifies project ref = hsezyogfxgnkpweoqqny
//   2. Checks D14 (20261105000001) is already applied
//   3. Checks D14 patch (20261105000002) is NOT already applied
//   4. Verifies no row has payment_status='void' (should be impossible pre-patch)
//   5. Applies the patch SQL in a single transaction
//   6. Registers migration in supabase_migrations.schema_migrations
//   7. Postchecks: 'void' now in constraint definition
//   8. Writes patch-evidence.json

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const PATCH_SQL_PATH = resolve(ROOT, 'supabase/migrations/20261105000002_vno_phase_d14_patch_payment_status_void.sql');
const PATCH_VERSION  = '20261105000002';
const D14_VERSION    = '20261105000001';
const EXPECTED_REF   = 'hsezyogfxgnkpweoqqny';

const DB_PASS = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASS) {
  console.error('ERROR: SUPABASE_DB_PASSWORD is not set in environment.');
  process.exit(1);
}

// Read project ref
const refFile = resolve(ROOT, 'supabase/.temp/project-ref');
const projectRef = readFileSync(refFile, 'utf8').trim();
if (projectRef !== EXPECTED_REF) {
  console.error(`ERROR: project-ref mismatch. Expected ${EXPECTED_REF}, got ${projectRef}`);
  process.exit(1);
}

const POOLER_URL = readFileSync(resolve(ROOT, 'supabase/.temp/pooler-url'), 'utf8').trim();
const DB_URL = POOLER_URL.replace('postgresql://', `postgresql://postgres.${EXPECTED_REF}:${DB_PASS}@`
  .replace(/postgresql:\/\/postgres\..*?@/, `postgresql://postgres.${EXPECTED_REF}:${DB_PASS}@`));

// Build the connection string
const connStr = POOLER_URL.replace(
  /^postgresql:\/\/postgres\.[^@]+/,
  `postgresql://postgres.${EXPECTED_REF}:${encodeURIComponent(DB_PASS)}`
);

function psql(sql) {
  const result = spawnSync('psql', [connStr, '--no-psqlrc', '--tuples-only', '--quiet', '-c', sql], {
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`psql spawn error: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`psql exit ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
}

function psqlFile(filePath) {
  const result = spawnSync('psql', [connStr, '--no-psqlrc', '-f', filePath], {
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`psql spawn error: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`psql exit ${result.status}:\n${result.stderr}\n${result.stdout}`);
  return { stdout: result.stdout, stderr: result.stderr };
}

console.log('\nD14 Patch — payment_status void extension');
console.log(`Project: ${EXPECTED_REF}\n`);

// ── Prechecks ─────────────────────────────────────────────────────────────────

console.log('── Prechecks ──');

// 1. D14 must already be applied
const d14Applied = psql(`
  select count(*) from supabase_migrations.schema_migrations
  where version = '${D14_VERSION}';
`).trim();
if (d14Applied !== '1') {
  console.error(`FAIL: D14 (${D14_VERSION}) is not in schema_migrations. Apply D14 first.`);
  process.exit(1);
}
console.log(`  PASS D14 ${D14_VERSION} already applied`);

// 2. Patch must not already be applied
const patchAlready = psql(`
  select count(*) from supabase_migrations.schema_migrations
  where version = '${PATCH_VERSION}';
`).trim();
if (patchAlready !== '0') {
  console.error(`FAIL: patch ${PATCH_VERSION} already in schema_migrations. Nothing to do.`);
  process.exit(1);
}
console.log(`  PASS patch ${PATCH_VERSION} not yet applied`);

// 3. No void rows (safeguard)
const voidRows = psql(`
  select count(*) from public.referral_transactions where payment_status = 'void';
`).trim();
if (voidRows !== '0') {
  console.error(`FAIL: ${voidRows} rows already have payment_status='void' — unexpected state.`);
  process.exit(1);
}
console.log(`  PASS 0 rows have payment_status='void' pre-patch`);

// 4. Confirm current constraint does NOT include void
const conDef = psql(`
  select pg_get_constraintdef(oid) from pg_constraint
  where conname = 'referral_transactions_payment_status_ck';
`).trim();
if (conDef.includes("'void'")) {
  console.error("FAIL: constraint already includes 'void' — patch not needed.");
  process.exit(1);
}
console.log(`  PASS constraint does not yet include 'void'`);
console.log(`       Current: ${conDef.slice(0, 120)}`);

// ── Apply patch ───────────────────────────────────────────────────────────────

console.log('\n── Applying patch SQL ──');
const patchSql = readFileSync(PATCH_SQL_PATH, 'utf8');
const sha256 = createHash('sha256').update(patchSql).digest('hex');
console.log(`  SHA256: ${sha256}`);

const applyResult = psqlFile(PATCH_SQL_PATH);
console.log(`  stdout: ${applyResult.stdout.trim().slice(0, 200)}`);
if (applyResult.stderr.trim()) console.log(`  stderr: ${applyResult.stderr.trim().slice(0, 200)}`);

// ── Register migration ────────────────────────────────────────────────────────

console.log('\n── Registering in schema_migrations ──');
psql(`
  insert into supabase_migrations.schema_migrations(version, name, statements)
  values (
    '${PATCH_VERSION}',
    'vno_phase_d14_patch_payment_status_void',
    array['alter table public.referral_transactions drop constraint referral_transactions_payment_status_ck',
          'alter table public.referral_transactions add constraint referral_transactions_payment_status_ck check (payment_status = any (array[''unverified''::text,''unpaid''::text,''partially_paid''::text,''paid''::text,''disputed''::text,''void''::text]))']
  );
`);
console.log('  Registered.');

// ── Postchecks ────────────────────────────────────────────────────────────────

console.log('\n── Postchecks ──');
const checks = [];

function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  if (!pass) process.exitCode = 1;
}

const newConDef = psql(`
  select pg_get_constraintdef(oid) from pg_constraint
  where conname = 'referral_transactions_payment_status_ck';
`).trim();
check("constraint includes 'void'", newConDef.includes("'void'"), newConDef.slice(0, 150));

const patchInHistory = psql(`
  select count(*) from supabase_migrations.schema_migrations where version = '${PATCH_VERSION}';
`).trim();
check('patch recorded in schema_migrations', patchInHistory === '1', patchInHistory);

// Verify existing rows still comply (void count = 0 and no violations)
const voidCountPost = psql(`
  select count(*) from public.referral_transactions where payment_status = 'void';
`).trim();
check('no void rows post-patch (RPCs not yet run)', voidCountPost === '0', voidCountPost);

// ── Evidence ──────────────────────────────────────────────────────────────────

const evidence = {
  patchVersion: PATCH_VERSION,
  sha256,
  appliedAt: new Date().toISOString(),
  projectRef: EXPECTED_REF,
  newConstraint: newConDef,
  postchecks: checks,
};

const evidenceDir = resolve(__dirname, 'evidence');
const evidencePath = resolve(evidenceDir, `d14-patch-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
import { mkdirSync } from 'node:fs';
mkdirSync(evidencePath, { recursive: true });
writeFileSync(resolve(evidencePath, 'patch-evidence.json'), JSON.stringify(evidence, null, 2));

console.log('\n── Summary ──');
const passed = checks.filter(c => c.pass).length;
const failed = checks.filter(c => !c.pass).length;
console.log(`  ${passed} PASS / ${failed} FAIL`);
if (failed > 0) {
  console.error(`\n  ${failed} postcheck(s) failed. Manual review required.`);
  process.exit(1);
}
console.log('\n  D14 patch applied successfully.');
console.log(`  Evidence: ${evidencePath}/patch-evidence.json\n`);
