#!/usr/bin/env node
// READ-ONLY security check of the transaction-function and scan-table privileges (see check-function-privileges.sql).
//
//   UAT (run from the host terminal that has SUPABASE_DB_PASSWORD; psql must be on PATH):
//     cd migration/v2 && PATH=/opt/homebrew/opt/libpq/bin:$PATH node check-function-privileges.mjs
//   Disposable local rehearsal database only (docker container vno-rehearsal-pg on :54999):
//     node check-function-privileges.mjs --rehearsal
//   Add --members to check the Merchant-member function of 20261111000001 instead (check-member-function-privileges.sql), e.g. `--rehearsal --members`.
//
// It cannot change anything: the session is opened with default_transaction_read_only=on, the SQL runs inside
// `begin read only … rollback`, and only catalog functions (pg_proc, has_*_privilege, aclexplode) are queried.
// It writes one small evidence file (ACL metadata only — no row data, no credentials) to migration/v2/evidence/privilege-check-<ts>/.
// Exit code 0 = every check PASS; 1 = at least one FAIL or the check could not run.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = new URL('../../', import.meta.url).pathname;
const EXPECTED_PROJECT_REF = 'hsezyogfxgnkpweoqqny';
const rehearsal = process.argv.includes('--rehearsal');
const members = process.argv.includes('--members');   // check the Merchant-member function (20261111000001) instead of the transaction functions
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const die = (msg) => { console.error(`\nFATAL: ${msg}`); process.exit(1); };

function getConn() {
  if (rehearsal) return { host: '127.0.0.1', port: '54999', user: 'postgres', db: 'postgres', password: 'rehearsal', label: 'LOCAL REHEARSAL DATABASE (throwaway container)' };
  const ref = readFileSync(join(REPO, 'supabase/.temp/project-ref'), 'utf8').trim();
  if (ref !== EXPECTED_PROJECT_REF) die(`Linked project is ${ref}, expected ${EXPECTED_PROJECT_REF}`);
  if (!process.env.SUPABASE_DB_PASSWORD) die('SUPABASE_DB_PASSWORD is not set');
  const u = new URL(readFileSync(join(REPO, 'supabase/.temp/pooler-url'), 'utf8').trim());
  return { host: u.hostname, port: u.port || '5432', user: decodeURIComponent(u.username), db: u.pathname.slice(1) || 'postgres', password: process.env.SUPABASE_DB_PASSWORD, label: `UAT project ${ref} via ${u.hostname}` };
}

const conn = getConn();
const redact = (s) => (s || '').split(conn.password).join('<redacted>');
console.log(`Read-only privilege check — ${conn.label}`);

const sql = readFileSync(join(REPO, members ? 'migration/v2/check-member-function-privileges.sql' : 'migration/v2/check-function-privileges.sql'), 'utf8');
const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
  input: sql, encoding: 'utf8', maxBuffer: 1 << 22,
  env: { ...process.env, PGHOST: conn.host, PGPORT: String(conn.port), PGUSER: conn.user, PGDATABASE: conn.db, PGPASSWORD: conn.password,
         PGSSLMODE: rehearsal ? 'disable' : 'require', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000' },
});
if (r.error) die(`could not start psql (is it on PATH? try PATH=/opt/homebrew/opt/libpq/bin:$PATH): ${r.error.message}`);
if (r.status !== 0) die(`the check query failed:\n${redact(r.stderr)}`);

const rows = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('|'));
const checks = []; let summary = null;
for (const cols of rows) {
  if (cols[1] === 'SUMMARY') { summary = { passed: Number(cols[2]), failed: Number(cols[3]) }; continue; }
  const [ord, label, verdict, ...detail] = cols;
  checks.push({ ord: Number(ord), label, pass: verdict === 'PASS', detail: detail.join('|') });
  console.log(`  ${verdict === 'PASS' ? 'PASS' : 'FAIL'}  ${label}${detail.length ? `\n        ${detail.join('|')}` : ''}`);
}
if (!summary || summary.passed + summary.failed !== checks.length) die('the check output could not be parsed (no SUMMARY line); nothing was changed');

const dir = resolve(join(REPO, `migration/v2/evidence/privilege-check-${ts}`));
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(join(dir, members ? 'member-function-privilege-check.json' : 'privilege-check.json'), JSON.stringify({ checked_at: new Date().toISOString(), target: conn.label, read_only: true, summary, checks }, null, 2), { mode: 0o600 });
console.log(`\n${summary.passed} passed, ${summary.failed} failed. Evidence (ACL metadata only): ${dir}/${members ? 'member-function-privilege-check.json' : 'privilege-check.json'}`);
if (summary.failed) { console.error('\nAt least one privilege check FAILED — do not change anything automatically; send the output above for review.'); process.exit(1); }
console.log('All privilege checks passed. Nothing was changed.');
