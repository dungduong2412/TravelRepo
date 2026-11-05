#!/usr/bin/env node
// Regression test for the Gate C read-only failure ("session is not read-only") and for incomplete-output handling.
// Usage: test-backup-readonly.mjs <local-supabase-workdir>   (local stack only; nothing here writes to a database)
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOT_READ_ONLY, wrapReadOnly } from './backup-readonly.mjs';

const workdir = process.argv[2];
if (!workdir) throw new Error('usage: test-backup-readonly.mjs <local-supabase-workdir>');
const st = Object.fromEntries(execFileSync('supabase', ['status', '--workdir', workdir, '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((l) => l.includes('=')).map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').replace(/^"|"$/g, '')]; }));
const u = new URL(st.DB_URL);
if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('refusing: local database required');
const realPsql = execFileSync('which', ['psql'], { encoding: 'utf8' }).trim();
const pgEnv = { ...process.env, PGHOST: u.hostname, PGPORT: u.port, PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: 'postgres', PGSSLMODE: 'disable' };
delete pgEnv.PGOPTIONS; // what the hosted pooler effectively does: startup options are not applied
const psql = (input, env = pgEnv) => spawnSync(realPsql, ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env, input, encoding: 'utf8' });
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'vno-ro-test-')));
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${detail}`}`); };

// T1 reproduces the production failure: with startup options not applied, a bare check reports 'off'.
const bare = psql("select current_setting('transaction_read_only')");
check('T1 repro: without per-transaction READ ONLY the session reports off (pooler ignoring startup options)', bare.stdout.trim() === 'off', bare.stdout + bare.stderr);

// T2 the fix: the guarded transaction reports on even though startup options are not applied.
const guarded = psql(wrapReadOnly("select current_setting('transaction_read_only')"));
check('T2 guarded transaction reports transaction_read_only=on with no startup options', guarded.status === 0 && guarded.stdout.trim() === 'on', guarded.stdout + guarded.stderr);

// T3 a write inside the guarded transaction is refused by PostgreSQL.
const write = psql(wrapReadOnly('create temp table vno_ro_probe(a int)'));
check('T3 write attempt inside guarded transaction is rejected (25006)', write.status !== 0 && /read-only transaction/.test(write.stderr), write.stderr);

// T4 an incorrectly configured read-write transaction is detected by the in-transaction assertion.
const rw = psql(wrapReadOnly("select 'should-not-run'", 'READ WRITE'));
check('T4 READ WRITE transaction is rejected by the assertion and runs no work', rw.status !== 0 && rw.stderr.includes(NOT_READ_ONLY) && !rw.stdout.includes('should-not-run'), rw.stdout + rw.stderr);

// T5 the real script aborts if its psql sessions turn out read-write (psql shim silently downgrades READ ONLY).
const shim = join(tmp, 'shim'); execFileSync('mkdir', [shim]);
writeFileSync(join(shim, 'psql'), `#!/bin/bash\nsed 's/repeatable read READ ONLY;/repeatable read READ WRITE;/' | exec "${realPsql}" "$@"\n`); chmodSync(join(shim, 'psql'), 0o755);
const script = new URL('./backup-uat-pg.mjs', import.meta.url).pathname;
const runScript = (outDir, pathPrefix = '') => spawnSync('node', [script, outDir, '--local', workdir, 'unused'], { env: { ...process.env, PATH: `${pathPrefix}${process.env.PATH}` }, encoding: 'utf8' });
const rwRun = runScript(join(tmp, 'rw-backup'), `${shim}:`);
check('T5 script aborts on a read-write session and produces no finished backup', rwRun.status !== 0 && rwRun.stderr.includes(NOT_READ_ONLY) && !existsSync(join(tmp, 'rw-backup')), rwRun.stderr.slice(0, 300));
check('T5b failed run leaves a marked .incomplete directory, never the final directory', existsSync(join(tmp, 'rw-backup.incomplete', 'INCOMPLETE-DO-NOT-USE.txt')));

// T6 a failing pg_dump cannot yield a finished backup.
const bad = join(tmp, 'badpath'); execFileSync('mkdir', [bad]);
writeFileSync(join(bad, 'pg_dump'), '#!/bin/bash\necho boom >&2\nexit 1\n'); chmodSync(join(bad, 'pg_dump'), 0o755);
const dumpRun = runScript(join(tmp, 'dump-fail'), `${bad}:`);
check('T6 failed pg_dump leaves no final directory', dumpRun.status !== 0 && !existsSync(join(tmp, 'dump-fail')) && existsSync(join(tmp, 'dump-fail.incomplete', 'INCOMPLETE-DO-NOT-USE.txt')), dumpRun.stderr.slice(0, 300));

// T7 leftovers block a retry rather than being mixed into a new backup.
const retry = runScript(join(tmp, 'rw-backup'));
check('T7 retry refuses while a previous .incomplete directory exists', retry.status !== 0 && /left over from an earlier failed attempt/.test(retry.stderr), retry.stderr.slice(0, 300));

// T8 a genuine run completes, is marked complete and the final directory appears only then.
const good = runScript(join(tmp, 'good'));
const manifest = existsSync(join(tmp, 'good', 'manifest.json')) ? JSON.parse(readFileSync(join(tmp, 'good', 'manifest.json'), 'utf8')) : {};
check('T8 genuine run completes: manifest status=complete, no .incomplete left, stable checksums', good.status === 0 && manifest.status === 'complete' && manifest.table_checksums_stable_before_vs_after_dump === true && !existsSync(join(tmp, 'good.incomplete')), good.stderr.slice(0, 300));
const priv = existsSync(join(tmp, 'good', 'privileges.json')) ? JSON.parse(readFileSync(join(tmp, 'good', 'privileges.json'), 'utf8')) : {};
check('T8b privileges.json records transaction_read_only=on', priv.transaction_read_only === 'on', JSON.stringify(priv.transaction_read_only));

console.log(failed ? `\n${failed} FAILED (scratch dir: ${tmp})` : `\nall passed (scratch dir: ${tmp})`);
process.exit(failed ? 1 : 0);
