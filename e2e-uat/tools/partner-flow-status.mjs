#!/usr/bin/env node
// READ-ONLY. Where is one Partner in the single-step flow?  register -> Admin approves -> activation e-mail -> link clicked -> Partner Portal
//   railway run --service vno-api -- node e2e-uat/tools/partner-flow-status.mjs <e-mail alias>
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (injected by `railway run`). Prints states, ids, statuses and timestamps only: no token, no password, no full address.
const [, , rawEmail] = process.argv;
const email = (rawEmail || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('usage: partner-flow-status.mjs <e-mail>'); process.exit(2); }
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing: run through `railway run --service vno-api -- node ...`'); process.exit(2); }
const H = { apikey: key, Authorization: `Bearer ${key}` };
const get = async (p) => { const r = await fetch(url + p, { headers: H }); if (!r.ok) throw new Error(`${p.split('?')[0]} HTTP ${r.status}`); return r.json(); };
const q = encodeURIComponent; const exact = q(email.replace(/[\\%_]/g, '\\$&'));
const mask = (e) => e.replace(/^(.{1,3}).*@/, '$1***@');
const line = (id, text) => console.log(`${id.padEnd(4)} ${text}`);

async function authUser() {
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: H });
    if (!r.ok) throw new Error(`auth admin users HTTP ${r.status}`);
    const users = (await r.json()).users ?? [];
    const hit = users.find((u) => String(u.email).toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 1000) return null;
  }
  return null;
}

console.log(`${mask(email)} | checked ${new Date().toISOString()}`);
const user = await authUser();
line('P1', user ? `Auth identity ${user.id}: created ${user.created_at}, e-mail confirmed=${user.email_confirmed_at ?? 'NO (confirmed by the activation click)'} , last_sign_in=${user.last_sign_in_at ?? 'never'}, activation link outstanding=${Boolean(user.app_metadata?.activation_nonce)}` : 'no Auth identity');
const profiles = await get(`/rest/v1/user_profiles?select=id,user_id,role,user_profiles_status,collaborator_id,login_count,last_login_at,created_at&email=ilike.${exact}`);
const records = await get(`/rest/v1/collaborators?select=id,collaborators_code,collaborators_name,collaborators_status,collaborators_verified,collaborators_registered_date,collaborators_qr_code&collaborators_email=ilike.${exact}`);
line('P2', `profiles=${profiles.length} ${profiles.map((p) => `[${p.user_profiles_status}/${p.role} linked=${p.collaborator_id ?? 'none'} login_count=${p.login_count ?? 0} last_login_at=${p.last_login_at ?? 'never'}]`).join(' ')}`);
line('P3', `partner records=${records.length} ${records.map((r) => `[${r.collaborators_code} ${r.collaborators_status} verified=${r.collaborators_verified} qr=${r.collaborators_qr_code ? 'yes' : 'no'} registered=${r.collaborators_registered_date}]`).join(' ')}`);

let events = [];
if (records[0]) events = await get(`/rest/v1/audit_events?select=action,occurred_at,actor_role,details&entity_id=eq.${records[0].id}&order=occurred_at.asc`);
for (const e of events) {
  const d = e.details || {};
  line('AUD', `${e.occurred_at}  ${e.action}${d.trigger ? `  trigger=${d.trigger}` : ''}${d.reason ? `  reason=${d.reason}` : ''}${d.channel ? `  channel=${d.channel}` : ''}`);
}

const problems = [];
if (records.length > 1) problems.push('MORE THAN ONE Partner record for this address');
if (profiles.length > 1) problems.push('MORE THAN ONE profile for this address');
if (records[0] && profiles[0] && profiles[0].collaborator_id !== records[0].id) problems.push('profile is not linked to the record');
if (records[0] && !profiles[0]) problems.push('record without a linked profile (cannot be approved: OWNER_NOT_CLAIMED)');
if (profiles[0] && user && profiles[0].user_id !== user.id) problems.push('profile belongs to a different Auth identity');
if (records[0] && profiles[0] && records[0].collaborators_status === 'active' && profiles[0].user_profiles_status !== 'active') problems.push('record active but profile not active');
if (records[0] && profiles[0] && records[0].collaborators_status === 'pending' && profiles[0].user_profiles_status !== 'pending') problems.push('record pending but profile not pending');

const mails = events.filter((e) => e.action.startsWith('collaborator.activation_email_'));
const last = mails[mails.length - 1];
let state;
if (!records[0] && !profiles[0]) state = user ? 'NOT_REGISTERED (identity only, no application)' : 'NOT_REGISTERED';
else if (records[0]?.collaborators_status === 'pending') state = 'PENDING_APPROVAL (visible to Admin under Pending)';
else if (records[0]?.collaborators_status === 'active' && (profiles[0]?.login_count || 0) === 0 && !events.some((e) => e.action === 'collaborator.activated')) state = `APPROVED_AWAITING_ACTIVATION (last activation e-mail: ${last ? `${last.action.replace('collaborator.activation_email_', '')}@${last.occurred_at}` : 'none recorded'})`;
else if (records[0]?.collaborators_status === 'active' && events.some((e) => e.action === 'collaborator.activated')) state = `ACTIVATED BY LINK (collaborator.activated audited; login_count=${profiles[0].login_count}, last_login_at=${profiles[0].last_login_at})`;
else if (records[0]?.collaborators_status === 'active') state = `ENTERED BY PASSWORD, activation LINK NOT USED (login_count=${profiles[0].login_count}, last_login_at=${profiles[0].last_login_at}; no collaborator.activated event; link outstanding=${Boolean(user?.app_metadata?.activation_nonce)})`;
else state = `OTHER (${records[0]?.collaborators_status})`;
line('=>', state);
if (problems.length) { for (const p of problems) line('!!', p); process.exit(1); }
line('OK', 'no inconsistency: at most one identity, one record and one linked profile, statuses agree');
