// Removes every UXIMG-* synthetic row/object/user created by fixtures.mjs. LOCAL stack only; matches by the UXIMG prefix, never by id list alone.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const SB = env.SUPABASE_URL; if (!['127.0.0.1', 'localhost'].includes(new URL(SB).hostname)) throw new Error('local only');
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' };
const get = async (p) => { const r = await fetch(`${SB}${p}`, { headers: H }); const t = await r.text(); if (!r.ok) throw new Error(`${p}: ${t}`); return JSON.parse(t); };
const del = async (p) => { const r = await fetch(`${SB}${p}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=representation' } }); const t = await r.text(); if (!r.ok) throw new Error(`DELETE ${p}: ${t}`); return t ? JSON.parse(t) : []; };
const merchants = await get(`/rest/v1/merchant_details?merchant_name=like.UXIMG*&select=merchant_system_id`);
const ids = merchants.map((m) => m.merchant_system_id); const inList = `(${ids.join(',')})`;
const users = (await get(`/rest/v1/user_profiles?email=like.uximg-*&select=user_id`)).map((u) => u.user_id);
const out = {};
if (ids.length) {
  const media = await get(`/rest/v1/media_assets?merchant_id=in.${inList}&select=id,bucket_id,object_path`);
  out.approvals = (await del(`/rest/v1/media_approval_requests?merchant_id=in.${inList}`)).length;
  out.media = (await del(`/rest/v1/media_assets?merchant_id=in.${inList}`)).length;
  const byBucket = {}; for (const m of media) (byBucket[m.bucket_id] ||= []).push(m.object_path);
  out.objects = 0;
  for (const [bucket, prefixes] of Object.entries(byBucket)) { const r = await fetch(`${SB}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes }) }); if (!r.ok) throw new Error(`storage: ${await r.text()}`); out.objects += prefixes.length; }
  for (const t of ['merchant_category_links', 'merchant_update_requests']) out[t] = (await del(`/rest/v1/${t}?merchant_id=in.${inList}`)).length;
  out.invitations = (await del(`/rest/v1/invitations?entity_id=in.${inList}`).catch(() => [])).length;
}
if (users.length) out.profiles = (await del(`/rest/v1/user_profiles?user_id=in.(${users.join(',')})`)).length;
if (ids.length) out.audit = (await del(`/rest/v1/audit_events?entity_id=in.(${[...ids, ...ids.map((i) => i)].join(',')})`).catch((e) => `blocked: ${e.message.slice(0, 80)}`));
if (users.length) out.audit_actor = (await del(`/rest/v1/audit_events?actor_auth_user_id=in.(${users.join(',')})`).catch((e) => `blocked: ${e.message.slice(0, 80)}`));
if (ids.length) out.merchants = (await del(`/rest/v1/merchant_details?merchant_system_id=in.${inList}`)).length;
for (const u of users) { const r = await fetch(`${SB}/auth/v1/admin/users/${u}`, { method: 'DELETE', headers: H }); if (!r.ok) throw new Error(`auth: ${await r.text()}`); }
out.authUsers = users.length;
console.log(JSON.stringify(out, (k, v) => (Array.isArray(v) ? v.length : v)));
