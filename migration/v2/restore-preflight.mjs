// Pure helpers for restore-and-verify-pg-backup.mjs: role references, role mapping, managed-schema drift and the
// check log that decides which checks may run / be reported. No I/O except CheckLog.finish().
import { writeFileSync } from 'node:fs';

const BUILTIN = new Set(['public', 'current_user', 'session_user', 'current_role', 'pg_database_owner']);
const ident = (s) => s.trim().replace(/^"|"$/g, '');

// Every role named by the dump: object owners, grant/revoke recipients, default-privilege owners and recipients, policy roles.
export function referencedRoles(sqlText) {
  const roles = new Set();
  const add = (list) => list.split(',').map(ident).filter((r) => r && !BUILTIN.has(r.toLowerCase())).forEach((r) => roles.add(r));
  for (const line of sqlText.split('\n')) {
    let m;
    if ((m = line.match(/\bOWNER TO ([^;]+);/))) add(m[1]);
    if (/^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)\b/.test(line)) {
      if ((m = line.match(/\bFOR ROLE ("?[\w$]+"?)/))) add(m[1]);
      if ((m = line.match(/\b(?:TO|FROM) ([^;]+?)(?: WITH GRANT OPTION| GRANTED BY .*)?;$/))) add(m[1]);
    }
    if (/^CREATE POLICY\b/.test(line) && (m = line.match(/\sTO ((?:"?[\w$]+"?)(?:, ?"?[\w$]+"?)*)(?= USING| WITH CHECK|;|$)/))) add(m[1]);
  }
  return roles;
}

// Roles and memberships exactly as pg_dumpall --globals-only (no passwords) recorded them.
export function parseGlobalsRoles(globalsSql) {
  const roles = {};
  const memberships = [];
  for (const line of globalsSql.split('\n')) {
    const m = line.match(/^ALTER ROLE ("?[\w$]+"?) WITH (.+);$/);
    if (m) roles[ident(m[1])] = new Set(m[2].split(/\s+/));
    const g = line.match(/^GRANT ("?[\w$]+"?) TO ("?[\w$]+"?)\b(.*);$/);
    if (g) memberships.push({ role: ident(g[1]), member: ident(g[2]), sql: line });
  }
  return { roles, memberships };
}

const FORBIDDEN = ['SUPERUSER', 'CREATEROLE', 'CREATEDB', 'REPLICATION', 'BYPASSRLS'];

// Reviewed strategy: a role missing from the target is created ONLY if the role map lists it, the backup's own role record
// shows it is unprivileged, and it is created without a password and without LOGIN. Anything else is reported, never guessed.
export function planRoleMapping({ referenced, targetRoles, roleMap, globals }) {
  const have = new Set(targetRoles);
  const missing = [...referenced].filter((r) => !have.has(r)).sort();
  const create = [], unmapped = [], unsafe = [], unrecorded = [];
  for (const r of missing) {
    if (!roleMap[r]) { unmapped.push(r); continue; }
    const attrs = globals.roles[r];
    if (!attrs) { unrecorded.push(r); continue; }
    const priv = FORBIDDEN.filter((a) => attrs.has(a));
    if (priv.length) { unsafe.push({ role: r, privileged_attributes: priv }); continue; }
    const inherit = attrs.has('NOINHERIT') ? 'noinherit' : 'inherit';
    create.push({ role: r, sql: `create role "${r}" with nosuperuser ${inherit} nocreaterole nocreatedb nologin noreplication nobypassrls`, source_attributes: [...attrs].sort(), login_in_source: attrs.has('LOGIN') });
  }
  const created = new Set(create.map((c) => c.role));
  const memberships = globals.memberships.filter((g) => created.has(g.role) || created.has(g.member));
  const memberRolesMissing = memberships.flatMap((g) => [g.role, g.member]).filter((r) => !created.has(r) && !have.has(r));
  return { missing, create, unmapped, unsafe, unrecorded, memberships, memberRolesMissing: [...new Set(memberRolesMissing)], ok: !unmapped.length && !unsafe.length && !unrecorded.length && !memberRolesMissing.length };
}

// Compare the source's auth schema (catalog fingerprint) with the target's managed Auth schema.
export function authDrift(srcAuth, tgtAuth) {
  const cols = (a) => new Set(a.map((x) => `${x.t}.${x.c}:${x.type}`));
  const tabs = (a) => new Set(a.map((x) => x.t));
  const [sc, tc, st, tt] = [cols(srcAuth), cols(tgtAuth), tabs(srcAuth), tabs(tgtAuth)];
  const d = {
    tables_only_in_source: [...st].filter((x) => !tt.has(x)).sort(), tables_only_in_target: [...tt].filter((x) => !st.has(x)).sort(),
    columns_only_in_source: [...sc].filter((x) => !tc.has(x) && st.has(x.split('.')[0]) && tt.has(x.split('.')[0])).sort(),
    columns_only_in_target: [...tc].filter((x) => !sc.has(x) && st.has(x.split('.')[0]) && tt.has(x.split('.')[0])).sort(),
  };
  return { ...d, compatible: Object.values(d).every((v) => !v.length) };
}

// Columns the dump's COPY statements will write into managed schemas (auth, storage, supabase_migrations).
export function copyColumns(dumpSql) {
  const out = {};
  for (const m of dumpSql.matchAll(/^COPY ("?[\w$]+"?)\.("?[\w$]+"?) \(([^)]*)\) FROM stdin;$/gm)) {
    const schema = ident(m[1]);
    if (schema === 'public') continue;
    out[`${schema}.${ident(m[2])}`] = m[3].split(',').map(ident);
  }
  return out;
}
// source COPY columns vs target information_schema columns ({ 'schema.table': [cols] }); only tables that will be restored are blocking.
export function columnDrift(copyCols, targetCols, restoredTables) {
  const blocking = [], informational = [];
  for (const [t, cols] of Object.entries(copyCols)) {
    const have = new Set(targetCols[t] || []);
    const missing = cols.filter((c) => !have.has(c));
    if (!missing.length && targetCols[t]) continue;
    (restoredTables.has(t) ? blocking : informational).push({ table: t, table_missing_in_target: !targetCols[t], columns_missing_in_target: missing });
  }
  return { blocking, informational, compatible: !blocking.length };
}

// Default privileges are compared for the schemas the backup actually contains; platform-owned schemas outside the backup
// (realtime, supabase_functions, extensions, graphql...) are provisioned by the target stack and reported as informational.
export const BACKUP_SCHEMAS = ['public', 'auth', 'storage', 'supabase_migrations'];
export const inBackupScope = (rows) => rows.filter((r) => BACKUP_SCHEMAS.includes(r.schema));

// Checks run in a fixed order. A failed prerequisite makes every later check NOT_RUN - never PASS.
export class CheckLog {
  constructor(planned, write) { this.planned = planned; this.checks = []; this.write = write; this.diagnostics = {}; }
  check(id, name, pass, evidence) { this.checks.push({ id, name, status: pass ? 'PASS' : 'FAIL', evidence }); console.error(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${JSON.stringify(evidence).slice(0, 240)}`); return pass; }
  failed(id) { return this.checks.some((c) => c.id === id && c.status === 'FAIL'); }
  finish(blockedBy) {
    const ran = new Set(this.checks.map((c) => c.id));
    const not_run = this.planned.filter((id) => !ran.has(id)).map((id) => ({ id, status: 'NOT_RUN', reason: blockedBy ? `prerequisite ${blockedBy} failed` : 'not reached' }));
    const fail = this.checks.filter((c) => c.status === 'FAIL').length;
    const gate = fail === 0 && not_run.length === 0 ? 'PASS' : 'FAIL';
    const summary = { generated_utc: new Date().toISOString(), ...this.meta?.(), gate_c: gate, pass: this.checks.filter((c) => c.status === 'PASS').length, fail, not_run, checks: this.checks, diagnostics: this.diagnostics };
    this.write(summary);
    console.log(JSON.stringify({ gate_c: gate, pass: summary.pass, fail, not_run: not_run.map((n) => n.id), failing: this.checks.filter((c) => c.status === 'FAIL').map((c) => c.id) }));
    return gate === 'PASS' ? 0 : 1;
  }
}
export const writeJson = (path) => (obj) => writeFileSync(path, JSON.stringify(obj, null, 2));
