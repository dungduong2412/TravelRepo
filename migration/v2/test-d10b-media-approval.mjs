#!/usr/bin/env node

const url = process.env.VNO_TARGET_URL; const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY; const anonKey = process.env.VNO_TARGET_ANON_KEY; const backend = process.env.VNO_TEST_BACKEND_URL;
if (!url || !serviceKey || !anonKey || !backend) throw new Error('local configuration required');
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) throw new Error('D10B test must be local');
const password = 'Local-Rehearsal-Only!42';
const merchantId = '20000000-0000-5000-8000-000000000002'; const collaboratorId = '20000000-0000-5000-8000-000000000003';
async function request(base, route, { key = serviceKey, token = key, method = 'GET', body } = {}) { const response = await fetch(`${base}${route}`, { method, headers: { apikey: key, Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await response.text(); let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; } return { status: response.status, json }; }
const raw = (route, options) => request(url, route, options); const api = (route, token, options = {}) => request(backend, route, { ...options, key: undefined, token });
async function login(email) { const result = await raw('/auth/v1/token?grant_type=password', { key: anonKey, token: anonKey, method: 'POST', body: { email, password } }); if (!result.json?.access_token) throw new Error(`login failed: ${email}`); return result.json.access_token; }
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const uploadBody = (name, extra = {}) => ({ filename: name, mime_type: 'image/png', size_bytes: png.length, base64_data: png.toString('base64'), action: 'add', slot: 'main', ...extra });
const results = []; const check = (name, pass, evidence = '') => { results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence }); if (!pass) process.exitCode = 1; };
const [admin, merchant, collaborator] = await Promise.all([login('d2-admin@local.invalid'), login('d2-merchant@local.invalid'), login('d2-collaborator@local.invalid')]);
const financeBefore = await raw('/rest/v1/referral_transactions?select=id,document_total,document_discount_amount,commission_amount');
const merchantBefore = await api(`/merchants/${merchantId}`, merchant);
const categoryRows = await raw('/rest/v1/categories?select=id&limit=1');
const categoryIds = (categoryRows.json || []).map((row) => row.id);
const merchantEdit = await api(`/merchants/${merchantId}`, merchant, { method: 'PATCH', body: { owner_name: 'D10B Synthetic Owner', owner_phone: '0900000099', owner_tax_code: 'D10B-TAX', merchant_name: 'D10B Synthetic Merchant', merchant_contact_phone: '0900000088', merchant_description: '**D10B rich description**', merchant_description_format: 'markdown', new_address_country: 'Vietnam', new_address_province: 'Synthetic Province', new_address_district: 'Synthetic District', new_address_ward: 'Synthetic Ward', new_address_line: 'Synthetic street', category_ids: categoryIds } });
const merchantRead = await api(`/merchants/${merchantId}`, merchant);
check('complete merchant details persist through owner API', merchantEdit.status === 200 && merchantRead.json?.owner_tax_code === 'D10B-TAX' && merchantRead.json?.merchant_description_format === 'markdown' && merchantRead.json?.new_address_country === 'Vietnam' && merchantRead.json?.new_address_district === 'Synthetic District' && JSON.stringify(merchantRead.json?.category_ids || []) === JSON.stringify(categoryIds), `PATCH ${merchantEdit.status}${merchantEdit.status === 200 ? '' : ` ${JSON.stringify(merchantEdit.json)}`}`);
check('legacy geography remains unchanged', merchantRead.json?.legacy_country === merchantBefore.json?.legacy_country && merchantRead.json?.legacy_province === merchantBefore.json?.legacy_province && merchantRead.json?.legacy_district === merchantBefore.json?.legacy_district && merchantRead.json?.legacy_ward === merchantBefore.json?.legacy_ward, 'legacy fields compared before/after');

const merchantUpload = await api('/media/upload', merchant, { method: 'POST', body: uploadBody('d10b-merchant.png') });
check('merchant upload creates pending private proposal', merchantUpload.status === 201 && merchantUpload.json?.publication_status === 'pending' && merchantUpload.json?.approval_request?.status === 'pending', `HTTP ${merchantUpload.status}`);
const pendingPublic = await api(`/media/approved/merchant/${merchantId}`, anonKey);
check('pending media remains unpublished', pendingPublic.status === 200 && pendingPublic.json?.length === 0, `HTTP ${pendingPublic.status}`);
const foreignPreview = await api(`/media/${merchantUpload.json?.id}/signed-url`, collaborator);
check('cross-owner pending preview denied', foreignPreview.status === 403, `HTTP ${foreignPreview.status}`);
const directStorage = await raw(`/storage/v1/object/authenticated/${encodeURIComponent(merchantUpload.json?.bucket_id)}/${merchantUpload.json?.object_path}`, { key: anonKey, token: anonKey });
check('unauthorized direct Storage read denied', directStorage.status >= 400, `HTTP ${directStorage.status}`);

const collaboratorUpload = await api('/media/upload', collaborator, { method: 'POST', body: uploadBody('d10b-collaborator.png') });
check('collaborator upload is independently scoped', collaboratorUpload.status === 201 && collaboratorUpload.json?.collaborator_id === collaboratorId, `HTTP ${collaboratorUpload.status}`);
const queue = await api('/media/approvals?status=pending&page=1&page_size=25', admin);
check('admin pending queue covers both owner types', queue.status === 200 && queue.json?.items?.some((x) => x.id === merchantUpload.json?.approval_request?.id) && queue.json?.items?.some((x) => x.id === collaboratorUpload.json?.approval_request?.id), `HTTP ${queue.status}`);

const approved = await api(`/media/approvals/${merchantUpload.json?.approval_request?.id}/approve`, admin, { method: 'POST', body: { reason: 'D10B test approval' } });
check('admin approval succeeds', approved.status === 201 && approved.json?.status === 'approved', `HTTP ${approved.status}`);
const publicAfter = await api(`/media/approved/merchant/${merchantId}`, anonKey);
check('approval publishes exactly the proposed main image', publicAfter.status === 200 && publicAfter.json?.length === 1 && publicAfter.json[0]?.id === merchantUpload.json?.id && publicAfter.json[0]?.is_hero === true, `HTTP ${publicAfter.status}`);
const duplicate = await api(`/media/approvals/${merchantUpload.json?.approval_request?.id}/approve`, admin, { method: 'POST', body: {} });
check('duplicate approval is rejected', duplicate.status === 400, `HTTP ${duplicate.status}`);

const replacement = await api('/media/upload', merchant, { method: 'POST', body: uploadBody('d10b-replacement.png', { action: 'replace', target_media_id: merchantUpload.json?.id }) });
check('replacement creates pending proposal with target version', replacement.status === 201 && replacement.json?.approval_request?.target_media_id === merchantUpload.json?.id, `HTTP ${replacement.status}`);
const crossOwner = await api('/media/upload', collaborator, { method: 'POST', body: uploadBody('d10b-cross.png', { action: 'replace', target_media_id: merchantUpload.json?.id }) });
check('cross-collaborator replacement denied', crossOwner.status === 403, `HTTP ${crossOwner.status}`);
const rejected = await api(`/media/approvals/${replacement.json?.approval_request?.id}/reject`, admin, { method: 'POST', body: { reason: 'Synthetic rejection' } });
check('admin rejection records reason', rejected.status === 201 && rejected.json?.status === 'rejected' && rejected.json?.decision_reason === 'Synthetic rejection', `HTTP ${rejected.status}`);
const afterReject = await api(`/media/approved/merchant/${merchantId}`, anonKey);
check('rejection preserves old effective image', afterReject.status === 200 && afterReject.json?.length === 1 && afterReject.json[0]?.id === merchantUpload.json?.id, `HTTP ${afterReject.status}`);

const removal = await api('/media/requests/change', merchant, { method: 'POST', body: { action: 'remove', target_media_id: merchantUpload.json?.id } });
const duplicateChange = await api('/media/requests/change', merchant, { method: 'POST', body: { action: 'reorder', target_media_id: merchantUpload.json?.id, display_order: 4 } });
check('concurrent pending target change is rejected', removal.status === 201 && duplicateChange.status === 400, `first ${removal.status}; second ${duplicateChange.status}`);
const removalApproved = await api(`/media/approvals/${removal.json?.id}/approve`, admin, { method: 'POST', body: {} });
const afterRemoval = await api(`/media/approved/merchant/${merchantId}`, anonKey);
check('approved removal withdraws effective image', removalApproved.status === 201 && afterRemoval.json?.length === 0, `HTTP ${removalApproved.status}`);

const concurrentApprovals = await Promise.all([api(`/media/approvals/${collaboratorUpload.json?.approval_request?.id}/approve`, admin, { method: 'POST', body: {} }), api(`/media/approvals/${collaboratorUpload.json?.approval_request?.id}/approve`, admin, { method: 'POST', body: {} })]);
check('concurrent approval has one winner', concurrentApprovals.filter((result) => result.status === 201).length === 1 && concurrentApprovals.filter((result) => result.status === 400).length === 1, concurrentApprovals.map((result) => result.status).join(','));
const cancellable = await api('/media/upload', merchant, { method: 'POST', body: uploadBody('d10b-cancel.png', { slot: 'gallery' }) });
const cancelled = await api(`/media/requests/${cancellable.json?.approval_request?.id}`, merchant, { method: 'DELETE' });
check('owner can safely cancel pending proposal', cancellable.status === 201 && cancelled.status === 200 && cancelled.json?.request?.status === 'cancelled', `upload ${cancellable.status}; cancel ${cancelled.status}`);
const directAdmin = await api('/media/upload', admin, { method: 'POST', body: uploadBody('d10b-admin-direct.png', { slot: 'gallery', merchant_id: merchantId, direct_publish: true }) });
check('direct Admin publication is explicit and approved', directAdmin.status === 201 && directAdmin.json?.publication_status === 'approved' && directAdmin.json?.approval_request?.status === 'approved', `HTTP ${directAdmin.status}`);
const badUpload = await api('/media/upload', merchant, { method: 'POST', body: { ...uploadBody('bad.jpg'), mime_type: 'image/jpeg' } });
check('failed signature upload leaves no proposal', badUpload.status === 400, `HTTP ${badUpload.status}`);
const financeAfter = await raw('/rest/v1/referral_transactions?select=id,document_total,document_discount_amount,commission_amount');
check('historical financial records unchanged', JSON.stringify(financeAfter.json) === JSON.stringify(financeBefore.json), `${financeBefore.json?.length} rows`);

await api(`/merchants/${merchantId}`, merchant, { method: 'PATCH', body: { owner_name: merchantBefore.json?.owner_name ?? null, owner_phone: merchantBefore.json?.owner_phone ?? null, owner_tax_code: merchantBefore.json?.owner_tax_code ?? null, merchant_name: merchantBefore.json?.merchant_name, merchant_contact_phone: merchantBefore.json?.merchant_contact_phone ?? null, merchant_description: merchantBefore.json?.merchant_description ?? null, merchant_description_format: merchantBefore.json?.merchant_description_format || 'plain_text', new_address_country: merchantBefore.json?.new_address_country ?? null, new_address_province: merchantBefore.json?.new_address_province ?? null, new_address_district: merchantBefore.json?.new_address_district ?? null, new_address_ward: merchantBefore.json?.new_address_ward ?? null, new_address_line: merchantBefore.json?.new_address_line ?? null, category_ids: merchantBefore.json?.category_ids || [] } });

const mediaIds = [merchantUpload.json?.id, replacement.json?.id, collaboratorUpload.json?.id, cancellable.json?.id, directAdmin.json?.id];
const mediaRows = await raw('/rest/v1/media_assets?select=id,bucket_id,object_path&id=in.(' + mediaIds.join(',') + ')');
for (const row of mediaRows.json || []) await raw(`/storage/v1/object/${encodeURIComponent(row.bucket_id)}/${row.object_path}`, { method: 'DELETE' });
await raw('/rest/v1/media_approval_requests?id=not.is.null', { method: 'DELETE' });
await raw('/rest/v1/media_assets?id=in.(' + mediaIds.join(',') + ')', { method: 'DELETE' });
console.log(JSON.stringify({ status: results.every((x) => x.status === 'PASS') ? 'PASS' : 'FAIL', controls: results.length, results }, null, 2));
