#!/usr/bin/env node
// Regression tests for the Gate C restore failures: missing roles (prisma_user), managed Auth schema drift
// (auth.mfa_recovery_code_sets), and P1 short-circuit behaviour of restore-and-verify-pg-backup.mjs.
// Usage: test-restore-preflight.mjs                                   unit tests only (no database)
//        test-restore-preflight.mjs <backup-dir> <target-workdir> <target-container>   + integration tests
// Integration tests need the isolated local target freshly reset (supabase db reset); the last one leaves it dirty -
// reset the target again before the real restore. Nothing here touches hosted UAT.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { CheckLog, authDrift, inBackupScope, columnDrift, copyColumns, parseGlobalsRoles, planRoleMapping, referencedRoles } from './restore-preflight.mjs';

let failed = 0;
const t = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${detail}`}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- unit: role references -------------------------------------------------------------------------------------------
const sql = `ALTER TABLE public.a OWNER TO postgres;
GRANT ALL ON TABLE public.a TO prisma_user;
GRANT ALL ON SCHEMA public TO anon, "weird-role" WITH GRANT OPTION;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO prisma_user;
CREATE POLICY p ON public.a FOR SELECT TO authenticated, service_role USING (true);
ALTER FUNCTION public.f() OWNER TO pg_database_owner;`;
t('U1 referencedRoles finds owners, grant recipients, default-privilege roles and policy roles; ignores PUBLIC/pg_database_owner',
  eq([...referencedRoles(sql)].sort(), ['anon', 'authenticated', 'postgres', 'prisma_user', 'service_role', 'weird-role']), JSON.stringify([...referencedRoles(sql)]));

// ---- unit: role mapping ----------------------------------------------------------------------------------------------
const globals = parseGlobalsRoles(`ALTER ROLE prisma_user WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
ALTER ROLE evil WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION BYPASSRLS;
ALTER ROLE boss WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;
GRANT prisma_user TO postgres WITH ADMIN OPTION, INHERIT FALSE, SET FALSE GRANTED BY supabase_admin;`);
const target = ['postgres', 'anon', 'supabase_admin'];
const base = { targetRoles: target, globals };
const missing = planRoleMapping({ ...base, referenced: new Set(['postgres', 'prisma_user']), roleMap: {} });
t('U2 a missing role without a reviewed mapping is reported, never created', !missing.ok && eq(missing.unmapped, ['prisma_user']) && !missing.create.length);
const priv = planRoleMapping({ ...base, referenced: new Set(['evil', 'boss']), roleMap: { evil: {}, boss: {} } });
t('U3 a mapped role that is privileged in the source (BYPASSRLS/SUPERUSER...) is refused', !priv.ok && priv.unsafe.length === 2 && !priv.create.length, JSON.stringify(priv.unsafe));
const ok = planRoleMapping({ ...base, referenced: new Set(['postgres', 'prisma_user']), roleMap: { prisma_user: {} } });
t('U4 an unprivileged mapped role is created NOLOGIN with no elevated attributes and keeps its postgres membership',
  ok.ok && /nosuperuser inherit nocreaterole nocreatedb nologin noreplication nobypassrls/.test(ok.create[0].sql) && /^GRANT prisma_user TO postgres WITH ADMIN OPTION, INHERIT FALSE, SET FALSE/.test(ok.memberships[0].sql), JSON.stringify(ok));
const norec = planRoleMapping({ ...base, referenced: new Set(['ghost']), roleMap: { ghost: {} } });
t('U5 a mapped role absent from the backup role record is refused', !norec.ok && eq(norec.unrecorded, ['ghost']));
const gOrphan = parseGlobalsRoles(`ALTER ROLE prisma_user WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS;
GRANT prisma_user TO ghost_member WITH ADMIN OPTION;`);
const memberGone = planRoleMapping({ targetRoles: ['postgres'], referenced: new Set(['prisma_user']), roleMap: { prisma_user: {} }, globals: gOrphan });
t('U6 a membership naming a role absent from the target blocks the restore', !memberGone.ok && eq(memberGone.memberRolesMissing, ['ghost_member']), JSON.stringify(memberGone.memberRolesMissing));

// ---- unit: managed Auth drift ----------------------------------------------------------------------------------------
const col = (t_, c, type = 'uuid') => ({ t: t_, c, type });
const srcAuth = [col('users', 'id'), col('mfa_factors', 'id'), col('mfa_recovery_code_sets', 'id'), col('one_time_tokens', 'expires_at', 'timestamptz')];
const oldTarget = [col('users', 'id'), col('mfa_factors', 'id')];
const d1 = authDrift(srcAuth, oldTarget);
t('U7 a managed Auth table present in the source but absent from the target (auth.mfa_recovery_code_sets) is detected', !d1.compatible && eq(d1.tables_only_in_source, ['mfa_recovery_code_sets', 'one_time_tokens']), JSON.stringify(d1));
const d2 = authDrift([col('users', 'id'), col('users', 'banned_until', 'timestamptz')], [col('users', 'id')]);
t('U8 a column missing from an existing managed table is detected', !d2.compatible && eq(d2.columns_only_in_source, ['users.banned_until:timestamptz']), JSON.stringify(d2));
t('U9 identical schemas are compatible', authDrift(srcAuth, [...srcAuth]).compatible);

const cc = copyColumns(`COPY storage.buckets (id, name, versioning_status) FROM stdin;
COPY auth.users (id, email) FROM stdin;
COPY public.things (a) FROM stdin;
COPY auth.sessions (id, new_col) FROM stdin;`);
t('U13 copyColumns reads managed-schema COPY column lists and skips public', eq(Object.keys(cc), ['storage.buckets', 'auth.users', 'auth.sessions']) && eq(cc['storage.buckets'], ['id', 'name', 'versioning_status']));
const cd = columnDrift(cc, { 'storage.buckets': ['id', 'name'], 'auth.users': ['id', 'email'], 'auth.sessions': ['id'] }, new Set(['storage.buckets', 'auth.users']));
t('U14 a column the dump writes but the target lacks (storage.buckets.versioning_status) blocks; same gap in a non-restored table is informational',
  !cd.compatible && eq(cd.blocking, [{ table: 'storage.buckets', table_missing_in_target: false, columns_missing_in_target: ['versioning_status'] }]) && cd.informational[0].table === 'auth.sessions', JSON.stringify(cd));
t('U15 a managed table missing entirely from the target blocks', !columnDrift({ 'auth.mfa_recovery_code_sets': ['id'] }, {}, new Set(['auth.mfa_recovery_code_sets'])).compatible);

t('U16 default privileges are scoped to the backed-up schemas (realtime/supabase_functions excluded, public/storage kept)',
  eq(inBackupScope([{ schema: 'public' }, { schema: 'realtime' }, { schema: 'supabase_functions' }, { schema: 'storage' }]).map((r) => r.schema), ['public', 'storage']));

// ---- unit: check log / short-circuit semantics -----------------------------------------------------------------------
const mk = () => { let written; const l = new CheckLog(['P0a', 'P1', 'P2', 'P3'], (o) => { written = o; }); return { l, get: () => written }; };
const silence = (fn) => { const e = console.error, o = console.log; console.error = console.log = () => {}; try { return fn(); } finally { console.error = e; console.log = o; } };
{
  const { l, get } = mk();
  const code = silence(() => { l.check('P0a', 'x', true, {}); l.check('P1', 'restore', false, { errors: ['role "prisma_user" does not exist'] }); return l.finish('P1'); });
  const w = get();
  t('U10 failed P1: exit 1, gate_c FAIL, P2/P3 recorded NOT_RUN with the reason, no later PASS', code === 1 && w.gate_c === 'FAIL' && eq(w.not_run.map((n) => `${n.id}:${n.reason}`), ['P2:prerequisite P1 failed', 'P3:prerequisite P1 failed']) && !w.checks.some((c) => c.id === 'P2' || c.id === 'P3'), JSON.stringify(w));
}
{
  const { l, get } = mk();
  const code = silence(() => { ['P0a', 'P1', 'P2'].forEach((id) => l.check(id, id, true, {})); return l.finish(); });
  t('U11 all checks PASS but a planned check never ran => gate_c FAIL (cannot be PASS by omission)', code === 1 && get().gate_c === 'FAIL' && get().not_run[0].id === 'P3');
}
{
  const { l, get } = mk();
  const code = silence(() => { ['P0a', 'P1', 'P2', 'P3'].forEach((id) => l.check(id, id, true, {})); return l.finish(); });
  t('U12 every planned check ran and passed => gate_c PASS', code === 0 && get().gate_c === 'PASS' && !get().not_run.length);
}

// ---- integration (real script against the isolated local target) ----------------------------------------------------------
const [backup, workdir, container] = process.argv.slice(2);
if (backup) {
  const script = new URL('./restore-and-verify-pg-backup.mjs', import.meta.url).pathname;
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'vno-restore-test-')));
  const st = Object.fromEntries(execFileSync('supabase', ['status', '--workdir', workdir, '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((l) => l.includes('=')).map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').replace(/^"|"$/g, '')]; }));
  const u = new URL(st.DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('refusing: local target required');
  const pg = { ...process.env, PGHOST: u.hostname, PGPORT: u.port, PGUSER: 'supabase_admin', PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: 'postgres', PGSSLMODE: 'disable' };
  const q = (s) => spawnSync('psql', ['-X', '-At', '-c', s], { env: pg, encoding: 'utf8' }).stdout.trim();
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const run = (dir, ev, env = {}, pathPrefix = '') => {
    const r = spawnSync('node', [script, dir, workdir, container, ev], { env: { ...process.env, ...env, PATH: `${pathPrefix}${process.env.PATH}` }, encoding: 'utf8' });
    return { ...r, ev: existsSync(ev) ? JSON.parse(readFileSync(ev, 'utf8')) : null };
  };
  const derive = (name, edit) => { // copy of the backup with one file changed and the manifest re-sealed
    const dir = join(tmp, name); cpSync(backup, dir, { recursive: true });
    edit(dir);
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    for (const f of Object.keys(m.files)) m.files[f] = sha(readFileSync(join(dir, f)));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
    return dir;
  };
  const snapshot = () => ({ users: q('select count(*) from auth.users'), public: q("select count(*) from pg_tables where schemaname = 'public'"), prisma: q("select count(*) from pg_roles where rolname = 'prisma_user'") });
  const clean = snapshot().users === '0' && snapshot().public === '0';
  t('I0 integration precondition: target is freshly reset', clean, JSON.stringify(snapshot()));

  // I1 missing role with no reviewed mapping: stops before any change
  const emptyMap = join(tmp, 'empty-role-map.json'); writeFileSync(emptyMap, '{}');
  const before = snapshot();
  const i1 = run(backup, join(tmp, 'i1.json'), { VNO_RESTORE_ROLE_MAP: emptyMap });
  t('I1 unmapped missing role: P0c FAIL, P1-P9 NOT_RUN, nothing changed in the target, clean exit with evidence file',
    i1.status === 1 && i1.ev?.gate_c === 'FAIL' && i1.ev.checks.find((c) => c.id === 'P0c')?.status === 'FAIL' && i1.ev.checks.find((c) => c.id === 'P0c').evidence.unmapped.includes('prisma_user')
    && i1.ev.not_run.some((n) => n.id === 'P1') && !/\n\s+at /.test(i1.stderr) && eq(before, snapshot()), (i1.stderr || '').slice(0, 400));

  // I2 managed Auth table the target lacks (older GoTrue): stops at P0b with the full drift listed
  const drifted = derive('drift', (dir) => {
    const f = JSON.parse(readFileSync(join(dir, 'catalog-fingerprint.json'), 'utf8'));
    f.auth_tables.push({ t: 'mfa_recovery_code_sets_from_newer_gotrue', c: 'id', type: 'uuid' }, { t: 'users', c: 'column_from_newer_gotrue', type: 'text' });
    writeFileSync(join(dir, 'catalog-fingerprint.json'), JSON.stringify(f));
  });
  const i2 = run(drifted, join(tmp, 'i2.json'));
  const p0b = i2.ev?.checks.find((c) => c.id === 'P0b');
  t('I2 managed Auth drift: P0b FAIL lists missing table and column, P0c/P1-P9 NOT_RUN, target unchanged',
    i2.status === 1 && p0b?.status === 'FAIL' && p0b.evidence.tables_only_in_source.includes('mfa_recovery_code_sets_from_newer_gotrue') && p0b.evidence.columns_only_in_source.includes('users.column_from_newer_gotrue:text')
    && i2.ev.not_run.some((n) => n.id === 'P1') && !i2.ev.checks.some((c) => c.id === 'P1') && eq(before, snapshot()), (i2.stderr || '').slice(0, 400));

  // I3 tampered backup file is refused before the target is touched
  const tampered = derive('tampered', () => {}); writeFileSync(join(tampered, 'anon-probe.json'), '{}');
  const i3 = run(tampered, join(tmp, 'i3.json'));
  t('I3 backup whose file no longer matches the manifest is refused with a diagnostic artifact', i3.status === 1 && /does not match the manifest checksum/.test(i3.ev?.refused || ''), (i3.stderr || '').slice(0, 300));

  // I4 P1 fails (pg_restore shim): short-circuit, structured evidence, no crash, nothing reported PASS afterwards
  const shim = join(tmp, 'shim'); mkdirSync(shim);
  const realRestore = execFileSync('which', ['pg_restore'], { encoding: 'utf8' }).trim();
  writeFileSync(join(shim, 'pg_restore'), `#!/bin/bash\nfor a in "$@"; do if [ "$a" = "--dbname" ]; then echo 'pg_restore: error: simulated: relation "auth.mfa_recovery_code_sets" does not exist' >&2; exit 1; fi; done\nexec "${realRestore}" "$@"\n`); chmodSync(join(shim, 'pg_restore'), 0o755);
  const i4 = run(backup, join(tmp, 'i4.json'), {}, `${shim}:`);
  const ids = (i4.ev?.checks || []).map((c) => c.id);
  t('I4 P1 failure: exit 1 without an unhandled exception, P1 FAIL with the restore errors, P2-P9 NOT_RUN and absent from checks',
    i4.status === 1 && i4.ev?.gate_c === 'FAIL' && i4.ev.checks.find((c) => c.id === 'P1')?.status === 'FAIL' && i4.ev.diagnostics?.p1 && ['P2', 'P3', 'P8', 'P9'].every((id) => i4.ev.not_run.some((n) => n.id === id)) && !ids.some((id) => /^P[2-9]$/.test(id)) && !/\n\s+at /.test(i4.stderr),
    `${ids} :: ${(i4.stderr || '').slice(-400)}`);
  t('I4b P1 failure left the P0c role mapping applied (so the failure is attributable to restore, not roles)', q("select count(*) from pg_roles where rolname = 'prisma_user'") === '1');
  console.log(`scratch: ${tmp}`);
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
