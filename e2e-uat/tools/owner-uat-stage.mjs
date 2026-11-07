// READ-ONLY. Where is one Partner (or Merchant) test alias in the owner's manual UAT flow? One line per stage, no secrets, nothing written or sent.
//   railway run --service vno-api -- node e2e-uat/tools/owner-uat-stage.mjs <alias e-mail>
// Stages: S0 no Auth user -> S1 signed up, e-mail NOT confirmed -> S2 confirmed, no profile -> S3 submitted (pending) -> S4 approved (active)
// plus login evidence (login_count / last_login_at), the approval/submission audit events, duplicates, and whether the Partner QR code exists.
const email = (process.argv[2] || '').trim().toLowerCase();
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !url || !key) { console.log('usage: needs <email> and SUPABASE_* env (railway run --service vno-api)'); process.exit(2); }
const H = { apikey: key, Authorization: `Bearer ${key}` };
const get = async (p) => { const r = await fetch(url + p, { headers: H }); if (!r.ok) throw new Error(`${p.split('?')[0]} ${r.status}`); return r.json(); };
const q = encodeURIComponent;
const mask = (e) => String(e).replace(/^(.{1,3}).*?(\+[^@]*)?@/, (m, a, b) => `${a}***${b || ''}@`);

let user = null;
for (let page = 1; page < 30 && !user; page++) {
  const b = await get(`/auth/v1/admin/users?page=${page}&per_page=1000`);
  user = (b.users ?? []).find((u) => String(u.email).toLowerCase() === email) ?? null; if ((b.users ?? []).length < 1000) break;
}
console.log('alias', mask(email), '| checked', new Date().toISOString());
if (!user) { console.log('S0  no Auth user yet (nothing signed up)'); process.exit(0); }
const role = user.user_metadata?.requested_role;
console.log(`S1  Auth user exists: created ${user.created_at}, requested_role=${role}, e-mail confirmed=${user.email_confirmed_at ? user.email_confirmed_at : 'NO'}, last_sign_in=${user.last_sign_in_at ?? 'never'}`);
if (!user.email_confirmed_at) { console.log('    -> waiting for the owner to open the confirmation link'); process.exit(0); }

const profs = await get(`/rest/v1/user_profiles?select=*&or=(user_id.eq.${user.id},email.ilike.${q(email)})`);
const cols = await get(`/rest/v1/collaborators?select=*&collaborators_email=ilike.${q(email)}`);
const mer = await get(`/rest/v1/merchant_details?select=merchant_system_id,merchant_name,merchants_status,merchant_verified,merchant_email,owner_email&or=(merchant_email.ilike.${q(email)},owner_email.ilike.${q(email)})`);
console.log(`S2  profiles=${profs.length} partner records=${cols.length} merchant records=${mer.length}`);
if (!profs.length && !cols.length && !mer.length) { console.log('    -> confirmed, profile NOT submitted yet (correct before "Gửi hồ sơ")'); process.exit(0); }

const p = profs[0]; const c = cols[0];
console.log(`S3  profile: role=${p?.role} status=${p?.user_profiles_status} login_count=${p?.login_count ?? 0} last_login_at=${p?.last_login_at ?? 'never'}`);
if (c) {
  console.log(`    partner record: code=${c.collaborators_code} status=${c.collaborators_status} verified=${c.collaborators_verified} registered=${c.collaborators_registered_date}`);
  console.log(`    linked: ${p?.collaborator_id === c.id ? 'profile -> this record (OK)' : 'NOT LINKED'} | duplicates by name: ${(await get(`/rest/v1/collaborators?select=id&collaborators_name=eq.${q(c.collaborators_name ?? '')}`)).length - 1}`);
  const audit = await get(`/rest/v1/audit_events?select=occurred_at,action&entity_id=eq.${c.id}&order=occurred_at.asc`);
  console.log('    audit:', audit.map((a) => `${a.action}@${a.occurred_at}`).join(' | ') || 'none');
  const approved = c.collaborators_status === 'active' && c.collaborators_verified === true && p?.user_profiles_status === 'active';
  console.log(approved ? `S4  APPROVED: record active+verified, profile active. QR code value present: ${c.collaborators_code ? 'yes (' + c.collaborators_code + ')' : 'NO'}` : '    -> not approved yet (pending Admin approval)');
}
for (const m of mer) console.log(`    merchant record: ${m.merchant_system_id} status=${m.merchants_status} verified=${m.merchant_verified}`);
