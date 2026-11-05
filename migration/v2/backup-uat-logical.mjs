#!/usr/bin/env node
// Credential-safe logical backup of hosted UAT (read-only): REST relations, Auth admin users, Storage buckets + object bytes.
// Usage: backup-uat-logical.mjs <empty-output-dir>
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: backup-uat-logical.mjs <output-dir>');
if (existsSync(out) && readdirSync(out).length) throw new Error('output dir must be empty');
const env = {};
readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  .forEach((l) => { const [k, ...v] = l.split('='); env[k.trim()] = v.join('=').trim(); });
const OVERRIDE = process.env.VNO_BACKUP_API_URL;
if (OVERRIDE) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(OVERRIDE).hostname)) throw new Error('VNO_BACKUP_API_URL may only point at a local stack');
} else if (new URL(env.SUPABASE_URL).hostname !== 'hsezyogfxgnkpweoqqny.supabase.co') throw new Error('refusing: not the UAT project');
const BASE = OVERRIDE || env.SUPABASE_URL;
const KEY = process.env.VNO_BACKUP_API_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (rel, data) => { const p = join(out, rel); mkdirSync(dirname(p), { recursive: true, mode: 0o700 }); writeFileSync(p, data, { mode: 0o600 }); return sha(data); };
mkdirSync(out, { recursive: true, mode: 0o700 }); chmodSync(out, 0o700);

async function getJson(path, headers = {}) {
  const r = await fetch(BASE + path, { headers: { ...H, ...headers } });
  if (!r.ok) throw new Error(`GET ${path.split('?')[0]} -> ${r.status}`);
  return { json: await r.json(), headers: r.headers };
}
async function count(table) {
  const r = await fetch(`${BASE}/rest/v1/${table}?select=*&limit=1`, { headers: { ...H, Prefer: 'count=exact' } });
  if (!r.ok) throw new Error(`count ${table} -> ${r.status}`);
  return Number(r.headers.get('content-range').split('/')[1]);
}

const started = new Date().toISOString();
const spec = (await getJson('/rest/v1/')).json;
const files = {};
files['openapi.json'] = put('openapi.json', JSON.stringify(spec, null, 1));
const relations = Object.keys(spec.definitions).sort();
const before = Object.fromEntries(await Promise.all(relations.map(async (t) => [t, await count(t)])));

const tables = {};
for (const t of relations) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { json } = await getJson(`/rest/v1/${t}?select=*&order=${await orderCol(t)}&limit=1000&offset=${offset}`);
    rows.push(...json);
    if (json.length < 1000) break;
  }
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  files[`tables/${t}.jsonl`] = put(`tables/${t}.jsonl`, body);
  tables[t] = rows.length;
}
async function orderCol(t) {
  const props = Object.keys(spec.definitions[t].properties);
  return props.includes('id') ? 'id' : props[0];
}

const users = [];
for (let page = 1; ; page++) {
  const { json } = await getJson(`/auth/v1/admin/users?page=${page}&per_page=100`);
  users.push(...json.users);
  if (json.users.length < 100) break;
}
users.sort((a, b) => a.id.localeCompare(b.id));
files['auth/users.json'] = put('auth/users.json', JSON.stringify(users, null, 1));

const buckets = (await getJson('/storage/v1/bucket')).json;
files['storage/buckets.json'] = put('storage/buckets.json', JSON.stringify(buckets, null, 1));
const objects = [];
async function walk(bucket, prefix) {
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(`${BASE}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`list ${bucket}/${prefix} -> ${r.status}`);
    const items = await r.json();
    for (const item of items) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) await walk(bucket, path);
      else objects.push({ bucket, path, size: item.metadata?.size, mimetype: item.metadata?.mimetype, etag: item.metadata?.eTag, updated_at: item.updated_at });
    }
    if (items.length < 100) break;
  }
}
for (const b of buckets) await walk(b.id, '');
let objectBytes = 0;
for (const o of objects) {
  const r = await fetch(`${BASE}/storage/v1/object/${o.bucket}/${o.path.split('/').map(encodeURIComponent).join('/')}`, { headers: H });
  if (!r.ok) throw new Error(`download ${o.bucket}/${o.path} -> ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  o.sha256 = put(`storage/objects/${o.bucket}/${o.path}`, bytes);
  o.downloaded_bytes = bytes.length;
  objectBytes += bytes.length;
}
files['storage/objects.json'] = put('storage/objects.json', JSON.stringify(objects, null, 1));

const after = Object.fromEntries(await Promise.all(relations.map(async (t) => [t, await count(t)])));
const stable = relations.every((t) => before[t] === after[t] && after[t] === tables[t]);
const manifest = {
  format: 'vno-uat-logical-backup-v1', project: 'hsezyogfxgnkpweoqqny', started_utc: started, finished_utc: new Date().toISOString(),
  relations: tables, counts_before_equal_after_equal_export: stable,
  auth_users: users.length, buckets: buckets.map((b) => b.id), storage_objects: objects.length, storage_bytes: objectBytes,
  files,
  limitations: ['Auth password hashes are not exposed by the Admin API', 'DDL/RLS/trigger definitions are not captured (no DB credential); schema is rebuilt from repository migrations and verified by OpenAPI parity'],
};
const manifestSha = put('manifest.json', JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ status: 'complete', relations: relations.length, rows: Object.values(tables).reduce((a, b) => a + b, 0), auth_users: users.length, storage_objects: objects.length, storage_bytes: objectBytes, stable, manifest_sha256: manifestSha }, null, 1));
