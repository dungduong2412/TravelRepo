#!/usr/bin/env node
// READ-ONLY catalog preflight for 20261111000001_vno_merchant_member_atomic_create.sql (see preflight-members-catalog.sql). It CHANGES NOTHING.
//
//   LIVE project (run from a host terminal that already has SUPABASE_DB_PASSWORD exported; psql must be on PATH):
//     cd migration/v2 && PATH=/opt/homebrew/opt/libpq/bin:$PATH node preflight-members-catalog.mjs [--out <dir>]
//   Disposable local rehearsal database only (docker container vno-rehearsal-pg on :54999):
//     node preflight-members-catalog.mjs --rehearsal [--out <dir>]
//
// The password is read from the environment of the process that runs this file and nowhere else: it is never an argument, never printed, never written (psql gets it
// through PGPASSWORD, and any appearance of it in psql's error output is replaced by <redacted> before printing). The linked project ref must equal
// hsezyogfxgnkpweoqqny or the script stops. The session is opened with default_transaction_read_only=on and the SQL runs inside `begin read only … rollback`.
// Output: PASS / FAIL gates and INFO inventory. Evidence (metadata and aggregates only; no row data, no credentials) is written to
// migration/v2/evidence/members-catalog-preflight-<timestamp>/preflight.json with mode 0600. Exit code 0 = every gate PASS; 1 = at least one FAIL or it could not run.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = new URL('../../', import.meta.url).pathname;
const EXPECTED_PROJECT_REF = 'hsezyogfxgnkpweoqqny';
const args = process.argv.slice(2);
const rehearsal = args.includes('--rehearsal');
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const die = (msg) => { console.error(`\nFATAL: ${msg}`); process.exit(1); };

function getConn() {
  if (rehearsal) return { host: '127.0.0.1', port: '54999', user: 'postgres', db: 'postgres', password: 'rehearsal', label: 'LOCAL REHEARSAL DATABASE (throwaway container)' };
  const ref = readFileSync(join(REPO, 'supabase/.temp/project-ref'), 'utf8').trim();
  if (ref !== EXPECTED_PROJECT_REF) die(`Linked project is ${ref}, expected ${EXPECTED_PROJECT_REF}`);
  if (!process.env.SUPABASE_DB_PASSWORD) die('SUPABASE_DB_PASSWORD is not set in this terminal (export it yourself; never paste it into a chat)');
  const u = new URL(readFileSync(join(REPO, 'supabase/.temp/pooler-url'), 'utf8').trim());
  return { host: u.hostname, port: u.port || '5432', user: decodeURIComponent(u.username), db: u.pathname.slice(1) || 'postgres', password: process.env.SUPABASE_DB_PASSWORD, label: `LIVE project ${ref} via ${u.hostname}` };
}

const conn = getConn();
const redact = (s) => (s || '').split(conn.password).join('<redacted>');
console.log(`Read-only catalog preflight — ${conn.label}`);

const sql = readFileSync(join(REPO, 'migration/v2/preflight-members-catalog.sql'), 'utf8');
const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
  input: sql, encoding: 'utf8', maxBuffer: 1 << 24,
  env: { ...process.env, PGHOST: conn.host, PGPORT: String(conn.port), PGUSER: conn.user, PGDATABASE: conn.db, PGPASSWORD: conn.password,
         PGSSLMODE: rehearsal ? 'disable' : 'require', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=60000' },
});
if (r.error) die(`could not start psql (is it on PATH? try PATH=/opt/homebrew/opt/libpq/bin:$PATH): ${redact(r.error.message)}`);
if (r.status !== 0) die(`the preflight query failed (nothing was changed):\n${redact(r.stderr)}`);

const rows = []; let summary = null;
for (const line of r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
  const [ord, label, a, b, c] = line.split('|');
  if (label === 'SUMMARY') { summary = { passed: Number(a), failed: Number(b), info: Number(c) }; continue; }
  const detail = line.split('|').slice(3).join('|');
  rows.push({ ord: Number(ord), label, verdict: a, detail });
}
if (!summary || summary.passed + summary.failed + summary.info !== rows.length) die('the output could not be parsed (no SUMMARY line); nothing was changed');

for (const x of rows.filter((x) => x.verdict !== 'INFO')) console.log(`  ${x.verdict}  ${x.label}${x.detail ? `\n        ${x.detail}` : ''}`);
console.log(`\n${rows.filter((x) => x.verdict === 'INFO').length} informational inventory rows are in the evidence file (columns, constraints, indexes, triggers, policies, functions, aggregates, digests).`);
for (const x of rows.filter((x) => x.verdict === 'INFO' && /^(INFO digest|INFO registered migrations|INFO collaborators: rows|INFO collaborators: groups|INFO collaborators with the Members code shape|INFO audit_events: rows|INFO audit_events: an index whose leading|INFO the one pending row)/.test(x.label))) console.log(`  ${x.label}\n        ${x.detail}`);

const dir = resolve(arg('--out') || join(REPO, `migration/v2/evidence/members-catalog-preflight-${ts}`));
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(join(dir, 'preflight.json'), JSON.stringify({ checked_at: new Date().toISOString(), target: conn.label, read_only: true, summary, rows }, null, 2), { mode: 0o600 });
console.log(`\n${summary.passed} gates passed, ${summary.failed} failed. Evidence: ${dir}/preflight.json`);
if (summary.failed) { console.error('\nAt least one gate FAILED — do not change anything; send the evidence file (it holds no credentials) for review.'); process.exit(1); }
console.log('All gates passed. Nothing was changed.');
