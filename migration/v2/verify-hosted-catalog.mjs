#!/usr/bin/env node
// Read-only catalog acceptance checks for the hosted UAT project AFTER the Snapshot-5 import: the import must not have changed schema,
// migration history, RLS, policies, grants, triggers, functions, roles or storage buckets; row counts and the financial total must be as expected.
// Compares live catalog queries with the pre-import backup's catalog-fingerprint.json / manifest (same SQL that produced them).
// Usage (hosted):  SUPABASE_DB_PASSWORD=... (exported in the shell, never on the command line)
//                  verify-hosted-catalog.mjs <pre-import-pg-backup-dir> <evidence.json>
//        (clone test): verify-hosted-catalog.mjs <backup-dir> <evidence.json> --local <supabase-workdir> <db-container>
// Every SQL statement runs inside BEGIN ... READ ONLY (wrapReadOnly). Checks that cannot run are NOT_RUN, never PASS.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { wrapReadOnly } from './backup-readonly.mjs';

const argv = process.argv.slice(2);
const [backupDir, evidenceOut] = argv;
const localIdx = argv.indexOf('--local');
const LOCAL = localIdx >= 0 ? { workdir: argv[localIdx + 1], container: argv[localIdx + 2] } : null;
const UAT_REF = 'hsezyogfxgnkpweoqqny';
if (!backupDir || !evidenceOut) throw new Error('usage: verify-hosted-catalog.mjs <backup-dir> <evidence.json> [--local <workdir> <container>]');
const checks = [];
const check = (id, name, pass, evidence) => { checks.push({ id, name, status: pass ? 'PASS' : 'FAIL', evidence }); console.error(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${JSON.stringify(evidence).slice(0, 240)}`); };

let psqlRun;
if (LOCAL) {
  const env = Object.fromEntries(execFileSync('supabase', ['status', '--workdir', LOCAL.workdir, '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((l) => l.includes('=')).map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').replace(/^"|"$/g, '')]; }));
  if (!/^http:\/\/127\.0\.0\.1:/.test(env.API_URL)) throw new Error('refusing: --local target is not local');
  psqlRun = (sql) => spawnSync('docker', ['exec', '-i', '-e', `PGPASSWORD=${decodeURIComponent(new URL(env.DB_URL).password)}`, LOCAL.container, 'psql', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: wrapReadOnly(sql), encoding: 'utf8', maxBuffer: 1 << 28 });
} else {
  if (readFileSync(new URL('../../supabase/.temp/project-ref', import.meta.url), 'utf8').trim() !== UAT_REF) throw new Error('refusing: linked project is not the approved UAT project');
  if (!process.env.SUPABASE_DB_PASSWORD) { console.error('NOT_RUN: SUPABASE_DB_PASSWORD is not set; no catalog check can run'); writeFileSync(evidenceOut, JSON.stringify({ generated_utc: new Date().toISOString(), outcome: 'NOT_RUN', reason: 'SUPABASE_DB_PASSWORD not set', checks: [] }, null, 2)); process.exit(3); }
  const u = new URL(readFileSync(new URL('../../supabase/.temp/pooler-url', import.meta.url), 'utf8').trim());
  psqlRun = (sql) => spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: wrapReadOnly(sql), encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGDATABASE: u.pathname.slice(1) || 'postgres', PGPASSWORD: process.env.SUPABASE_DB_PASSWORD, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '20' } });
}
// K4 fix: pg_get_constraintdef/pg_get_expr/pg_policies render names relative to search_path, so the fingerprint is only comparable when
// search_path is pinned. It is set with SET LOCAL inside the same read-only transaction that runs the query (nothing persistent changes).
const SEARCH_PATH = 'pg_catalog, public';
const sql = (q) => { const r = psqlRun(`set local search_path = ${SEARCH_PATH};\n${q}`); if (r.status !== 0) throw new Error(String(r.stderr).replace(process.env.SUPABASE_DB_PASSWORD || '\u0000', '<redacted>').slice(0, 300)); return r.stdout.trim(); };
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

const baseFp = JSON.parse(readFileSync(join(backupDir, 'catalog-fingerprint.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8'));
const fpOut = sql(`select current_setting('search_path');\n${readFileSync(new URL('./catalog-fingerprint.sql', import.meta.url), 'utf8')}`);
const nl = fpOut.indexOf('\n');
const fpSearchPath = fpOut.slice(0, nl).trim();
if (fpSearchPath !== SEARCH_PATH) throw new Error(`fingerprint transaction ran with search_path '${fpSearchPath}', expected '${SEARCH_PATH}'`);
const nowFp = JSON.parse(fpOut.slice(nl + 1));
const group = (id, name, sections) => {
  const diff = sections.filter((s) => stable(nowFp[s]) !== stable(baseFp[s]));
  check(id, name, diff.length === 0, { sections: sections.length, differing: diff, ...(diff.length ? { counts: Object.fromEntries(diff.map((s) => [s, [baseFp[s]?.length, nowFp[s]?.length]])) } : {}) });
};

// K1 migration history
const versions = JSON.parse(sql(`select coalesce(jsonb_agg(version order by version), '[]') from supabase_migrations.schema_migrations`));
const baseVersions = manifest.coverage.auth.migration_versions;
const repoVersions = readdirSync(new URL('../../supabase/migrations', import.meta.url)).map((f) => f.split('_')[0]).filter((v) => /^\d{14}$/.test(v)).sort();
check('K1', 'migration history: hosted schema_migrations equals the pre-import history (the import applied no migration)', stable(versions) === stable(baseVersions),
  { hosted: versions.length, pre_import: baseVersions.length, in_repo_not_applied: repoVersions.filter((v) => !versions.includes(v)), applied_not_in_repo: versions.filter((v) => !repoVersions.includes(v)) });
// K2..K5 catalog groups
group('K2', 'RLS flags, table/function ACLs, policies (public + storage) and default privileges unchanged', ['public_relations', 'policies', 'default_privileges', 'schema_acls_app', 'schema_acls_managed']);
group('K3', 'roles and role settings unchanged (no role created/altered/granted by the import)', ['roles', 'role_settings']);
group('K4', 'schema unchanged: columns, constraints, indexes, triggers (incl. the fractional-rate guard, C17), functions, views, extensions', ['public_columns', 'constraints', 'indexes', 'triggers', 'functions', 'view_defs', 'extensions']);
group('K5', 'Auth table structure and Storage buckets/limits unchanged', ['auth_tables', 'storage_buckets']);
const guard = sql(`select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.merchant_details'::regclass and not t.tgisinternal and t.tgenabled = 'O' and p.proname = 'enforce_fractional_merchant_rates'`);
check('C17', 'D5: the fractional-rate guard trigger exists and is enabled on public.merchant_details', guard === '1', { enabled_guard_triggers: Number(guard) });
// C18 foreign keys
const fks = sql(`select c.conrelid::regclass, c.confrelid::regclass, (select string_agg(format('c.%I', a.attname), ',' order by u.ord) from unnest(c.conkey) with ordinality u(att,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=u.att), (select string_agg(format('p.%I', a.attname), ',' order by u.ord) from unnest(c.confkey) with ordinality u(att,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=u.att), c.conname from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.contype='f' and n.nspname='public'`).split('\n').filter(Boolean).map((l) => l.split('|'));
const fkBad = [];
for (const [child, parent, cc, pc, name] of fks) { const cl = cc.split(','), pl = pc.split(','); const n = Number(sql(`select count(*) from ${child} c where ${cl.map((c) => `${c} is not null`).join(' and ')} and not exists (select 1 from ${parent} p where ${cl.map((c, i) => `${c} = ${pl[i]}`).join(' and ')})`)); if (n) fkBad.push({ fk: name, orphans: n }); }
check('C18', 'all foreign keys in public resolve (no orphan rows)', fkBad.length === 0 && fks.length > 0, { checked: fks.length, violations: fkBad });
// K6 totals
const counts = JSON.parse(sql(`select jsonb_build_object('auth_users', (select count(*) from auth.users), 'auth_identities', (select count(*) from auth.identities), 'storage_objects', (select count(*) from storage.objects), 'media_assets', (select count(*) from public.media_assets), 'tx', (select count(*) from public.referral_transactions), 'tx_total', (select coalesce(sum(document_total), 0) from public.referral_transactions)::text, 'source_records', (select count(*) from public.legacy_source_records), 'dup_partner_codes', (select count(*) from (select lower(btrim(collaborators_code)) from public.collaborators group by 1 having count(*) > 1) d))::text`));
const baseTx = JSON.parse(readFileSync(join(backupDir, 'financial-totals.json'), 'utf8')).referral_transactions;
const expectTx = (BigInt(Math.round(Number(baseTx.document_total) * 10000)) + 3807051620000n);
const gotTx = BigInt(Math.round(Number(counts.tx_total) * 10000));
check('K6', 'database totals: 475 Auth users and identities, 616 Storage objects and media rows, 114 transactions totalling pre-import + 380705162.0000, 14260 source records, 0 duplicate Partner codes',
  counts.auth_users === 475 && counts.auth_identities === 475 && counts.storage_objects === 616 && counts.media_assets === 616 && counts.tx === 114 && gotTx === expectTx && counts.source_records === 14260 && counts.dup_partner_codes === 0, counts);

// K7 no unrelated change: tables the import does not write must be byte-identical (rows + md5 of all rows, same query as the backup) to the pre-import backup
const IMPORT_WRITTEN = new Set(['merchant_details', 'collaborators', 'referral_transactions', 'merchant_category_links', 'categories', 'merchant_update_requests', 'media_assets', 'user_profiles', 'legacy_identity_map', 'legacy_import_conflicts', 'legacy_migration_batches', 'legacy_migration_runs', 'legacy_source_records', 'legacy_tenant_evidence']);
const baseSums = JSON.parse(readFileSync(join(backupDir, 'row-checksums.json'), 'utf8'));
const publicTables = Object.keys(baseSums).filter((t) => t.startsWith('public.')).map((t) => t.slice(7));
const liveSums = Object.fromEntries(sql(publicTables.map((t) => `select '${t}' || '|' || count(*) || '|' || md5(coalesce(string_agg(x::text, E'\\n' order by x::text), '')) from "public"."${t}" x`).join('\nunion all\n')).split('\n').filter(Boolean).map((l) => { const [t, rows, md5] = l.split('|'); return [t, { rows: Number(rows), md5 }]; }));
const untouched = publicTables.filter((t) => !IMPORT_WRITTEN.has(t) && t !== 'audit_events');
const k7bad = untouched.filter((t) => liveSums[t]?.md5 !== baseSums[`public.${t}`].md5 || liveSums[t]?.rows !== baseSums[`public.${t}`].rows);
const auditNow = liveSums.audit_events?.rows ?? null;
check('K7', 'no unrelated change: every public table the import does not write is byte-identical to the pre-import backup (audit_events may only have grown)', k7bad.length === 0 && untouched.length > 0 && auditNow >= baseSums['public.audit_events'].rows,
  { compared_tables: untouched, differing: k7bad, audit_events: { before: baseSums['public.audit_events'].rows, now: auditNow }, search_path: fpSearchPath });

const out = { generated_utc: new Date().toISOString(), mode: LOCAL ? 'local-clone' : 'hosted', pass: checks.filter((c) => c.status === 'PASS').length, fail: checks.filter((c) => c.status === 'FAIL').length, checks };
writeFileSync(evidenceOut, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ mode: out.mode, pass: out.pass, fail: out.fail, failing: checks.filter((c) => c.status === 'FAIL').map((c) => c.id) }));
process.exit(out.fail ? 1 : 0);
