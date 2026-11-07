// READ-ONLY. Verifies the result of a Partner onboarding submission made by the owner in the browser.
//   railway run --service vno-api -- node e2e-uat/tools/verify-partner-submission.mjs <alias e-mail>
// Reads Auth (admin list), user_profiles, collaborators, audit_events. Writes nothing, sends nothing, prints no secrets.
const email = (process.argv[2] || '').trim().toLowerCase();
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !url || !key) { console.log('usage: needs <email> and SUPABASE_* env (railway run --service vno-api)'); process.exit(2); }
const H = { apikey: key, Authorization: `Bearer ${key}` };
const get = async (p) => { const r = await fetch(url + p, { headers: H }); if (!r.ok) throw new Error(`${p.split('?')[0]} ${r.status}`); return r.json(); };
const mask = (e) => String(e).replace(/^(.{1,3}).*?(\+[^@]*)?@/, (m, a, b) => `${a}***${b || ''}@`);
const q = encodeURIComponent;
let fail = 0; const ok = (name, pass, detail = '') => { if (!pass) fail++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

let user = null;
for (let page = 1; page < 20 && !user; page++) {
  const b = await get(`/auth/v1/admin/users?page=${page}&per_page=1000`);
  user = (b.users ?? []).find((u) => String(u.email).toLowerCase() === email) ?? null; if ((b.users ?? []).length < 1000) break;
}
console.log('target', mask(email));
ok('V0 Auth user exists and e-mail is confirmed', !!user?.email_confirmed_at, user ? `confirmed ${user.email_confirmed_at}, requested_role=${user.user_metadata?.requested_role}` : 'no user');
if (!user) process.exit(1);

const byUser = await get(`/rest/v1/user_profiles?select=*&user_id=eq.${user.id}`);
const byEmail = await get(`/rest/v1/user_profiles?select=id,user_id,role&email=ilike.${q(email)}`);
const cols = await get(`/rest/v1/collaborators?select=id,collaborators_code,collaborators_status,collaborators_verified,collaborators_email,collaborators_registered_date,collaborators_name&collaborators_email=ilike.${q(email)}`);
const submitted = cols.length > 0 || byUser.length > 0;
console.log(`state: profiles(by user)=${byUser.length} profiles(by email)=${byEmail.length} collaborators(by email)=${cols.length}`);
if (!submitted) { console.log('NOT SUBMITTED YET: no profile and no Partner record (correct before the owner presses "Gửi hồ sơ").'); process.exit(3); }

ok('V1 exactly one Partner business record for this e-mail', cols.length === 1, `count=${cols.length}`);
ok('V2 exactly one user_profiles row (by user id and by e-mail)', byUser.length === 1 && byEmail.length === 1, `user=${byUser.length} email=${byEmail.length}`);
const c = cols[0], p = byUser[0];
ok('V3 record status pending and not verified (not approved)', c?.collaborators_status === 'pending' && c?.collaborators_verified === false, `status=${c?.collaborators_status} verified=${c?.collaborators_verified}`);
ok('V4 profile is collaborator/pending and linked to that exact record, no merchant link', p?.role === 'collaborator' && p?.user_profiles_status === 'pending' && p?.collaborator_id === c?.id && !p?.merchant_id,
  `role=${p?.role} status=${p?.user_profiles_status} linked=${p?.collaborator_id === c?.id} merchant_id=${p?.merchant_id ?? null}`);
ok('V5 profile e-mail equals the verified Auth e-mail', String(p?.email).toLowerCase() === email);
const dup = await get(`/rest/v1/collaborators?select=id&collaborators_name=eq.${q(c?.collaborators_name ?? '')}`);
ok('V6 no duplicate Partner record with the same name', dup.length === 1, `same-name rows=${dup.length}`);
const audit = c ? await get(`/rest/v1/audit_events?select=occurred_at,action,actor_role,actor_auth_user_id&entity_id=eq.${c.id}&order=occurred_at.asc`) : [];
const n = (a) => audit.filter((x) => x.action === a).length;
ok('V7 exactly one application_submitted audit event by this user', n('collaborator.application_submitted') === 1 && audit.find((x) => x.action === 'collaborator.application_submitted')?.actor_auth_user_id === user.id, audit.map((x) => x.action).join(','));
ok('V8 no approval event exists', n('collaborator.approved') === 0);
const other = await get(`/rest/v1/collaborators?select=id&collaborators_registered_date=gte.${q(c?.collaborators_registered_date ?? '')}`);
ok('V9 this was the only Partner record created since submission', other.length === 1, `rows since=${other.length}`);
console.log(`record ${c?.collaborators_code} registered ${c?.collaborators_registered_date}`);
process.exit(fail ? 1 : 0);
