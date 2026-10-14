#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto';

const url = process.env.VNO_TARGET_URL;
const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('VNO_TARGET_URL and VNO_TARGET_SERVICE_ROLE_KEY are required');
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) {
  throw new Error('rollback rehearsal must target an isolated local Supabase instance');
}

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const tenantId = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';
const testId = randomUUID();
const objectPath = `d4-rollback-test/${testId}.bin`;
const testBytes = randomBytes(4096);
const testBytesSha256 = createHash('sha256').update(testBytes).digest('hex');
const testEmail = `vno-d4-rollback-${testId}@example.invalid`;
const testPassword = `D4!${randomBytes(24).toString('base64url')}`;
let authUserId = null;
let objectCreated = false;
let batchCreated = false;

const stableHash = (value) => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex');

async function request(route, options = {}) {
  const response = await fetch(`${url}${route}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* binary/text response */ }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${route}: HTTP ${response.status}`);
  return { response, body };
}

async function allRows(table, select) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await request(`/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${select.split(',')[0]}.asc&offset=${offset}&limit=1000`);
    rows.push(...result.body);
    if (result.body.length < 1000) return rows;
  }
}

async function authInventory() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const result = await request(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    const batch = result.body.users || [];
    users.push(...batch.map(({ id, email }) => ({ id, email })).sort((a, b) => a.id.localeCompare(b.id)));
    if (batch.length < 1000) break;
  }
  return users;
}

async function listStorage(bucket, prefix = '') {
  const output = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await request(`/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    for (const item of result.body) {
      if (item.id == null) output.push(...await listStorage(bucket, `${prefix}${item.name}/`));
      else output.push({ name: `${prefix}${item.name}`, id: item.id, size: item.metadata?.size ?? null });
    }
    if (result.body.length < 1000) break;
  }
  return output.sort((a, b) => a.name.localeCompare(b.name));
}

async function snapshotState() {
  const tables = {
    merchants: await allRows('merchant_details', 'merchant_system_id'),
    collaborators: await allRows('collaborators', 'id'),
    transactions: await allRows('referral_transactions', 'id'),
    media: await allRows('media_assets', 'id'),
    profiles: await allRows('user_profiles', 'id'),
    batches: await allRows('legacy_migration_batches', 'id'),
  };
  const auth = await authInventory();
  const storage = {
    merchant: await listStorage('merchant-media'),
    partner: await listStorage('partner-media'),
  };
  const summarize = (value) => ({ count: value.length, sha256: stableHash(value) });
  return {
    database: Object.fromEntries(Object.entries(tables).map(([name, value]) => [name, summarize(value)])),
    auth: summarize(auth),
    storage: {
      merchant: summarize(storage.merchant),
      partner: summarize(storage.partner),
    },
  };
}

async function cleanup() {
  if (objectCreated) {
    await request(`/storage/v1/object/merchant-media/${objectPath}`, { method: 'DELETE' });
    objectCreated = false;
  }
  if (authUserId) {
    await request(`/auth/v1/admin/users/${authUserId}`, { method: 'DELETE' });
    authUserId = null;
  }
  if (batchCreated) {
    await request(`/rest/v1/legacy_migration_batches?id=eq.${testId}`, { method: 'DELETE' });
    batchCreated = false;
  }
}

const startedAt = performance.now();
const before = await snapshotState();
try {
  await request('/rest/v1/legacy_migration_batches', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ id: testId, legacy_tenant_id: tenantId, status: 'planned', notes: 'D4 isolated rollback rehearsal' }),
  });
  batchCreated = true;

  const createdUser = await request('/auth/v1/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword, email_confirm: true, app_metadata: { role: 'd4_test' } }),
  });
  authUserId = createdUser.body.id;

  await request(`/storage/v1/object/merchant-media/${objectPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'false' },
    body: testBytes,
  });
  objectCreated = true;
  const downloaded = await fetch(`${url}/storage/v1/object/authenticated/merchant-media/${objectPath}`, { headers });
  if (!downloaded.ok) throw new Error(`download test object: HTTP ${downloaded.status}`);
  const downloadedSha256 = createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex');
  if (downloadedSha256 !== testBytesSha256) throw new Error('test object checksum mismatch');

  const mutated = await snapshotState();
  if (mutated.database.batches.count !== before.database.batches.count + 1) throw new Error('database mutation not observed');
  if (mutated.auth.count !== before.auth.count + 1) throw new Error('Auth mutation not observed');
  if (mutated.storage.merchant.count !== before.storage.merchant.count + 1) throw new Error('Storage mutation not observed');

  const recoveryStartedAt = performance.now();
  await cleanup();
  const after = await snapshotState();
  const recoverySeconds = (performance.now() - recoveryStartedAt) / 1000;
  const pass = JSON.stringify(before) === JSON.stringify(after);
  console.log(JSON.stringify({
    status: pass ? 'PASS' : 'FAIL',
    target: 'isolated-local-supabase',
    before,
    after,
    restored: {
      database: before.database.batches.sha256 === after.database.batches.sha256,
      auth: before.auth.sha256 === after.auth.sha256,
      storage: before.storage.merchant.sha256 === after.storage.merchant.sha256 &&
        before.storage.partner.sha256 === after.storage.partner.sha256,
    },
    synthetic_storage_object_sha256: testBytesSha256,
    recovery_seconds: Number(recoverySeconds.toFixed(3)),
    total_test_seconds: Number(((performance.now() - startedAt) / 1000).toFixed(3)),
  }, null, 2));
  if (!pass) process.exitCode = 1;
} finally {
  await cleanup();
}
