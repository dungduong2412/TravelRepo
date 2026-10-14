#!/usr/bin/env node

const supabaseUrl = process.env.VNO_UAT_SUPABASE_URL;
const anonKey = process.env.VNO_UAT_SUPABASE_ANON_KEY;
const apiUrl = process.env.VNO_UAT_API_URL;
const webUrl = process.env.VNO_UAT_WEB_URL;
const password = process.env.VNO_UAT_TEST_PASSWORD;
const personas = [
  { role: 'admin', email: process.env.VNO_UAT_ADMIN_EMAIL },
  { role: 'merchant', email: process.env.VNO_UAT_MERCHANT_EMAIL },
  { role: 'collaborator', email: process.env.VNO_UAT_COLLABORATOR_EMAIL },
];
if (!supabaseUrl || !anonKey || !apiUrl || !webUrl || !password || personas.some((item) => !item.email)) {
  throw new Error('UAT URLs, anon key, and three authorized test-account credentials are required');
}

const results = [];
const assert = (name, pass, evidence) => {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence });
  if (!pass) process.exitCode = 1;
};

const loginPage = await fetch(`${webUrl.replace(/\/$/, '')}/login`, { redirect: 'manual' });
assert('web login route', loginPage.status === 200, `HTTP ${loginPage.status}`);
const health = await fetch(`${apiUrl.replace(/\/$/, '')}/health`);
assert('API health', health.status === 200, `HTTP ${health.status}`);

for (const persona of personas) {
  const login = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email: persona.email, password }),
  });
  const body = await login.json().catch(() => null);
  assert(`${persona.role} authentication`, login.status === 200 && Boolean(body?.access_token), `HTTP ${login.status}`);
  persona.token = body?.access_token;
}

if (personas.every((persona) => persona.token)) {
  const [admin, merchant, collaborator] = personas;
  for (const route of ['/transactions', '/commissions', '/media']) {
    const allowed = await fetch(`${apiUrl}${route}`, { headers: { Authorization: `Bearer ${admin.token}` } });
    assert(`admin ${route}`, allowed.status === 200, `HTTP ${allowed.status}`);
    for (const persona of [merchant, collaborator]) {
      const denied = await fetch(`${apiUrl}${route}`, { headers: { Authorization: `Bearer ${persona.token}` } });
      assert(`${persona.role} denied ${route}`, denied.status === 403, `HTTP ${denied.status}`);
    }
  }
  for (const persona of [merchant, collaborator]) {
    const profile = await fetch(`${apiUrl}/user-profiles/me`, { headers: { Authorization: `Bearer ${persona.token}` } });
    assert(`${persona.role} own profile`, profile.status === 200, `HTTP ${profile.status}`);
  }
}

console.log(JSON.stringify({
  status: results.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL',
  scope: 'authorized UAT accounts only',
  customer_email_sent: false,
  results,
}, null, 2));
