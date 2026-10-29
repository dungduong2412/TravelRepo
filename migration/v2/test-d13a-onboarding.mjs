#!/usr/bin/env node

import { randomUUID } from 'node:crypto';

const url = process.env.VNO_TARGET_URL;
const anonKey = process.env.VNO_TARGET_ANON_KEY;
const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
const backend = process.env.VNO_TEST_BACKEND_URL;
if (!url || !anonKey || !serviceKey || !backend) throw new Error('Local target and backend variables are required');
if (![url, backend].every((value) => ['127.0.0.1', 'localhost', '::1'].includes(new URL(value).hostname))) {
  throw new Error('D13A onboarding test is restricted to isolated local services');
}

const run = randomUUID();
const password = 'Local-Rehearsal-Only!42';
const emails = {
  merchant: `d13a-merchant-${run}@local.invalid`,
  collaborator: `d13a-collaborator-${run}@local.invalid`,
};
const created = { auth: [], media: [], requests: [], auditActors: [], merchants: [], collaborators: [] };
const results = [];
const check = (name, pass, evidence = '') => { results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence }); if (!pass) process.exitCode = 1; };

async function request(base, route, { key, token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(key ? { apikey: key } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json, headers: response.headers };
}
const raw = (route, options = {}) => request(url, route, { key: serviceKey, token: serviceKey, ...options });
const api = (route, token, options = {}) => request(backend, route, { token, ...options });
async function exactCount(table) {
  const response = await raw(`/rest/v1/${table}?select=id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
  return Number(response.headers.get('content-range')?.split('/')[1] || 0);
}
async function login(email) {
  const response = await request(url, '/auth/v1/token?grant_type=password', { key: anonKey, token: anonKey, method: 'POST', body: { email, password } });
  if (!response.json?.access_token) throw new Error(`Unable to authenticate ${email}`);
  return response.json;
}
async function createVerifiedUser(email) {
  const response = await raw('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } });
  if (response.status >= 300 || !response.json?.id) throw new Error(`Unable to create verified test user: HTTP ${response.status}`);
  created.auth.push(response.json.id); created.auditActors.push(response.json.id);
  return response.json;
}

const tables = ['user_profiles', 'merchant_details', 'collaborators', 'media_assets', 'media_approval_requests', 'referral_transactions'];
const before = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await exactCount(table)])));
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const uploadBody = (name) => ({ filename: name, mime_type: 'image/png', size_bytes: png.length, base64_data: png.toString('base64'), action: 'add', slot: 'main', display_order: 0, direct_publish: false });

try {
  const admin = await login('d2-admin@local.invalid');
  const merchantAuth = await createVerifiedUser(emails.merchant);
  const merchantSession = await login(emails.merchant);
  const merchantCreate = await api('/merchants', merchantSession.access_token, { method: 'POST', body: {
    owner_email: emails.merchant, merchant_name: `D13A Merchant ${run}`, merchant_email: emails.merchant,
    owner_name: 'Synthetic Owner', new_address_country: 'Vietnam', new_address_province: 'Synthetic Province',
  } });
  check('verified Merchant submits application', merchantCreate.status === 201 && merchantCreate.json?.merchants_status === 'pending', `HTTP ${merchantCreate.status}`);
  if (merchantCreate.json?.merchant_system_id) created.merchants.push(merchantCreate.json.merchant_system_id);
  const merchantId = merchantCreate.json?.merchant_system_id;

  const pendingProfile = await raw(`/rest/v1/user_profiles?select=user_profiles_status,merchant_id&user_id=eq.${merchantAuth.id}`);
  check('Merchant operational state remains pending', pendingProfile.json?.[0]?.user_profiles_status === 'pending' && pendingProfile.json?.[0]?.merchant_id === merchantId, `rows ${pendingProfile.json?.length || 0}`);
  const merchantRead = await api(`/merchants/${merchantId}`, merchantSession.access_token);
  check('pending Merchant reads own profile', merchantRead.status === 200, `HTTP ${merchantRead.status}`);
  const merchantEdit = await api(`/merchants/${merchantId}`, merchantSession.access_token, { method: 'PATCH', body: { merchant_phone: '0900000013', new_address_ward: 'Synthetic Ward' } });
  check('pending Merchant edits permitted fields', merchantEdit.status === 200, `HTTP ${merchantEdit.status}`);
  const deniedOperations = await api('/merchants/members', merchantSession.access_token);
  check('pending Merchant denied active operations', deniedOperations.status === 403, `HTTP ${deniedOperations.status}`);

  const merchantUpload = await api('/media/upload', merchantSession.access_token, { method: 'POST', body: uploadBody(`d13a-merchant-${run}.png`) });
  check('pending Merchant creates private media proposal', merchantUpload.status === 201 && merchantUpload.json?.publication_status === 'pending', `HTTP ${merchantUpload.status}`);
  if (merchantUpload.json?.id) created.media.push(merchantUpload.json);
  if (merchantUpload.json?.approval_request?.id) created.requests.push(merchantUpload.json.approval_request.id);
  const merchantEffectiveBefore = await api(`/media/approved/merchant/${merchantId}`, merchantSession.access_token);
  check('pending Merchant media remains unpublished', merchantEffectiveBefore.status === 200 && merchantEffectiveBefore.json?.length === 0, `HTTP ${merchantEffectiveBefore.status}; rows ${merchantEffectiveBefore.json?.length}`);

  const merchantApproval = await api(`/merchants/${merchantId}/approve`, admin.access_token, { method: 'POST' });
  check('Admin activates verified Merchant application', merchantApproval.status === 201 && merchantApproval.json?.merchants_status === 'active', `HTTP ${merchantApproval.status}`);
  const merchantMediaApproval = await api(`/media/approvals/${merchantUpload.json.approval_request.id}/approve`, admin.access_token, { method: 'POST', body: { reason: 'D13A isolated test' } });
  check('Admin separately publishes Merchant image', merchantMediaApproval.status === 201, `HTTP ${merchantMediaApproval.status}`);

  const collaboratorAuth = await createVerifiedUser(emails.collaborator);
  const collaboratorSession = await login(emails.collaborator);
  const collaboratorCreate = await api('/collaborators', collaboratorSession.access_token, { method: 'POST', body: {
    collaborators_name: `D13A Collaborator ${run}`, collaborators_phone: '0900000014', collaborators_email: emails.collaborator,
    collaborators_bank_name: 'Synthetic Bank', collaborators_bank_acc_number: 'TEST-ONLY',
  } });
  check('verified Collaborator submits application', collaboratorCreate.status === 201 && collaboratorCreate.json?.collaborators_status === 'pending', `HTTP ${collaboratorCreate.status}`);
  if (collaboratorCreate.json?.id) created.collaborators.push(collaboratorCreate.json.id);
  const collaboratorId = collaboratorCreate.json?.id;
  const collaboratorProfile = await raw(`/rest/v1/user_profiles?select=user_profiles_status,collaborator_id&user_id=eq.${collaboratorAuth.id}`);
  check('Collaborator operational state remains pending', collaboratorProfile.json?.[0]?.user_profiles_status === 'pending' && collaboratorProfile.json?.[0]?.collaborator_id === collaboratorId, `rows ${collaboratorProfile.json?.length || 0}`);
  const collaboratorUpload = await api('/media/upload', collaboratorSession.access_token, { method: 'POST', body: uploadBody(`d13a-collaborator-${run}.png`) });
  check('pending Collaborator creates private avatar proposal', collaboratorUpload.status === 201 && collaboratorUpload.json?.publication_status === 'pending', `HTTP ${collaboratorUpload.status}`);
  if (collaboratorUpload.json?.id) created.media.push(collaboratorUpload.json);
  if (collaboratorUpload.json?.approval_request?.id) created.requests.push(collaboratorUpload.json.approval_request.id);
  const qrBeforeApproval = await api('/collaborators/me/qr-code', collaboratorSession.access_token);
  check('pending Collaborator denied QR operations', qrBeforeApproval.status === 403, `HTTP ${qrBeforeApproval.status}`);
  const rejection = await api(`/collaborators/${collaboratorId}/reject`, admin.access_token, { method: 'POST' });
  check('Admin rejection separates application from media decision', rejection.status === 201 && rejection.json?.collaborators_status === 'blocked', `HTTP ${rejection.status}`);
  const resubmit = await api(`/collaborators/${collaboratorId}/resubmit`, collaboratorSession.access_token, { method: 'POST' });
  check('rejected Collaborator can resubmit own application', resubmit.status === 201 && resubmit.json?.collaborators_status === 'pending', `HTTP ${resubmit.status}`);
  const collaboratorApproval = await api(`/collaborators/${collaboratorId}/approve`, admin.access_token, { method: 'POST' });
  check('Admin activates resubmitted Collaborator', collaboratorApproval.status === 201 && collaboratorApproval.json?.collaborators_status === 'active', `HTTP ${collaboratorApproval.status}`);
  const collaboratorMediaApproval = await api(`/media/approvals/${collaboratorUpload.json.approval_request.id}/approve`, admin.access_token, { method: 'POST', body: { reason: 'D13A isolated test' } });
  check('Admin separately publishes Collaborator avatar', collaboratorMediaApproval.status === 201, `HTTP ${collaboratorMediaApproval.status}`);

  const refresh = await request(url, '/auth/v1/token?grant_type=refresh_token', { key: anonKey, token: anonKey, method: 'POST', body: { refresh_token: merchantSession.refresh_token } });
  check('verified Merchant session refreshes', refresh.status === 200 && Boolean(refresh.json?.access_token), `HTTP ${refresh.status}`);
  const transactionCount = await exactCount('referral_transactions');
  check('onboarding creates no financial transaction', transactionCount === before.referral_transactions, `${before.referral_transactions} before / ${transactionCount} during`);
} finally {
  for (const media of created.media) {
    await raw(`/storage/v1/object/${encodeURIComponent(media.bucket_id)}/${media.object_path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' });
  }
  if (created.requests.length) await raw(`/rest/v1/media_approval_requests?id=in.(${created.requests.join(',')})`, { method: 'DELETE' });
  if (created.media.length) await raw(`/rest/v1/media_assets?id=in.(${created.media.map((row) => row.id).join(',')})`, { method: 'DELETE' });
  for (const id of created.auditActors) await raw(`/rest/v1/audit_events?actor_auth_user_id=eq.${id}`, { method: 'DELETE' });
  for (const id of created.auth) {
    const profiles = await raw(`/rest/v1/user_profiles?select=id&user_id=eq.${id}`);
    for (const profile of profiles.json || []) {
      await raw(`/rest/v1/merchant_user_links?user_profile_id=eq.${profile.id}`, { method: 'DELETE' });
    }
    await raw(`/rest/v1/user_profiles?user_id=eq.${id}`, { method: 'DELETE' });
  }
  for (const id of created.merchants) await raw(`/rest/v1/merchant_details?merchant_system_id=eq.${id}`, { method: 'DELETE' });
  for (const id of created.collaborators) await raw(`/rest/v1/collaborators?id=eq.${id}`, { method: 'DELETE' });
  for (const id of created.auth) await raw(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
}

const after = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await exactCount(table)])));
for (const table of tables) check(`${table} count restored`, after[table] === before[table], `${before[table]} before / ${after[table]} after`);
console.log(JSON.stringify({ status: results.every((row) => row.status === 'PASS') ? 'PASS' : 'FAIL', controls: results.length, results }, null, 2));
