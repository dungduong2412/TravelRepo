#!/usr/bin/env node
// Read-only completeness / isolation verification of the hosted UAT import (REST, Auth admin and Storage GET only).
//   S1 every sealed source record (14,260) is archived with the exact payload SHA-256, under the approved batch; per-table run rows match
//   S2 batch row status/tenant/manifest, tenant evidence
//   S3 every migratable V1 user has exactly one Auth identity, a matching legacy_identity_map and profile link, unique e-mail
//   S4 every row of the pre-import backup (all backed-up tables) still exists unchanged (only updated_at, and for merged categories the
//      added legacy_* columns, may differ); pre-existing Auth users and Storage objects unchanged
// Usage: verify-hosted-import-state.mjs <snapshot-dir> <pre-import-pg-backup-dir> <evidence.json> <batch-id>
//   env: VNO_TARGET_URL, VNO_TARGET_SERVICE_ROLE_KEY
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [snapDir, backupArg, evidenceOut, batchId] = process.argv.slice(2);
const API = process.env.VNO_TARGET_URL, KEY = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
if (!snapDir || !backupArg || !evidenceOut || !batchId || !API || !KEY) throw new Error('usage: verify-hosted-import-state.mjs <snapshot-dir> <backup-dir> <evidence.json> <batch-id>');
if (new URL(API).hostname !== 'hsezyogfxgnkpweoqqny.supabase.co') throw new Error('refusing: not the approved UAT project');
const backup = existsSync(join(backupArg, 'logical', 'auth', 'users.json')) ? join(backupArg, 'logical') : backupArg;
const TENANT = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const norm = (v) => (v == null ? null : String(v).trim().toLocaleLowerCase('en-US'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const checks = [];
const check = (id, name, pass, evidence) => { checks.push({ id, name, status: pass ? 'PASS' : 'FAIL', evidence }); console.error(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${JSON.stringify(evidence).slice(0, 240)}`); };
async function all(path) { const rows = []; for (let off = 0; ; off += 1000) { const r = await fetch(`${API}/rest/v1/${path}${path.includes('?') ? '&' : '?'}limit=1000&offset=${off}`, { headers: H, signal: AbortSignal.timeout(120_000) }); if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}`); const j = await r.json(); rows.push(...j); if (j.length < 1000) break; } return rows; }
const jl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---- S1: archive completeness with exact payload hashes ----
const manifest = JSON.parse(readFileSync(join(snapDir, 'manifest.json'), 'utf8'));
const expected = new Map(); let expectedTotal = 0; const perTable = new Map();
for (const t of manifest.tables) {
  const lines = readFileSync(join(snapDir, t.file), 'utf8').split('\n').filter(Boolean);
  if (lines.length !== t.rows) throw new Error(`snapshot row count mismatch in ${t.file}`);
  for (const line of lines) {
    const row = JSON.parse(line);
    const pk = (t.primary_key_columns || []).map((c) => row[c]).filter((v) => v != null).join('|') || sha(line);
    expected.set(`${t.database}|${t.schema}|${t.table}|${pk}`, sha(line));
  }
  expectedTotal += lines.length; perTable.set(`${t.database}|${t.schema}|${t.table}`, t.rows);
}
const archive = await all('legacy_source_records?select=source_database,source_schema,source_table,source_primary_key,source_payload_sha256,import_batch_id,legacy_tenant_id&order=source_database,source_table,source_primary_key');
const hostedKeys = new Map(archive.map((r) => [`${r.source_database}|${r.source_schema}|${r.source_table}|${r.source_primary_key}`, r]));
const missing = [...expected.keys()].filter((k) => !hostedKeys.has(k)).length;
const wrongHash = [...expected].filter(([k, h]) => hostedKeys.get(k) && hostedKeys.get(k).source_payload_sha256 !== h).length;
const wrongBatch = archive.filter((r) => r.import_batch_id !== batchId).length;
const extra = [...hostedKeys.keys()].filter((k) => !expected.has(k)).length;
check('S1', `all ${expectedTotal} sealed source records archived exactly once with matching payload SHA-256, all under the approved batch`, archive.length === expectedTotal && expected.size === expectedTotal && missing === 0 && wrongHash === 0 && wrongBatch === 0 && extra === 0,
  { sealed: expectedTotal, archived: archive.length, missing, payload_hash_mismatch: wrongHash, wrong_batch: wrongBatch, unexpected: extra });
const runs = await all(`legacy_migration_runs?select=source_database,source_schema,source_table,expected_rows,imported_rows,rejected_rows,import_batch_id&import_batch_id=eq.${batchId}`);
const runBad = [...perTable].filter(([k, n]) => { const r = runs.find((x) => `${x.source_database}|${x.source_schema}|${x.source_table}` === k); return !r || r.expected_rows !== n || r.imported_rows !== n || r.rejected_rows !== 0; }).length;
check('S1b', `migration run rows: ${perTable.size} tables, expected = imported = sealed rows, 0 rejected`, runs.length === perTable.size && runBad === 0, { runs: runs.length, tables: perTable.size, bad: runBad, imported_total: runs.reduce((a, r) => a + r.imported_rows, 0) });

// ---- S2: batch ----
const [batch] = await all(`legacy_migration_batches?select=id,legacy_tenant_id,status,source_inventory_sha256,started_at,completed_at&id=eq.${batchId}`);
const batches = await all('legacy_migration_batches?select=id');
const manifestSha = sha(readFileSync(join(snapDir, 'manifest.json')));
check('S2', 'exactly one batch exists, it is the approved batch, bound to the sealed manifest hash, and has left loading (validating)',
  Boolean(batch) && batches.length === 1 && lower(batch.legacy_tenant_id) === TENANT && batch.source_inventory_sha256 === manifestSha && batch.status === 'validating',
  { batch: batch && { id: batch.id, status: batch.status, manifest_hash_matches: batch.source_inventory_sha256 === manifestSha }, batches: batches.length });

// ---- S3: Auth identities ----
const users = jl(join(snapDir, 'tables/Emos_Identity/dbo.AbpUsers.jsonl')), userRoles = jl(join(snapDir, 'tables/Emos_Identity/dbo.AbpUserRoles.jsonl')), roles = jl(join(snapDir, 'tables/Emos_Identity/dbo.AbpRoles.jsonl'));
const roleName = new Map(roles.map((r) => [lower(r.Id), norm(r.Name)]));
const rolesBy = new Map(); for (const l of userRoles) rolesBy.set(lower(l.UserId), [...(rolesBy.get(lower(l.UserId)) || []), roleName.get(lower(l.RoleId))]);
const mapRole = (n = []) => (n.includes('admin') ? 'admin' : n.includes('bus') ? 'merchant' : n.includes('ctv') ? 'collaborator' : null);
const migratable = users.filter((u) => !u.IsDeleted && u.IsActive !== false && u.Email && mapRole(rolesBy.get(lower(u.Id))));
const authUsers = []; for (let p = 1; ; p++) { const r = await (await fetch(`${API}/auth/v1/admin/users?page=${p}&per_page=200`, { headers: H })).json(); authUsers.push(...r.users); if (r.users.length < 200) break; }
const authById = new Map(authUsers.map((u) => [lower(u.id), u]));
const idMap = await all('legacy_identity_map?select=legacy_user_id,auth_user_id,legacy_tenant_id,migration_status');
const profiles = await all('user_profiles?select=id,user_id,role,email');
const mapBy = new Map(idMap.map((m) => [lower(m.legacy_user_id), m])), profBy = new Map(profiles.map((p) => [lower(p.id), p]));
const emails = new Map(); for (const u of authUsers) emails.set(norm(u.email), (emails.get(norm(u.email)) || 0) + 1);
const s3bad = []; let withIdentity = 0;
// the admin LIST endpoint omits identities; read each user individually
const identitiesOf = new Map();
{ const q = migratable.map((u) => lower(u.Id)); await Promise.all(Array.from({ length: 8 }, async () => { for (let id = q.shift(); id; id = q.shift()) { const r = await fetch(`${API}/auth/v1/admin/users/${id}`, { headers: H, signal: AbortSignal.timeout(60_000) }); identitiesOf.set(id, r.ok ? ((await r.json()).identities || []) : []); } })); }
for (const u of migratable) {
  const a = authById.get(lower(u.Id)), m = mapBy.get(lower(u.Id)), p = profBy.get(lower(u.Id));
  const ids = (identitiesOf.get(lower(u.Id)) || []).filter((i) => i.provider === 'email' && lower(i.user_id) === lower(u.Id));
  if (ids.length >= 1) withIdentity++;
  if (!a || ids.length < 1 || !m || lower(m.auth_user_id) !== lower(a.id) || !p || lower(p.user_id) !== lower(a.id) || a.app_metadata?.legacy_user_id !== lower(u.Id) || a.app_metadata?.password_reset_required !== true || emails.get(norm(u.Email)) !== 1) s3bad.push(lower(u.Id));
}
const importedAuth = authUsers.filter((a) => a.app_metadata?.legacy_user_id).length;
check('S3', `${migratable.length} migratable V1 users: Auth user + email identity + identity map + profile link all consistent, e-mails unique, password reset required; no extra imported Auth users`, s3bad.length === 0 && migratable.length === 451 && withIdentity === 451 && importedAuth === 451 && idMap.filter((m) => lower(m.legacy_tenant_id) === TENANT).length === 451,
  { migratable: migratable.length, with_identity: withIdentity, imported_auth_users: importedAuth, auth_users_total: authUsers.length, identity_maps: idMap.length, inconsistent: s3bad.length });

// ---- S4: pre-existing data unchanged ----
const tablesDir = join(backup, 'tables');
const volatile = (table) => (k) => k === 'updated_at' || (table === 'categories' && k.startsWith('legacy_'));
const canon = (table, row) => stable(Object.fromEntries(Object.entries(row).filter(([k]) => !volatile(table)(k))));
const unchanged = {}; const changed = [];
for (const f of readdirSync(tablesDir).filter((n) => n.endsWith('.jsonl')).sort()) {
  const table = f.replace(/\.jsonl$/, '');
  const before = jl(join(tablesDir, f));
  let now; try { now = await all(`${table}?select=*`); } catch (e) { changed.push({ table, error: String(e.message).slice(0, 80) }); continue; }
  const hostedSet = new Set(now.map((r) => canon(table, r)));
  const gone = before.filter((r) => !hostedSet.has(canon(table, r))).length;
  unchanged[table] = { before: before.length, now: now.length, differing_or_missing: gone };
  if (gone) changed.push({ table, differing_or_missing: gone });
}
check('S4a', 'every row of the pre-import backup (all backed-up tables) exists unchanged (updated_at ignored; merged categories only gained legacy_* columns)', changed.length === 0, { tables: Object.keys(unchanged).length, rows_before_total: Object.values(unchanged).reduce((a, t) => a + t.before, 0), changed });
const baseUsers = JSON.parse(readFileSync(join(backup, 'auth/users.json'), 'utf8'));
const baseAuthBad = baseUsers.filter((b) => { const a = authById.get(lower(b.id)); return !a || a.email !== b.email || stable(a.app_metadata) !== stable(b.app_metadata) || stable(a.user_metadata) !== stable(b.user_metadata) || (a.banned_until || null) !== (b.banned_until || null); }).length;
check('S4b', `pre-existing ${baseUsers.length} Auth users unchanged (e-mail, metadata, ban state)`, baseAuthBad === 0, { users: baseUsers.length, changed: baseAuthBad });
const objs = JSON.parse(readFileSync(join(backup, 'storage/objects.json'), 'utf8'));
let objBad = 0;
for (const o of objs) { const r = await fetch(`${API}/storage/v1/object/${o.bucket}/${o.path.split('/').map(encodeURIComponent).join('/')}`, { headers: H, signal: AbortSignal.timeout(120_000) }); const b = r.ok ? Buffer.from(await r.arrayBuffer()) : null; if (!b || sha(b) !== o.sha256 || b.length !== o.size) objBad++; }
check('S4c', `pre-existing ${objs.length} Storage objects unchanged (SHA-256 and size)`, objBad === 0, { objects: objs.length, changed: objBad });

const out = { generated_utc: new Date().toISOString(), batch_id: batchId, pass: checks.filter((c) => c.status === 'PASS').length, fail: checks.filter((c) => c.status === 'FAIL').length, checks };
writeFileSync(evidenceOut, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ pass: out.pass, fail: out.fail, failing: checks.filter((c) => c.status === 'FAIL').map((c) => c.id) }));
process.exit(out.fail ? 1 : 0);
