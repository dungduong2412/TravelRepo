#!/usr/bin/env node
const url = process.env.VNO_TARGET_URL;
const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
const anonKey = process.env.VNO_TARGET_ANON_KEY;
const backend = process.env.VNO_TEST_BACKEND_URL;
if (!url || !serviceKey || !anonKey) throw new Error('local target URL, service key, and anon key are required');
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('authorization rehearsal must be local');

const password = 'Local-Rehearsal-Only!42';
const personas = [
  { role: 'admin', id: '10000000-0000-5000-8000-000000000001', email: 'd2-admin@local.invalid' },
  { role: 'merchant', id: '10000000-0000-5000-8000-000000000002', email: 'd2-merchant@local.invalid',
    entity: '20000000-0000-5000-8000-000000000002' },
  { role: 'collaborator', id: '10000000-0000-5000-8000-000000000003', email: 'd2-collaborator@local.invalid',
    entity: '20000000-0000-5000-8000-000000000003' },
];

async function call(route, { key = serviceKey, token = key, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${url}${route}`, { method, headers: {
    apikey: key, Authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers,
  }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}

async function upsert(table, body, conflict) {
  const result = await call(`/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: 'POST', body, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  if (result.status >= 300) throw new Error(`seed ${table}: HTTP ${result.status}`);
}

await upsert('merchant_details', [{ merchant_system_id: personas[1].entity, merchant_code: 'D2-TEST-M',
  merchant_name: 'D2 merchant persona', merchant_verified: true, merchants_status: 'active' }], 'merchant_system_id');
await upsert('collaborators', [{ id: personas[2].entity, collaborators_code: 'D2-TEST-C',
  collaborators_name: 'D2 collaborator persona', collaborators_verified: true, collaborators_status: 'active' }], 'id');

const existing = await call('/auth/v1/admin/users?page=1&per_page=1000');
for (const persona of personas) {
  let user = existing.json.users.find((candidate) => candidate.email === persona.email);
  if (!user) {
    const created = await call('/auth/v1/admin/users', { method: 'POST', body: {
      id: persona.id, email: persona.email, password, email_confirm: true, app_metadata: { role: persona.role },
    }});
    if (created.status >= 300) throw new Error(`create ${persona.role}: HTTP ${created.status}`);
    user = created.json;
  } else {
    const updated = await call(`/auth/v1/admin/users/${user.id}`, { method: 'PUT', body: { password } });
    if (updated.status >= 300) throw new Error(`update ${persona.role}: HTTP ${updated.status}`);
  }
  await upsert('user_profiles', [{ id: persona.id, user_id: user.id, email: persona.email,
    role: persona.role, full_name: `D2 ${persona.role}`, user_profiles_status: 'active',
    merchant_id: persona.role === 'merchant' ? persona.entity : null,
    collaborator_id: persona.role === 'collaborator' ? persona.entity : null }], 'id');
}

const results = [];
const assert = (name, pass, evidence) => {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence });
  if (!pass) process.exitCode = 1;
};

const publicCategories = await call('/rest/v1/categories?select=id&limit=1', { key: anonKey, token: anonKey });
assert('anonymous category read', publicCategories.status === 200, `HTTP ${publicCategories.status}`);
const anonymousPrivate = await call('/rest/v1/merchant_details?select=merchant_system_id&limit=1', { key: anonKey, token: anonKey });
assert('anonymous private-domain denial', anonymousPrivate.status >= 400, `HTTP ${anonymousPrivate.status}`);

for (const persona of personas) {
  const login = await call('/auth/v1/token?grant_type=password', { key: anonKey, token: anonKey,
    method: 'POST', body: { email: persona.email, password } });
  assert(`${persona.role} Supabase Auth`, login.status === 200 && Boolean(login.json?.access_token), `HTTP ${login.status}`);
  if (!login.json?.access_token) continue;
  persona.token = login.json.access_token;
  const own = await call('/rest/v1/user_profiles?select=user_id,role&user_id=eq.' + persona.id,
    { key: anonKey, token: persona.token });
  assert(`${persona.role} own profile`, own.status === 200 && own.json.length === 1 && own.json[0].role === persona.role,
    `HTTP ${own.status}; rows ${own.json?.length ?? 'n/a'}`);
  const others = await call('/rest/v1/user_profiles?select=user_id&user_id=neq.' + persona.id,
    { key: anonKey, token: persona.token });
  assert(`${persona.role} profile isolation`, others.status === 200 && others.json.length === 0,
    `HTTP ${others.status}; rows ${others.json?.length ?? 'n/a'}`);
  const privateTable = await call('/rest/v1/referral_transactions?select=id&limit=1',
    { key: anonKey, token: persona.token });
  assert(`${persona.role} direct financial denial`, privateTable.status >= 400, `HTTP ${privateTable.status}`);
}

const escalation = await call(`/rest/v1/user_profiles?user_id=eq.${personas[1].id}`, {
  key: anonKey, token: personas[1].token, method: 'PATCH', body: { role: 'admin' },
});
assert('role escalation denial', escalation.status >= 400, `HTTP ${escalation.status}`);

if (backend) {
  for (const persona of personas) {
    const response = await fetch(`${backend}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: persona.email, password, userType: persona.role }) });
    const body = await response.json().catch(() => null);
    const contractEntity = persona.role === 'merchant' ? body?.merchant :
      persona.role === 'collaborator' ? body?.collaborator : true;
    assert(`${persona.role} backend login`, response.status < 300 &&
      body?.user?.role === persona.role && Boolean(contractEntity), `HTTP ${response.status}`);
  }
  const adminHeaders = { Authorization: `Bearer ${personas[0].token}` };
  const merchantHeaders = { Authorization: `Bearer ${personas[1].token}` };
  for (const route of ['/transactions', '/commissions', '/media']) {
    const adminResponse = await fetch(`${backend}${route}`, { headers: adminHeaders });
    const merchantResponse = await fetch(`${backend}${route}`, { headers: merchantHeaders });
    assert(`admin ${route}`, adminResponse.status === 200, `HTTP ${adminResponse.status}`);
    assert(`merchant denied ${route}`, merchantResponse.status === 403, `HTTP ${merchantResponse.status}`);
  }
  for (const route of ['/transactions/me', '/commissions/me']) {
    const response = await fetch(`${backend}${route}`, { headers: merchantHeaders });
    assert(`merchant ${route}`, response.status === 200, `HTTP ${response.status}`);
  }
  const publicVerified = await fetch(`${backend}/merchants/verified`);
  const publicVerifiedBody = await publicVerified.json().catch(() => []);
  assert('public verified merchants sanitized', publicVerified.status === 200 &&
    publicVerifiedBody.every((row) => !Object.hasOwn(row, 'owner_password')), `HTTP ${publicVerified.status}`);
  const privateMerchantList = await fetch(`${backend}/merchants`);
  assert('anonymous merchant list denial', privateMerchantList.status === 401, `HTTP ${privateMerchantList.status}`);
  const privateMerchantDetail = await fetch(`${backend}/merchants/${personas[1].entity}`);
  assert('anonymous merchant detail denial', privateMerchantDetail.status === 401, `HTTP ${privateMerchantDetail.status}`);
  const privateCollaboratorList = await fetch(`${backend}/collaborators`);
  assert('anonymous collaborator list denial', privateCollaboratorList.status === 401, `HTTP ${privateCollaboratorList.status}`);
  const organizationWrite = await fetch(`${backend}/organization-profile`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organization_name: 'denied' }),
  });
  assert('anonymous organization write denial', organizationWrite.status === 401, `HTTP ${organizationWrite.status}`);
  const ownMerchantUpdate = await fetch(`${backend}/merchants/${personas[1].entity}`, {
    method: 'PATCH', headers: { ...merchantHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ merchants_status: 'active' }),
  });
  assert('merchant own update', ownMerchantUpdate.status === 200, `HTTP ${ownMerchantUpdate.status}`);
  const ownMerchantRead = await fetch(`${backend}/merchants/${personas[1].entity}`, {
    headers: merchantHeaders,
  });
  const ownMerchantBody = await ownMerchantRead.json().catch(() => null);
  assert('merchant own read', ownMerchantRead.status === 200 &&
    !Object.hasOwn(ownMerchantBody || {}, 'owner_password'), `HTTP ${ownMerchantRead.status}`);
  const foreignMerchantRead = await fetch(`${backend}/merchants/${personas[1].entity}`, {
    headers: { Authorization: `Bearer ${personas[2].token}` },
  });
  assert('collaborator foreign merchant read denial', foreignMerchantRead.status === 403,
    `HTTP ${foreignMerchantRead.status}`);
  const foreignMerchantUpdate = await fetch(`${backend}/merchants/${personas[1].entity}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${personas[2].token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ merchants_status: 'active' }),
  });
  assert('collaborator foreign merchant denial', foreignMerchantUpdate.status === 403, `HTTP ${foreignMerchantUpdate.status}`);
}

console.log(JSON.stringify({ status: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL', results }, null, 2));
