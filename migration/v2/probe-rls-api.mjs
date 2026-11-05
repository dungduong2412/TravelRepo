#!/usr/bin/env node
// API-level (NOT catalog-level) evidence for RLS/grants on hosted UAT after the import. Read-only HEAD/GET requests only.
//   anon:    status per public table compared with the pre-import anon-probe.json of the verified backup (must be identical)
//   roles:   row counts visible to the synthetic UAT merchant / partner (e2e-uat/.env.uat.local) for every table; V1-imported data and
//            internal migration tables must not be readable beyond the user's own scope
// This does NOT replace the catalog checks (pg_policies / information_schema.role_table_grants), which need SQL access.
// Usage: probe-rls-api.mjs <pre-import-pg-backup-dir> <evidence.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [backupDir, out] = process.argv.slice(2);
const root = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; }));
const e2e = Object.fromEntries(readFileSync(new URL('../../e2e-uat/.env.uat.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim().replace(/^"|"$/g, '')]; }));
const URL_ = root.SUPABASE_URL; if (new URL(URL_).hostname !== 'hsezyogfxgnkpweoqqny.supabase.co') throw new Error('not the approved UAT project');
const anon = e2e.E2E_SUPABASE_ANON_KEY || root.SUPABASE_ANON_KEY;
const baseline = JSON.parse(readFileSync(join(backupDir, 'anon-probe.json'), 'utf8'));
const tables = Object.keys(baseline);
const status = async (table, token) => { const r = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${token || anon}`, Prefer: 'count=exact' }, signal: AbortSignal.timeout(60_000) }); const cr = r.headers.get('content-range'); await r.text(); return { status: r.status === 206 ? 200 : r.status, visible: r.ok ? Number((cr || '').split('/')[1]) : null }; };
const signIn = async (email, password) => (await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
const result = { generated_utc: new Date().toISOString(), anon: {}, roles: {} };
for (const t of tables) result.anon[t] = (await status(t)).status;
const anonDiff = tables.filter((t) => result.anon[t] !== baseline[t]);
for (const [role, [e, p]] of Object.entries({ merchant: [e2e.E2E_MERCHANT_EMAIL, e2e.E2E_MERCHANT_PASSWORD], partner: [e2e.E2E_PARTNER_EMAIL, e2e.E2E_PARTNER_PASSWORD] })) {
  const token = await signIn(e, p); result.roles[role] = {};
  for (const t of tables) result.roles[role][t] = await status(t, token);
}
const internal = ['legacy_source_records', 'legacy_identity_map', 'legacy_import_conflicts', 'legacy_migration_batches', 'legacy_migration_runs', 'legacy_tenant_evidence', 'legacy_import_checkpoints', 'audit_events'];
const leaks = [];
for (const role of Object.keys(result.roles)) for (const t of internal) { const r = result.roles[role][t]; if (r.status === 200 && r.visible > 0) leaks.push({ role, table: t, visible: r.visible }); }
const profileLeak = Object.entries(result.roles).filter(([, m]) => (m.user_profiles.visible ?? 0) > 1).map(([role]) => role);
result.summary = { anon_identical_to_pre_import_baseline: anonDiff.length === 0, anon_differences: anonDiff, internal_tables_readable_by_roles: leaks, roles_seeing_more_than_own_profile: profileLeak,
  v1_scope_visible_counts: Object.fromEntries(Object.entries(result.roles).map(([role, m]) => [role, { merchant_details: m.merchant_details.visible, collaborators: m.collaborators.visible, referral_transactions: m.referral_transactions.visible, media_assets: m.media_assets.visible }])) };
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.summary, null, 1));
process.exit(anonDiff.length || leaks.length || profileLeak.length ? 1 : 0);
