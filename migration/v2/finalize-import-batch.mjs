#!/usr/bin/env node
// Governed finalization of ONE sealed-snapshot import batch: legacy_migration_batches.status 'validating' -> 'validated'.
//   * refuses unless fresh, complete, all-PASS evidence is supplied: catalog verification (K1-K7, C17, C18) and the full reconciliation (C1-C23)
//   * refuses unless the batch is the deterministic id of the pinned snapshot, bound to the sealed manifest hash, and the only batch
//   * the single write is a compare-and-set PATCH filtered by id AND status=validating AND source_inventory_sha256; it sets ONLY `status`
//   * idempotent: an already-validated batch with the same hash is reported and nothing is written
//   * reads the stored row back and proves every other column and every table row count is unchanged
// Usage: finalize-import-batch.mjs --label snapshot-5 --batch-id <uuid> --catalog <catalog.json> --reconcile <reconcile.json> --out <closure.json> [--execute] [--max-age-minutes 120]
// Env: VNO_TARGET_URL, VNO_TARGET_SERVICE_ROLE_KEY, VNO_ALLOW_REMOTE_REHEARSAL (non-local only)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { SNAPSHOT_PINS, verifySealedSnapshot } from './snapshot-pins.mjs';

const TENANT = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';
const APPROVED_UAT_HOST = 'hsezyogfxgnkpweoqqny.supabase.co';
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const LABEL = opt('--label'), BATCH_ID = opt('--batch-id'), CATALOG = opt('--catalog'), RECON = opt('--reconcile'), OUT = opt('--out'), EXECUTE = argv.includes('--execute');
const MAX_AGE_MIN = Number(opt('--max-age-minutes', '120'));
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const sha = (b) => createHash('sha256').update(b).digest('hex');
const uuidFrom = (value) => { const hex = sha(value).slice(0, 32).split(''); hex[12] = '5'; hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4]; return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`; };
const stop = (m) => { throw new Error(`STOP: ${m}`); };

if (!LABEL || !SNAPSHOT_PINS[LABEL] || !BATCH_ID || !CATALOG || !RECON || !OUT) throw new Error('usage: --label --batch-id --catalog --reconcile --out [--execute]');
const URL_ = process.env.VNO_TARGET_URL, KEY = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error('VNO_TARGET_URL and VNO_TARGET_SERVICE_ROLE_KEY are required');
const host = new URL(URL_).hostname;
const local = ['localhost', '127.0.0.1', '::1'].includes(host);
if (!local) {
  if (host !== APPROVED_UAT_HOST) stop(`${host} is not the approved UAT project or a local clone`);
  if (process.env.VNO_ALLOW_REMOTE_REHEARSAL !== 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION') stop('remote target blocked: VNO_ALLOW_REMOTE_REHEARSAL is not set');
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const rest = async (route, o = {}) => { const r = await fetch(`${URL_}/rest/v1/${route}`, { ...o, headers: { ...H, ...(o.headers || {}) }, signal: AbortSignal.timeout(60_000) }); const t = await r.text(); if (!r.ok) throw new Error(`${o.method || 'GET'} ${route.split('?')[0]}: HTTP ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; };
const count = async (t) => { const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, { headers: { ...H, Prefer: 'count=exact' } }); await r.text(); return Number((r.headers.get('content-range') || '').split('/')[1]); };
const TABLES = ['merchant_details', 'collaborators', 'referral_transactions', 'merchant_category_links', 'categories', 'merchant_update_requests', 'media_assets', 'user_profiles', 'legacy_identity_map', 'legacy_import_conflicts', 'legacy_migration_batches', 'legacy_migration_runs', 'legacy_source_records', 'legacy_tenant_evidence', 'invitations', 'transaction_events', 'organization_profile', 'merchant_user_links', 'media_approval_requests'];

// ---- 1. snapshot / batch identity ----
const snap = process.env.VNO_SNAPSHOT_DIR || SNAPSHOT_PINS[LABEL].dir;
const seal = await verifySealedSnapshot({ label: LABEL, snapshotDir: snap, tenant: TENANT });
if (lower(BATCH_ID) !== uuidFrom(`vno-${LABEL}:${seal.manifest_sha256}`)) stop('--batch-id is not the deterministic batch of the pinned snapshot');
const batches = await rest('legacy_migration_batches?select=*');
const before = batches.find((b) => b.id === lower(BATCH_ID));
if (!before || batches.length !== 1) stop(`expected exactly the approved batch, found ${batches.length} batch rows`);
if (lower(before.legacy_tenant_id) !== TENANT || before.source_inventory_sha256 !== seal.manifest_sha256) stop('batch tenant / snapshot hash does not match the pinned snapshot');
if (!['validating', 'validated'].includes(before.status)) stop(`batch status is '${before.status}', expected validating (or already validated)`);

// ---- 2. evidence gate ----
const ageOk = (iso) => Date.now() - Date.parse(iso) <= MAX_AGE_MIN * 60_000 && Date.parse(iso) <= Date.now() + 60_000;
const catBytes = readFileSync(CATALOG), recBytes = readFileSync(RECON);
const cat = JSON.parse(catBytes), rec = JSON.parse(recBytes);
const need = ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'C17', 'C18'];
const catOk = cat.mode === (local ? cat.mode : 'hosted') && need.every((id) => cat.checks?.find((c) => c.id === id)?.status === 'PASS') && cat.checks.length === need.length && cat.fail === 0 && ageOk(cat.generated_utc);
const recIds = Array.from({ length: 23 }, (_, i) => `C${i + 1}`);
const recOk = rec.snapshot === LABEL && recIds.every((id) => rec.checks?.find((c) => c.id === id)?.status === 'PASS') && rec.pass === 23 && rec.fail === 0 && (rec.not_run ?? 0) === 0 && rec.checks.length === 23 && ageOk(rec.generated_utc);
if (!catOk) stop(`catalog evidence is not fresh complete all-PASS K1-K7 + C17 + C18 (mode ${cat.mode}, ${cat.pass} pass / ${cat.fail} fail, generated ${cat.generated_utc})`);
if (!recOk) stop(`reconciliation evidence is not fresh complete 23/23 PASS (${rec.pass} pass / ${rec.fail} fail / ${rec.not_run ?? 0} not run, generated ${rec.generated_utc})`);

// ---- 3. scoped, idempotent write ----
const countsBefore = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await count(t)])));
let outcome = 'planned', patched = null;
if (before.status === 'validated') outcome = 'already_validated (no write)';
else if (EXECUTE) {
  patched = await rest(`legacy_migration_batches?id=eq.${lower(BATCH_ID)}&status=eq.validating&source_inventory_sha256=eq.${seal.manifest_sha256}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ status: 'validated' }) });
  if (patched.length !== 1) stop(`compare-and-set updated ${patched.length} rows`);
  outcome = 'validated';
}
// ---- 4. read back ----
const afterRows = await rest('legacy_migration_batches?select=*');
const after = afterRows.find((b) => b.id === lower(BATCH_ID));
const countsAfter = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await count(t)])));
const otherColumnsEqual = Object.keys(before).filter((k) => k !== 'status').every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]));
const verify = {
  one_batch_only: afterRows.length === 1,
  status_after: after.status,
  only_status_column_changed: otherColumnsEqual,
  snapshot_hash_still_matches: after.source_inventory_sha256 === seal.manifest_sha256,
  row_counts_unchanged_in_all_tables: JSON.stringify(countsBefore) === JSON.stringify(countsAfter),
};
const pass = EXECUTE || outcome.startsWith('already') ? verify.one_batch_only && verify.only_status_column_changed && verify.snapshot_hash_still_matches && verify.row_counts_unchanged_in_all_tables && after.status === 'validated' : true;
const closure = { generated_utc: new Date().toISOString(), target: host, label: LABEL, batch_id: lower(BATCH_ID), manifest_sha256: seal.manifest_sha256, mode: EXECUTE ? 'execute' : 'plan', outcome,
  status_before: before.status, stored_batch_state: after, evidence: { catalog: { sha256: sha(catBytes), generated_utc: cat.generated_utc, pass: cat.pass, fail: cat.fail }, reconcile: { sha256: sha(recBytes), generated_utc: rec.generated_utc, pass: rec.pass, fail: rec.fail, not_run: rec.not_run ?? 0 } },
  row_counts: countsAfter, verify, result: pass ? 'PASS' : 'FAIL' };
writeFileSync(OUT, JSON.stringify(closure, null, 2));
console.log(JSON.stringify({ outcome, status_before: before.status, status_after: after.status, result: closure.result }));
process.exit(pass ? 0 : 1);
