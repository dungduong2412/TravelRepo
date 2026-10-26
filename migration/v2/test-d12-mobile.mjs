#!/usr/bin/env node

const url = process.env.VNO_TARGET_URL;
const anonKey = process.env.VNO_TARGET_ANON_KEY;
const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
const backend = process.env.VNO_TEST_BACKEND_URL;
if (!url || !anonKey || !serviceKey || !backend) throw new Error('Local target and backend variables are required');
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname) || !['127.0.0.1', 'localhost', '::1'].includes(new URL(backend).hostname)) throw new Error('D12 tests are restricted to isolated local services');

const password = 'Local-Rehearsal-Only!42';
const identities = { admin: 'd2-admin@local.invalid', merchant: 'd2-merchant@local.invalid', collaborator: 'd2-collaborator@local.invalid' };
const results = [];
function assert(name, pass, evidence) { results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence }); if (!pass) process.exitCode = 1; }
async function request(path, { token, method = 'GET', body } = {}) { const response = await fetch(`${backend}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await response.text(); let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; } return { status: response.status, json }; }
async function login(email, role) { const response = await fetch(`${backend}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, userType: role }) }); const json = await response.json(); if (!response.ok || !json.access_token) throw new Error(`${role} login failed: HTTP ${response.status}`); return json.access_token; }
async function transactionCount() { const response = await fetch(`${url}/rest/v1/referral_transactions?select=id`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'count=exact', Range: '0-0' } }); return Number(response.headers.get('content-range')?.split('/')[1] || 0); }

const tokens = Object.fromEntries(await Promise.all(Object.entries(identities).map(async ([role, email]) => [role, await login(email, role)])));
const beforeCount = await transactionCount();
const qr = await request('/collaborators/me/qr-code', { token: tokens.collaborator });
assert('collaborator QR is generated', qr.status === 200 && String(qr.json?.qr_code_image).startsWith('data:image/png;base64,'), `HTTP ${qr.status}`);
assert('QR payload is stable code only', qr.json?.qr_payload === 'D2-TEST-C' && qr.json?.qr_payload_format === 'collaborator_code', `format ${qr.json?.qr_payload_format || 'missing'}`);
assert('QR response contains no bank details', !Object.keys(qr.json || {}).some((key) => key.includes('bank') || key.includes('account')), 'sanitized QR response');

const first = await request('/qr/resolve', { token: tokens.merchant, method: 'POST', body: { payload: 'D2-TEST-C' } });
const second = await request('/qr/resolve', { token: tokens.merchant, method: 'POST', body: { payload: 'https://uat.invalid/c/D2-TEST-C' } });
assert('merchant resolves raw collaborator code', first.status === 201 && first.json?.collaborator_code === 'D2-TEST-C' && first.json?.verified === true, `HTTP ${first.status}`);
assert('merchant resolves URL-wrapped code', second.status === 201 && second.json?.collaborator_code === 'D2-TEST-C', `HTTP ${second.status}`);
assert('repeat scan is explicitly read-only', first.json?.idempotent === true && second.json?.idempotent === true && first.json?.financial_action_created === false && second.json?.financial_action_created === false, 'no financial action');
assert('merchant scan response contains no private contact or bank fields', [first.json, second.json].every((value) => !Object.keys(value || {}).some((key) => /bank|phone|email|account/i.test(key))), 'sanitized merchant response');

for (const role of ['admin', 'collaborator']) { const denied = await request('/qr/resolve', { token: tokens[role], method: 'POST', body: { payload: 'D2-TEST-C' } }); assert(`${role} denied merchant scanner`, denied.status === 403, `HTTP ${denied.status}`); }
const invalid = await request('/qr/resolve', { token: tokens.merchant, method: 'POST', body: { payload: 'NOT-A-CODE' } });
assert('invalid QR is rejected', invalid.status === 404, `HTTP ${invalid.status}`);
const publicResult = await request('/c/D2-TEST-C');
assert('public referral resolution is sanitized', publicResult.status === 200 && !Object.keys(publicResult.json || {}).some((key) => /bank|phone|email|account/i.test(key)), `HTTP ${publicResult.status}`);
const ownProfile = await request('/collaborators/me', { token: tokens.collaborator });
assert('collaborator can read own banking metadata', ownProfile.status === 200 && Object.hasOwn(ownProfile.json || {}, 'collaborators_bank_name'), `HTTP ${ownProfile.status}`);
const foreignProfile = await request('/collaborators/me', { token: tokens.merchant });
assert('merchant cannot read collaborator private profile', foreignProfile.status === 403, `HTTP ${foreignProfile.status}`);
const afterCount = await transactionCount();
assert('QR verification leaves transactions unchanged', beforeCount === afterCount, `${beforeCount} before / ${afterCount} after`);

console.log(JSON.stringify({ status: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL', controls: results.length, results }, null, 2));
