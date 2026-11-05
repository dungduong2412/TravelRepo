#!/usr/bin/env node
// Read-only direct-PostgreSQL backup of hosted UAT (or, for pipeline tests only, an isolated local stack).
//
//   UAT:   SUPABASE_DB_PASSWORD=... node backup-uat-pg.mjs <empty-out-dir>
//          connection comes from supabase/.temp/pooler-url (no password in it); the password is read from the
//          environment only, passed to child processes through PGPASSWORD, and never printed or written.
//   Test:  node backup-uat-pg.mjs <out> --local <supabase-workdir> <db-container>
//
// Read-only is established and verified INSIDE every SQL transaction (backup-readonly.mjs): each psql call runs as
// BEGIN ... REPEATABLE READ READ ONLY and raises if transaction_read_only is not 'on' in that same transaction.
// PGOPTIONS default_transaction_read_only is kept only as defence in depth: the hosted pooler ignores startup options,
// so it must never be the control. pg_dump itself always dumps inside a REPEATABLE READ, READ ONLY transaction.
// pg_dump takes one consistent snapshot of public + auth + storage + supabase_migrations. It does NOT assume a default
// CLI dump covers managed schemas: the role's privileges are checked first and the script stops if any table in those
// schemas is unreadable.
//
// Output is built in <out-dir>.incomplete and renamed to <out-dir> only after the manifest is written, so <out-dir>
// existing means the backup finished. A failed run leaves <out-dir>.incomplete with INCOMPLETE-DO-NOT-USE.txt.
import { createHash } from 'node:crypto';
import { wrapReadOnly } from './backup-readonly.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const argv = process.argv.slice(2);
const localIdx = argv.indexOf('--local');
if (!argv[0] || argv[0] === '--local') throw new Error('usage: backup-uat-pg.mjs <new-out-dir> [--local <workdir> <db-container>]');
const finalDir = resolve(argv[0]);
const out = `${finalDir}.incomplete`;
if (existsSync(finalDir)) throw new Error(`${finalDir} already exists; a finished backup is never overwritten and a failed earlier attempt must be moved aside (mv) before retrying`);
if (existsSync(out)) throw new Error(`${out} is left over from an earlier failed attempt; move it aside (mv) before retrying`);
mkdirSync(out, { recursive: true, mode: 0o700 }); chmodSync(out, 0o700);
process.on('uncaughtException', (e) => {
  try { writeFileSync(join(out, 'INCOMPLETE-DO-NOT-USE.txt'), `backup failed at ${new Date().toISOString()}: ${String(e && e.message).slice(0, 500)}\nThis directory is NOT a backup.\n`, { mode: 0o600 }); } catch { /* best effort */ }
  console.error(`BACKUP FAILED (not a valid backup; see ${out}/INCOMPLETE-DO-NOT-USE.txt): ${e && e.message}`);
  process.exit(1);
});
const repo = new URL('../../', import.meta.url).pathname;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const SCHEMAS = ['public', 'auth', 'storage', 'supabase_migrations'];
const EPHEMERAL = new Set(['auth.schema_migrations', 'auth.audit_log_entries', 'auth.sessions', 'auth.refresh_tokens', 'auth.flow_state', 'auth.one_time_tokens', 'auth.mfa_challenges', 'auth.mfa_amr_claims', 'storage.objects', 'storage.migrations', 'storage.s3_multipart_uploads', 'storage.s3_multipart_uploads_parts']);

let conn, api, mode;
if (localIdx >= 0) {
  mode = 'local-test';
  const workdir = argv[localIdx + 1];
  const st = Object.fromEntries(execFileSync('supabase', ['status', '--workdir', workdir, '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((l) => l.includes('=')).map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').replace(/^"|"$/g, '')]; }));
  const u = new URL(st.DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('--local requires a local database');
  conn = { host: u.hostname, port: u.port, user: decodeURIComponent(u.username), db: u.pathname.slice(1), password: decodeURIComponent(u.password), ssl: 'disable' };
  api = { url: st.API_URL, serviceKey: st.SERVICE_ROLE_KEY, anonKey: st.ANON_KEY };
} else {
  mode = 'uat';
  const ref = readFileSync(join(repo, 'supabase/.temp/project-ref'), 'utf8').trim();
  if (ref !== 'hsezyogfxgnkpweoqqny') throw new Error('linked project is not the approved UAT project');
  const u = new URL(readFileSync(join(repo, 'supabase/.temp/pooler-url'), 'utf8').trim());
  if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is not set in the environment (never pass it on the command line)');
  conn = { host: u.hostname, port: u.port || '5432', user: decodeURIComponent(u.username), db: u.pathname.slice(1) || 'postgres', password: process.env.SUPABASE_DB_PASSWORD, ssl: 'require' };
  const env = {};
  readFileSync(join(repo, '.env'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).forEach((l) => { const [k, ...v] = l.split('='); env[k.trim()] = v.join('=').trim(); });
  if (new URL(env.SUPABASE_URL).hostname !== 'hsezyogfxgnkpweoqqny.supabase.co') throw new Error('refusing: .env is not UAT');
  api = { url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, anonKey: env.SUPABASE_ANON_KEY };
}
const childEnv = () => ({ ...process.env, PGHOST: conn.host, PGPORT: String(conn.port), PGUSER: conn.user, PGDATABASE: conn.db, PGPASSWORD: conn.password, PGSSLMODE: conn.ssl, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=0 -c search_path=pg_catalog,public', PGCONNECT_TIMEOUT: '20' });
const run = (cmd, args, input) => { const r = spawnSync(cmd, args, { env: childEnv(), input, encoding: 'utf8', maxBuffer: 1 << 28 }); return { status: r.status, out: r.stdout, err: (r.stderr || '').replace(new RegExp(conn.password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<redacted>') }; };
const sql = (q) => { const r = run('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], wrapReadOnly(q)); if (r.status !== 0) throw new Error(`psql: ${r.err.slice(0, 400)}`); return r.out.trim(); };
const put = (name, data, mode_ = 0o600) => { const p = join(out, name); mkdirSync(join(p, '..'), { recursive: true, mode: 0o700 }); writeFileSync(p, data, { mode: mode_ }); return p; };
const started = new Date().toISOString();

// 1. connectivity + actual privileges --------------------------------------------------------------------
const privileges = JSON.parse(sql(`select jsonb_build_object(
  'current_user', current_user, 'session_user', session_user, 'server_version', current_setting('server_version'),
  'transaction_read_only', current_setting('transaction_read_only'),
  'role', (select to_jsonb(r) from (select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls from pg_roles where rolname = current_user) r),
  'member_of', (select coalesce(jsonb_agg(g.rolname order by g.rolname), '[]') from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = (select oid from pg_roles where rolname = current_user)),
  'schema_usage', (select jsonb_object_agg(nspname, has_schema_privilege(nspname, 'USAGE')) from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'),
  'unreadable_tables', (select coalesce(jsonb_agg(n.nspname || '.' || c.relname order by n.nspname, c.relname), '[]') from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname in ('public', 'auth', 'storage', 'supabase_migrations') and not has_table_privilege(c.oid, 'SELECT')),
  'can_read_password_hashes', has_column_privilege('auth.users', 'encrypted_password', 'SELECT'),
  'can_read_storage_objects', has_table_privilege('storage.objects', 'SELECT')
)::text;`));
put('privileges.json', JSON.stringify(privileges, null, 2));
if (privileges.transaction_read_only !== 'on') throw new Error('session is not read-only');
// negative control: a write must be refused by this same guarded session (temp table => harmless even if it were not)
const writeProbe = run('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], wrapReadOnly('create temp table vno_ro_probe(a int)'));
if (writeProbe.status === 0 || !/read-only transaction/.test(writeProbe.err)) throw new Error('read-only negative control failed: a write was not rejected');
if (privileges.unreadable_tables.length) throw new Error(`role cannot read: ${privileges.unreadable_tables.join(', ')} - backup would be incomplete; stopping`);
if (!privileges.can_read_password_hashes) throw new Error('role cannot read auth.users.encrypted_password - login recovery impossible; stopping');

// 2. coverage inventory + fingerprints + checksums ---------------------------------------------------------
const tableList = sql(`select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname in ('public', 'auth', 'storage', 'supabase_migrations') order by 1;`).split('\n').filter(Boolean);
// one read-only REPEATABLE READ transaction => every table is checksummed from the same snapshot
const checksums = () => Object.fromEntries(sql(tableList.map((t) => { const [s, n] = t.split('.'); return `select '${t}' || '|' || count(*) || '|' || md5(coalesce(string_agg(x::text, E'\\n' order by x::text), '')) from "${s}"."${n}" x`; }).join('\nunion all\n')).split('\n').filter(Boolean).map((l) => {
  const [t, rows, md5] = l.split('|');
  return [t, { rows: Number(rows), md5, restored: !EPHEMERAL.has(t) }];
}));
const before = checksums();
put('catalog-fingerprint.json', sql(readFileSync(new URL('./catalog-fingerprint.sql', import.meta.url), 'utf8')));
put('financial-totals.json', JSON.stringify(JSON.parse(sql(`select jsonb_build_object('referral_transactions', (select jsonb_build_object('rows', count(*), 'document_total', coalesce(sum(document_total), 0), 'discount', coalesce(sum(document_discount_amount), 0), 'commission', coalesce(sum(commission_amount), 0)) from public.referral_transactions))::text;`)), null, 2));
const authCoverage = JSON.parse(sql(`select jsonb_build_object('auth_users', (select count(*) from auth.users), 'auth_identities', (select count(*) from auth.identities), 'users_with_password_hash', (select count(*) from auth.users where encrypted_password is not null and encrypted_password <> ''),
  'storage_buckets', (select coalesce(jsonb_agg(id order by id), '[]') from storage.buckets), 'storage_objects', (select count(*) from storage.objects), 'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
  'migration_versions', (select coalesce(jsonb_agg(version order by version), '[]') from supabase_migrations.schema_migrations))::text;`));

// 3. consistent dump (one snapshot across all schemas) ---------------------------------------------------
const dumpPath = join(out, 'full.dump');
const dump = run('pg_dump', ['--format=custom', '--compress=6', '-n', 'public', '-n', 'auth', '-n', 'storage', '-n', 'supabase_migrations', '--file', dumpPath]);
if (dump.status !== 0) throw new Error(`pg_dump failed: ${dump.err.slice(0, 500)}`);
chmodSync(dumpPath, 0o600);
const toc = run('pg_restore', ['--list', dumpPath]).out;
put('full.dump.toc.txt', toc);
const plainSchema = run('pg_dump', ['--schema-only', '-n', 'public', '--file', join(out, 'public-schema.sql')]);
if (plainSchema.status !== 0) throw new Error(`schema dump failed: ${plainSchema.err.slice(0, 300)}`);
const globals = run('pg_dumpall', ['--globals-only', '--no-role-passwords']);
put('globals-attempt.json', JSON.stringify({ status: globals.status, note: globals.status === 0 ? 'globals dumped without role passwords' : `not permitted for this role: ${globals.err.slice(0, 200)}` }, null, 2));
if (globals.status === 0) put('globals.sql', globals.out);
const after = checksums();
const stable = tableList.every((t) => before[t].rows === after[t].rows && before[t].md5 === after[t].md5);
put('row-checksums.json', JSON.stringify(after, null, 2));

// 4. anon probe (RLS behaviour reference) ---------------------------------------------------------------------
const publicTables = tableList.filter((t) => t.startsWith('public.')).map((t) => t.slice(7));
const probe = {};
for (const t of publicTables) { const r = await fetch(`${api.url}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: api.anonKey, Authorization: `Bearer ${api.anonKey}` } }); probe[t] = r.status; }
put('anon-probe.json', JSON.stringify(probe, null, 2));

// 5. API-level export incl. Storage object bytes (same tool as the logical backup) ---------------------------------
const logicalEnv = { ...process.env };
if (mode === 'local-test') { logicalEnv.VNO_BACKUP_API_URL = api.url; logicalEnv.VNO_BACKUP_API_KEY = api.serviceKey; }
const logical = spawnSync('node', [new URL('./backup-uat-logical.mjs', import.meta.url).pathname, join(out, 'logical')], { env: logicalEnv, encoding: 'utf8' });
if (logical.status !== 0) throw new Error(`logical/Storage export failed: ${logical.stderr.slice(0, 300)}`);
const logicalSummary = JSON.parse(logical.stdout);

// 6. manifest ---------------------------------------------------------------------------------------------------------
const files = {};
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name !== 'manifest.json') files[relative(out, p)] = sha(readFileSync(p)); } };
walk(out);
const manifest = {
  format: 'vno-uat-pg-backup-v1', status: 'complete', read_only_enforced: 'per-transaction (BEGIN ... REPEATABLE READ READ ONLY + in-transaction assertion + write negative control)', mode, project: 'hsezyogfxgnkpweoqqny', started_utc: started, finished_utc: new Date().toISOString(),
  server_version: privileges.server_version, connecting_role: privileges.role, member_of: privileges.member_of,
  tools: { pg_dump: execFileSync('pg_dump', ['--version'], { encoding: 'utf8' }).trim(), psql: execFileSync('psql', ['--version'], { encoding: 'utf8' }).trim() },
  coverage: { schemas_dumped: SCHEMAS, toc_entries: toc.split('\n').filter((l) => l && !l.startsWith(';')).length, tables: tableList.length, auth: authCoverage, ephemeral_tables_not_restored: [...EPHEMERAL], globals_dumped: globals.status === 0,
    password_hashes_included: true, role_settings_and_roles: 'captured in catalog-fingerprint.json (roles, role_settings, default_privileges); role passwords are managed by Supabase and not exported' },
  table_checksums_stable_before_vs_after_dump: stable, logical_export: logicalSummary, files,
};
put('manifest.json', JSON.stringify(manifest, null, 2));
renameSync(out, finalDir);
const manifestPath = join(finalDir, 'manifest.json');
console.log(JSON.stringify({ status: 'complete', backup_dir: finalDir, mode, server_version: privileges.server_version, role: privileges.role.rolname, superuser: privileges.role.rolsuper, bypassrls: privileges.role.rolbypassrls,
  tables: tableList.length, auth_users: authCoverage.auth_users, storage_objects: authCoverage.storage_objects, stable, dump_bytes: statSync(join(finalDir, 'full.dump')).size, manifest_sha256: sha(readFileSync(manifestPath)) }, null, 1));
