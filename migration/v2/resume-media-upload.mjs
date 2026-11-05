#!/usr/bin/env node
// Bounded, media-only resume of an EXISTING sealed-snapshot import batch whose core relational/Auth import already completed
// but whose Storage uploads did not (e.g. the 2026-11-01 Snapshot-5 UAT import: UND_ERR_HEADERS_TIMEOUT after 16/602 objects).
//
// It never starts a batch, never touches any table other than media_assets (plus the batch status on --complete-batch), never
// creates Auth users, never overwrites a Storage object whose bytes differ, and treats the target's SHA-256 as the only truth.
//
// Usage:
//   resume-media-upload.mjs --label snapshot-5 --batch-id <uuid> [--execute] [--max-files N] [--max-bytes N] [--deadline-minutes N]
//                           [--max-object-bytes N] [--concurrency N] [--checkpoint file.jsonl] [--summary file.json] [--complete-batch]
// Default (no --execute) is a strictly read-only plan: seal + file verification, batch/identity preconditions, per-object state.
// Env: VNO_TARGET_URL, VNO_TARGET_SERVICE_ROLE_KEY, VNO_ALLOW_REMOTE_REHEARSAL=I_UNDERSTAND_THIS_IS_NOT_PRODUCTION (non-local only),
//      VNO_SNAPSHOT_DIR (optional, must still equal the pinned path), VNO_MEDIA_* (see media-upload.mjs).
// Exit: 0 all 602 complete, 2 bounded stop with verified progress, 1 STOP (precondition / mismatch / exhausted retries / mismatch).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SNAPSHOT_PINS, verifySealedSnapshot } from './snapshot-pins.mjs';
import { ensureObject, loadMediaConfig, planMediaAsset, MediaStopError, effectiveStatus } from './media-upload.mjs';

const TENANT = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';
const APPROVED_UAT_HOST = 'hsezyogfxgnkpweoqqny.supabase.co';
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const sha256 = (d) => createHash('sha256').update(d).digest('hex');
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v || '');
const uuidFrom = (value) => {
  const hex = sha256(value).slice(0, 32).split('');
  hex[12] = '5'; hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
};

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, fallback = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : fallback; };
const intOpt = (n) => { const v = opt(n); if (v == null) return null; const x = Number(v); if (!Number.isInteger(x) || x < 1) throw new Error(`${n} must be a positive integer`); return x; };
const LABEL = opt('--label');
const BATCH_ID = opt('--batch-id');
const EXECUTE = flag('--execute');
const COMPLETE_BATCH = flag('--complete-batch');
const MAX_FILES = intOpt('--max-files'), MAX_BYTES = intOpt('--max-bytes'), MAX_OBJECT_BYTES = intOpt('--max-object-bytes'), CONCURRENCY = intOpt('--concurrency') || 1, DEADLINE_MIN = intOpt('--deadline-minutes');
const CHECKPOINT = opt('--checkpoint'), SUMMARY = opt('--summary');
const stopAll = (msg) => { throw new MediaStopError('PRECONDITION', msg); };

const t0 = Date.now();
const log = (m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const checkpoint = (rec) => { if (CHECKPOINT) appendFileSync(CHECKPOINT, `${JSON.stringify({ ts: new Date().toISOString(), ...rec })}\n`, { mode: 0o600 }); };

class Target {
  constructor(url, key) {
    const u = new URL(url);
    const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
    if (!local) {
      if (u.hostname !== APPROVED_UAT_HOST) stopAll(`refusing: ${u.hostname} is not the approved UAT project or a local clone`);
      if (process.env.VNO_ALLOW_REMOTE_REHEARSAL !== 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION') stopAll('remote target blocked: VNO_ALLOW_REMOTE_REHEARSAL is not set');
    }
    this.url = url.replace(/\/$/, ''); this.headers = { apikey: key, Authorization: `Bearer ${key}` };
  }
  async rest(route, options = {}) {
    const res = await fetch(`${this.url}/rest/v1/${route}`, { ...options, headers: { ...this.headers, ...(options.headers || {}) }, signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${options.method || 'GET'} ${route.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  async all(route) {
    const rows = [];
    for (let off = 0; ; off += 1000) { const r = await this.rest(`${route}${route.includes('?') ? '&' : '?'}limit=1000&offset=${off}`); rows.push(...r); if (r.length < 1000) break; }
    return rows;
  }
  async withRetry(fn, what) { // small bounded retry for REST metadata calls (idempotent upserts / reads only)
    for (let a = 1; ; a++) {
      try { return await fn(); } catch (e) {
        if (a >= 4 || !/HTTP (408|425|429|5\d\d)|fetch failed|timeout|aborted/i.test(String(e.message + (e.cause?.code || '')))) throw e;
        const d = 500 * 2 ** a * (0.5 + Math.random() / 2); log(`  retry ${what} in ${Math.round(d)}ms: ${e.message.slice(0, 100)}`); await new Promise((r) => setTimeout(r, d));
      }
    }
  }
}

const jsonl = async (snap, db, t) => (await readFile(path.join(snap, 'tables', db, `dbo.${t}.jsonl`), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const same = (a, b) => (a ?? null) === (b ?? null) || String(a ?? '') === String(b ?? '');

async function main() {
  if (!LABEL || !SNAPSHOT_PINS[LABEL]) throw new Error(`--label must be one of ${Object.keys(SNAPSHOT_PINS).join(', ')}`);
  if (!BATCH_ID || !isUuid(BATCH_ID)) throw new Error('--batch-id <uuid> is required');
  if (!process.env.VNO_TARGET_URL || !process.env.VNO_TARGET_SERVICE_ROLE_KEY) throw new Error('VNO_TARGET_URL and VNO_TARGET_SERVICE_ROLE_KEY are required');
  if (CONCURRENCY > 16) throw new Error('--concurrency must be 1..16');
  if (COMPLETE_BATCH && !EXECUTE) throw new Error('--complete-batch requires --execute');
  const cfg = loadMediaConfig();
  const target = new Target(process.env.VNO_TARGET_URL, process.env.VNO_TARGET_SERVICE_ROLE_KEY);
  const snap = process.env.VNO_SNAPSHOT_DIR || SNAPSHOT_PINS[LABEL].dir;
  log(`mode=${EXECUTE ? 'EXECUTE' : 'PLAN (read-only)'} label=${LABEL} batch=${BATCH_ID} target=${new URL(target.url).hostname} cfg=${JSON.stringify(cfg)}`);

  // 1. sealed snapshot + every media file against the sealed checksums (before any write)
  const seal = await verifySealedSnapshot({ label: LABEL, snapshotDir: snap, tenant: TENANT });
  const expectedBatch = uuidFrom(`vno-${LABEL}:${seal.manifest_sha256}`);
  if (lower(BATCH_ID) !== expectedBatch) stopAll(`--batch-id is not the deterministic batch of ${LABEL} (${expectedBatch}); a new batch is never started here`);
  const csv = (await readFile(path.join(snap, 'media-checksums.csv'), 'utf8')).split('\n').filter(Boolean);
  const headers = csv.shift().split(',').map((v) => v.trim());
  const records = csv.map((line) => { const v = line.split(',').map((x) => x.trim()); return Object.fromEntries(headers.map((h, i) => [h, v[i]])); });
  let verifiedBytes = 0;
  for (const m of records) {
    const bytes = await readFile(path.join(snap, m.relative_file));
    if (bytes.length !== Number(m.bytes) || sha256(bytes) !== m.sha256) stopAll(`source media hash mismatch: ${m.source_id}`);
    verifiedBytes += bytes.length;
  }
  log(`seal OK (${seal.tracked_files} tracked files); ${records.length} source media files re-hashed (${verifiedBytes} bytes)`);
  if (new Set(records.map((m) => lower(m.source_id))).size !== records.length) stopAll('duplicate source_id in media-checksums.csv');

  // 2. batch + core import preconditions
  const [batch] = await target.rest(`legacy_migration_batches?select=id,legacy_tenant_id,status,source_inventory_sha256,notes&id=eq.${expectedBatch}`);
  if (!batch) stopAll('the approved batch does not exist in the target; media resume is only for an existing batch');
  if (lower(batch.legacy_tenant_id) !== TENANT || batch.source_inventory_sha256 !== seal.manifest_sha256) stopAll('batch tenant/manifest hash does not match the sealed snapshot');
  if (!['loading', 'validating'].includes(batch.status)) stopAll(`batch status is '${batch.status}', expected loading or validating`);
  const [restaurants, partners, images] = await Promise.all([jsonl(snap, 'Emos_MdmService', 'Restaurant'), jsonl(snap, 'Emos_MdmService', 'RestaurantMiddleman'), jsonl(snap, 'Emos_MdmService', 'MerchantImages')]);
  const tMerchants = await target.all(`merchant_details?select=merchant_system_id,legacy_restaurant_id&legacy_tenant_id=eq.${TENANT}`);
  const tPartners = await target.all(`collaborators?select=id,legacy_middleman_id&legacy_tenant_id=eq.${TENANT}`);
  if (tMerchants.length !== restaurants.length || tPartners.length !== partners.length) stopAll(`core import incomplete: merchants ${tMerchants.length}/${restaurants.length}, partners ${tPartners.length}/${partners.length}`);
  const merchantId = new Map(tMerchants.map((m) => [lower(m.legacy_restaurant_id), m.merchant_system_id]));
  const collaboratorId = new Map(tPartners.map((p) => [lower(p.legacy_middleman_id), p.id]));
  const imageByName = new Map(images.map((r) => [lower(r.ImageId), r]));
  const partnerByImage = new Map(partners.filter((r) => r.Image).map((r) => [lower(r.Image), r]));
  const existingRows = new Map((await target.all(`media_assets?select=*&legacy_tenant_id=eq.${TENANT}`)).map((r) => [lower(r.id), r]));
  log(`batch ${batch.status}; target core OK (merchants ${tMerchants.length}, partners ${tPartners.length}); media_assets rows for tenant: ${existingRows.size}`);

  // 3. per-record plan; existing rows must equal the plan (also proves this resume path builds the importer's rows exactly)
  const plan = [];
  for (const m of records) {
    const p = planMediaAsset(m, { merchantImage: imageByName.get(lower(m.source_name)), partner: partnerByImage.get(lower(m.source_name)), merchantId, collaboratorId, tenant: TENANT, lower, isUuid });
    if (p.row.merchant_id === undefined && imageByName.get(lower(m.source_name))) stopAll(`merchant for media ${m.source_id} is not in the target`);
    if (p.row.collaborator_id === undefined && partnerByImage.get(lower(m.source_name))) stopAll(`partner for media ${m.source_id} is not in the target`);
    const have = existingRows.get(p.row.id);
    if (have) {
      const diff = Object.keys(p.row).filter((k) => !same(p.row[k], have[k]));
      if (diff.length) stopAll(`existing media_assets row ${p.row.id} differs from the sealed plan in: ${diff.join(', ')}; refusing to overwrite`);
    }
    plan.push({ m, p, rowExists: Boolean(have) });
  }
  const unknownRows = [...existingRows.keys()].filter((id) => !plan.some((x) => x.p.row.id === id));
  if (unknownRows.length) stopAll(`${unknownRows.length} tenant media_assets rows are not in the sealed snapshot`);

  // 4. execute (or read-only classify)
  const stats = { total: plan.length, skipped_complete: 0, uploaded: 0, rows_inserted: 0, absent: 0, deferred_large: 0, identical_object_only: 0, bytes_uploaded: 0, retries: 0 };
  const deadline = DEADLINE_MIN ? t0 + DEADLINE_MIN * 60_000 : null;
  let done = 0, stoppedBy = null, filesThisRun = 0, fatal = null;
  const processItem = async (i, { m, p, rowExists }) => {
    const bytes = await readFile(path.join(snap, m.relative_file));
    if (!EXECUTE) {
      // read-only classification: object state is probed with GET, never written
      const r = await fetch(`${target.url}/storage/v1/object/${p.bucket}/${p.objectPath.split('/').map(encodeURIComponent).join('/')}`, { headers: target.headers, signal: AbortSignal.timeout(120_000) });
      if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (sha256(b) !== m.sha256 || b.length !== bytes.length) stopAll(`object ${p.bucket}/${p.objectPath} exists with different content`); rowExists ? stats.skipped_complete++ : stats.identical_object_only++; }
      else { const body = await r.text(); if (!/object not found|not_found/i.test(body) || effectiveStatus(r.status, body) >= 500) stopAll(`probe ${r.status} ${body.slice(0, 120)}`); stats.absent++; if (rowExists) stopAll(`row ${p.row.id} exists but its object is missing`); }
      return;
    }
    if (MAX_OBJECT_BYTES && bytes.length > MAX_OBJECT_BYTES && !rowExists) { stats.deferred_large++; return; } // deferred, not skipped: the run is reported as bounded
    // Bounds are checked before an item starts; with --concurrency N up to N-1 already-started items may finish past the bound.
    if (MAX_FILES && filesThisRun >= MAX_FILES) { stoppedBy ||= `--max-files ${MAX_FILES}`; return; }
    if (MAX_BYTES && stats.bytes_uploaded + bytes.length > MAX_BYTES && filesThisRun > 0) { stoppedBy ||= `--max-bytes ${MAX_BYTES}`; return; }
    if (deadline && Date.now() > deadline) { stoppedBy ||= `--deadline-minutes ${DEADLINE_MIN}`; return; }
    if (!rowExists) filesThisRun++; // reserve the slot now so concurrent workers respect --max-files; verified-complete items are not "new work"
    const start = Date.now();
    let result;
    try {
      result = await ensureObject({ baseUrl: target.url, headers: target.headers, bucket: p.bucket, objectPath: p.objectPath, bytes, mime: m.detected_mime, sha256: m.sha256, cfg, log });
    } catch (e) {
      checkpoint({ id: p.row.id, bucket: p.bucket, object_path: p.objectPath, status: 'STOPPED', code: e.code || 'ERROR', message: String(e.message).slice(0, 300), index: i + 1 });
      throw e;
    }
    if (!rowExists) { await target.withRetry(() => target.rest('media_assets?on_conflict=id', { method: 'POST', headers: { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([p.row]) }), 'media_assets upsert'); stats.rows_inserted++; }
    stats.retries += Math.max(0, result.attempts - 1);
    if (result.outcome === 'uploaded') { stats.uploaded++; stats.bytes_uploaded += bytes.length; } else stats.skipped_complete++;
    done++;
    checkpoint({ id: p.row.id, bucket: p.bucket, object_path: p.objectPath, sha256: m.sha256, bytes: bytes.length, status: result.outcome, attempts: result.attempts, row_inserted: !rowExists, ms: Date.now() - start, index: i + 1 });
    log(`${i + 1}/${plan.length} ${result.outcome}${rowExists ? '' : '+row'} ${p.bucket}/${p.objectPath} ${bytes.length}B attempts=${result.attempts} ${Date.now() - start}ms (done ${done}, uploaded ${stats.uploaded}, ${(stats.bytes_uploaded / 1048576).toFixed(1)} MiB)`);
  };
  // Bounded worker pool. Any non-retryable error stops all workers from taking new items (in-flight ones finish or time out); the first error is rethrown.
  const queue = plan.entries();
  const worker = async () => {
    for (;;) {
      if (fatal || stoppedBy) return;
      const next = queue.next();
      if (next.done) return;
      try { await processItem(next.value[0], next.value[1]); } catch (e) { fatal ||= e; return; }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (fatal) throw fatal;

  if (EXECUTE && stats.deferred_large && !stoppedBy) stoppedBy = `--max-object-bytes ${MAX_OBJECT_BYTES} (${stats.deferred_large} larger objects deferred)`;

  // 5. final verification (execute): every row exists and the object bytes match, before touching the batch
  let finalCheck = null, batchCompleted = false;
  if (EXECUTE) {
    const rows = await target.all(`media_assets?select=id,sha256_hex,size_bytes,bucket_id,object_path&legacy_tenant_id=eq.${TENANT}`);
    const byId = new Map(rows.map((r) => [lower(r.id), r]));
    const missing = plan.filter(({ p }) => !byId.has(p.row.id)).length;
    finalCheck = { rows: rows.length, expected: plan.length, rows_missing: missing };
    if (!stoppedBy && missing === 0 && rows.length === plan.length) {
      let bad = 0;
      for (const { m, p } of plan) {
        const r = await fetch(`${target.url}/storage/v1/object/${p.bucket}/${p.objectPath.split('/').map(encodeURIComponent).join('/')}`, { headers: target.headers, signal: AbortSignal.timeout(120_000) });
        const b = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
        if (!b || sha256(b) !== m.sha256 || b.length !== Number(m.bytes)) bad++;
      }
      finalCheck.objects_mismatched_or_missing = bad;
      if (bad === 0 && COMPLETE_BATCH) {
        await target.withRetry(() => target.rest(`legacy_migration_batches?id=eq.${expectedBatch}`, { method: 'PATCH', headers: { 'content-type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'validating' }) }), 'batch status');
        batchCompleted = true;
      }
    }
  }

  const complete = EXECUTE ? (finalCheck.rows === plan.length && finalCheck.objects_mismatched_or_missing === 0) : false;
  const summary = { generated_utc: new Date().toISOString(), mode: EXECUTE ? 'execute' : 'plan', label: LABEL, batch_id: expectedBatch, manifest_sha256: seal.manifest_sha256,
    source_files_verified: records.length, source_bytes_verified: verifiedBytes, stats, bounded_stop: stoppedBy, final_check: finalCheck, batch_completed: batchCompleted,
    all_602_complete: complete, elapsed_s: Math.round((Date.now() - t0) / 1000) };
  if (SUMMARY) writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(!EXECUTE ? 0 : complete ? 0 : stoppedBy ? 2 : 1);
}

main().catch((e) => {
  const stop = e instanceof MediaStopError;
  console.error(`STOP ${stop ? e.code : 'ERROR'}: ${e.message}`);
  const summary = { generated_utc: new Date().toISOString(), outcome: 'STOPPED', code: stop ? e.code : 'ERROR', message: e.message, detail: e.detail || null };
  if (SUMMARY) { try { writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 }); } catch { /* best effort */ } }
  console.log(JSON.stringify(summary, null, 2));
  process.exit(1);
});
