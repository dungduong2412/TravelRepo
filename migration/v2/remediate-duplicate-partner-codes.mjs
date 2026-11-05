#!/usr/bin/env node
// Exception E1: give the 4 Partners that share V1 codes C2500228 / C2500240 unique codes (see partner-code-remap.mjs for the policy).
// Touches ONLY collaborators.collaborators_code of those 4 rows (+ the table's own updated_at) and adds 4 legacy_import_conflicts audit rows.
// It never runs the importer, deletes nothing, creates no Auth user and sends nothing.
//
// Usage: remediate-duplicate-partner-codes.mjs --label snapshot-5 --batch-id <uuid> --evidence <file.json> [--execute]
// Default is a read-only plan. Env: VNO_TARGET_URL, VNO_TARGET_SERVICE_ROLE_KEY, VNO_ALLOW_REMOTE_REHEARSAL (non-local only).
// Order: audit rows first, then each code change as a compare-and-set (id AND old code), then full re-verification.
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SNAPSHOT_PINS, verifySealedSnapshot } from './snapshot-pins.mjs';
import { pinnedPartnerRemap, partnerConflictRows } from './partner-code-remap.mjs';

const TENANT = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';
const APPROVED_UAT_HOST = 'hsezyogfxgnkpweoqqny.supabase.co';
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const LABEL = opt('--label'), BATCH_ID = opt('--batch-id'), EVIDENCE = opt('--evidence'), EXECUTE = argv.includes('--execute');
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const norm = (v) => (v == null ? null : String(v).trim().toLocaleLowerCase('en-US'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const uuidFrom = (value) => { const hex = sha(value).slice(0, 32).split(''); hex[12] = '5'; hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4]; return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`; };
const stop = (m) => { throw new Error(`STOP: ${m}`); };
const log = (m) => console.error(m);

if (!LABEL || !SNAPSHOT_PINS[LABEL] || !BATCH_ID || !EVIDENCE) throw new Error('usage: --label <snapshot> --batch-id <uuid> --evidence <file> [--execute]');
const URL_ = process.env.VNO_TARGET_URL, KEY = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error('VNO_TARGET_URL and VNO_TARGET_SERVICE_ROLE_KEY are required');
const host = new URL(URL_).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  if (host !== APPROVED_UAT_HOST) stop(`${host} is not the approved UAT project or a local clone`);
  if (process.env.VNO_ALLOW_REMOTE_REHEARSAL !== 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION') stop('remote target blocked: VNO_ALLOW_REMOTE_REHEARSAL is not set');
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const rest = async (route, o = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${route}`, { ...o, headers: { ...H, ...(o.headers || {}) }, signal: AbortSignal.timeout(60_000) });
  const t = await r.text(); if (!r.ok) throw new Error(`${o.method || 'GET'} ${route.split('?')[0]}: HTTP ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const all = async (route) => { const rows = []; for (let off = 0; ; off += 1000) { const r = await rest(`${route}${route.includes('?') ? '&' : '?'}limit=1000&offset=${off}`); rows.push(...r); if (r.length < 1000) break; } return rows; };

const snap = process.env.VNO_SNAPSHOT_DIR || SNAPSHOT_PINS[LABEL].dir;
const seal = await verifySealedSnapshot({ label: LABEL, snapshotDir: snap, tenant: TENANT });
if (lower(BATCH_ID) !== uuidFrom(`vno-${LABEL}:${seal.manifest_sha256}`)) stop('--batch-id is not the deterministic batch of the pinned snapshot');
const partners = readFileSync(path.join(snap, 'tables/Emos_MdmService/dbo.RestaurantMiddleman.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const remap = pinnedPartnerRemap(partners);
const [batch] = await rest(`legacy_migration_batches?select=id,status,source_inventory_sha256&id=eq.${lower(BATCH_ID)}`);
if (!batch || batch.source_inventory_sha256 !== seal.manifest_sha256 || !['loading', 'validating'].includes(batch.status)) stop('the approved batch is missing, not bound to the sealed manifest, or in an unexpected status');

const COLS = 'id,collaborators_code,collaborators_verified,collaborators_status,merchant_system_id,legacy_middleman_id,legacy_tenant_id,updated_at';
const before = await all(`collaborators?select=*&order=id`);
const byId = new Map(before.map((c) => [lower(c.id), c]));
const ids = remap.map((m) => m.legacy_id);
const txRefs = (await all(`referral_transactions?select=id,collaborator_id&collaborator_id=in.(${ids.join(',')})`)).length;
const state = remap.map((m) => {
  const c = byId.get(m.legacy_id);
  if (!c) stop(`Partner ${m.legacy_id} is not in the target`);
  if (lower(c.legacy_middleman_id) !== m.legacy_id || lower(c.legacy_tenant_id) !== TENANT) stop(`Partner ${m.legacy_id} is not owned by this tenant/legacy id`);
  if (c.collaborators_verified !== true || c.merchant_system_id !== null) stop(`Partner ${m.legacy_id} has unexpected verification/assignment state`);
  const phase = c.collaborators_code === m.original_code ? 'duplicate' : c.collaborators_code === m.replacement_code ? 'remediated' : stop(`Partner ${m.legacy_id} has unexpected code ${c.collaborators_code}`);
  return { ...m, phase };
});
const phases = new Set(state.map((s) => s.phase));
if (phases.size !== 1) stop('mixed remediation state (some Partners remediated, some not); not continuing automatically');
const phase = [...phases][0];
const codeCount = new Map(); for (const c of before) codeCount.set(norm(c.collaborators_code), (codeCount.get(norm(c.collaborators_code)) || 0) + 1);
const dupCodes = [...codeCount].filter(([, n]) => n > 1).map(([c]) => c).sort();
const expectedDup = phase === 'duplicate' ? [...new Set(remap.map((m) => norm(m.original_code)))].sort() : [];
if (JSON.stringify(dupCodes) !== JSON.stringify(expectedDup)) stop(`hosted duplicate codes are ${JSON.stringify(dupCodes)}, expected ${JSON.stringify(expectedDup)}`);
if (phase === 'duplicate' && remap.some((m) => codeCount.has(norm(m.replacement_code)))) stop('a replacement code is already used by another Partner');

const plan = { generated_utc: new Date().toISOString(), mode: EXECUTE ? 'execute' : 'plan', target: host, batch_id: lower(BATCH_ID), phase, partners_total: before.length,
  changes: remap.map((m) => ({ legacy_id: m.legacy_id, original_code: m.original_code, replacement_code: m.replacement_code })), transactions_referencing_affected_partners: txRefs, merchant_assignments: 0 };
log(JSON.stringify(plan));
let result = { ...plan, outcome: 'planned' };

if (EXECUTE && phase === 'duplicate') {
  writeFileSync(`${EVIDENCE}.pre-state.json`, JSON.stringify(remap.map((m) => byId.get(m.legacy_id)), null, 2), { mode: 0o600 });
  await rest('legacy_import_conflicts?on_conflict=import_batch_id,entity_type,legacy_id,reason_code', { method: 'POST', headers: { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(partnerConflictRows(remap, { batchId: lower(BATCH_ID), snapshotLabel: LABEL, v2IdByLegacy: new Map(remap.map((m) => [m.legacy_id, byId.get(m.legacy_id).id])), createdByLegacy: new Map(partners.map((p) => [lower(p.Id), p.CreationTime])) })) });
  for (const m of remap) {
    const patched = await rest(`collaborators?id=eq.${byId.get(m.legacy_id).id}&collaborators_code=eq.${encodeURIComponent(m.original_code)}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ collaborators_code: m.replacement_code }) });
    if (patched.length !== 1) stop(`compare-and-set updated ${patched.length} rows for ${m.legacy_id}`);
    log(`remapped ${m.legacy_id} ${m.original_code} -> ${m.replacement_code}`);
  }
}
if (EXECUTE) {
  const after = await all(`collaborators?select=*&order=id`);
  const afterById = new Map(after.map((c) => [lower(c.id), c]));
  const strip = (c) => { const { updated_at, ...rest_ } = c; return JSON.stringify(rest_, Object.keys(rest_).sort()); };
  const changedRows = before.filter((c) => strip(c) !== strip(afterById.get(lower(c.id)) || {})).map((c) => lower(c.id));
  const expectChanged = phase === 'duplicate' ? ids.slice().sort() : [];
  const otherColumnsEqual = remap.every((m) => { const b = { ...byId.get(m.legacy_id) }, a = { ...afterById.get(m.legacy_id) }; delete b.collaborators_code; delete a.collaborators_code; return strip(b) === strip(a); });
  const codes = new Map(); for (const c of after) codes.set(norm(c.collaborators_code), (codes.get(norm(c.collaborators_code)) || 0) + 1);
  const conflicts = await all(`legacy_import_conflicts?select=legacy_id,candidate_v2_id,resolution_status,evidence&entity_type=eq.collaborator&reason_code=eq.duplicate_collaborator_code&import_batch_id=eq.${lower(BATCH_ID)}`);
  const verify = {
    rows_unchanged_count: after.length === before.length,
    only_the_4_pinned_rows_changed: JSON.stringify(changedRows.sort()) === JSON.stringify(expectChanged),
    only_code_column_changed_on_those_rows: otherColumnsEqual,
    all_partner_codes_unique: [...codes.values()].every((n) => n === 1),
    replacement_codes_in_place: remap.every((m) => afterById.get(m.legacy_id).collaborators_code === m.replacement_code),
    audit_rows: conflicts.length === 4 && conflicts.every((c) => c.resolution_status === 'approved' && c.evidence?.original_code && c.evidence?.replacement_code && c.evidence?.sibling_v2_ids?.length === 1),
  };
  const pass = Object.values(verify).every(Boolean);
  result = { ...plan, outcome: pass ? 'PASS' : 'FAIL', verify };
  if (!pass) { writeFileSync(EVIDENCE, JSON.stringify(result, null, 2)); throw new Error(`STOP: post-verification failed ${JSON.stringify(verify)}`); }
}
writeFileSync(EVIDENCE, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ outcome: result.outcome, phase, changes: plan.changes.length }));
