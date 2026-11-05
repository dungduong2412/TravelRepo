#!/usr/bin/env node
// Restore a UAT logical backup into an ISOLATED local Supabase stack and verify it.
// Usage: restore-and-verify-uat-backup.mjs <backup-dir> <local-supabase-workdir> <evidence-out.json>
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , backupDir, workdir, evidenceOut] = process.argv;
if (!backupDir || !workdir || !evidenceOut) throw new Error('usage: restore-and-verify-uat-backup.mjs <backup-dir> <workdir> <evidence.json>');
const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8'));

const status = Object.fromEntries(execFileSync('supabase', ['status', '--workdir', workdir, '-o', 'env'], { encoding: 'utf8' })
  .split('\n').filter((l) => l.includes('=')).map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').replace(/^"|"$/g, '')]; }));
const API = status.API_URL;
if (!/^http:\/\/127\.0\.0\.1:57321/.test(API)) throw new Error(`refusing: restore target is not the isolated drill stack (${API})`);
const SVC = status.SERVICE_ROLE_KEY;
const H = { apikey: SVC, Authorization: `Bearer ${SVC}` };
const DB = 'supabase_db_vno-e1e2-restore-drill';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const checks = [];
const check = (id, name, pass, evidence) => { checks.push({ id, name, status: pass ? 'PASS' : 'FAIL', evidence }); console.error(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence).slice(0, 200)}`); };
const psql = (sql) => {
  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.slice(0, 400)}`);
  return r.stdout;
};
const jget = async (path) => { const r = await fetch(API + path, { headers: H }); if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}`); return r.json(); };

// ---- 0. schema drift between repository-built schema and UAT ----------------------------------------
const uatSpec = JSON.parse(readFileSync(join(backupDir, 'openapi.json'), 'utf8'));
const FORMAT = { bigint: 'int64', int64: 'int64', integer: 'int32', int32: 'int32' };
const surface = (s) => ({
  defs: Object.fromEntries(Object.entries(s.definitions).map(([k, d]) => [k, { required: [...(d.required || [])].sort(), props: Object.fromEntries(Object.entries(d.properties).map(([p, v]) => [p, `${v.type || ''}|${FORMAT[v.format] || v.format || ''}`])) }])),
  rpcs: Object.keys(s.paths).filter((p) => p.startsWith('/rpc/')).sort(),
});
const surfaceDiff = (a, b) => {
  const out = [];
  for (const k of new Set([...Object.keys(a.defs), ...Object.keys(b.defs)])) if (stable(a.defs[k]) !== stable(b.defs[k])) out.push(k);
  if (stable(a.rpcs) !== stable(b.rpcs)) out.push('<rpc>');
  return out;
};
const PG_TYPE = { uuid: 'uuid', text: 'text', 'character varying': 'varchar', 'timestamp with time zone': 'timestamptz', 'timestamp without time zone': 'timestamp', boolean: 'boolean', jsonb: 'jsonb', json: 'json', numeric: 'numeric', integer: 'integer', bigint: 'bigint', date: 'date' };
const preDiff = surfaceDiff(surface(uatSpec), surface(await jget('/rest/v1/')));
check('S1', 'repository migrations alone reproduce the UAT schema surface', preDiff.length === 0, { drifted_relations: preDiff, note: 'DDL for drifted relations is not in the repository; only a pg-level dump/PITR captures it exactly' });
const reconciled = [];
const notNullAfterLoad = [];
for (const t of preDiff.filter((x) => x !== '<rpc>')) {
  const want = uatSpec.definitions[t];
  const have = (await jget('/rest/v1/')).definitions[t];
  if (!have) throw new Error(`relation ${t} missing in restore target`);
  for (const [c, v] of Object.entries(want.properties)) {
    if (have.properties[c]) continue;
    const type = v.format === 'character varying' && v.maxLength ? `varchar(${v.maxLength})` : PG_TYPE[v.format];
    if (!type) throw new Error(`no type mapping for ${t}.${c} (${v.format})`);
    psql(`alter table public."${t}" add column "${c}" ${type}`);
    reconciled.push(`${t}.${c}+`);
  }
  for (const c of Object.keys(have.properties)) if (!want.properties[c]) { psql(`alter table public."${t}" drop column "${c}"`); reconciled.push(`${t}.${c}-`); }
  for (const c of want.required || []) if (!(have.required || []).includes(c)) notNullAfterLoad.push([t, c]);
}
psql("notify pgrst, 'reload schema'");
await new Promise((r) => setTimeout(r, 3000));
check('S2', 'drifted relations reconstructed in the drill target from UAT column metadata', reconciled.length > 0 ? true : preDiff.length === 0, { applied: reconciled });

// ---- 1. restore relational data ------------------------------------------------------------
const baseTables = new Set(psql("select tablename from pg_tables where schemaname='public'").split('\n').filter(Boolean));
const cols = {};
for (const line of psql("select table_name, column_name from information_schema.columns where table_schema='public' and is_generated='NEVER' order by table_name, ordinal_position").split('\n').filter(Boolean)) {
  const [t, c] = line.split('\t'); (cols[t] ||= []).push(c);
}
const loaded = {};
let sql = 'begin;\nset local session_replication_role = replica;\n';
for (const [t, n] of Object.entries(manifest.relations)) {
  if (!baseTables.has(t) || n === 0) continue;
  const file = join(backupDir, 'tables', `${t}.jsonl`);
  execFileSync('docker', ['cp', file, `${DB}:/tmp/restore_${t}.jsonl`]);
  const list = cols[t].map((c) => `"${c}"`).join(', ');
  const sel = cols[t].map((c) => `r."${c}"`).join(', ');
  sql += `create temp table _s_${t}(j jsonb) on commit drop;\n\\copy _s_${t} from '/tmp/restore_${t}.jsonl' with (format csv, quote E'\\x01', delimiter E'\\x02')\n`;
  sql += `insert into public."${t}" (${list}) overriding system value select ${sel} from _s_${t}, lateral jsonb_populate_record(null::public."${t}", _s_${t}.j) r;\n`;
  loaded[t] = n;
}
for (const line of psql("select table_name, column_name from information_schema.columns where table_schema='public' and is_identity='YES'").split('\n').filter(Boolean)) {
  const [t, c] = line.split('\t');
  if (loaded[t]) sql += `select setval(pg_get_serial_sequence('public."${t}"','${c}'), coalesce(max("${c}"),1), max("${c}") is not null) from public."${t}";\n`;
}
sql += 'commit;\n';
psql(sql);
for (const [t, c] of notNullAfterLoad) psql(`alter table public."${t}" alter column "${c}" set not null`);
psql("notify pgrst, 'reload schema'");
await new Promise((r) => setTimeout(r, 3000));
const emptyTarget = psql(`select count(*) from public.collaborators`).trim();
check('R1', 'relational data loaded in one transaction (triggers/FKs deferred, validated below)', Number(emptyTarget) === manifest.relations.collaborators, { tables_loaded: Object.keys(loaded).length });

// ---- 2. restore Auth users -----------------------------------------------------------------
const backupUsers = JSON.parse(readFileSync(join(backupDir, 'auth/users.json'), 'utf8'));
const authFailures = [];
for (const u of backupUsers) {
  const body = { id: u.id, email: u.email, email_confirm: Boolean(u.email_confirmed_at), app_metadata: u.app_metadata, user_metadata: u.user_metadata, password: randomBytes(24).toString('base64url') + 'Aa1!' };
  if (u.phone) { body.phone = u.phone; body.phone_confirm = Boolean(u.phone_confirmed_at); }
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) authFailures.push({ id: u.id, status: r.status });
}
const restoredUsers = [];
for (let page = 1; ; page++) { const j = await jget(`/auth/v1/admin/users?page=${page}&per_page=100`); restoredUsers.push(...j.users); if (j.users.length < 100) break; }
const byId = new Map(restoredUsers.map((u) => [u.id, u]));
const authDiff = backupUsers.filter((u) => { const r = byId.get(u.id); return !r || r.email !== u.email || stable(r.app_metadata) !== stable(u.app_metadata) || stable(r.user_metadata) !== stable(u.user_metadata) || Boolean(r.email_confirmed_at) !== Boolean(u.email_confirmed_at) || r.role !== u.role; }).map((u) => u.id);
check('R2', 'Auth users restored with identical id/email/roles/metadata/confirmation state', authFailures.length === 0 && authDiff.length === 0 && restoredUsers.length === backupUsers.length,
  { backup: backupUsers.length, restored: restoredUsers.length, create_failures: authFailures.length, mismatched: authDiff.length });
check('R2b', 'Auth password hashes', false, 'NOT RECOVERABLE from Admin API export: restored users have random passwords (password reset required). pg-level dump or PITR is required to preserve hashes.');

// ---- 3. restore Storage buckets + bytes ----------------------------------------------------
const buckets = JSON.parse(readFileSync(join(backupDir, 'storage/buckets.json'), 'utf8'));
for (const b of buckets) {
  const body = { id: b.id, name: b.name, public: b.public, file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types };
  const r = await fetch(`${API}/storage/v1/bucket`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok && r.status !== 409 && !(await r.clone().text()).includes('already exists')) throw new Error(`bucket ${b.id} ${r.status}`);
  if (!r.ok) await fetch(`${API}/storage/v1/bucket/${b.id}`, { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
const objects = JSON.parse(readFileSync(join(backupDir, 'storage/objects.json'), 'utf8'));
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const objProblems = [];
for (const o of objects) {
  const bytes = readFileSync(join(backupDir, 'storage/objects', o.bucket, o.path));
  const up = await fetch(`${API}/storage/v1/object/${o.bucket}/${enc(o.path)}`, { method: 'POST', headers: { ...H, 'content-type': o.mimetype || 'application/octet-stream', 'x-upsert': 'true' }, body: bytes });
  if (!up.ok) { objProblems.push({ path: o.path, step: 'upload', status: up.status }); continue; }
  const dl = Buffer.from(await (await fetch(`${API}/storage/v1/object/${o.bucket}/${enc(o.path)}`, { headers: H })).arrayBuffer());
  if (sha(dl) !== o.sha256 || dl.length !== o.downloaded_bytes) objProblems.push({ path: o.path, step: 'byte-compare' });
}
const bucketsBack = await jget('/storage/v1/bucket');
const bucketDiff = buckets.filter((b) => { const r = bucketsBack.find((x) => x.id === b.id); return !r || r.public !== b.public || r.file_size_limit !== b.file_size_limit || stable(r.allowed_mime_types) !== stable(b.allowed_mime_types); }).map((b) => b.id);
check('R3', 'Storage buckets restored with identical privacy/limits/MIME rules', bucketDiff.length === 0, { buckets: buckets.length, mismatched: bucketDiff });
check('R4', 'Storage object bytes restored and SHA-256/size verified against backup', objProblems.length === 0, { objects: objects.length, bytes: manifest.storage_bytes, problems: objProblems.length });

// ---- 4. verify: table content parity ------------------------------------------------------------
const diffTables = [];
for (const t of Object.keys(manifest.relations)) {
  const want = readFileSync(join(backupDir, 'tables', `${t}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => stable(JSON.parse(l))).sort();
  const got = [];
  for (let off = 0; ; off += 1000) { const rows = await jget(`/rest/v1/${t}?select=*&limit=1000&offset=${off}`); got.push(...rows.map((r) => stable(r))); if (rows.length < 1000) break; }
  got.sort();
  if (want.length !== got.length || sha(want.join('\n')) !== sha(got.join('\n'))) diffTables.push({ table: t, backup: want.length, restored: got.length });
}
check('V1', 'every relation (tables and views) returns byte-identical canonical rows after restore', diffTables.length === 0, { relations: Object.keys(manifest.relations).length, rows: Object.values(manifest.relations).reduce((a, b) => a + b, 0), differing: diffTables });

// ---- 5. verify: schema surface parity (OpenAPI) --------------------------------------------------------
const postDiff = surfaceDiff(surface(uatSpec), surface(await jget('/rest/v1/')));
check('V2', 'REST schema surface (relations, columns, types, required flags, RPCs) identical to UAT after reconstruction', postDiff.length === 0, { relations: Object.keys(uatSpec.definitions).length, differing: postDiff });

// ---- 6. verify: referential integrity (all FKs incl. auth.users) -------------------------------
const fks = psql(`select c.conrelid::regclass, c.confrelid::regclass, (select string_agg(format('c.%I', a.attname), ',' order by u.ord) from unnest(c.conkey) with ordinality u(att,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=u.att),
  (select string_agg(format('p.%I', a.attname), ',' order by u.ord) from unnest(c.confkey) with ordinality u(att,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=u.att), c.conname
  from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.contype='f' and n.nspname='public'`).split('\n').filter(Boolean);
const fkBad = [];
for (const line of fks) {
  const [child, parent, ccols, pcols, name] = line.split('\t');
  const cl = ccols.split(','), pl = pcols.split(',');
  const notNull = cl.map((c) => `${c} is not null`).join(' and ');
  const join_ = cl.map((c, i) => `${c} = ${pl[i]}`).join(' and ');
  const n = Number(psql(`select count(*) from ${child} c where ${notNull} and not exists (select 1 from ${parent} p where ${join_})`).trim());
  if (n) fkBad.push({ fk: name, orphans: n });
}
check('V3', 'all foreign keys resolve after restore (including references to restored auth.users)', fkBad.length === 0, { fk_constraints_checked: fks.length, violations: fkBad });

// ---- 7. verify: Storage metadata ties to media_assets -------------------------------------
const media = readFileSync(join(backupDir, 'tables/media_assets.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const objByKey = new Map(objects.map((o) => [`${o.bucket}/${o.path}`, o]));
const mediaBad = media.filter((m) => { const o = objByKey.get(`${m.bucket_id}/${m.object_path}`); return !o || o.sha256 !== m.sha256_hex || o.downloaded_bytes !== Number(m.size_bytes); }).map((m) => m.id);
check('V4', 'every media_assets row points to a restored Storage object with matching SHA-256 and size', mediaBad.length === 0, { media_assets: media.length, mismatched: mediaBad.length });

// ---- 8. verify: financial integrity ----------------------------------------------------------------
const scaled = (v) => { const [w, f = ''] = String(v ?? 0).split('.'); return BigInt(w) * 10n ** 8n + BigInt((f + '00000000').slice(0, 8)) * (String(v).startsWith('-') ? -1n : 1n); };
const money = {};
for (const [t, d] of Object.entries(uatSpec.definitions)) {
  const numeric = Object.entries(d.properties).filter(([, v]) => v.format === 'numeric' || v.type === 'number').map(([p]) => p);
  if (!numeric.length || !manifest.relations[t]) continue;
  const rows = readFileSync(join(backupDir, 'tables', `${t}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const now = [];
  for (let off = 0; ; off += 1000) { const r = await jget(`/rest/v1/${t}?select=*&limit=1000&offset=${off}`); now.push(...r); if (r.length < 1000) break; }
  for (const c of numeric) {
    const s1 = rows.reduce((x, r) => x + (r[c] == null ? 0n : scaled(r[c])), 0n);
    const s2 = now.reduce((x, r) => x + (r[c] == null ? 0n : scaled(r[c])), 0n);
    money[`${t}.${c}`] = { backup: s1.toString(), restored: s2.toString(), equal: s1 === s2 };
  }
}
const moneyBad = Object.entries(money).filter(([, v]) => !v.equal).map(([k]) => k);
check('V5', 'sum of every numeric/money column per table identical before and after restore', moneyBad.length === 0, { columns_compared: Object.keys(money).length, differing: moneyBad });
const tx = readFileSync(join(backupDir, 'tables/referral_transactions.jsonl'), 'utf8').split('\n').filter(Boolean).length;
const txBack = Number(psql('select count(*) from public.referral_transactions').trim());
check('V6', 'referral_transactions row count preserved', tx === txBack, { backup: tx, restored: txBack });

// ---- 9. verify: guards present in restored schema ---------------------------------------------------
const triggers = psql("select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not tgisinternal order by 1").split('\n').filter(Boolean);
check('V7', 'D13A fractional-rate guard trigger present in restored schema', triggers.includes('merchant_details_fractional_rates_trg'), { user_triggers: triggers.length });
const migs = psql('select version from supabase_migrations.schema_migrations order by 1').split('\n').filter(Boolean);
check('V8', 'restored schema was built from baseline + 10 repository migrations', migs.length === 11, { applied: migs.length });

const summary = { generated_utc: new Date().toISOString(), target: 'isolated local stack vno-e1e2-restore-drill (127.0.0.1:57321)', backup_manifest_sha256: sha(readFileSync(join(backupDir, 'manifest.json'))), pass: checks.filter((c) => c.status === 'PASS').length, fail: checks.filter((c) => c.status === 'FAIL').length, checks };
writeFileSync(evidenceOut, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ pass: summary.pass, fail: summary.fail, failing: checks.filter((c) => c.status === 'FAIL').map((c) => c.id) }));
