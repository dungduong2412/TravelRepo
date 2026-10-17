#!/usr/bin/env node

const url = process.env.VNO_TARGET_URL;
const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
const anonKey = process.env.VNO_TARGET_ANON_KEY;
const backend = process.env.VNO_TEST_BACKEND_URL;
if (!url || !serviceKey || !anonKey || !backend) throw new Error('local Supabase and backend configuration is required');
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname) || !['127.0.0.1', 'localhost', '::1'].includes(new URL(backend).hostname)) throw new Error('D10 functional rehearsal must be local');

const password = 'Local-Rehearsal-Only!42';
const ids = {
  merchant: '20000000-0000-5000-8000-000000000002',
  collaborator: '20000000-0000-5000-8000-000000000003',
  detail: '31000000-0000-5000-8000-000000000001',
  second: '31000000-0000-5000-8000-000000000002',
  orphan: '31000000-0000-5000-8000-000000000003',
};

async function raw(route, { key = serviceKey, token = key, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${url}${route}`, { method, headers: { apikey: key, Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await response.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}
async function api(route, token, { method = 'GET', body } = {}) {
  const response = await fetch(`${backend}${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await response.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}
async function login(email) {
  const result = await raw('/auth/v1/token?grant_type=password', { key: anonKey, token: anonKey, method: 'POST', body: { email, password } });
  if (!result.json?.access_token) throw new Error(`local login failed for ${email}`);
  return result.json.access_token;
}
async function upsertTransactions(rows) {
  const normalized = rows.map((row) => ({
    legacy_transaction_id: null,
    legacy_restaurant_display_name: null,
    legacy_middleman_display_name: null,
    ...row,
  }));
  const result = await raw('/rest/v1/referral_transactions?on_conflict=id', { method: 'POST', body: normalized, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  if (result.status >= 300) throw new Error(`seed transactions: HTTP ${result.status} ${JSON.stringify(result.json)}`);
}

const results = [];
const check = (name, pass, evidence) => { results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence }); if (!pass) process.exitCode = 1; };
const [adminToken, merchantToken, collaboratorToken] = await Promise.all([login('d2-admin@local.invalid'), login('d2-merchant@local.invalid'), login('d2-collaborator@local.invalid')]);

const coreRows = [
  { id: ids.detail, legacy_transaction_id: ids.detail, merchant_id: ids.merchant, collaborator_id: ids.collaborator, legacy_status: null, lifecycle_status: 'legacy-unmapped', payment_status: 'unverified', document_number: 'D10-DETAIL', document_date_utc: '2026-10-17T01:00:00Z', document_total: '100.1234', document_discount_percent: '10.1000', document_discount_amount: '10.1111', commission_percent: '5.0000', commission_amount: '5.0062', currency_code: 'VND', legacy_restaurant_display_name: 'D10 source merchant', legacy_middleman_display_name: 'D10 source collaborator' },
  { id: ids.second, legacy_transaction_id: ids.second, merchant_id: ids.merchant, collaborator_id: ids.collaborator, legacy_status: 17, lifecycle_status: 'legacy-unmapped', payment_status: 'unverified', document_number: 'D10-SECOND', document_date_utc: '2026-10-17T02:00:00Z', document_total: '200.2000', document_discount_percent: '10.0000', document_discount_amount: '20.0200', commission_percent: '5.0000', commission_amount: '10.0100', currency_code: 'VND' },
  { id: ids.orphan, legacy_transaction_id: ids.orphan, merchant_id: null, collaborator_id: ids.collaborator, legacy_status: 23, lifecycle_status: 'legacy-unmapped', payment_status: 'unverified', document_number: 'D10-ORPHAN', document_date_utc: '2026-10-17T03:00:00Z', document_total: '300.0000', document_discount_percent: '10.0000', document_discount_amount: '30.0000', commission_percent: '5.0000', commission_amount: '15.0000', currency_code: 'VND', legacy_restaurant_display_name: 'Historical merchant without destination relation' },
];
await upsertTransactions(coreRows);

const scaleRows = Array.from({ length: 1005 }, (_, index) => ({
  id: `32000000-0000-5000-8000-${String(index + 1).padStart(12, '0')}`,
  merchant_id: ids.merchant, collaborator_id: ids.collaborator, legacy_status: 9,
  lifecycle_status: 'legacy-unmapped', payment_status: 'unverified', document_number: `D10-SCALE-${String(index + 1).padStart(4, '0')}`,
  document_date_utc: '2026-10-16T00:00:00Z', document_total: '1.0000', document_discount_percent: '0.0000', document_discount_amount: '0.0000', commission_percent: '0.0000', commission_amount: '0.0000', currency_code: 'VND',
}));
for (let offset = 0; offset < scaleRows.length; offset += 250) await upsertTransactions(scaleRows.slice(offset, offset + 250));

const report = await api('/transactions/report?page=1&page_size=25', adminToken);
check('admin paginated financial report', report.status === 200 && report.json?.total === 1008 && report.json?.items?.length === 25, `HTTP ${report.status}; total ${report.json?.total}`);
check('full filtered exact totals beyond 1000 rows', report.json?.summary?.transaction_count === 1008 && report.json?.summary?.document_total === '1605.3234' && report.json?.summary?.document_discount_amount === '60.1311' && report.json?.summary?.commission_amount === '30.0162', JSON.stringify(report.json?.summary));

const detail = await api('/transactions/report?search=D10-DETAIL&page=1&page_size=10', adminToken);
const detailRow = detail.json?.items?.[0];
check('merchant and collaborator names/codes replace UUID presentation', detail.status === 200 && detailRow?.merchant?.merchant_code === 'D2-TEST-M' && detailRow?.collaborator?.collaborators_code === 'D2-TEST-C', `HTTP ${detail.status}`);
check('null source status is preserved without invention', detailRow?.legacy_status === null && detail.json?.summary?.source_statuses?.null === 1, `legacy_status ${detailRow?.legacy_status}`);
check('discount and commission rates/amounts preserved', String(detailRow?.document_discount_percent) === '10.1' && String(detailRow?.document_discount_amount) === '10.1111' && String(detailRow?.commission_percent) === '5' && String(detailRow?.commission_amount) === '5.0062', 'exact stored values returned');

const orphan = await api('/transactions/report?orphan_only=true&page=1&page_size=10', adminToken);
check('historical orphan is preserved without invented merchant', orphan.status === 200 && orphan.json?.total === 1 && orphan.json?.items?.[0]?.merchant_id === null, `HTTP ${orphan.status}; total ${orphan.json?.total}`);
const nullStatus = await api('/transactions/report?legacy_status=null&page=1&page_size=10', adminToken);
check('null source-status filter', nullStatus.status === 200 && nullStatus.json?.total === 1, `HTTP ${nullStatus.status}`);

const merchantReport = await api('/transactions/me/report?page=1&page_size=10', merchantToken);
check('merchant report ownership excludes orphan', merchantReport.status === 200 && merchantReport.json?.total === 1007 && !merchantReport.json?.items?.some((row) => row.id === ids.orphan), `HTTP ${merchantReport.status}; total ${merchantReport.json?.total}`);
const collaboratorReport = await api('/transactions/me/report?page=1&page_size=10', collaboratorToken);
check('collaborator report ownership includes linked orphan', collaboratorReport.status === 200 && collaboratorReport.json?.total === 1008, `HTTP ${collaboratorReport.status}; total ${collaboratorReport.json?.total}`);
const merchantAdminReport = await api('/transactions/report?page=1&page_size=10', merchantToken);
check('merchant denied admin financial report', merchantAdminReport.status === 403, `HTTP ${merchantAdminReport.status}`);

const directory = await api('/merchants/admin-directory?search=D2-TEST-M&page=1&page_size=10', adminToken);
check('admin merchant directory search and pagination', directory.status === 200 && directory.json?.total === 1 && directory.json?.items?.[0]?.merchant_code === 'D2-TEST-M', `HTTP ${directory.status}`);
const operational = await api(`/merchants/${ids.merchant}/operational-detail`, adminToken);
check('admin operational detail includes history/media/category contracts', operational.status === 200 && Array.isArray(operational.json?.update_requests) && Array.isArray(operational.json?.media) && Array.isArray(operational.json?.categories), `HTTP ${operational.status}`);
const merchantOperational = await api(`/merchants/${ids.merchant}/operational-detail`, merchantToken);
check('merchant denied admin operational detail', merchantOperational.status === 403, `HTTP ${merchantOperational.status}`);
const merchantAdminEdit = await api(`/merchants/${ids.merchant}/admin`, merchantToken, { method: 'PATCH', body: { merchant_priority: 7 } });
check('merchant denied governed admin edit', merchantAdminEdit.status === 403, `HTTP ${merchantAdminEdit.status}`);

await raw(`/rest/v1/referral_transactions?id=in.(${coreRows.map((row) => row.id).join(',')})`, { method: 'DELETE' });
for (let offset = 0; offset < scaleRows.length; offset += 100) {
  await raw(`/rest/v1/referral_transactions?id=in.(${scaleRows.slice(offset, offset + 100).map((row) => row.id).join(',')})`, { method: 'DELETE' });
}

console.log(JSON.stringify({ status: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL', controls: results.length, results }, null, 2));
