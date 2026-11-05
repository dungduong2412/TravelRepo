#!/usr/bin/env node
// apply-d14-patch2.mjs
// Applies 20261105000003_vno_phase_d14_patch_terminal_event_index.sql
// Fixes transaction_events_real_terminal_once_uq so CONFIRMED→REVERSED works.
//
// PREREQ: SUPABASE_DB_PASSWORD in environment.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const PATCH_SQL = resolve(ROOT, 'supabase/migrations/20261105000003_vno_phase_d14_patch_terminal_event_index.sql');
const PATCH_VERSION  = '20261105000003';
const PREV_PATCH     = '20261105000002';
const EXPECTED_REF   = 'hsezyogfxgnkpweoqqny';

const DB_PASS = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASS) { console.error('ERROR: SUPABASE_DB_PASSWORD not set'); process.exit(1); }

const refFile = resolve(ROOT, 'supabase/.temp/project-ref');
if (readFileSync(refFile, 'utf8').trim() !== EXPECTED_REF) {
  console.error(`ERROR: project-ref mismatch`); process.exit(1);
}

const POOLER_URL = readFileSync(resolve(ROOT, 'supabase/.temp/pooler-url'), 'utf8').trim();
const connStr = POOLER_URL.replace(
  /^postgresql:\/\/postgres\.[^@]+/,
  `postgresql://postgres.${EXPECTED_REF}:${encodeURIComponent(DB_PASS)}`
);

function psql(sql) {
  const r = spawnSync('psql', [connStr, '--no-psqlrc', '--tuples-only', '--quiet', '-c', sql], { encoding: 'utf8' });
  if (r.error) throw new Error(`psql: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`psql ${r.status}: ${r.stderr}`);
  return r.stdout.trim();
}
function psqlFile(f) {
  const r = spawnSync('psql', [connStr, '--no-psqlrc', '-f', f], { encoding: 'utf8' });
  if (r.error) throw new Error(`psql: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`psql ${r.status}:\n${r.stderr}\n${r.stdout}`);
  return r.stdout;
}

console.log('\nD14 Patch 2 — fix terminal event index');
console.log(`Project: ${EXPECTED_REF}\n`);

// Prechecks
const prevApplied = psql(`select count(*) from supabase_migrations.schema_migrations where version = '${PREV_PATCH}';`);
if (prevApplied.trim() !== '1') { console.error(`FAIL: patch 2 (${PREV_PATCH}) not applied — apply it first`); process.exit(1); }
console.log(`  PASS patch ${PREV_PATCH} already applied`);

const alreadyApplied = psql(`select count(*) from supabase_migrations.schema_migrations where version = '${PATCH_VERSION}';`);
if (alreadyApplied.trim() !== '0') { console.error(`FAIL: ${PATCH_VERSION} already applied`); process.exit(1); }
console.log(`  PASS ${PATCH_VERSION} not yet applied`);

// Confirm current index is on (transaction_id) — single column
const idxDef = psql(`
  select indexdef from pg_indexes
  where indexname = 'transaction_events_real_terminal_once_uq';
`);
console.log(`  Current index: ${idxDef.slice(0, 120)}`);

// Apply
console.log('\n── Applying patch SQL ──');
const sql = readFileSync(PATCH_SQL, 'utf8');
const sha256 = createHash('sha256').update(sql).digest('hex');
console.log(`  SHA256: ${sha256}`);
psqlFile(PATCH_SQL);

// Register
psql(`
  insert into supabase_migrations.schema_migrations(version, name, statements)
  values ('${PATCH_VERSION}', 'vno_phase_d14_patch_terminal_event_index',
    array['drop index if exists public.transaction_events_real_terminal_once_uq',
          'create unique index transaction_events_real_terminal_once_uq on public.transaction_events (transaction_id, event_type) where event_type in (''real_transaction_confirmed'',''real_transaction_cancelled'',''real_transaction_reversed'')']);
`);

// Postchecks
const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
  if (!pass) process.exitCode = 1;
}

const newIdxDef = psql(`select indexdef from pg_indexes where indexname = 'transaction_events_real_terminal_once_uq';`);
check('index now on (transaction_id, event_type)', newIdxDef.includes('transaction_id, event_type'), newIdxDef.slice(0, 120));
check('index still partial (WHERE clause present)', newIdxDef.includes('real_transaction_'), newIdxDef.slice(0, 120));
const patchReg = psql(`select count(*) from supabase_migrations.schema_migrations where version = '${PATCH_VERSION}';`);
check('patch registered in schema_migrations', patchReg.trim() === '1', patchReg);

const evidenceDir = resolve(__dirname, `evidence/d14-patch2-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(resolve(evidenceDir, 'patch2-evidence.json'), JSON.stringify({ patchVersion: PATCH_VERSION, sha256, appliedAt: new Date().toISOString(), newIndex: newIdxDef, checks }, null, 2));

const passed = checks.filter(c => c.pass).length;
const failed = checks.filter(c => !c.pass).length;
console.log(`\n  ${passed} PASS / ${failed} FAIL`);
if (failed > 0) { process.exit(1); }
console.log('\n  D14 patch 2 applied successfully.\n');
