#!/usr/bin/env node

const url = process.env.VNO_TARGET_URL;
const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
const anonKey = process.env.VNO_TARGET_ANON_KEY;
const backend = process.env.VNO_TEST_BACKEND_URL;
if (!url || !serviceKey || !anonKey || !backend) throw new Error('local Supabase and backend configuration is required');
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('D6 functional rehearsal must be local');
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(backend).hostname)) throw new Error('D6 backend rehearsal must be local');

const password = 'Local-Rehearsal-Only!42';
const ids = {
  admin: '10000000-0000-5000-8000-000000000001',
  merchant: '10000000-0000-5000-8000-000000000002',
  collaborator: '10000000-0000-5000-8000-000000000003',
  merchantEntity: '20000000-0000-5000-8000-000000000002',
  collaboratorEntity: '20000000-0000-5000-8000-000000000003',
  lifecycleAuth: '10000000-0000-5000-8000-000000000010',
  lifecycleProfile: '10000000-0000-5000-8000-000000000011',
  lifecycleMerchant: '20000000-0000-5000-8000-000000000010',
  lifecycleCollaborator: '20000000-0000-5000-8000-000000000011',
  orphanTransaction: '30000000-0000-5000-8000-000000000001',
  linkedTransaction: '30000000-0000-5000-8000-000000000002',
};

async function raw(route, { key = serviceKey, token = key, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${url}${route}`, { method, headers: {
    apikey: key, Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers,
  }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}

async function api(route, token, { method = 'GET', body } = {}) {
  const response = await fetch(`${backend}${route}`, { method, headers: {
    Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
  }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}

async function login(email) {
  const result = await raw('/auth/v1/token?grant_type=password', { key: anonKey, token: anonKey, method: 'POST', body: { email, password } });
  if (!result.json?.access_token) throw new Error(`local login failed for ${email}`);
  return result.json.access_token;
}

async function upsert(table, body, conflict) {
  const result = await raw(`/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: 'POST', body, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  if (result.status >= 300) throw new Error(`seed ${table}: HTTP ${result.status}`);
}

const results = [];
const check = (name, pass, evidence) => {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence });
  if (!pass) process.exitCode = 1;
};

const adminToken = await login('d2-admin@local.invalid');
const merchantToken = await login('d2-merchant@local.invalid');
const collaboratorToken = await login('d2-collaborator@local.invalid');

await upsert('merchant_details', [{ merchant_system_id: ids.lifecycleMerchant, merchant_code: 'D6-LIFE-M', merchant_name: 'D6 lifecycle merchant', owner_email: 'd6-lifecycle@local.invalid', merchant_verified: false, merchants_status: 'pending' }], 'merchant_system_id');
await upsert('collaborators', [
  { id: ids.collaboratorEntity, merchant_system_id: ids.merchantEntity, collaborators_code: 'D2-TEST-C', collaborators_name: 'D2 collaborator persona', collaborators_email: 'd2-collaborator@local.invalid', collaborators_verified: true, collaborators_status: 'active' },
  { id: ids.lifecycleCollaborator, merchant_system_id: ids.lifecycleMerchant, collaborators_code: 'D6-LIFE-C', collaborators_name: 'D6 lifecycle collaborator', collaborators_email: 'd6-lifecycle-c@local.invalid', collaborators_verified: false, collaborators_status: 'pending' },
], 'id');

await raw('/auth/v1/admin/users/' + ids.lifecycleAuth, { method: 'DELETE' });
const createdAuth = await raw('/auth/v1/admin/users', { method: 'POST', body: { id: ids.lifecycleAuth, email: 'd6-lifecycle-user@local.invalid', password, email_confirm: true, app_metadata: { role: 'merchant' } } });
if (createdAuth.status >= 300) throw new Error(`create lifecycle Auth user: HTTP ${createdAuth.status}`);
await upsert('user_profiles', [{ id: ids.lifecycleProfile, user_id: ids.lifecycleAuth, email: 'd6-lifecycle-user@local.invalid', role: 'merchant', user_profiles_status: 'active', merchant_id: ids.lifecycleMerchant, collaborator_id: null }], 'id');

const selfDeactivate = await api(`/user-profiles/${ids.admin}`, adminToken, { method: 'PATCH', body: { role: 'admin', user_profiles_status: 'inactive', merchant_id: null, collaborator_id: null } });
check('admin self-deactivation denial', selfDeactivate.status === 400, `HTTP ${selfDeactivate.status}`);
const merchantAdminWrite = await api(`/user-profiles/${ids.lifecycleProfile}`, merchantToken, { method: 'PATCH', body: { role: 'merchant', user_profiles_status: 'inactive', merchant_id: ids.lifecycleMerchant, collaborator_id: null } });
check('merchant admin lifecycle denial', merchantAdminWrite.status === 403, `HTTP ${merchantAdminWrite.status}`);
const lifecycleUpdate = await api(`/user-profiles/${ids.lifecycleProfile}`, adminToken, { method: 'PATCH', body: { role: 'collaborator', user_profiles_status: 'active', merchant_id: null, collaborator_id: ids.lifecycleCollaborator } });
check('admin role and assignment update', lifecycleUpdate.status === 200 && lifecycleUpdate.json?.role === 'collaborator' && lifecycleUpdate.json?.collaborator_id === ids.lifecycleCollaborator, `HTTP ${lifecycleUpdate.status}`);
const invalidAssignment = await api(`/user-profiles/${ids.lifecycleProfile}`, adminToken, { method: 'PATCH', body: { role: 'merchant', user_profiles_status: 'active', merchant_id: null, collaborator_id: ids.lifecycleCollaborator } });
check('inconsistent assignment denial', invalidAssignment.status === 400, `HTTP ${invalidAssignment.status}`);
const audits = await api('/audit-events?limit=20', adminToken);
check('admin lifecycle audit event', audits.status === 200 && audits.json.some((row) => row.action === 'user_profile.authorization_updated' && row.entity_id === ids.lifecycleProfile), `HTTP ${audits.status}`);

const adminMerchantCreate = await api('/merchants/admin', adminToken, { method: 'POST', body: {
  owner_email: 'd6-admin-created-merchant@local.invalid', merchant_name: 'D6 admin-created merchant', merchant_phone: '0900000012',
} });
check('admin creates pending merchant without activating an account', adminMerchantCreate.status === 201 && adminMerchantCreate.json?.merchants_status === 'pending' && adminMerchantCreate.json?.merchant_verified === false, `HTTP ${adminMerchantCreate.status}`);
const adminCollaboratorCreate = await api('/collaborators/admin', adminToken, { method: 'POST', body: {
  collaborators_name: 'D6 admin-created collaborator', collaborators_phone: '0900000013', collaborators_email: 'd6-admin-created-collaborator@local.invalid', merchant_system_id: ids.lifecycleMerchant,
} });
check('admin creates pending collaborator without activating an account', adminCollaboratorCreate.status === 201 && adminCollaboratorCreate.json?.collaborators_status === 'pending' && adminCollaboratorCreate.json?.collaborators_verified === false, `HTTP ${adminCollaboratorCreate.status}`);

const merchantPrivilegeEscalation = await api(`/merchants/${ids.merchantEntity}`, merchantToken, { method: 'PATCH', body: { merchant_verified: true } });
check('merchant cannot self-verify', merchantPrivilegeEscalation.status === 400, `HTTP ${merchantPrivilegeEscalation.status}`);
const collaboratorPrivilegeEscalation = await api(`/collaborators/${ids.collaboratorEntity}`, collaboratorToken, { method: 'PATCH', body: { collaborators_verified: true } });
check('collaborator cannot self-verify', collaboratorPrivilegeEscalation.status === 400, `HTTP ${collaboratorPrivilegeEscalation.status}`);

const merchantMembers = await api('/merchants/members', merchantToken);
check('merchant scoped member list', merchantMembers.status === 200 && merchantMembers.json.every((row) => row.merchant_system_id === undefined), `HTTP ${merchantMembers.status}`);
const collaboratorMembers = await api('/collaborators/members', collaboratorToken);
check('collaborator team member list', collaboratorMembers.status === 200 && collaboratorMembers.json.some((row) => row.id === ids.collaboratorEntity), `HTTP ${collaboratorMembers.status}`);
const adminMembersDenied = await api('/merchants/members', adminToken);
check('admin cannot impersonate merchant member scope', adminMembersDenied.status === 403, `HTTP ${adminMembersDenied.status}`);
const merchantMemberCreate = await api('/merchants/members', merchantToken, { method: 'POST', body: { collaborators_name: 'D6 merchant-created member', collaborators_phone: '0900000010', collaborators_email: 'd6-merchant-member@local.invalid', collaborators_password: password } });
check('merchant creates pending scoped member', merchantMemberCreate.status === 201 && merchantMemberCreate.json?.merchant_system_id === ids.merchantEntity && merchantMemberCreate.json?.collaborators_status === 'pending', `HTTP ${merchantMemberCreate.status}`);
const collaboratorMemberCreate = await api('/collaborators/members', collaboratorToken, { method: 'POST', body: { collaborators_name: 'D6 collaborator-created member', collaborators_phone: '0900000011', collaborators_email: 'd6-collaborator-member@local.invalid', collaborators_password: password } });
check('collaborator creates pending team member', collaboratorMemberCreate.status === 201 && collaboratorMemberCreate.json?.merchant_system_id === ids.merchantEntity && collaboratorMemberCreate.json?.collaborators_status === 'pending', `HTTP ${collaboratorMemberCreate.status}`);

await upsert('referral_transactions', [
  { id: ids.orphanTransaction, merchant_id: null, collaborator_id: ids.collaboratorEntity, legacy_status: 17, lifecycle_status: 'legacy-unmapped', payment_status: 'unverified', document_number: 'D6-ORPHAN', document_date_utc: '2026-10-16T12:00:00Z', document_total: '1000.0000', document_discount_amount: '100.0000', commission_percent: '5.0000', commission_amount: '50.0000', currency_code: 'VND' },
  { id: ids.linkedTransaction, merchant_id: ids.merchantEntity, collaborator_id: ids.collaboratorEntity, legacy_status: 23, lifecycle_status: 'legacy-unmapped', payment_status: 'unverified', document_number: 'D6-LINKED', document_date_utc: '2026-10-16T13:00:00Z', document_total: '2000.0000', document_discount_amount: '200.0000', commission_percent: '5.0000', commission_amount: '100.0000', currency_code: 'VND' },
], 'id');
const adminTransactions = await api('/transactions', adminToken);
check('admin sees preserved orphan transaction', adminTransactions.status === 200 && adminTransactions.json.some((row) => row.id === ids.orphanTransaction && row.merchant_id === null && row.legacy_status === 17), `HTTP ${adminTransactions.status}`);
const merchantTransactions = await api('/transactions/me', merchantToken);
check('merchant transaction ownership', merchantTransactions.status === 200 && merchantTransactions.json.some((row) => row.id === ids.linkedTransaction) && !merchantTransactions.json.some((row) => row.id === ids.orphanTransaction), `HTTP ${merchantTransactions.status}`);
const collaboratorTransactions = await api('/transactions/me', collaboratorToken);
check('collaborator sees linked and orphan history', collaboratorTransactions.status === 200 && [ids.orphanTransaction, ids.linkedTransaction].every((id) => collaboratorTransactions.json.some((row) => row.id === id)), `HTTP ${collaboratorTransactions.status}`);

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const upload = await api('/media/upload', merchantToken, { method: 'POST', body: { filename: 'd6-proof.png', mime_type: 'image/png', size_bytes: png.length, base64_data: png.toString('base64'), action: 'add', slot: 'main' } });
check('merchant private media proposal', upload.status === 201 && upload.json?.bucket_id === 'merchant-media' && upload.json?.merchant_id === ids.merchantEntity && upload.json?.transfer_status === 'verified' && upload.json?.publication_status === 'pending', `HTTP ${upload.status}`);
const ownMedia = await api('/media/me', merchantToken);
check('merchant media listing ownership', ownMedia.status === 200 && ownMedia.json.some((row) => row.id === upload.json?.id), `HTTP ${ownMedia.status}`);
const ownSigned = await api(`/media/${upload.json?.id}/signed-url`, merchantToken);
check('merchant signed retrieval', ownSigned.status === 200 && Boolean(ownSigned.json?.signedUrl), `HTTP ${ownSigned.status}`);
const foreignSigned = await api(`/media/${upload.json?.id}/signed-url`, collaboratorToken);
check('cross-role media retrieval denial', foreignSigned.status === 403, `HTTP ${foreignSigned.status}`);
const invalidMedia = await api('/media/upload', merchantToken, { method: 'POST', body: { filename: 'fake.jpg', mime_type: 'image/jpeg', size_bytes: png.length, base64_data: png.toString('base64') } });
check('media byte-signature denial', invalidMedia.status === 400, `HTTP ${invalidMedia.status}`);

await raw(`/storage/v1/object/${encodeURIComponent(upload.json?.bucket_id)}/${upload.json?.object_path}`, { method: 'DELETE' });
if (upload.json?.approval_request?.id) await raw(`/rest/v1/media_approval_requests?id=eq.${upload.json.approval_request.id}`, { method: 'DELETE' });
await raw(`/rest/v1/media_assets?id=eq.${upload.json?.id}`, { method: 'DELETE' });
await raw(`/rest/v1/referral_transactions?id=in.(${ids.orphanTransaction},${ids.linkedTransaction})`, { method: 'DELETE' });
const authUsers = await raw('/auth/v1/admin/users?page=1&per_page=1000');
for (const email of ['d6-merchant-member@local.invalid', 'd6-collaborator-member@local.invalid']) {
  const user = authUsers.json?.users?.find((candidate) => candidate.email === email);
  if (user) await raw(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
}
if (merchantMemberCreate.json?.id) await raw(`/rest/v1/collaborators?id=eq.${merchantMemberCreate.json.id}`, { method: 'DELETE' });
if (collaboratorMemberCreate.json?.id) await raw(`/rest/v1/collaborators?id=eq.${collaboratorMemberCreate.json.id}`, { method: 'DELETE' });
if (adminCollaboratorCreate.json?.id) await raw(`/rest/v1/collaborators?id=eq.${adminCollaboratorCreate.json.id}`, { method: 'DELETE' });
if (adminMerchantCreate.json?.merchant_system_id) await raw(`/rest/v1/merchant_details?merchant_system_id=eq.${adminMerchantCreate.json.merchant_system_id}`, { method: 'DELETE' });
await raw(`/auth/v1/admin/users/${ids.lifecycleAuth}`, { method: 'DELETE' });
await raw(`/rest/v1/collaborators?id=in.(${ids.lifecycleCollaborator})`, { method: 'DELETE' });
await raw(`/rest/v1/merchant_details?merchant_system_id=in.(${ids.lifecycleMerchant})`, { method: 'DELETE' });

console.log(JSON.stringify({ status: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL', controls: results.length, results }, null, 2));
