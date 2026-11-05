#!/usr/bin/env node
// Targeted rollback of ONE sealed-snapshot import (everything the importer owns), then proof against the pre-import backup.
//   Local rehearsal:  rollback-import-batch.mjs --local <supabase-workdir> [--execute] --backup <pg-backup-dir>
//   Verify only:      rollback-import-batch.mjs --local <workdir> --verify-only --backup <pg-backup-dir>
//   Hosted UAT:       VNO_ROLLBACK_CONFIRM=<batch-id> SUPABASE_DB_PASSWORD=... rollback-import-batch.mjs --uat --execute --backup <pg-backup-dir>
// Dry run by default (counts only). Ownership rules - nothing is deleted unless it belongs to the import:
//   * rows are selected by legacy_tenant_id = the V1 tenant (pre-existing synthetic rows have none), or by the batch id;
//   * Auth users only if they are in legacy_identity_map AND carry app_metadata.legacy_user_id equal to the map entry;
//     one foreign-looking user aborts the whole rollback before the first delete;
//   * Storage objects only those registered by this import's media_assets rows (paths under legacy-*/).
// The importer MERGES V1 categories into existing UAT categories with the same name (it only adds the legacy_* tags). Those rows
// are reverted to their pre-import legacy_* values from the backup's export, not deleted; only categories absent from the backup are deleted.
// --backup is mandatory with --execute: it is both the source of those original values and the proof reference (row-checksums.json).
// --backup also recomputes the row count + md5 of every non-ephemeral table in a READ ONLY transaction and compares it to
// the backup's row-checksums.json (the state before the import).
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wrapReadOnly } from './backup-readonly.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const UAT = argv.includes('--uat'), EXECUTE = argv.includes('--execute'), verifyDir = opt('--backup');
const TENANT = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';
const UAT_REF = 'hsezyogfxgnkpweoqqny';
const repo = new URL('../../', import.meta.url).pathname;
let API, KEY, pg;
if (UAT) {
  const env = {};
  readFileSync(join(repo, '.env'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).forEach((l) => { const [k, ...v] = l.split('='); env[k.trim()] = v.join('=').trim(); });
  if (new URL(env.SUPABASE_URL).hostname !== `${UAT_REF}.supabase.co`) throw new Error('refusing: .env is not the approved UAT project');
  if (readFileSync(join(repo, 'supabase/.temp/project-ref'), 'utf8').trim() !== UAT_REF) throw new Error('refusing: linked project is not the approved UAT project');
  API = env.SUPABASE_URL; KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (EXECUTE && !process.env.VNO_ROLLBACK_CONFIRM) throw new Error('hosted rollback requires VNO_ROLLBACK_CONFIRM=<batch-id>');
  if (EXECUTE && !verifyDir) throw new Error('--execute requires --backup <pg-backup-dir>');
  if (verifyDir && !process.env.SUPABASE_DB_PASSWORD) throw new Error('--verify on UAT needs SUPABASE_DB_PASSWORD in the environment');
  const u = new URL(readFileSync(join(repo, 'supabase/.temp/pooler-url'), 'utf8').trim());
  pg = { PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGDATABASE: u.pathname.slice(1) || 'postgres', PGPASSWORD: process.env.SUPABASE_DB_PASSWORD, PGSSLMODE: 'require' };
} else {
  const workdir = opt('--local');
  if (!workdir) throw new Error('usage: --local <workdir> | --uat');
  const st = Object.fromEntries(execFileSync('supabase', ['status', '--workdir', workdir, '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((l) => l.includes('=')).map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').replace(/^"|"$/g, '')]; }));
  const d = new URL(st.DB_URL);
  if (!/^http:\/\/127\.0\.0\.1:/.test(st.API_URL) || !['127.0.0.1', 'localhost'].includes(d.hostname)) throw new Error('refusing: --local requires a local stack');
  API = st.API_URL; KEY = st.SERVICE_ROLE_KEY;
  pg = { PGHOST: d.hostname, PGPORT: d.port, PGUSER: 'supabase_admin', PGDATABASE: 'postgres', PGPASSWORD: decodeURIComponent(d.password), PGSSLMODE: 'disable' };
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const req = async (path, init = {}) => {
  const r = await fetch(API + path, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path.split('?')[0]} -> ${r.status} ${text.slice(0, 200)}`);
  return { json: text ? JSON.parse(text) : null, range: r.headers.get('content-range') };
};
const select = async (path) => { const rows = []; for (let off = 0; ; off += 1000) { const { json } = await req(`/rest/v1/${path}${path.includes('?') ? '&' : '?'}limit=1000&offset=${off}`); rows.push(...json); if (json.length < 1000) break; } return rows; };
const count = async (table, filter) => Number((await req(`/rest/v1/${table}?select=*&${filter}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } })).range?.split('/')[1] ?? NaN);
const del = async (table, filter) => Number(((await req(`/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'count=exact,return=minimal' } })).range || '*/0').split('/')[1]);
const log = [];
const step = (name, n, extra = {}) => { log.push({ step: name, rows: n, ...extra }); console.error(`${EXECUTE ? 'DELETED' : 'WOULD DELETE'} ${String(n).padStart(6)}  ${name}`); };

// ---- proof against the pre-import backup ------------------------------------------------------------------------------------------------
async function verifyState() {
  let verdict = null;
  if (verifyDir) {
  const want = JSON.parse(readFileSync(join(verifyDir, 'row-checksums.json'), 'utf8'));
  const psql = (q) => { const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: wrapReadOnly(q), env: { ...process.env, ...pg }, encoding: 'utf8', maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(r.stderr.replace(pg.PGPASSWORD, '<redacted>').slice(0, 300)); return r.stdout.trim(); };
  // public.categories is compared column-by-column WITHOUT updated_at: its BEFORE UPDATE trigger restamps updated_at on the rows the
  // importer merged into, and REST cannot bypass the trigger. Known, documented residual: those timestamps only.
  const tables = Object.entries(want).filter(([t, w]) => w.restored && t !== 'public.categories').map(([t]) => t);
  const out = psql(tables.map((t) => { const [s, n] = t.split('.'); return `select '${t}' || '|' || count(*) || '|' || md5(coalesce(string_agg(x::text, E'\\n' order by x::text), '')) from "${s}"."${n}" x`; }).join('\nunion all\n'));
  const got = Object.fromEntries(out.split('\n').filter(Boolean).map((l) => { const [t, rows, md5] = l.split('|'); return [t, { rows: Number(rows), md5 }]; }));
  const catNow = psql(`select to_jsonb(x) - 'updated_at' from public.categories x order by x.id`).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const strip = ({ updated_at, ...rest }) => rest;
  const catWant = readFileSync(join(verifyDir, 'logical/tables/categories.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => strip(JSON.parse(l))).sort((a, b) => a.id.localeCompare(b.id));
  const sortKeys = (o) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
  const catBad = JSON.stringify(catNow.map(sortKeys)) !== JSON.stringify(catWant.map(sortKeys));
  const bad = tables.filter((t) => !got[t] || got[t].rows !== want[t].rows || got[t].md5 !== want[t].md5).map((t) => ({ table: t, backup_rows: want[t].rows, now_rows: got[t]?.rows }));
  if (catBad) bad.push({ table: 'public.categories', note: 'differs beyond updated_at' });
  verdict = bad.length ? 'FAIL: state differs from the pre-import backup' : 'PASS: every restored table equals the pre-import backup (public.categories ignoring updated_at)';
  console.error(`verify (${tables.length + 1} tables): ${verdict}`); if (bad.length) console.error(JSON.stringify(bad));
  log.push({ verify: verdict, tables: tables.length + 1, differing: bad, residual: 'public.categories.updated_at restamped on rows merged by the importer' });
  }
  return verdict;
}

if (argv.includes('--verify-only')) { const v = await verifyState(); console.log(JSON.stringify({ verify_only: true, verdict: v })); process.exit(v && v.startsWith('PASS') ? 0 : 1); }

// ---- identify the import -------------------------------------------------------------------------------------------------------------
const batches = await select(`legacy_migration_batches?select=id,notes,status&legacy_tenant_id=eq.${TENANT}`);
if (batches.length !== 1) throw new Error(`expected exactly one import batch for the tenant, found ${batches.length}; stopping (nothing deleted)`);
const batchId = batches[0].id;
if (EXECUTE && UAT && process.env.VNO_ROLLBACK_CONFIRM !== batchId) throw new Error(`VNO_ROLLBACK_CONFIRM does not match batch ${batchId}; stopping`);
console.error(`batch ${batchId} (${batches[0].notes}; status ${batches[0].status}) mode=${UAT ? 'HOSTED UAT' : 'local'} ${EXECUTE ? 'EXECUTE' : 'dry-run'}`);

// ---- ownership pre-checks (all before the first delete) --------------------------------------------------------------------------------
const idmap = await select(`legacy_identity_map?select=legacy_user_id,auth_user_id&legacy_tenant_id=eq.${TENANT}`);
const authIds = [];
for (const m of idmap) {
  const { json: u } = await req(`/auth/v1/admin/users/${m.auth_user_id}`).catch(() => ({ json: null }));
  if (!u) continue; // already gone
  if (String(u.app_metadata?.legacy_user_id).toLowerCase() !== String(m.legacy_user_id).toLowerCase()) throw new Error(`Auth user ${m.auth_user_id} is not migration-owned; rollback aborted before any delete`);
  authIds.push(m.auth_user_id);
}
const media = await select(`media_assets?select=bucket_id,object_path&legacy_tenant_id=eq.${TENANT}`);
if (media.some((m) => !/^legacy-/.test(m.object_path))) throw new Error('a media asset outside legacy-*/ is tagged with the V1 tenant; rollback aborted');

// ---- delete, children first --------------------------------------------------------------------------------------------------------------
const run = async (name, table, filter) => step(name, EXECUTE ? await del(table, filter) : await count(table, filter));
await run('media_assets', 'media_assets', `legacy_tenant_id=eq.${TENANT}`);
const byBucket = {};
for (const m of media) (byBucket[m.bucket_id] ||= []).push(m.object_path);
for (const [bucket, paths] of Object.entries(byBucket)) {
  let removed = 0;
  if (EXECUTE) for (let i = 0; i < paths.length; i += 100) { const { json } = await req(`/storage/v1/object/${bucket}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) }); removed += json.length; }
  step(`storage objects in ${bucket}`, EXECUTE ? removed : paths.length);
}
await run('referral_transactions', 'referral_transactions', `legacy_tenant_id=eq.${TENANT}`);
await run('merchant_update_requests', 'merchant_update_requests', `legacy_tenant_id=eq.${TENANT}`);
await run('merchant_category_links', 'merchant_category_links', `legacy_tenant_id=eq.${TENANT}`);
let profiles = 0;
const ids = idmap.map((m) => m.legacy_user_id);
for (let i = 0; i < ids.length; i += 50) { const f = `id=in.(${ids.slice(i, i + 50).join(',')})`; profiles += EXECUTE ? await del('user_profiles', f) : await count('user_profiles', f); }
step('user_profiles (V1 users)', profiles);
await run('legacy_identity_map', 'legacy_identity_map', `legacy_tenant_id=eq.${TENANT}`);
let authDeleted = 0;
if (EXECUTE) for (const id of authIds) { await req(`/auth/v1/admin/users/${id}`, { method: 'DELETE' }); authDeleted++; }
step('auth users (migration-owned)', EXECUTE ? authDeleted : authIds.length);
await run('collaborators', 'collaborators', `legacy_tenant_id=eq.${TENANT}`);
await run('merchant_details', 'merchant_details', `legacy_tenant_id=eq.${TENANT}`);
{ // categories: delete V1-only rows, revert merged pre-existing rows to their backed-up legacy_* values
  const original = verifyDir ? readFileSync(join(verifyDir, 'logical/tables/categories.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const originalById = new Map(original.map((c) => [c.id, c]));
  const tagged = await select(`categories?select=id&legacy_tenant_id=eq.${TENANT}`);
  const merged = tagged.filter((c) => originalById.has(c.id)), v1Only = tagged.filter((c) => !originalById.has(c.id));
  if (!verifyDir && !EXECUTE) step('categories: V1-only rows deleted / merged rows reverted (needs --backup to split)', tagged.length);
  else {
    let d = 0;
    for (const c of v1Only) d += EXECUTE ? await del('categories', `id=eq.${c.id}`) : 1;
    for (const c of merged) if (EXECUTE) await req(`/rest/v1/categories?id=eq.${c.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ legacy_category_id: originalById.get(c.id).legacy_category_id ?? null, legacy_tenant_id: originalById.get(c.id).legacy_tenant_id ?? null }) });
    step('categories deleted (V1-only)', d); step('categories reverted (merged into pre-existing UAT rows)', merged.length);
  }
}
await run('legacy_import_conflicts', 'legacy_import_conflicts', `import_batch_id=eq.${batchId}`);
await run('legacy_migration_runs', 'legacy_migration_runs', `import_batch_id=eq.${batchId}`);
await run('legacy_source_records', 'legacy_source_records', `import_batch_id=eq.${batchId}`);
await run('legacy_migration_batches', 'legacy_migration_batches', `id=eq.${batchId}`);
await run('legacy_tenant_evidence', 'legacy_tenant_evidence', `legacy_tenant_id=eq.${TENANT}`);

let verdict = EXECUTE ? 'executed (not verified)' : 'dry-run';
if (verifyDir) verdict = await verifyState();
console.log(JSON.stringify({ batch_id: batchId, mode: UAT ? 'uat' : 'local', executed: EXECUTE, verdict, steps: log }));
process.exit(verdict.startsWith('FAIL') ? 1 : 0);
