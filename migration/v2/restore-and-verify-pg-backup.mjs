#!/usr/bin/env node
// Restore a backup-uat-pg.mjs backup into an ISOLATED, repository-migration-free local Supabase stack and verify it.
// Usage: restore-and-verify-pg-backup.mjs <backup-dir> <target-workdir> <target-db-container> <evidence.json> [--login-control email:password]
// Order is fixed: P0a-c preflight (target identity/cleanliness, managed Auth schema drift, role mapping) -> P1 restore -> P2-P9.
// A failed P0x or P1 stops the run at once: evidence.json is still written (gate_c=FAIL, diagnostics, every later check NOT_RUN).
// Gate C is PASS only if every planned check ran and passed.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CheckLog, authDrift, inBackupScope, columnDrift, copyColumns, parseGlobalsRoles, planRoleMapping, referencedRoles, writeJson } from './restore-preflight.mjs';

const argv = process.argv.slice(2);
const [backupDir, workdir, container, evidenceOut] = argv;
const refuse = (reason) => { // before any target access: still leave a diagnostic artifact and a clean exit
  const out = { generated_utc: new Date().toISOString(), backup_dir: backupDir, gate_c: 'FAIL', refused: reason, checks: [], not_run: 'all' };
  if (evidenceOut && evidenceOut !== '/dev/null') writeFileSync(evidenceOut, JSON.stringify(out, null, 2));
  console.error(`REFUSED: ${reason}`); console.log(JSON.stringify({ gate_c: 'FAIL', refused: reason })); process.exit(1);
};
const lc = argv.indexOf('--login-control');
const loginControl = lc >= 0 ? argv[lc + 1] : null;
if (!backupDir || !workdir || !container || !evidenceOut) refuse('usage: restore-and-verify-pg-backup.mjs <backup-dir> <target-workdir> <target-db-container> <evidence.json> [--login-control email:password]');
let stOut; try { stOut = execFileSync('supabase', ['status', '--workdir', workdir, '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { refuse(`target stack in ${workdir} is not running (supabase status failed)`); }
const st = Object.fromEntries(stOut.split('\n').filter((l) => l.includes('=')).map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').replace(/^"|"$/g, '')]; }));
const dbUrl = new URL(st.DB_URL);
if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || !['127.0.0.1', 'localhost'].some((h) => st.API_URL.includes(h))) refuse('restore target must be local');
if (!existsSync(join(backupDir, 'manifest.json'))) refuse('backup has no manifest.json (incomplete or not a backup)');
const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8'));
if (manifest.status !== 'complete' || backupDir.endsWith('.incomplete')) refuse('backup manifest is not marked complete');
for (const [f, h] of Object.entries(manifest.files)) if (!existsSync(join(backupDir, f)) || createHash('sha256').update(readFileSync(join(backupDir, f))).digest('hex') !== h) refuse(`backup file ${f} is missing or does not match the manifest checksum`);
const API = st.API_URL, SVC = st.SERVICE_ROLE_KEY, ANON = st.ANON_KEY;
const H = { apikey: SVC, Authorization: `Bearer ${SVC}` };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const PLANNED = ['P0a', 'P0b', 'P0c', 'P1', 'P2', 'P3', 'P3b', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', ...(loginControl ? ['P10'] : [])];
const log = new CheckLog(PLANNED, evidenceOut === '/dev/null' ? () => {} : writeJson(evidenceOut));
log.meta = () => ({ backup_dir: backupDir, backup_manifest_sha256: sha(readFileSync(join(backupDir, 'manifest.json'))), target: `isolated local stack (${API}), container ${container}` });
const check = (...a) => log.check(...a);
const stop = (blockedBy) => process.exit(log.finish(blockedBy));
process.on('uncaughtException', (e) => { log.check('FATAL', 'unhandled error in verifier', false, { message: String(e && e.message).slice(0, 600) }); stop('FATAL'); });
const pgEnv = { ...process.env, PGHOST: dbUrl.hostname, PGPORT: dbUrl.port, PGUSER: 'supabase_admin', PGPASSWORD: decodeURIComponent(dbUrl.password), PGDATABASE: 'postgres', PGSSLMODE: 'disable', PGOPTIONS: '-c search_path=pg_catalog,public' };
const psql = (q, tolerate = false) => { const r = spawnSync('psql', ['-X', '-At', '-F', '\t', ...(tolerate ? [] : ['-v', 'ON_ERROR_STOP=1']), '-f', '-'], { env: pgEnv, input: q, encoding: 'utf8', maxBuffer: 1 << 28 }); if (!tolerate && r.status !== 0) throw new Error(r.stderr.slice(0, 400)); return r.stdout.trim(); };
const jget = async (path, headers = H) => { const r = await fetch(API + path, { headers }); if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}`); return r.json(); };
const dump = join(backupDir, 'full.dump');

// 0. preflight: nothing below mutates the target until P0a-c all pass -------------------------------------------------------------
const psqlSafe = (q) => { const r = spawnSync('psql', ['-X', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env: pgEnv, input: q, encoding: 'utf8', maxBuffer: 1 << 28 }); return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };
const dockerPort = spawnSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' });
const portOk = dockerPort.status === 0 && dockerPort.stdout.split('\n').some((l) => l.trim().endsWith(`:${dbUrl.port}`));
const dirty = psqlSafe("select (select count(*) from auth.users) || '|' || (select count(*) from pg_tables where schemaname = 'public')");
const [dirtyUsers, dirtyPublic] = dirty.ok ? dirty.out.split('|').map(Number) : [NaN, NaN];
check('P0a', 'restore target is the named local container and is clean (no auth users, no public tables)', portOk && dirty.ok && dirtyUsers === 0 && dirtyPublic === 0,
  { container, container_publishes_db_port: portOk, db_port: dbUrl.port, target_auth_users: dirtyUsers, target_public_tables: dirtyPublic, error: dirty.ok ? undefined : dirty.err.slice(0, 200), remedy: 'supabase db reset --workdir <target-workdir>' });
if (log.failed('P0a')) stop('P0a');
const fpWant = JSON.parse(readFileSync(join(backupDir, 'catalog-fingerprint.json'), 'utf8'));
const fpTarget0 = JSON.parse(psql(readFileSync(new URL('./catalog-fingerprint.sql', import.meta.url), 'utf8')));
const dumpSql = spawnSync('pg_restore', ['-f', '-', dump], { encoding: 'utf8', maxBuffer: 1 << 29 }).stdout || '';
const drift = authDrift(fpWant.auth_tables, fpTarget0.auth_tables);
const targetCols = {};
for (const line of psql("select table_schema || '.' || table_name || '|' || column_name from information_schema.columns where table_schema in ('auth', 'storage', 'supabase_migrations')").split('\n')) { const [t, c] = line.split('|'); (targetCols[t] ||= []).push(c); }
const EPH0 = new Set(manifest.coverage.ephemeral_tables_not_restored);
const colDrift = columnDrift(copyColumns(dumpSql), targetCols, new Set(Object.keys(copyColumns(dumpSql)).filter((t) => !EPH0.has(t) && !t.startsWith('supabase_migrations.'))));
const targetTables = new Set(psql("select schemaname || '.' || tablename from pg_tables where schemaname in ('auth', 'storage')").split('\n'));
const tocTables = readFileSync(join(backupDir, 'full.dump.toc.txt'), 'utf8').split('\n').map((l) => l.match(/ TABLE (auth|storage) (\S+) \S+\s*$/)).filter(Boolean).map((m) => `${m[1]}.${m[2]}`);
const missingManaged = tocTables.filter((t) => !targetTables.has(t));
const imageOf = (svc) => { try { return execFileSync('docker', ['ps', '--format', '{{.Image}}', '--filter', `name=supabase_${svc}_${container.replace(/^supabase_db_/, '')}`], { encoding: 'utf8' }).trim(); } catch { return null; } };
const gotrue = { db: imageOf('db'), auth: imageOf('auth'), storage: imageOf('storage'), rest: imageOf('rest') };
check('P0b', 'managed Auth/Storage schema of the target is compatible with the backup (same tables and columns; no one-table-at-a-time patching)', drift.compatible && !missingManaged.length && colDrift.compatible,
  { ...drift, data_columns_missing_in_target: colDrift.blocking, data_columns_missing_informational_not_restored: colDrift.informational, managed_tables_in_dump_missing_from_target: missingManaged, source_server: manifest.server_version, target_images: gotrue, remedy: 'pin the target to the hosted component versions: copy supabase/.temp/{gotrue,storage,rest,postgres}-version and storage-migration into <target-workdir>/supabase/.temp/, then supabase stop --no-backup && supabase start' });
if (log.failed('P0b')) stop('P0b');
const globalsSql = existsSync(join(backupDir, 'globals.sql')) ? readFileSync(join(backupDir, 'globals.sql'), 'utf8') : '';
const roleMap = JSON.parse(readFileSync(process.env.VNO_RESTORE_ROLE_MAP || new URL('./restore-role-map.json', import.meta.url), 'utf8'));
delete roleMap._review;
const referenced = referencedRoles(dumpSql);
const plan = planRoleMapping({ referenced, targetRoles: psql('select rolname from pg_roles').split('\n'), roleMap, globals: parseGlobalsRoles(globalsSql) });
check('P0c', 'every role the dump references exists in the target or has a reviewed, unprivileged mapping', plan.ok,
  { referenced_roles: [...referenced].sort(), missing_from_target: plan.missing, will_create: plan.create.map((c) => ({ role: c.role, source_attributes: c.source_attributes, created_as: 'NOLOGIN, no password, no elevated attributes', login_in_source: c.login_in_source })), unmapped: plan.unmapped, privileged_in_source: plan.unsafe, not_recorded_in_globals: plan.unrecorded, membership_roles_missing: plan.memberRolesMissing, memberships_to_apply: plan.memberships.map((m) => m.sql) });
if (log.failed('P0c')) stop('P0c');
for (const c of plan.create) psql(c.sql);
for (const m of plan.memberships) psql(m.sql);

// 1. managed-schema data first (public foreign keys reference auth.users), then rebuild public from the dump alone
// 1a. auth + storage data (managed schemas keep their own DDL) ------------------------------------------------------
const EPH = new Set(manifest.coverage.ephemeral_tables_not_restored);
const toc = readFileSync(join(backupDir, 'full.dump.toc.txt'), 'utf8').split('\n');
const wanted = toc.filter((l) => { const m = l.match(/TABLE DATA (auth|storage) (\S+)/); return m && !EPH.has(`${m[1]}.${m[2]}`); });
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'vno-pg-restore-')));
writeFileSync(join(tmp, 'use-list.txt'), wanted.join('\n') + '\n');
const r2 = spawnSync('pg_restore', ['--dbname', 'postgres', '--data-only', '--disable-triggers', '-L', join(tmp, 'use-list.txt'), dump], { env: pgEnv, encoding: 'utf8', maxBuffer: 1 << 28 });
const errors2 = (r2.stderr || '').split('\n').filter((l) => /error/i.test(l));
if (r2.error) errors2.push(`spawn: ${r2.error.message}`);
// 1b. public + migration history
const pre = psql("select count(*) from pg_tables where schemaname = 'public'");
const schemaOwner = (name) => toc.map((l) => l.match(new RegExp(`SCHEMA - ${name} (\\S+)\\s*$`))).find(Boolean)?.[1];
psql(`drop schema if exists public cascade; create schema public authorization "${schemaOwner('public') || 'pg_database_owner'}"; grant usage on schema public to public; drop schema if exists supabase_migrations cascade; create schema supabase_migrations authorization "${schemaOwner('supabase_migrations') || 'postgres'}";`);
const r1 = spawnSync('pg_restore', ['--dbname', 'postgres', '-n', 'public', '-n', 'supabase_migrations', dump], { env: pgEnv, encoding: 'utf8', maxBuffer: 1 << 28 });
// schema-level ACL entries are skipped by pg_restore -n; apply them explicitly from the same dump
writeFileSync(join(tmp, 'schema-acl-list.txt'), toc.filter((l) => /ACL - SCHEMA (public|supabase_migrations) /.test(l)).join('\n') + '\n');
const r1b = spawnSync('pg_restore', ['--dbname', 'postgres', '-L', join(tmp, 'schema-acl-list.txt'), dump], { env: pgEnv, encoding: 'utf8' });
const errors1 = ((r1.stderr || '') + (r1b.stderr || '')).split('\n').filter((l) => /error/i.test(l));
for (const x of [r1, r1b]) if (x.error) errors1.push(`spawn: ${x.error.message}`);
log.diagnostics.p1 = { managed_data_restore_stderr: (r2.stderr || '').split('\n').slice(0, 60), public_restore_stderr: ((r1.stderr || '') + (r1b.stderr || '')).split('\n').slice(0, 60) };
psql("notify pgrst, 'reload schema'");
await new Promise((r) => setTimeout(r, 4000));
check('P1', 'pg_restore of public + migration history + auth/storage data completes without errors (public rebuilt from the dump, no repository migrations)', errors1.length === 0 && errors2.length === 0,
  { target_public_tables_before: Number(pre), public_error_count: errors1.length, public_errors: errors1.slice(0, 5), managed_schema_error_count: errors2.length, managed_schema_errors: errors2.slice(0, 5), auth_storage_tables_restored: wanted.length });
if (log.failed('P1')) stop('P1');

// 3. row-level equality (includes auth.users password hashes) -------------------------------------------------------------
const want = JSON.parse(readFileSync(join(backupDir, 'row-checksums.json'), 'utf8'));
const bad = [];
for (const [t, w] of Object.entries(want)) {
  if (!w.restored) continue;
  const [s, n] = t.split('.');
  const r = psqlSafe(`select count(*) || '|' || md5(coalesce(string_agg(x::text, E'\\n' order by x::text), '')) from "${s}"."${n}" x;`);
  if (!r.ok) { bad.push({ table: t, source_rows: w.rows, error: r.err.slice(0, 160) }); continue; }
  const got = r.out.split('|');
  if (Number(got[0]) !== w.rows || got[1] !== w.md5) bad.push({ table: t, source_rows: w.rows, restored_rows: Number(got[0]) });
}
const compared = Object.values(want).filter((w) => w.restored).length;
check('P2', 'every restored table has identical row count and content checksum (including auth.users password hashes and identities)', bad.length === 0, { tables_compared: compared, rows: Object.values(want).filter((w) => w.restored).reduce((a, w) => a + w.rows, 0), differing: bad });

// 4. application schema, RLS, grants, triggers, functions ---------------------------------------------------------------------------
const fpGot = JSON.parse(psql(readFileSync(new URL('./catalog-fingerprint.sql', import.meta.url), 'utf8')));
const STRICT = ['schema_acls_app', 'public_relations', 'public_columns', 'policies', 'constraints', 'indexes', 'triggers', 'functions', 'view_defs', 'default_privileges', 'auth_tables', 'storage_buckets'];
const scoped = (fp) => ({ ...fp, default_privileges: inBackupScope(fp.default_privileges) });
const fpBad = STRICT.filter((k) => stable(scoped(fpWant)[k]) !== stable(scoped(fpGot)[k]));
check('P3', 'application schema identical: relations, columns, RLS flags, policies, grants, constraints, indexes, triggers, functions, views, default privileges', fpBad.length === 0,
  { sections_compared: STRICT.length, default_privileges_scope: 'schemas in the backup (public, auth, storage, supabase_migrations)', differing: fpBad, policies: fpWant.policies.length, rls_tables: fpWant.public_relations.filter((r) => r.rls).length });
const infoDiff = ['roles', 'role_settings', 'extensions', 'schema_acls_managed'].filter((k) => stable(fpWant[k]) !== stable(fpGot[k]));
const outOfScope = (fp) => fp.default_privileges.filter((r) => !inBackupScope([r]).length).map(stable);
const oosDiff = { only_in_source: outOfScope(fpWant).filter((x) => !outOfScope(fpGot).includes(x)), only_in_target: outOfScope(fpGot).filter((x) => !outOfScope(fpWant).includes(x)) };
check('P3b', 'informational: roles, role settings, extensions and platform-schema default privileges of the source vs the (differently provisioned) local target', true, { sections_that_differ: infoDiff, platform_schema_default_privileges_not_in_backup: oosDiff, note: 'roles/role settings are provisioned by the Supabase platform; source values are preserved in catalog-fingerprint.json' });

// 5. RLS behaviour -----------------------------------------------------------------------------------------------------------------------
const probeWant = JSON.parse(readFileSync(join(backupDir, 'anon-probe.json'), 'utf8'));
const probeBad = [];
for (const [t, status] of Object.entries(probeWant)) { const r = await fetch(`${API}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }); if (r.status !== status) probeBad.push({ table: t, source: status, restored: r.status }); }
check('P4', 'anonymous access behaves identically on every public table (RLS/grants effective, not just present)', probeBad.length === 0, { tables_probed: Object.keys(probeWant).length, differing: probeBad });

// 6. financial totals -------------------------------------------------------------------------------------------------------------------
const finWant = JSON.parse(readFileSync(join(backupDir, 'financial-totals.json'), 'utf8'));
const finGot = JSON.parse(psql(`select jsonb_build_object('referral_transactions', (select jsonb_build_object('rows', count(*), 'document_total', coalesce(sum(document_total), 0), 'discount', coalesce(sum(document_discount_amount), 0), 'commission', coalesce(sum(commission_amount), 0)) from public.referral_transactions))::text;`));
check('P5', 'financial totals identical (transaction count, document total, discount, commission)', stable(finWant) === stable(finGot), { source: finWant.referral_transactions, restored: finGot.referral_transactions });

// 7. foreign keys across public and auth.users -------------------------------------------------------------------------------------
const fks = psql(`select c.conrelid::regclass, c.confrelid::regclass, (select string_agg(format('c.%I', a.attname), ',' order by u.ord) from unnest(c.conkey) with ordinality u(att,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=u.att), (select string_agg(format('p.%I', a.attname), ',' order by u.ord) from unnest(c.confkey) with ordinality u(att,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=u.att), c.conname from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.contype='f' and n.nspname='public'`).split('\n').filter(Boolean);
const fkBad = [];
for (const line of fks) { const [child, parent, cc, pc, name] = line.split('\t'); const cl = cc.split(','), pl = pc.split(','); const n = Number(psql(`select count(*) from ${child} c where ${cl.map((c) => `${c} is not null`).join(' and ')} and not exists (select 1 from ${parent} p where ${cl.map((c, i) => `${c} = ${pl[i]}`).join(' and ')})`)); if (n) fkBad.push({ fk: name, orphans: n }); }
check('P6', 'all foreign keys resolve (including references to restored auth.users)', fkBad.length === 0, { checked: fks.length, violations: fkBad });

// 7b. REST-visible records vs API export taken at backup time ------------------------------------------------------------------------
const diffTables = [];
for (const [t, n] of Object.entries(manifest.logical_export.relations_rows || {})) void n;
const relFiles = Object.keys(manifest.files).filter((f) => /^logical\/tables\/.+\.jsonl$/.test(f));
for (const f of relFiles) {
  const t = f.replace('logical/tables/', '').replace('.jsonl', '');
  const wantRows = readFileSync(join(backupDir, f), 'utf8').split('\n').filter(Boolean).map((l) => stable(JSON.parse(l))).sort();
  const got = []; for (let off = 0; ; off += 1000) { const rows = await jget(`/rest/v1/${t}?select=*&limit=1000&offset=${off}`); got.push(...rows.map((r) => stable(r))); if (rows.length < 1000) break; }
  got.sort(); if (sha(wantRows.join('\n')) !== sha(got.join('\n'))) diffTables.push(t);
}
check('P7', 'records as served by the restored API equal the API export taken at backup time (tables and views)', diffTables.length === 0, { relations: relFiles.length, differing: diffTables });

// 8. Storage bytes -------------------------------------------------------------------------------------------------------------------------------
const objects = JSON.parse(readFileSync(join(backupDir, 'logical/storage/objects.json'), 'utf8'));
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const objBad = [];
for (const o of objects) {
  const bytes = readFileSync(join(backupDir, 'logical/storage/objects', o.bucket, o.path));
  const up = await fetch(`${API}/storage/v1/object/${o.bucket}/${enc(o.path)}`, { method: 'POST', headers: { ...H, 'content-type': o.mimetype || 'application/octet-stream', 'x-upsert': 'true' }, body: bytes });
  if (!up.ok) { objBad.push({ path: o.path, step: 'upload', status: up.status }); continue; }
  const dl = Buffer.from(await (await fetch(`${API}/storage/v1/object/${o.bucket}/${enc(o.path)}`, { headers: H })).arrayBuffer());
  if (sha(dl) !== o.sha256) objBad.push({ path: o.path, step: 'sha256' });
}
const listed = psql("select count(*) || '|' || coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects").split('|');
check('P8', 'Storage: buckets restored from the dump; every object byte-for-byte restored from the byte backup (SHA-256) and registered', objBad.length === 0 && Number(listed[0]) === objects.length && Number(listed[1]) === manifest.coverage.auth.storage_bytes,
  { objects: objects.length, bytes: Number(listed[1]), expected_bytes: manifest.coverage.auth.storage_bytes, problems: objBad.length });

// 9. login recovery ------------------------------------------------------------------------------------------------------------------------------------
const hashes = psql("select count(*) filter (where encrypted_password is not null and encrypted_password <> '') || '|' || count(*) from auth.users").split('|');
check('P9', 'login recovery: every user and identity restored with its original password hash (bit-identical via P2)', Number(hashes[0]) === manifest.coverage.auth.users_with_password_hash && Number(hashes[1]) === manifest.coverage.auth.auth_users && want['auth.users'].restored, { users: Number(hashes[1]), with_hash: Number(hashes[0]), identities: manifest.coverage.auth.auth_identities });
if (loginControl) {
  const [email, ...pw] = loginControl.split(':'); const password = pw.join(':');
  const ok = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await ok.json();
  const wrong = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: password + 'x' }) });
  check('P10', 'login control: a user with a known password signs in after restore (and a wrong password is refused)', ok.status === 200 && Boolean(j.access_token) && wrong.status === 400, { signed_in: ok.status, wrong_password: wrong.status });
}
stop();
