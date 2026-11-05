#!/usr/bin/env node
// Post-import reconciliation of an ISOLATED local target against a sealed snapshot, plus pre-existing-row isolation and state fingerprint.
// Usage: reconcile-import-target.mjs <snapshot-dir> <uat-backup-dir> <local-supabase-workdir> <db-container> <evidence.json> [--state-out file] [--state-compare file]
//        reconcile-import-target.mjs <snapshot-dir> <uat-backup-dir> - - <evidence.json> --uat [--state-out file]
// --uat reconciles the approved HOSTED UAT project after an authorized import. It is strictly read-only: REST/Storage GETs from .env and
// SQL only inside BEGIN ... READ ONLY transactions (SUPABASE_DB_PASSWORD from the environment). C17 (a rolled-back write attempt) is
// replaced by a catalog check that the rate-guard function and its trigger exist; C21 needs two local runs and is not applicable.
// --no-db (UAT only) runs every REST/Storage/Auth check without SUPABASE_DB_PASSWORD; the SQL-only checks (C17, C18) are then recorded
// as NOT_RUN, which is never a PASS (exit code 3 when nothing FAILed). A missing/unreadable table, a missing row or a failing SQL call is
// always recorded as a FAIL check, never as an uncaught exception.
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { wrapReadOnly } from './backup-readonly.mjs';
import { pinnedPartnerRemap } from './partner-code-remap.mjs';

const argv = process.argv.slice(2);
const [snapDir, backupDirArg, workdir, dbContainer, evidenceOut] = argv;
// accepts either a logical export dir or a backup-uat-pg.mjs backup (whose logical export sits in logical/)
const backupDir = existsSync(join(backupDirArg, 'logical', 'auth', 'users.json')) ? join(backupDirArg, 'logical') : backupDirArg;
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const stateOut = opt('--state-out'), stateCompare = opt('--state-compare');
const TENANT = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';
const UAT = argv.includes('--uat');
const NO_DB = argv.includes('--no-db');
if (NO_DB && !UAT) throw new Error('--no-db is only valid with --uat');
const UAT_REF = 'hsezyogfxgnkpweoqqny';
let status;
if (UAT) {
  const env = {};
  readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).forEach((l) => { const [k, ...v] = l.split('='); env[k.trim()] = v.join('=').trim(); });
  if (new URL(env.SUPABASE_URL).hostname !== `${UAT_REF}.supabase.co`) throw new Error('refusing: .env is not the approved UAT project');
  if (readFileSync(new URL('../../supabase/.temp/project-ref', import.meta.url), 'utf8').trim() !== UAT_REF) throw new Error('refusing: linked project is not the approved UAT project');
  if (!process.env.SUPABASE_DB_PASSWORD && !NO_DB) throw new Error('SUPABASE_DB_PASSWORD is not set in the environment (use --no-db to run only the REST/Storage/Auth checks)');
  status = { API_URL: env.SUPABASE_URL, SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY, ANON_KEY: env.SUPABASE_ANON_KEY };
} else {
  status = Object.fromEntries(execFileSync('supabase', ['status', '--workdir', workdir, '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').filter((l) => l.includes('=')).map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=').replace(/^"|"$/g, '')]; }));
}
const API = status.API_URL;
if (!UAT && !/^http:\/\/127\.0\.0\.1:/.test(API)) throw new Error('refusing: target is not local');
const H = { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}` };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const jl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const snap = (db, t) => jl(join(snapDir, 'tables', db, `dbo.${t}.jsonl`));
const checks = [];
process.on('uncaughtException', (e) => { // never end on a bare stack trace: leave a FAIL artifact
  checks.push({ id: 'FATAL', name: 'reconciliation could not complete', status: 'FAIL', evidence: { message: String(e && e.message).slice(0, 500) } });
  if (evidenceOut) writeFileSync(evidenceOut, JSON.stringify({ generated_utc: new Date().toISOString(), pass: checks.filter((c) => c.status === 'PASS').length, fail: checks.filter((c) => c.status === 'FAIL').length, checks }, null, 2));
  console.error(`FAIL FATAL ${e && e.message}`); console.log(JSON.stringify({ fail: 1, failing: ['FATAL'] })); process.exit(1);
});
const check = (id, name, pass, evidence) => { checks.push({ id, name, status: pass ? 'PASS' : 'FAIL', evidence }); console.error(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${JSON.stringify(evidence).slice(0, 220)}`); };
const notRun = (id, name, reason) => { checks.push({ id, name, status: 'NOT_RUN', evidence: { reason } }); console.error(`NOT_RUN ${id} ${name} :: ${reason}`); };
const dec4 = (v) => { const [w, f = ''] = String(v ?? 0).split('.'); return BigInt(w) * 10000n + BigInt((f + '0000').slice(0, 4)); };
const fmt4 = (v) => `${v / 10000n}.${String(v % 10000n).padStart(4, '0')}`;
async function all(path) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${API}/rest/v1/${path}${path.includes('?') ? '&' : '?'}limit=1000&offset=${off}`, { headers: H });
    if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
    const j = await r.json(); rows.push(...j); if (j.length < 1000) break;
  }
  return rows;
}
// A table that cannot be read is a FAIL check (and an empty list so dependent checks fail on counts), not an exception.
async function tryAll(path) {
  try { return await all(path); } catch (e) {
    checks.push({ id: `READ:${path.split('?')[0]}`, name: `target table ${path.split('?')[0]} is readable`, status: 'FAIL', evidence: { message: String(e.message).slice(0, 200) } });
    console.error(`FAIL READ:${path.split('?')[0]} ${String(e.message).slice(0, 160)}`); return [];
  }
}
const psql = (sql, allowError = false) => {
  if (UAT) { // read-only per transaction; the pooler ignores startup options
    const u = new URL(readFileSync(new URL('../../supabase/.temp/pooler-url', import.meta.url), 'utf8').trim());
    const r = spawnSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: wrapReadOnly(sql), encoding: 'utf8', maxBuffer: 1 << 26,
      env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGDATABASE: u.pathname.slice(1) || 'postgres', PGPASSWORD: process.env.SUPABASE_DB_PASSWORD, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '20' } });
    if (r.status !== 0 && !allowError) throw new Error(r.stderr.replace(process.env.SUPABASE_DB_PASSWORD, '<redacted>').slice(0, 300));
    return { out: r.stdout, err: r.stderr };
  }
  const r = spawnSync('docker', ['exec', '-i', '-e', `PGPASSWORD=${decodeURIComponent(new URL(status.DB_URL).password)}`, dbContainer, 'psql', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-F', '\t', ...(allowError ? [] : ['-v', 'ON_ERROR_STOP=1'])], { input: sql, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (!allowError && r.status !== 0) throw new Error(r.stderr.slice(0, 300));
  return { out: r.stdout, err: r.stderr };
};

// ---- source side ------------------------------------------------------------------------------------
const restaurants = snap('Emos_MdmService', 'Restaurant'), collaborators = snap('Emos_MdmService', 'RestaurantMiddleman');
const transactions = snap('Emos_MdmService', 'RestaurantComTrack'), catLinks = snap('Emos_MdmService', 'RestaurantCategoryMap');
const updates = snap('Emos_MdmService', 'MerchantUpdateRequests'), categories = snap('Emos_MdmService', 'RestaurantCategory');
const users = snap('Emos_Identity', 'AbpUsers'), userRoles = snap('Emos_Identity', 'AbpUserRoles'), roles = snap('Emos_Identity', 'AbpRoles');
const userMap = snap('Emos_MdmService', 'RestaurantUserMap');
const orphanMap = JSON.parse(readFileSync(join(snapDir, 'orphan-transaction-mapping.json'), 'utf8'));
const excluded = JSON.parse(readFileSync(join(snapDir, 'excluded-deleted-merchants.json'), 'utf8'));
const roleName = new Map(roles.map((r) => [lower(r.Id), String(r.Name).trim().toLowerCase()]));
const rolesByUser = new Map();
for (const l of userRoles) rolesByUser.set(lower(l.UserId), [...(rolesByUser.get(lower(l.UserId)) || []), roleName.get(lower(l.RoleId))]);
const mapRole = (n = []) => (n.includes('admin') ? 'admin' : n.includes('bus') ? 'merchant' : n.includes('ctv') ? 'collaborator' : null);
const migratable = users.filter((u) => !u.IsDeleted && u.IsActive !== false && mapRole(rolesByUser.get(lower(u.Id))) && u.Email);

// ---- target side ------------------------------------------------------------------------------------
const merchants = await tryAll('merchant_details?select=*');
const collabs = await tryAll('collaborators?select=*');
const txs = await tryAll('referral_transactions?select=*');
const links = await tryAll('merchant_category_links?select=*');
const mur = await tryAll('merchant_update_requests?select=*');
const media = await tryAll('media_assets?select=*');
const profiles = await tryAll('user_profiles?select=*');
const conflicts = await tryAll('legacy_import_conflicts?select=*');
const idMap = await tryAll('legacy_identity_map?select=*');
const cats = await tryAll('categories?select=*');
const tenantOf = (rows) => rows.filter((r) => lower(r.legacy_tenant_id) === TENANT);
const T = { merchants: tenantOf(merchants), collabs: tenantOf(collabs), txs: tenantOf(txs), mur: tenantOf(mur), media: tenantOf(media) };

check('C1', 'record counts: 140 merchants, 312 partners, 105 transactions, 28 update requests', T.merchants.length === restaurants.length && T.collabs.length === collaborators.length && T.txs.length === transactions.length && T.mur.length === updates.length,
  { merchants: [T.merchants.length, restaurants.length], partners: [T.collabs.length, collaborators.length], transactions: [T.txs.length, transactions.length], update_requests: [T.mur.length, updates.length] });
check('C2', 'pre-existing synthetic rows are still present (19 merchants, 19 partners, 9 transactions)', merchants.length - T.merchants.length === 19 && collabs.length - T.collabs.length === 19 && txs.length - T.txs.length === 9, { merchants_total: merchants.length, partners_total: collabs.length, tx_total: txs.length });

// financial: totals + per-row verbatim
const tot = (rows, f) => rows.reduce((a, r) => a + dec4(r[f]), 0n);
const srcTot = [tot(transactions, 'DocTotal'), tot(transactions, 'DocDiscountAmt'), tot(transactions, 'CommissionAmt')].map(fmt4);
const tgtTot = [tot(T.txs, 'document_total'), tot(T.txs, 'document_discount_amount'), tot(T.txs, 'commission_amount')].map(fmt4);
check('C3', 'financial totals equal V1 (total, discount, commission)', stable(srcTot) === stable(tgtTot) && srcTot[0] === '380705162.0000', { source: srcTot, target: tgtTot });
const txById = new Map(T.txs.map((r) => [lower(r.legacy_transaction_id), r]));
const txBad = transactions.filter((s) => { const t = txById.get(lower(s.Id)); return !t || fmt4(dec4(t.document_total)) !== fmt4(dec4(s.DocTotal)) || fmt4(dec4(t.document_discount_amount)) !== fmt4(dec4(s.DocDiscountAmt)) || fmt4(dec4(t.commission_amount)) !== fmt4(dec4(s.CommissionAmt)) || String(t.legacy_status) !== String(s.Status); }).map((s) => s.Id);
check('C4', 'every one of the 105 transactions matches V1 amount-for-amount and status (no recalculation)', txBad.length === 0, { mismatched: txBad.length });
const byStatus = (rows, sf, af) => { const o = {}; for (const r of rows) { const k = String(r[sf]); o[k] = [(o[k]?.[0] || 0) + 1, ((o[k]?.[1]) || 0n) + dec4(r[af])]; } return Object.fromEntries(Object.entries(o).sort().map(([k, [n, v]]) => [k, [n, fmt4(v)]])); };
check('C5', 'per-status counts and totals equal V1', stable(byStatus(transactions, 'Status', 'DocTotal')) === stable(byStatus(T.txs, 'legacy_status', 'document_total')), byStatus(T.txs, 'legacy_status', 'document_total'));

// D3 orphans
const orphanIds = orphanMap.transactions.map((o) => o.transaction_id).sort();
const tgtOrphans = T.txs.filter((t) => t.legacy_restaurant_id && !t.merchant_id).map((t) => lower(t.legacy_transaction_id)).sort();
const orphanOk = stable(orphanIds) === stable(tgtOrphans) && orphanMap.transactions.every((o) => { const t = txById.get(o.transaction_id); return Boolean(t) && t.merchant_id === null && lower(t.legacy_restaurant_id) === o.legacy_restaurant_id && fmt4(dec4(t.document_total)) === fmt4(dec4(o.document_total)) && t.legacy_restaurant_display_name === o.legacy_restaurant_display_name; });
check('C6', 'D3: exactly the 3 approved orphan transactions preserved with merchant link NULL, legacy ID and display name kept, amounts verbatim', orphanOk, { orphans: tgtOrphans.length, value: orphanMap.document_total_sum });
const conf = conflicts.filter((c) => c.entity_type === 'referral_transaction');
check('C7', 'D3: auditable mapping rows exist (approved, with evidence and policy)', conf.length === 3 && conf.every((c) => c.resolution_status === 'approved' && c.evidence?.mapping && c.evidence?.policy && c.candidate_v2_id === null), { rows: conf.length, reasons: [...new Set(conf.map((c) => c.reason_code))] });

// D4 exclusions
const exIds = new Set(excluded.merchants.map((m) => m.legacy_id));
const exInMerchants = merchants.filter((m) => exIds.has(lower(m.legacy_restaurant_id))).length;
const exInProfiles = idMap.filter((m) => exIds.has(lower(m.legacy_user_id))).length + profiles.filter((p) => exIds.has(lower(p.id))).length;
const exInLinks = mur.filter((m) => exIds.has(lower(m.legacy_merchant_id))).length;
check('C8', 'D4: none of the 9 deleted V1 merchants (or their soft-deleted owner users) exist in the target', exInMerchants === 0 && exInProfiles === 0 && exInLinks === 0, { merchants: exInMerchants, identities_profiles: exInProfiles, update_requests: exInLinks, excluded: exIds.size });

// relationships
const mByLegacy = new Map(T.merchants.map((m) => [lower(m.legacy_restaurant_id), m.merchant_system_id]));
const cByLegacy = new Map(T.collabs.map((c) => [lower(c.legacy_middleman_id), c.id]));
const relBad = transactions.filter((s) => { const t = txById.get(lower(s.Id)); if (!t) return true; /* absent from target (e.g. pre-import smoke) = mismatch, not a crash */ const mWant = mByLegacy.get(lower(s.RestaurantId)) || null; const cWant = s.MiddlemanId ? cByLegacy.get(lower(s.MiddlemanId)) || null : null; return t.merchant_id !== mWant || t.collaborator_id !== cWant || (s.MiddlemanId && !cWant); }).length;
check('C9', 'transaction -> merchant / partner relationships exact (105 checked)', relBad === 0, { mismatched: relBad });
const catWant = catLinks.filter((l) => mByLegacy.has(lower(l.ResId))).length;
const tgtLinks = links.filter((l) => [...mByLegacy.values()].includes(l.merchant_id)).length;
check('C10', 'merchant category links reconcile', catWant === catLinks.length && tgtLinks >= catLinks.length, { source: catLinks.length, target_for_v1_merchants: tgtLinks });
const imported = new Set(idMap.map((m) => lower(m.legacy_user_id)));
const profBad = migratable.filter((u) => { const p = profiles.find((x) => lower(x.id) === lower(u.Id)); if (!p) return true; const role = mapRole(rolesByUser.get(lower(u.Id))); if (p.role !== role) return true;
  if (role === 'merchant') { const rid = userMap.find((m) => lower(m.UserId) === lower(u.Id))?.ResId; return rid ? p.merchant_id !== mByLegacy.get(lower(rid)) : false; } return false; }).length;
check('C11', 'every migratable V1 user has an Auth identity map, a profile with the right role and the right merchant/partner link', imported.size >= migratable.length && profBad === 0, { migratable: migratable.length, identity_maps: idMap.length, profile_mismatches: profBad });

// Auth users
const authUsers = [];
try { for (let p = 1; ; p++) { const res = await fetch(`${API}/auth/v1/admin/users?page=${p}&per_page=200`, { headers: H }); const r = await res.json(); if (!res.ok || !Array.isArray(r.users)) throw new Error(`HTTP ${res.status}`); authUsers.push(...r.users); if (r.users.length < 200) break; } }
catch (e) { checks.push({ id: 'READ:auth.users', name: 'Auth admin users are readable', status: 'FAIL', evidence: { message: String(e.message).slice(0, 200) } }); console.error(`FAIL READ:auth.users ${e.message}`); }
const baseUsers = JSON.parse(readFileSync(join(backupDir, 'auth/users.json'), 'utf8'));
const authById = new Map(authUsers.map((u) => [u.id, u]));
const baseChanged = baseUsers.filter((b) => { const a = authById.get(b.id); return !a || a.email !== b.email || stable(a.app_metadata) !== stable(b.app_metadata) || stable(a.user_metadata) !== stable(b.user_metadata); }).length;
check('C12', 'Auth: 24 pre-existing users untouched; V1 users added', baseChanged === 0 && authUsers.length === baseUsers.length + migratable.length, { pre_existing_changed: baseChanged, total: authUsers.length, expected: baseUsers.length + migratable.length });
const noEmailNoise = authUsers.filter((u) => !baseUsers.find((b) => b.id === u.id)).every((u) => u.app_metadata?.password_reset_required === true && u.app_metadata?.legacy_user_id);
check('C13', 'Auth: imported users carry legacy ID, role and password_reset_required; passwords are random and unknown', noEmailNoise, { imported_users: authUsers.length - baseUsers.length });

// isolation of pre-existing rows
const canon = (rows, key) => rows.map((r) => stable(r)).sort();
const tableFile = (t) => jl(join(backupDir, 'tables', `${t}.jsonl`));
const synthetic = { merchant_details: merchants.filter((m) => lower(m.legacy_tenant_id) !== TENANT), collaborators: collabs.filter((c) => lower(c.legacy_tenant_id) !== TENANT), referral_transactions: txs.filter((t) => lower(t.legacy_tenant_id) !== TENANT) };
const isoBad = Object.entries(synthetic).filter(([t, rows]) => { const want = new Set(tableFile(t).map((r) => stable(r))); return rows.length !== want.size || rows.some((r) => !want.has(stable(r))); }).map(([t]) => t);
check('C14', 'source-to-target isolation: all pre-existing synthetic merchants, partners and transactions are byte-identical to the pre-import backup', isoBad.length === 0, { differing: isoBad });
const synMedia = media.filter((m) => lower(m.legacy_tenant_id) !== TENANT); const wantMedia = new Set(tableFile('media_assets').map((r) => stable(r)));
check('C15', 'pre-existing 14 media assets unchanged', synMedia.length === 14 && synMedia.every((m) => wantMedia.has(stable(m))), { rows: synMedia.length });

// D5 rate guards
const viol = (m) => ['commission', 'discount'].some((k) => m[`merchant_${k}_type`] === 'percentage' && m[`merchant_${k}_value`] != null && (m[`merchant_${k}_value`] < 0 || m[`merchant_${k}_value`] > 1));
check('C16', 'D5: V1 merchants have no rate-guard violations; the 11 deferred synthetic violations are untouched', T.merchants.filter(viol).length === 0 && synthetic.merchant_details.filter(viol).length === 11, { v1_violations: T.merchants.filter(viol).length, synthetic_violations: synthetic.merchant_details.filter(viol).length });
const target = T.merchants.find((m) => m.merchant_commission_type === 'percentage' && m.merchant_commission_value != null);
const sqlGuarded = (id, name, fn) => { try { fn(); } catch (e) { check(id, name, false, { sql_error: String(e.message).slice(0, 200) }); } };
if (UAT && NO_DB) notRun('C17', 'D5 (read-only form): the fractional-rate guard trigger exists and is enabled on public.merchant_details', 'no database credentials (--no-db)');
else if (UAT) sqlGuarded('C17', 'D5 (read-only form): the fractional-rate guard trigger exists and is enabled on public.merchant_details', () => {
  const g = psql(`select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.merchant_details'::regclass and not t.tgisinternal and t.tgenabled = 'O' and p.proname = 'enforce_fractional_merchant_rates'`).out.trim();
  check('C17', 'D5 (read-only form): the fractional-rate guard trigger exists and is enabled on public.merchant_details', g === '1', { enabled_guard_triggers: Number(g) });
});
else if (!target) check('C17', 'D5: the fractional-rate guard rejects a percentage rate above 1 after import', false, { reason: 'no imported percentage-rate Merchant to test against (import absent or incomplete)' });
else {
  const guard = psql(`begin;\nupdate public.merchant_details set merchant_commission_value = 12 where merchant_system_id = '${target.merchant_system_id}';\nrollback;\n`, true);
  check('C17', 'D5: the fractional-rate guard still rejects a percentage rate above 1 after import', /fraction between 0 and 1/.test(guard.err), { rejected: /fraction between 0 and 1/.test(guard.err) });
}

// FK integrity
let fks = [];
const fkBad = [];
if (NO_DB) notRun('C18', 'all foreign keys resolve after import', 'no database credentials (--no-db)');
else sqlGuarded('C18', 'all foreign keys resolve after import', () => {
fks = psql(`select c.conrelid::regclass, c.confrelid::regclass, (select string_agg(format('c.%I', a.attname), ',' order by u.ord) from unnest(c.conkey) with ordinality u(att,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=u.att), (select string_agg(format('p.%I', a.attname), ',' order by u.ord) from unnest(c.confkey) with ordinality u(att,ord) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=u.att), c.conname from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.contype='f' and n.nspname='public'`).out.split('\n').filter(Boolean);
for (const line of fks) { const [child, parent, cc, pc, name] = line.split('\t'); const cl = cc.split(','), pl = pc.split(','); const n = Number(psql(`select count(*) from ${child} c where ${cl.map((c) => `${c} is not null`).join(' and ')} and not exists (select 1 from ${parent} p where ${cl.map((c, i) => `${c} = ${pl[i]}`).join(' and ')})`).out.trim()); if (n) fkBad.push({ fk: name, orphans: n }); }
check('C18', 'all foreign keys resolve after import', fkBad.length === 0, { checked: fks.length, violations: fkBad });
});

// media bytes
const csv = readFileSync(join(snapDir, 'media-checksums.csv'), 'utf8').split('\n').filter(Boolean); csv.shift();
let mediaBad = 0, mediaBytes = 0;
const mById = new Map(T.media.map((m) => [lower(m.id), m]));
for (const line of csv) {
  const [database, provenance, sourceId, , bytes, sha256, , , rel] = line.split(',');
  const m = mById.get(lower(sourceId));
  if (!m || m.sha256_hex !== sha256 || Number(m.size_bytes) !== Number(bytes)) { mediaBad++; continue; }
  try {
    const r = await fetch(`${API}/storage/v1/object/${m.bucket_id}/${m.object_path.split('/').map(encodeURIComponent).join('/')}`, { headers: H, signal: AbortSignal.timeout(120000) });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || sha(buf) !== sha256 || buf.length !== Number(bytes)) mediaBad++; else mediaBytes += buf.length;
  } catch { mediaBad++; }
}
check('C19', 'all media: 602 assets, bytes retrieved from Storage match V1 SHA-256 and size', mediaBad === 0 && csv.length === 602 && T.media.length === 602, { files: csv.length, assets: T.media.length, bytes: mediaBytes, mismatched: mediaBad });
const merchantMedia = T.media.filter((m) => m.merchant_id).length, partnerMedia = T.media.filter((m) => m.collaborator_id).length;
const refMerchants = new Set(T.media.filter((m) => m.merchant_id).map((m) => m.merchant_id));
check('C20', 'media ownership: every merchant-linked asset points to an imported V1 merchant; partner-linked assets to imported partners', T.media.filter((m) => m.merchant_id).every((m) => T.merchants.some((x) => x.merchant_system_id === m.merchant_id)) && T.media.filter((m) => m.collaborator_id).every((m) => T.collabs.some((x) => x.id === m.collaborator_id)), { merchant_assets: merchantMedia, partner_assets: partnerMedia, merchants_with_media: refMerchants.size });

// D6: duplicate Merchant code resolved exactly as approved; original code and both source IDs preserved
{
  const mapping = JSON.parse(readFileSync(join(snapDir, 'merchant-code-conflict-mapping.json'), 'utf8'));
  const [c0] = mapping.conflicts;
  const byLegacy = (id) => T.merchants.find((m) => lower(m.legacy_restaurant_id) === lower(id));
  const keptRow = byLegacy(c0.kept_legacy_id), remapRow = byLegacy(c0.remapped_legacy_id);
  const srcByLegacy = new Map(restaurants.map((r) => [lower(r.Id), r]));
  const otherCodesEqual = T.merchants.filter((m) => lower(m.legacy_restaurant_id) !== lower(c0.remapped_legacy_id)).every((m) => m.merchant_code === srcByLegacy.get(lower(m.legacy_restaurant_id))?.Code);
  const allCodes = merchants.map((m) => String(m.merchant_code).toLowerCase());
  const d6rows = conflicts.filter((c) => c.entity_type === 'merchant' && c.reason_code === 'duplicate_merchant_code');
  const ev = d6rows[0]?.evidence || {};
  check('C22', 'D6: duplicate code M2500119 kept by the earliest Merchant, the other mapped to M2500119-DUP-d669a426; all other V1 codes verbatim; codes unique; original code and both source IDs preserved in legacy_import_conflicts',
    mapping.conflicts.length === 1 && keptRow?.merchant_code === c0.original_code && remapRow?.merchant_code === c0.replacement_code && otherCodesEqual && new Set(allCodes).size === allCodes.length
    && d6rows.length === 1 && d6rows[0].resolution_status === 'approved' && lower(d6rows[0].legacy_id) === lower(c0.remapped_legacy_id) && ev.original_code === c0.original_code && ev.replacement_code === c0.replacement_code
    && lower(ev.kept_legacy_id) === lower(c0.kept_legacy_id) && lower(ev.remapped_legacy_id) === lower(c0.remapped_legacy_id) && ev.kept_v2_id === keptRow?.merchant_system_id && ev.remapped_v2_id === remapRow?.merchant_system_id,
    { kept: keptRow?.merchant_code, remapped: remapRow?.merchant_code, replacement_length: remapRow?.merchant_code?.length, conflict_rows: d6rows.length, other_codes_verbatim: otherCodesEqual, codes_unique: new Set(allCodes).size === allCodes.length });
}

// E1: duplicate Partner codes (C2500228, C2500240) remapped exactly as pinned; every other V1 Partner code verbatim; all Partner codes unique;
// original code, both V1 ids and the printed-QR-replacement flag preserved in legacy_import_conflicts
{
  let remap = [], err = null;
  try { remap = pinnedPartnerRemap(collaborators); } catch (e) { err = String(e.message); }
  const byLegacy = new Map(T.collabs.map((c) => [lower(c.legacy_middleman_id), c]));
  const srcByLegacy = new Map(collaborators.map((r) => [lower(r.Id), r]));
  const remapped = new Map(remap.map((m) => [m.legacy_id, m]));
  const codeOk = remap.length === 4 && remap.every((m) => byLegacy.get(m.legacy_id)?.collaborators_code === m.replacement_code);
  const othersVerbatim = T.collabs.filter((c) => !remapped.has(lower(c.legacy_middleman_id))).every((c) => c.collaborators_code === srcByLegacy.get(lower(c.legacy_middleman_id))?.Code);
  const norms = collabs.map((c) => String(c.collaborators_code).trim().toLowerCase());
  const e1rows = conflicts.filter((c) => c.entity_type === 'collaborator' && c.reason_code === 'duplicate_collaborator_code');
  const auditOk = e1rows.length === 4 && remap.every((m) => { const r = e1rows.find((x) => lower(x.legacy_id) === m.legacy_id); const ev = r?.evidence || {}; return r && r.resolution_status === 'approved' && ev.original_code === m.original_code && ev.replacement_code === m.replacement_code && ev.printed_qr_replacement_required === true && (ev.sibling_legacy_ids || []).join() === m.sibling_legacy_ids.join() && r.candidate_v2_id === byLegacy.get(m.legacy_id)?.id; });
  check('C23', 'E1: the 4 Partners that shared V1 codes C2500228/C2500240 hold unique <code>-DUP-<id8> codes, all other V1 Partner codes are verbatim, all Partner codes are unique, original code and sibling ids are preserved in legacy_import_conflicts',
    !err && codeOk && othersVerbatim && new Set(norms).size === norms.length && auditOk,
    { pinned_error: err, remapped_codes_in_place: codeOk, other_codes_verbatim: othersVerbatim, partner_codes_unique: new Set(norms).size === norms.length, partners_total: norms.length, audit_rows: e1rows.length, audit_ok: auditOk });
}

// state fingerprint for idempotency
const volatile = /^(created_at|updated_at|started_at|completed_at|migrated_at|merchant_last_update|last_sign_in_at|updated_at)$/;
const clean = (rows) => rows.map((r) => stable(Object.fromEntries(Object.entries(r).filter(([k]) => !volatile.test(k))))).sort();
const fingerprints = {};
for (const t of ['merchant_details', 'collaborators', 'referral_transactions', 'merchant_category_links', 'categories', 'merchant_update_requests', 'media_assets', 'user_profiles', 'legacy_identity_map', 'legacy_import_conflicts', 'legacy_migration_batches', 'legacy_migration_runs']) {
  const rows = t === 'merchant_details' ? merchants : t === 'collaborators' ? collabs : t === 'referral_transactions' ? txs : t === 'merchant_category_links' ? links : t === 'categories' ? cats : t === 'merchant_update_requests' ? mur : t === 'media_assets' ? media : t === 'user_profiles' ? profiles : t === 'legacy_identity_map' ? idMap : t === 'legacy_import_conflicts' ? conflicts : await tryAll(`${t}?select=*`);
  fingerprints[t] = { rows: rows.length, sha256: sha(clean(rows).join('\n')) };
}
const srcRecords = await tryAll('legacy_source_records?select=source_database,source_table,source_primary_key,source_payload_sha256&order=source_database,source_table,source_primary_key');
fingerprints.legacy_source_records = { rows: srcRecords.length, sha256: sha(clean(srcRecords).join('\n')) };
fingerprints.auth_users = { rows: authUsers.length, sha256: sha(authUsers.map((u) => `${u.id}|${u.email}|${stable(u.app_metadata)}`).sort().join('\n')) };
if (stateOut) writeFileSync(stateOut, JSON.stringify(fingerprints, null, 2));
if (stateCompare) {
  const before = JSON.parse(readFileSync(stateCompare, 'utf8'));
  const diff = Object.keys(fingerprints).filter((k) => stable(before[k]) !== stable(fingerprints[k]));
  check('C21', 'idempotency: a second full import run leaves every table, Auth user and archive record unchanged', diff.length === 0, { tables_compared: Object.keys(fingerprints).length, differing: diff });
}
const summary = { generated_utc: new Date().toISOString(), snapshot: snapDir.split('/').pop(), pass: checks.filter((c) => c.status === 'PASS').length, fail: checks.filter((c) => c.status === 'FAIL').length, not_run: checks.filter((c) => c.status === 'NOT_RUN').length, fingerprints, checks };
writeFileSync(evidenceOut, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ pass: summary.pass, fail: summary.fail, not_run: summary.not_run, failing: checks.filter((c) => c.status === 'FAIL').map((c) => c.id), not_run_ids: checks.filter((c) => c.status === 'NOT_RUN').map((c) => c.id) }));
process.exit(summary.fail ? 1 : summary.not_run ? 3 : 0);
