#!/usr/bin/env node
// Read-only collision preflight: fresh V1 capture vs hosted UAT. Prints counts only (no PII).
import { readFileSync } from 'node:fs';

const [, , freshDir, sealedDir, outFile] = process.argv;
if (!freshDir || !sealedDir) throw new Error('usage: preflight-uat-collisions.mjs <fresh-capture> <sealed-snapshot> [out.json]');
const env = {};
readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  .forEach((l) => { const [k, ...v] = l.split('='); env[k.trim()] = v.join('=').trim(); });
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

const rows = (dir, db, t) => readFileSync(`${dir}/tables/${db}/dbo.${t}.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const norm = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim().toLocaleLowerCase('en-US'));
const digits = (v) => (v == null ? null : String(v).replace(/\D/g, '') || null);
const last9 = (v) => { const d = digits(v); return d && d.length >= 9 ? d.slice(-9) : d; };
const get = async (path) => { const r = await fetch(`${env.SUPABASE_URL}${path}`, { headers: H }); if (!r.ok) throw new Error(`${path} ${r.status}`); return r.json(); };

const uat = {
  collab: await get('/rest/v1/collaborators?select=id,legacy_middleman_id,collaborators_code,collaborators_email,collaborators_phone'),
  merch: await get('/rest/v1/merchant_details?select=merchant_system_id,legacy_restaurant_id,merchant_code,merchant_email,merchant_phone,owner_email,owner_phone'),
  profiles: await get('/rest/v1/user_profiles?select=id,user_id,email,role'),
  auth: (await get('/auth/v1/admin/users?page=1&per_page=1000')).users,
};

function collide(sourceRows, targets, specs) {
  const result = {};
  for (const [label, sourceField, targetFields, fn] of specs) {
    const index = new Map();
    for (const t of targets) for (const f of targetFields) { const v = fn(t[f]); if (v) { (index.get(v) || new Set()).add(t); index.set(v, index.get(v) || new Set()); index.get(v).add(t); } }
    result[label] = sourceRows.filter((r) => { const v = fn(r[sourceField]); return v && index.has(v); }).length;
  }
  return result;
}
function dupes(rs, field, fn) {
  const seen = new Map();
  for (const r of rs) { const v = fn(r[field]); if (v) seen.set(v, (seen.get(v) || 0) + 1); }
  return [...seen.values()].filter((n) => n > 1).length;
}

const out = { generated_utc: new Date().toISOString(), uat_counts: { collaborators: uat.collab.length, merchants: uat.merch.length, profiles: uat.profiles.length, auth_users: uat.auth.length } };
for (const [label, dir] of [['fresh_full', freshDir], ['sealed_full', sealedDir]]) {
  const col = rows(dir, 'Emos_MdmService', 'RestaurantMiddleman');
  const mer = rows(dir, 'Emos_MdmService', 'Restaurant');
  const usr = rows(dir, 'Emos_Identity', 'AbpUsers').filter((u) => !u.IsDeleted && u.Email);
  const authAsTargets = uat.auth.map((u) => ({ id: u.id, email: u.email }));
  out[label] = {
    counts: { collaborators: col.length, merchants: mer.length, active_users_with_email: usr.length },
    collaborators_vs_uat: collide(col, uat.collab, [
      ['id_vs_id', 'Id', ['id'], lower], ['id_vs_legacy_id', 'Id', ['legacy_middleman_id'], lower],
      ['code', 'Code', ['collaborators_code'], norm], ['email', 'Email', ['collaborators_email'], norm],
      ['phone_digits', 'Phone', ['collaborators_phone'], digits], ['phone_last9', 'Phone', ['collaborators_phone'], last9]]),
    merchants_vs_uat: collide(mer, uat.merch, [
      ['id_vs_id', 'Id', ['merchant_system_id'], lower], ['id_vs_legacy_id', 'Id', ['legacy_restaurant_id'], lower],
      ['code', 'Code', ['merchant_code'], norm], ['email', 'Email', ['merchant_email', 'owner_email'], norm],
      ['phone_digits', 'Phone', ['merchant_phone', 'owner_phone'], digits], ['phone_last9', 'Phone', ['merchant_phone', 'owner_phone'], last9]]),
    users_vs_uat_auth: collide(usr, authAsTargets, [['email', 'Email', ['email'], norm], ['id', 'Id', ['id'], lower]]),
    users_vs_uat_profiles: collide(usr, uat.profiles, [['email', 'Email', ['email'], norm], ['id', 'Id', ['id'], lower], ['id_vs_user_id', 'Id', ['user_id'], lower]]),
    internal_v1_duplicates: {
      collaborator_codes: dupes(col, 'Code', norm), collaborator_emails: dupes(col, 'Email', norm), collaborator_phones: dupes(col, 'Phone', digits),
      merchant_codes: dupes(mer, 'Code', norm), merchant_emails: dupes(mer, 'Email', norm), merchant_phones: dupes(mer, 'Phone', digits),
      user_emails: dupes(usr, 'Email', norm),
    },
  };
}
// Delta-only subset (rows present in fresh but not in sealed)
const sealedIds = new Set(rows(sealedDir, 'Emos_MdmService', 'RestaurantMiddleman').map((r) => lower(r.Id)));
const sealedMer = new Set(rows(sealedDir, 'Emos_MdmService', 'Restaurant').map((r) => lower(r.Id)));
const newCol = rows(freshDir, 'Emos_MdmService', 'RestaurantMiddleman').filter((r) => !sealedIds.has(lower(r.Id)));
const newMer = rows(freshDir, 'Emos_MdmService', 'Restaurant').filter((r) => !sealedMer.has(lower(r.Id)));
out.delta_new_records = {
  collaborators: newCol.length, merchants: newMer.length,
  collaborators_vs_uat: collide(newCol, uat.collab, [['id', 'Id', ['id', 'legacy_middleman_id'], lower], ['code', 'Code', ['collaborators_code'], norm], ['email', 'Email', ['collaborators_email'], norm], ['phone_digits', 'Phone', ['collaborators_phone'], digits]]),
  merchants_vs_uat: collide(newMer, uat.merch, [['id', 'Id', ['merchant_system_id', 'legacy_restaurant_id'], lower], ['code', 'Code', ['merchant_code'], norm], ['email', 'Email', ['merchant_email', 'owner_email'], norm], ['phone_digits', 'Phone', ['merchant_phone', 'owner_phone'], digits]]),
  new_collaborator_code_format_ok: newCol.filter((r) => /^C25\d{5}$/.test(r.Code || '')).length,
  uat_code_prefixes: [...new Set([...uat.collab.map((c) => (c.collaborators_code || '').slice(0, 4)), ...uat.merch.map((m) => (m.merchant_code || '').slice(0, 4))])],
};
const text = JSON.stringify(out, null, 2);
console.log(text);
if (outFile) (await import('node:fs')).writeFileSync(outFile, text);
