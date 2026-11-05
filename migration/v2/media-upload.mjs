// Resilient, identity- and SHA-256-based Storage object upload shared by the sealed-snapshot importer and the media-only
// resume tool. Design rules (see docs/V1_V2_SNAPSHOT5_MEDIA_RECOVERY_*.md):
//  * the target object's SHA-256 is the only source of truth: identical -> skip, absent -> upload, different -> STOP (never overwrite);
//  * uploads use x-upsert:false, so a stale or concurrent object can never be replaced;
//  * after any timeout/network error the next attempt re-probes first, because the server may have completed the write;
//  * transient failures (timeouts, resets, 408/425/5xx) and rate limits (429, Retry-After honoured) are retried with bounded,
//    exponentially backed-off, jittered delays; everything else is a non-retryable MediaStopError.
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

// Observed 2026-11-01 on hosted UAT: upload throughput is throttled to ~11-33 KB/s PER CONNECTION (aggregate scales with parallel
// connections), so a 10 MiB object needs > 300 s. The defaults assume >= ~17 KB/s per connection; override per run if needed.
export const DEFAULT_MEDIA_CONFIG = Object.freeze({
  requestTimeoutMs: 120_000,  // per HTTP request, base
  perMbTimeoutMs: 60_000,     // added per started MiB of payload
  maxAttempts: 6,             // per object
  backoffBaseMs: 1_000,
  backoffMaxMs: 60_000,
  maxRetryAfterMs: 120_000,
});

const intEnv = (env, name, fallback, min, max) => {
  if (env[name] == null || env[name] === '') return fallback;
  const n = Number(env[name]);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  return n;
};
export function loadMediaConfig(env = process.env) {
  const d = DEFAULT_MEDIA_CONFIG;
  const cfg = {
    requestTimeoutMs: intEnv(env, 'VNO_MEDIA_REQUEST_TIMEOUT_MS', d.requestTimeoutMs, 1_000, 600_000),
    perMbTimeoutMs: intEnv(env, 'VNO_MEDIA_PER_MB_TIMEOUT_MS', d.perMbTimeoutMs, 0, 300_000),
    maxAttempts: intEnv(env, 'VNO_MEDIA_MAX_ATTEMPTS', d.maxAttempts, 1, 20),
    backoffBaseMs: intEnv(env, 'VNO_MEDIA_BACKOFF_BASE_MS', d.backoffBaseMs, 0, 60_000),
    backoffMaxMs: intEnv(env, 'VNO_MEDIA_BACKOFF_MAX_MS', d.backoffMaxMs, 0, 600_000),
    maxRetryAfterMs: d.maxRetryAfterMs,
  };
  if (cfg.backoffMaxMs < cfg.backoffBaseMs) throw new Error('VNO_MEDIA_BACKOFF_MAX_MS must be >= VNO_MEDIA_BACKOFF_BASE_MS');
  return cfg;
}

/** Non-retryable condition: the caller must stop the whole run, not just this object. */
export class MediaStopError extends Error {
  constructor(code, message, detail = {}) { super(`${code}: ${message}`); this.name = 'MediaStopError'; this.code = code; this.detail = detail; }
}

const keepAliveAgents = { 'http:': new http.Agent({ keepAlive: true, maxSockets: 32 }), 'https:': new https.Agent({ keepAlive: true, maxSockets: 32 }) };
/**
 * Minimal fetch-compatible transport on node:http(s). Unlike the global (undici) fetch it has NO hidden 300 s response-headers
 * timeout: the only time limit is the caller's AbortSignal, which is what lets a slow-but-progressing 10 MiB upload finish.
 */
export function nodeFetch(url, { method = 'GET', headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const h = { ...headers };
    if (body != null) h['content-length'] = Buffer.byteLength(body);
    const req = (u.protocol === 'https:' ? https : http).request(u, { method, headers: h, agent: keepAliveAgents[u.protocol] }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('close', () => { if (!res.complete) reject(new Error('response aborted')); });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
          headers: { get: (n) => { const v = res.headers[String(n).toLowerCase()]; return Array.isArray(v) ? v.join(', ') : v ?? null; } },
          arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), text: async () => buf.toString('utf8') });
      });
    });
    const onAbort = () => req.destroy(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    if (signal) {
      if (signal.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => signal.removeEventListener('abort', onAbort));
    }
    req.on('error', reject);
    req.end(body);
  });
}

const RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504]);
export const isRateLimited = (status) => status === 429;
export const isRetryableStatus = (status) => RETRYABLE_STATUS.has(status);

/** Decimal-seconds or HTTP-date Retry-After -> ms (null when absent/unparseable). */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  if (/^\d+(\.\d+)?$/.test(String(value).trim())) return Math.round(Number(value) * 1000);
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

/** Equal-jitter exponential backoff: half the capped exponential delay plus a random half. attempt is 1-based (the attempt that just failed). */
export function backoffMs(attempt, cfg, rand = Math.random) {
  const cap = Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * 2 ** (attempt - 1));
  return Math.round(cap / 2 + rand() * (cap / 2));
}

export const requestTimeoutFor = (cfg, bytes) => cfg.requestTimeoutMs + Math.ceil(bytes / 1_048_576) * cfg.perMbTimeoutMs;

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
const objectUrl = (base, bucket, objectPath) => `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(objectPath)}`;
const isNotFound = (status, body) => (status === 400 || status === 404) && /object not found|"not_found"/i.test(body) && !/bucket not found/i.test(body);
// Supabase Storage reports many errors as HTTP 400 with the real status in the JSON body ({"statusCode":"409",...}).
export function effectiveStatus(status, body) {
  if (status !== 400) return status;
  try { const n = Number(JSON.parse(body).statusCode); return Number.isInteger(n) && n >= 400 && n < 600 ? n : status; } catch { return status; }
}
const describe = (e) => (e && e.cause && (e.cause.code || e.cause.message)) || (e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'request timeout' : e && e.message) || String(e);

/**
 * Ensure the Storage object exists with exactly these bytes.
 * Returns { outcome: 'skipped_identical' | 'uploaded', attempts, events }.
 * Throws MediaStopError for: MISMATCH (a different object is already there), AUTH, REJECTED (non-retryable HTTP), EXHAUSTED.
 */
export async function ensureObject({ baseUrl, headers, bucket, objectPath, bytes, mime, sha256, cfg = DEFAULT_MEDIA_CONFIG,
  fetchImpl = nodeFetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), rand = Math.random, log = () => {} }) {
  const url = objectUrl(baseUrl, bucket, objectPath);
  const timeoutMs = requestTimeoutFor(cfg, bytes.length);
  const events = [];
  let lastError = null;

  const probe = async () => { // 'absent' | 'identical'; throws MediaStopError(MISMATCH|AUTH) or a retryable Error
    const res = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === bytes.length && sha256Hex(buf) === sha256) return 'identical';
      throw new MediaStopError('MISMATCH', `${bucket}/${objectPath} already exists with different content; refusing to overwrite`,
        { bucket, objectPath, existing_bytes: buf.length, existing_sha256: sha256Hex(buf), expected_bytes: bytes.length, expected_sha256: sha256 });
    }
    const body = await res.text();
    if (isNotFound(res.status, body)) return 'absent';
    if (res.status === 401 || res.status === 403) throw new MediaStopError('AUTH', `probe ${res.status}`, { status: res.status });
    const err = new Error(`probe HTTP ${res.status} ${body.slice(0, 160)}`);
    err.status = res.status; err.retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
    if (!isRetryableStatus(res.status) && !isRateLimited(res.status)) throw new MediaStopError('REJECTED', `probe ${res.status} ${body.slice(0, 160)}`, { status: res.status });
    throw err;
  };

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    let waitMs = null;
    try {
      if ((await probe()) === 'identical') { events.push({ attempt, event: 'identical' }); return { outcome: attempt === 1 ? 'skipped_identical' : 'uploaded', attempts: attempt, events }; }
      const res = await fetchImpl(url, { method: 'POST', headers: { ...headers, 'content-type': mime, 'x-upsert': 'false' }, body: bytes, signal: AbortSignal.timeout(timeoutMs) });
      const body = await res.text();
      const status = res.ok ? res.status : effectiveStatus(res.status, body);
      if (res.ok) {
        if ((await probe()) !== 'identical') throw new MediaStopError('MISMATCH', `${bucket}/${objectPath} not readable back after upload`, { bucket, objectPath });
        events.push({ attempt, event: 'uploaded' });
        return { outcome: 'uploaded', attempts: attempt, events };
      }
      if (status === 409) { events.push({ attempt, event: 'conflict-reprobe' }); lastError = new Error('409 object exists'); waitMs = 0; }
      else if (status === 401 || status === 403) throw new MediaStopError('AUTH', `upload ${status} ${body.slice(0, 160)}`, { status });
      else if (isRateLimited(status) || isRetryableStatus(status)) {
        lastError = new Error(`upload HTTP ${status} ${body.slice(0, 160)}`);
        waitMs = isRateLimited(status) ? Math.min(cfg.maxRetryAfterMs, Math.max(parseRetryAfter(res.headers?.get?.('retry-after')) ?? 0, backoffMs(attempt, cfg, rand))) : null;
        events.push({ attempt, event: isRateLimited(status) ? 'rate-limited' : 'transient-http', status });
      } else throw new MediaStopError('REJECTED', `upload ${status} ${body.slice(0, 200)}`, { status, bucket, objectPath });
    } catch (e) {
      if (e instanceof MediaStopError) throw e;
      lastError = e;
      waitMs = isRateLimited(e.status) ? Math.min(cfg.maxRetryAfterMs, Math.max(e.retryAfterMs ?? 0, backoffMs(attempt, cfg, rand))) : null;
      events.push({ attempt, event: 'transient-error', error: describe(e) });
    }
    if (attempt === cfg.maxAttempts) break;
    const delay = waitMs ?? backoffMs(attempt, cfg, rand);
    log(`  retry ${attempt}/${cfg.maxAttempts - 1} for ${bucket}/${objectPath} in ${delay}ms (${describe(lastError)})`);
    await sleep(delay);
  }
  throw new MediaStopError('EXHAUSTED', `${bucket}/${objectPath} failed after ${cfg.maxAttempts} attempts: ${describe(lastError)}`, { bucket, objectPath, events });
}

/** The importer's media_assets row + storage location for one sealed media-checksums.csv record. One definition for both code paths. */
export function planMediaAsset(media, { merchantImage, partner, merchantId, collaboratorId, tenant, lower, isUuid }) {
  const bucket = partner ? 'partner-media' : 'merchant-media';
  const extension = media.detected_mime === 'image/png' ? 'png' : media.detected_mime === 'image/webp' ? 'webp' : 'jpg';
  const kind = media.provenance === 'cms' ? 'legacy-cms' : media.provenance === 'unreferenced' ? 'legacy-unreferenced' : `legacy-${media.provenance}`;
  const objectPath = `${kind}/${media.database}/${lower(media.source_id)}.${extension}`;
  const row = { id: lower(media.source_id),
    legacy_image_id: isUuid(media.source_name) ? lower(media.source_name) : null,
    legacy_blob_id: lower(media.source_id), legacy_tenant_id: tenant,
    merchant_id: merchantImage ? merchantId.get(lower(merchantImage.ResId)) : null,
    collaborator_id: partner ? collaboratorId.get(lower(partner.Id)) : null,
    bucket_id: bucket, object_path: objectPath, original_filename: media.source_name,
    mime_type: media.detected_mime, sha256_hex: media.sha256, size_bytes: Number(media.bytes),
    is_hero: merchantImage?.IsHero || false, display_order: merchantImage?.Order || 0,
    transfer_status: 'verified', publication_status: 'legacy_effective',
    approved_by: null, approved_at: null,
    legacy_merchant_image_id: merchantImage ? lower(merchantImage.Id) : null,
    legacy_blob_database: media.database, legacy_blob_name: media.source_name };
  return { bucket, objectPath, row };
}
