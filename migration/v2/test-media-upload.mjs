#!/usr/bin/env node
// Hermetic tests for media-upload.mjs against an in-process fake Storage server with injectable faults.
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ensureObject, MediaStopError, backoffMs, parseRetryAfter, effectiveStatus, loadMediaConfig, requestTimeoutFor, planMediaAsset } from './media-upload.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const objects = new Map();           // key -> Buffer
let faults = [];                     // queue of fault names applied to successive POSTs ('ok' passes through)
let getFaults = [];
const calls = [];
const server = http.createServer(async (req, res) => {
  const key = decodeURIComponent(req.url.replace('/storage/v1/object/', ''));
  const chunks = []; for await (const c of req) chunks.push(c);
  calls.push({ method: req.method, key, upsert: req.headers['x-upsert'] });
  const send = (code, body, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...extra }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  if (req.method === 'GET') {
    const f = getFaults.shift();
    if (f === '503') return send(503, 'down');
    if (objects.has(key)) { res.writeHead(200); return res.end(objects.get(key)); }
    return send(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
  }
  const f = faults.shift() || 'ok';
  if (f === 'stall') return;                                            // never answers: client per-request timeout
  if (f === 'reset') return req.socket.destroy();                       // connection reset before response
  if (f === 'stored-then-reset') { objects.set(key, Buffer.concat(chunks)); return req.socket.destroy(); }   // write landed, response lost
  if (f === '503') return send(503, 'unavailable');
  if (f === '429') return send(429, 'slow down', { 'retry-after': '2' });
  if (f === '413') return send(400, { statusCode: '413', error: 'Payload too large', message: 'too big' });
  if (f === '403') return send(403, 'denied');
  if (f === 'dup409') { objects.set(key, Buffer.concat(chunks)); return send(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }); }
  if (req.headers['x-upsert'] !== 'false') return send(500, 'test: upsert must be false');
  if (objects.has(key)) return send(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
  objects.set(key, Buffer.concat(chunks)); send(200, { Key: key });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const bytes = Buffer.from('image-bytes-'.repeat(50)); const digest = sha(bytes);
const cfg = { requestTimeoutMs: 1000, perMbTimeoutMs: 0, maxAttempts: 4, backoffBaseMs: 10, backoffMaxMs: 40, maxRetryAfterMs: 5000 };
const sleeps = []; const sleep = async (ms) => { sleeps.push(ms); };
const run = (over = {}) => ensureObject({ baseUrl: base, headers: { apikey: 'k' }, bucket: 'b', objectPath: 'legacy-x/db/id.jpg', bytes, mime: 'image/jpeg', sha256: digest, cfg, sleep, ...over });
const reset = () => { objects.clear(); faults = []; getFaults = []; calls.length = 0; sleeps.length = 0; };
let n = 0; const t = async (name, fn) => { reset(); try { await fn(); n++; console.log(`PASS ${name}`); } catch (e) { console.error(`FAIL ${name}\n`, e); process.exitCode = 1; } };

await t('uploads an absent object with x-upsert:false and reads it back', async () => {
  const r = await run(); assert.equal(r.outcome, 'uploaded'); assert.equal(r.attempts, 1);
  assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => c.upsert), ['false']); assert.ok(objects.has('b/legacy-x/db/id.jpg'));
});
await t('identical existing object is skipped without any POST', async () => {
  objects.set('b/legacy-x/db/id.jpg', bytes); const r = await run();
  assert.equal(r.outcome, 'skipped_identical'); assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});
await t('MISMATCH: different existing object is never overwritten', async () => {
  objects.set('b/legacy-x/db/id.jpg', Buffer.from('other')); await assert.rejects(run(), (e) => e instanceof MediaStopError && e.code === 'MISMATCH');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0); assert.equal(objects.get('b/legacy-x/db/id.jpg').toString(), 'other');
});
await t('hung request times out per-request, then succeeds on retry', async () => {
  faults = ['stall']; const r = await run({ cfg: { ...cfg, requestTimeoutMs: 150 } }); assert.equal(r.outcome, 'uploaded'); assert.equal(r.attempts, 2);
  assert.ok(r.events.some((e) => e.event === 'transient-error'));
});
await t('connection reset and 503 are retried with bounded backoff', async () => {
  faults = ['reset', '503']; const r = await run(); assert.equal(r.attempts, 3); assert.equal(sleeps.length, 2); assert.ok(sleeps.every((s) => s <= cfg.backoffMaxMs));
});
await t('write landed but response lost: next attempt finds identical object, no second POST', async () => {
  faults = ['stored-then-reset']; const r = await run(); assert.equal(r.outcome, 'uploaded'); assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
});
await t('429 honours Retry-After (capped) and then succeeds', async () => {
  faults = ['429']; const r = await run(); assert.equal(r.attempts, 2); assert.ok(sleeps[0] >= 2000 && sleeps[0] <= 5000, `sleep ${sleeps[0]}`); assert.ok(r.events.some((e) => e.event === 'rate-limited'));
});
await t('409 duplicate re-probes: identical -> success, no overwrite', async () => {
  faults = ['dup409']; const r = await run(); assert.equal(r.outcome, 'uploaded'); assert.equal(sleeps[0] ?? 0, 0);
});
await t('non-retryable 413 / 403 stop immediately', async () => {
  faults = ['413']; await assert.rejects(run(), (e) => e.code === 'REJECTED' && e.detail.status === 413); assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  reset(); faults = ['403']; await assert.rejects(run(), (e) => e.code === 'AUTH');
});
await t('retries are bounded: EXHAUSTED after maxAttempts', async () => {
  faults = ['503', '503', '503', '503', '503']; await assert.rejects(run(), (e) => e.code === 'EXHAUSTED'); assert.equal(calls.filter((c) => c.method === 'POST').length, cfg.maxAttempts);
});
await t('transient probe failure (GET 503) is retried', async () => {
  getFaults = ['503']; const r = await run(); assert.equal(r.outcome, 'uploaded'); assert.ok(r.attempts >= 2);
});
await t('helpers: backoff jitter bounds, Retry-After parsing, status normalisation, config validation, timeout scaling', async () => {
  const c = { backoffBaseMs: 1000, backoffMaxMs: 8000 };
  for (let a = 1; a <= 8; a++) { const cap = Math.min(8000, 1000 * 2 ** (a - 1)); const lo = backoffMs(a, c, () => 0), hi = backoffMs(a, c, () => 0.999999); assert.equal(lo, cap / 2); assert.ok(hi <= cap && hi > lo); }
  assert.equal(parseRetryAfter('3'), 3000); assert.equal(parseRetryAfter(null), null); assert.equal(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT', Date.parse('2015-10-21T07:27:50Z')), 10000);
  assert.equal(effectiveStatus(400, '{"statusCode":"409"}'), 409); assert.equal(effectiveStatus(500, '{"statusCode":"409"}'), 500); assert.equal(effectiveStatus(400, 'plain'), 400);
  assert.throws(() => loadMediaConfig({ VNO_MEDIA_MAX_ATTEMPTS: '0' })); assert.throws(() => loadMediaConfig({ VNO_MEDIA_BACKOFF_BASE_MS: '9000', VNO_MEDIA_BACKOFF_MAX_MS: '10' }));
  assert.equal(loadMediaConfig({ VNO_MEDIA_REQUEST_TIMEOUT_MS: '5000' }).requestTimeoutMs, 5000);
  assert.equal(requestTimeoutFor({ requestTimeoutMs: 1000, perMbTimeoutMs: 500 }, 3 * 1048576), 2500);
});
await t('planMediaAsset produces the importer row shape (merchant / partner / unreferenced)', async () => {
  const lower = (v) => (v == null ? null : String(v).toLowerCase()); const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v || '');
  const ctx = (o) => ({ merchantId: new Map([['r1', 'M1']]), collaboratorId: new Map([['p1', 'P1']]), tenant: 'T', lower, isUuid, ...o });
  const base = { database: 'Emos_MdmService', source_id: 'AAAAAAAA-0000-0000-0000-000000000001', source_name: 'aaaaaaaa-0000-0000-0000-000000000002', detected_mime: 'image/png', sha256: 'h', bytes: '5' };
  const a = planMediaAsset({ ...base, provenance: 'merchant' }, ctx({ merchantImage: { ResId: 'R1', Id: 'I1', IsHero: true, Order: 2 } }));
  assert.equal(a.bucket, 'merchant-media'); assert.equal(a.objectPath, 'legacy-merchant/Emos_MdmService/aaaaaaaa-0000-0000-0000-000000000001.png'); assert.equal(a.row.merchant_id, 'M1'); assert.equal(a.row.is_hero, true); assert.equal(a.row.legacy_merchant_image_id, 'i1');
  const b = planMediaAsset({ ...base, provenance: 'partner', detected_mime: 'image/jpeg' }, ctx({ partner: { Id: 'P1' } })); assert.equal(b.bucket, 'partner-media'); assert.equal(b.row.collaborator_id, 'P1'); assert.ok(b.objectPath.endsWith('.jpg'));
  const c = planMediaAsset({ ...base, provenance: 'unreferenced' }, ctx({})); assert.equal(c.row.merchant_id, null); assert.ok(c.objectPath.startsWith('legacy-unreferenced/'));
});
server.close(); console.log(`${n} passed`);
