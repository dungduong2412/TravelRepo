#!/usr/bin/env node
// Pre-import row validation against a restored copy of the REAL UAT schema (Gate C clone). Reports EVERY row the importer
// would write that the target's constraints (types/lengths, NOT NULL, CHECK, UNIQUE/PK incl. rows already in the target) reject,
// instead of stopping at the first error. Nothing is written to the target: the importer runs from a patched in-memory copy whose
// upsert/createAuthUser/upload only record what they would send, and validation happens in rolled-back temp tables.
// Usage: prevalidate-import-rows.mjs <snapshot-dir> <local-supabase-workdir> <evidence.json>
//   (local stack only; VNO_SNAPSHOT_LABEL defaults to snapshot-4)
import { spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [snapDir, workdir, evidenceOut] = process.argv.slice(2);
if (!snapDir || !workdir || !evidenceOut) throw new Error('usage: prevalidate-import-rows.mjs <snapshot-dir> <local-supabase-workdir> <evidence.json>');
const st = Object.fromEntries(execFileSync('supabase', ['status', '--workdir', workdir, '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((l) => l.includes('=')).map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').replace(/^"|"$/g, '')]; }));
const db = new URL(st.DB_URL);
if (!['127.0.0.1', 'localhost'].includes(db.hostname) || !st.API_URL.startsWith('http://127.0.0.1:')) throw new Error('refusing: local target required');
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'vno-prevalidate-')));
const cap = join(tmp, 'captured.jsonl'); writeFileSync(cap, '');
let src = readFileSync(new URL('./import-sealed-snapshot.mjs', import.meta.url), 'utf8');
const patch = (from, to) => { if (!src.includes(from)) throw new Error(`importer layout changed; cannot patch: ${from.slice(0, 40)}`); src = src.replace(from, to); };
patch('async upsert(table, rows, onConflict, batchSize = 250) {', "async upsert(table, rows, onConflict, batchSize = 250) {\n    (await import('node:fs')).appendFileSync(process.env.VNO_CAPTURE_FILE, JSON.stringify({ table, onConflict, rows }) + '\\n'); return;");
patch('async createAuthUser(row) {', 'async createAuthUser(row) {\n    return { id: row.id, email: row.email, app_metadata: row.app_metadata };');
patch('async upload(bucket, objectPath, bytes, mime) {', 'async upload(bucket, objectPath, bytes, mime) {\n    return null;');
const patched = join(tmp, 'importer-capture.mjs'); writeFileSync(patched, src);
const run = spawnSync('node', [patched, '--include-auth', '--include-media'], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, VNO_SNAPSHOT_LABEL: process.env.VNO_SNAPSHOT_LABEL || 'snapshot-4', VNO_SNAPSHOT_DIR: snapDir, VNO_TARGET_URL: st.API_URL, VNO_TARGET_SERVICE_ROLE_KEY: st.SERVICE_ROLE_KEY, VNO_CAPTURE_FILE: cap, VNO_D2_PRIVATE_DIR: join(tmp, 'private') } });
if (run.status !== 0) throw new Error(`importer (capture mode) failed before producing rows: ${run.stderr.slice(-600)}`);

// group by table, apply upsert semantics (later rows with the same conflict key replace earlier ones)
const byTable = new Map();
for (const line of readFileSync(cap, 'utf8').split('\n').filter(Boolean)) {
  const { table, onConflict, rows } = JSON.parse(line);
  const g = byTable.get(table) || { onConflict, rows: new Map() };
  const keys = onConflict.split(',');
  for (const r of rows) g.rows.set(keys.map((k) => String(r[k])).join('|'), r);
  byTable.set(table, g);
}
const pgEnv = { ...process.env, PGHOST: db.hostname, PGPORT: db.port, PGUSER: 'supabase_admin', PGPASSWORD: decodeURIComponent(db.password), PGDATABASE: 'postgres', PGSSLMODE: 'disable' };
const results = [];
for (const [table, g] of byTable) {
  const rows = [...g.rows.values()];
  const keys = g.onConflict.split(',');
  const dataFile = join(tmp, `${table}.json`); writeFileSync(dataFile, JSON.stringify(rows));
  const keyCols = keys.map((k) => `"${k}"`).join(', ');
  const sql = `\\set rows \`cat ${dataFile}\`
begin;
create temp table cap_t (like public."${table}" including defaults including identity including generated including constraints including indexes) on commit drop;
insert into cap_t overriding system value select t.* from public."${table}" t where not exists (select 1 from jsonb_populate_recordset(null::public."${table}", :'rows'::jsonb) c where (${keys.map((k) => `c."${k}" is not distinct from t."${k}"`).join(' and ')}));
create temp table cap_errors (idx int, key text, sqlstate text, message text) on commit drop;
do $v$
declare e jsonb; i int := 0; cols text; begin
  for e in select value from jsonb_array_elements(current_setting('vno.rows')::jsonb) loop
    i := i + 1;
    select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(e) k;
    begin
      execute format('insert into cap_t (%s) select %s from jsonb_populate_record(null::public."${table}", $1)', cols, cols) using e;
    exception when others then
      insert into cap_errors values (i, (select string_agg(coalesce(e->>k, ''), '|') from unnest(string_to_array('${g.onConflict}', ',')) k), sqlstate, sqlerrm);
    end;
  end loop;
end $v$;
select jsonb_build_object('table', '${table}', 'rows', ${rows.length}, 'rejected', (select count(*) from cap_errors), 'errors', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from cap_errors order by idx limit 25) x), '[]'))::text;
rollback;`;
  const withSetting = `select set_config('vno.rows', :'rows', false);\n`;
  const full = sql.replace('begin;', `begin;\n${withSetting}`);
  const r = spawnSync('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env: pgEnv, input: full, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { results.push({ table, rows: rows.length, rejected: null, harness_error: r.stderr.slice(0, 400) }); continue; }
  const line = r.stdout.split('\n').filter((l) => l.startsWith('{')).pop();
  results.push(JSON.parse(line));
}
const rejected = results.filter((x) => x.rejected !== 0);
const out = { generated_utc: new Date().toISOString(), snapshot: process.env.VNO_SNAPSHOT_LABEL || 'snapshot-4', tables_checked: results.length, tables_with_rejections: rejected.length, results };
writeFileSync(evidenceOut, JSON.stringify(out, null, 2));
for (const r of results) console.error(`${r.rejected === 0 ? 'OK  ' : 'FAIL'} ${r.table} rows=${r.rows} rejected=${r.rejected}${r.harness_error ? ` harness_error=${r.harness_error}` : ''}`);
for (const r of rejected) for (const e of (r.errors || []).slice(0, 5)) console.error(`   ${r.table} [${e.key}] ${e.sqlstate} ${e.message.slice(0, 160)}`);
console.log(JSON.stringify({ tables_checked: results.length, tables_with_rejections: rejected.map((r) => r.table) }));
process.exit(rejected.length ? 1 : 0);
