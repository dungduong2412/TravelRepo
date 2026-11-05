#!/usr/bin/env node
// Derives the expected post-import Auth user count and combined financial totals from the sealed snapshot and the verified
// pre-import UAT backup (no database access). Mirrors the importer's selection rules exactly.
// Usage: explain-import-baselines.mjs <snapshot-dir> <uat-pg-backup-dir> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [snap, backup, out] = process.argv.slice(2);
if (!snap || !backup || !out) throw new Error('usage: explain-import-baselines.mjs <snapshot-dir> <uat-pg-backup-dir> <out.json>');
const jl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const norm = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim().toLocaleLowerCase('en-US'));
const S = (db, t) => jl(join(snap, 'tables', db, `dbo.${t}.jsonl`));
const dec = (v) => { const [w, f = ''] = String(v ?? 0).split('.'); const neg = String(v).startsWith('-'); const n = BigInt(w.replace('-', '')) * 10000n + BigInt((f + '0000').slice(0, 4)); return neg ? -n : n; };
const fmt = (n) => `${n / 10000n}.${String(n % 10000n).padStart(4, '0')}`;

// ---- Auth users ---------------------------------------------------------------------------------------------------------------
const users = S('Emos_Identity', 'AbpUsers'), roles = S('Emos_Identity', 'AbpRoles'), userRoles = S('Emos_Identity', 'AbpUserRoles');
const roleName = new Map(roles.map((r) => [lower(r.Id), norm(r.Name)]));
const rolesByUser = new Map();
for (const l of userRoles) rolesByUser.set(lower(l.UserId), [...(rolesByUser.get(lower(l.UserId)) || []), roleName.get(lower(l.RoleId))]);
const roleOf = (names = []) => names.includes('admin') ? 'admin' : names.includes('bus') ? 'merchant' : names.includes('ctv') ? 'collaborator' : null;
const funnel = { v1_users_in_snapshot: users.length };
let rest = users;
const step = (label, keep) => { const before = rest.length; rest = rest.filter(keep); funnel[label] = { removed: before - rest.length, remaining: rest.length }; };
step('not_soft_deleted', (u) => !u.IsDeleted);
step('active', (u) => u.IsActive !== false);
step('has_email', (u) => Boolean(u.Email));
step('has_role_admin_bus_or_ctv', (u) => Boolean(roleOf(rolesByUser.get(lower(u.Id)))));
const byRole = {}; for (const u of rest) byRole[roleOf(rolesByUser.get(lower(u.Id)))] = (byRole[roleOf(rolesByUser.get(lower(u.Id)))] || 0) + 1;
const emails = rest.map((u) => norm(u.Email));
const uatUsers = JSON.parse(readFileSync(join(backup, 'logical/auth/users.json'), 'utf8'));
const uatEmails = new Set(uatUsers.map((u) => norm(u.email)));
const uatIds = new Set(uatUsers.map((u) => lower(u.id)));
const auth = { uat_baseline_auth_users: uatUsers.length, v1_migratable_users: rest.length, by_role: byRole, unique_emails_among_migratable: new Set(emails).size,
  collisions_with_uat_baseline: { email: emails.filter((e) => uatEmails.has(e)).length, id: rest.filter((u) => uatIds.has(lower(u.Id))).length },
  expected_auth_users_after_import: uatUsers.length + rest.length, funnel };

// ---- financial totals -----------------------------------------------------------------------------------------------------------
const tx = S('Emos_MdmService', 'RestaurantComTrack');
const uatTx = jl(join(backup, 'logical/tables/referral_transactions.jsonl'));
const sum = (rows, f) => rows.reduce((a, r) => a + dec(r[f]), 0n);
const v1 = { rows: tx.length, document_total: sum(tx, 'DocTotal'), discount: sum(tx, 'DocDiscountAmt'), commission: sum(tx, 'CommissionAmt') };
const base = { rows: uatTx.length, document_total: sum(uatTx, 'document_total'), discount: sum(uatTx, 'document_discount_amount'), commission: sum(uatTx, 'commission_amount') };
const v1ids = new Set(tx.map((r) => lower(r.Id)));
const overlap = uatTx.filter((r) => v1ids.has(lower(r.id))).length;
const combined = { rows: v1.rows + base.rows, document_total: v1.document_total + base.document_total, discount: v1.discount + base.discount, commission: v1.commission + base.commission };
const show = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'bigint' ? fmt(v) : v]));
const financial = { v1_snapshot: show(v1), uat_baseline_transactions: show(base), id_overlap_between_v1_and_uat: overlap, combined_after_import: show(combined),
  note: 'amounts are summed as exact 4-decimal integers; V1 amounts are imported verbatim (no recalculation), including the 3 approved orphan transactions (5266708.0000)' };
const result = { generated_utc: new Date().toISOString(), snapshot: snap.split('/').pop(), baseline_backup: backup.split('/').pop(), auth, financial };
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ expected_auth_users: auth.expected_auth_users_after_import, combined_document_total: financial.combined_after_import.document_total, combined_rows: combined.rows }));
