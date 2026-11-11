#!/usr/bin/env node
// READ-ONLY probe of the REST-visible schema for 20261111000001 (create_merchant_member_application). It CHANGES NOTHING.
//
//   Hosted (the live project):  railway run --service vno-api -- node migration/v2/rest-schema-probe.mjs [--out <dir>]
//   Disposable rehearsal DB:    node migration/v2/rest-schema-probe.mjs --rehearsal --key <service-role JWT> [--out <dir>]
//
// It is the PARTIAL substitute for migration/v2/preflight-members-catalog.sql when no database password is at hand: PostgREST publishes the columns, types, length
// limits, NOT NULL-without-default ("required") and the callable functions of the exposed schema as an OpenAPI document. It CANNOT see constraints, indexes, triggers,
// RLS, privileges, other schemas or the migration history: those stay unresolved until the catalog preflight runs on an authorized host connection.
//
// Read-only by construction: the only network primitive here is get() (one HTTP GET to /rest/v1/); there is no code path that sends another method, and no table is
// queried (no row is read). It refuses any host except the live Supabase project (or loopback with --rehearsal). The key is held in memory, never printed or written.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const rehearsal = args.includes('--rehearsal');
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const HOSTED_HOST = 'hsezyogfxgnkpweoqqny.supabase.co';
const die = (m) => { console.error(`FATAL: ${m}`); process.exit(1); };

let base; let key;
if (rehearsal) {
  base = process.env.VNO_REHEARSAL_REST || 'http://localhost:54998'; key = arg('--key') || '';
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) die('--rehearsal requires a loopback PostgREST');
} else {
  const u = process.env.SUPABASE_URL; key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!u || !key) die('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set (run it through `railway run --service vno-api -- node ...`)');
  const url = new URL(u); if (url.hostname !== HOSTED_HOST || url.protocol !== 'https:') die(`refusing host ${url.hostname}: only ${HOSTED_HOST} is allowed`);
  base = `${url.origin}/rest/v1`;
}

async function get(path) {   // the ONLY network primitive in this file
  const res = await fetch(`${base}${path}`, { method: 'GET', headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/openapi+json, application/json' } });
  if (!res.ok) die(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

const doc = await get('/');
const defs = doc.definitions || doc.components?.schemas || {};
const paths = doc.paths || {};
const fam = (p) => {
  if (!p) return 'MISSING';
  const f = String(p.format || ''); const t = String(p.type || '');
  if (f === 'uuid') return 'uuid';
  if (f === 'text' || f.startsWith('character') || (t === 'string' && !f)) return 'text';
  if (f.startsWith('timestamp with time zone')) return 'timestamptz';
  if (f === 'boolean' || t === 'boolean') return 'boolean';
  if (f === 'jsonb' || f === 'json') return 'jsonb';
  return f || t;
};
const need = [
  ['collaborators', 'merchant_system_id', 'uuid'], ['collaborators', 'collaborators_code', 'text', 10], ['collaborators', 'collaborators_name', 'text', 120], ['collaborators', 'collaborators_phone', 'text', 16],
  ['collaborators', 'collaborators_email', 'text', 254], ['collaborators', 'collaborators_bank_name', 'text', 100], ['collaborators', 'collaborators_bank_acc_number', 'text', 20],
  ['collaborators', 'collaborators_password', 'text'], ['collaborators', 'collaborators_registered_date', 'timestamptz'], ['collaborators', 'collaborators_verified', 'boolean'],
  ['collaborators', 'collaborators_status', 'text'], ['collaborators', 'id', 'uuid'],
  ['audit_events', 'actor_auth_user_id', 'uuid'], ['audit_events', 'actor_role', 'text', 8], ['audit_events', 'action', 'text', 38], ['audit_events', 'entity_type', 'text', 12],
  ['audit_events', 'entity_id', 'text', 36], ['audit_events', 'source', 'text', 12], ['audit_events', 'details', 'jsonb'],
  ['user_profiles', 'user_id', 'uuid'], ['user_profiles', 'role', 'text'], ['user_profiles', 'merchant_id', 'uuid'], ['user_profiles', 'user_profiles_status', 'text'],
  ['merchant_details', 'merchant_system_id', 'uuid'], ['merchant_details', 'merchants_status', 'text'], ['merchant_details', 'merchant_verified', 'boolean'],
];
const written = {
  collaborators: ['merchant_system_id', 'collaborators_code', 'collaborators_name', 'collaborators_phone', 'collaborators_email', 'collaborators_bank_name', 'collaborators_bank_acc_number', 'collaborators_password', 'collaborators_registered_date', 'collaborators_verified', 'collaborators_status'],
  audit_events: ['actor_auth_user_id', 'actor_role', 'action', 'entity_type', 'entity_id', 'source', 'details'],
};

const rows = []; const add = (verdict, label, detail) => rows.push({ verdict, label, detail });
for (const t of ['collaborators', 'audit_events', 'user_profiles', 'merchant_details']) add(defs[t] ? 'PASS' : 'FAIL', `GATE ${t} is exposed by PostgREST`, defs[t] ? 'present' : 'MISSING');
for (const [t, col, want, minlen] of need) {
  const p = defs[t]?.properties?.[col]; const got = fam(p);
  const maxLength = p?.maxLength; const lenOk = !minlen || maxLength === undefined || maxLength >= minlen;
  add(p && got === want && lenOk ? 'PASS' : 'FAIL', `GATE ${t}.${col}: exists, type family ${want}${minlen ? `, room for ${minlen}` : ''}`,
    p ? `format=${p.format ?? '-'} type=${p.type ?? '-'}${maxLength !== undefined ? ` maxLength=${maxLength}` : ''}${p.default !== undefined ? ` default=${p.default}` : ''}` : 'COLUMN MISSING');
}
for (const t of Object.keys(written)) {
  // PostgREST lists EVERY NOT NULL column as "required", default or not; a column that has a default (id, occurred_at, ...) is filled by the database
  const props = defs[t]?.properties || {};
  const required = defs[t]?.required || [];
  const noDefault = required.filter((c) => props[c]?.default === undefined);
  const notWritten = noDefault.filter((c) => !written[t].includes(c));
  // an integer NOT NULL column with no visible default is what an IDENTITY column looks like over REST (PostgREST does not publish identity defaults): the REST probe cannot
  // prove it, so it is reported as UNRESOLVED (not PASS) and settled by the catalog preflight; any other column in that position is a FAIL
  const identityLike = notWritten.filter((c) => ['bigint', 'integer', 'smallint'].includes(String(props[c]?.format)));
  const bad = notWritten.filter((c) => !identityLike.includes(c));
  const detail = `NOT NULL without a visible default: ${noDefault.join(', ') || 'none'}; NOT NULL with a default (filled by the database): ${required.filter((c) => props[c]?.default !== undefined).map((c) => `${c}=${props[c].default}`).join(', ') || 'none'}`;
  if (bad.length) add('FAIL', `GATE ${t}: every NOT NULL column without a default is written by the function`, `NOT WRITTEN: ${bad.join(', ')}. ${detail}`);
  else if (identityLike.length) add('UNRESOLVED', `GATE ${t}: every NOT NULL column without a default is written by the function`, `${identityLike.join(', ')} looks like an identity column (integer, NOT NULL, no visible default) - the deployed AuditService inserts without it, but only the catalog preflight proves it. ${detail}`);
  else add('PASS', `GATE ${t}: every NOT NULL column without a default is written by the function`, detail);
}
const rpcs = Object.keys(paths).filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5)).sort();
add(rpcs.includes('create_merchant_member_application') ? 'FAIL' : 'PASS', 'GATE create_merchant_member_application is NOT callable yet (the migration has not been applied)', rpcs.includes('create_merchant_member_application') ? 'ALREADY PRESENT' : 'absent');
add(rpcs.some((r) => /merchant_member/.test(r) && r !== 'create_merchant_member_application') ? 'FAIL' : 'PASS', 'GATE no other *merchant_member* function is callable (the reconciliation function from an earlier draft must not exist)', rpcs.filter((r) => /merchant_member/.test(r)).join(', ') || 'none');
add('INFO', 'INFO callable functions (count)', String(rpcs.length));
add('INFO', 'INFO callable functions (names)', rpcs.join(', ') || 'none');
for (const t of ['collaborators', 'audit_events']) add('INFO', `INFO ${t} columns (${Object.keys(defs[t]?.properties || {}).length})`, Object.entries(defs[t]?.properties || {}).map(([c, p]) => `${c}:${p.format ?? p.type}${p.maxLength !== undefined ? `(${p.maxLength})` : ''}${(defs[t].required || []).includes(c) ? '*' : ''}`).join(', '));

const summary = { passed: rows.filter((r) => r.verdict === 'PASS').length, failed: rows.filter((r) => r.verdict === 'FAIL').length, unresolved: rows.filter((r) => r.verdict === 'UNRESOLVED').length, info: rows.filter((r) => r.verdict === 'INFO').length };
for (const r of rows) console.log(`  ${r.verdict.padEnd(10)}  ${r.label}\n        ${r.detail}`);
console.log(`\n${summary.passed} passed, ${summary.failed} failed, ${summary.unresolved} unresolved (need the catalog preflight), ${summary.info} informational. (* in a column list = NOT NULL, with or without a default)`);
const out = resolve(arg('--out') || (rehearsal ? '/tmp/rest-schema-probe-rehearsal' : join(new URL('../../', import.meta.url).pathname, 'migration/v2/evidence/members-audit-atomicity-20261111-rev2/hosted-rest-schema-probe')));
mkdirSync(out, { recursive: true, mode: 0o700 });
writeFileSync(join(out, 'rest-schema-probe.json'), JSON.stringify({ checked_at: new Date().toISOString(), target: rehearsal ? 'LOCAL REHEARSAL DATABASE' : `live project ${HOSTED_HOST}`, read_only: true, method: 'one GET /rest/v1/ (OpenAPI), no table queried', summary, rows }, null, 2), { mode: 0o600 });
console.log(`READ-ONLY. Nothing was changed. Evidence (schema metadata only; no row data, no credentials): ${out}/rest-schema-probe.json`);
process.exit(summary.failed ? 1 : 0);
