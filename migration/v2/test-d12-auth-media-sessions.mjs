#!/usr/bin/env node

const url = process.env.VNO_TARGET_URL;
const anonKey = process.env.VNO_TARGET_ANON_KEY;
const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
const backend = process.env.VNO_TEST_BACKEND_URL;
if (!url || !anonKey || !serviceKey || !backend) throw new Error('Local target and backend variables are required');
if (![url, backend].every((value) => ['127.0.0.1', 'localhost', '::1'].includes(new URL(value).hostname))) {
  throw new Error('D12 Auth/media session tests are restricted to isolated local services');
}

const password = 'Local-Rehearsal-Only!42';
const personas = [
  { role: 'merchant', email: 'd2-merchant@local.invalid', ownerType: 'merchant', ownerId: '20000000-0000-5000-8000-000000000002' },
  { role: 'collaborator', email: 'd2-collaborator@local.invalid', ownerType: 'collaborator', ownerId: '20000000-0000-5000-8000-000000000003' },
];
const results = [];
function check(name, pass, evidence) {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence });
  if (!pass) process.exitCode = 1;
}
async function auth(path, { key = anonKey, method = 'POST', body } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}
async function api(path, token) {
  const response = await fetch(`${backend}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}
async function sessionFor(persona, method) {
  if (method === 'password') {
    return auth('/auth/v1/token?grant_type=password', { body: { email: persona.email, password } });
  }
  const link = await auth('/auth/v1/admin/generate_link', {
    key: serviceKey,
    body: { type: method, email: persona.email, options: { redirect_to: 'http://127.0.0.1:3001' } },
  });
  if (link.status >= 300 || !link.json?.hashed_token) return link;
  return auth('/auth/v1/verify', { body: { type: method, token_hash: link.json.hashed_token } });
}

for (const persona of personas) {
  for (const method of ['password', 'magiclink', 'recovery']) {
    const session = await sessionFor(persona, method);
    check(`${persona.role} ${method} establishes session`, session.status === 200 && Boolean(session.json?.access_token) && Boolean(session.json?.refresh_token), `HTTP ${session.status}`);
    if (!session.json?.access_token) continue;

    const profile = await api('/user-profiles/me', session.json.access_token);
    const expectedAssignment = persona.role === 'merchant'
      ? profile.json?.merchant_id === persona.ownerId
      : profile.json?.collaborator_id === persona.ownerId;
    check(`${persona.role} ${method} resolves assigned identity`, profile.status === 200 && profile.json?.role === persona.role && expectedAssignment, `HTTP ${profile.status}`);

    const media = await api('/media/me', session.json.access_token);
    const effective = Array.isArray(media.json) ? media.json.filter((row) => ['approved', 'legacy_effective', 'preexisting_effective'].includes(row.publication_status)) : [];
    check(`${persona.role} ${method} loads effective media`, media.status === 200 && effective.length === 1, `HTTP ${media.status}; ${effective.length} effective`);
    if (effective[0]) {
      const signed = await api(`/media/${effective[0].id}/signed-url`, session.json.access_token);
      const bytes = signed.json?.signedUrl ? await fetch(signed.json.signedUrl) : null;
      check(`${persona.role} ${method} retrieves signed media`, signed.status === 200 && bytes?.status === 200 && String(bytes.headers.get('content-type')).startsWith('image/'), `sign ${signed.status}; object ${bytes?.status || 'n/a'}`);
    }

    const refreshed = await auth('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.json.refresh_token } });
    const refreshedProfile = refreshed.json?.access_token ? await api('/user-profiles/me', refreshed.json.access_token) : { status: 0 };
    const refreshedMedia = refreshed.json?.access_token ? await api('/media/me', refreshed.json.access_token) : { status: 0, json: [] };
    check(`${persona.role} ${method} survives session refresh`, refreshed.status === 200 && refreshedProfile.status === 200 && refreshedMedia.status === 200 && refreshedMedia.json.some((row) => ['approved', 'legacy_effective', 'preexisting_effective'].includes(row.publication_status)), `refresh ${refreshed.status}; profile ${refreshedProfile.status}; media ${refreshedMedia.status}`);
  }
}

console.log(JSON.stringify({
  status: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL',
  controls: results.length,
  results,
}, null, 2));
