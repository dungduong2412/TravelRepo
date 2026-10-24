#!/usr/bin/env node

import { createHash } from 'node:crypto';

const base = process.env.VNO_TARGET_URL;
const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
if (!base || !serviceKey) throw new Error('VNO_TARGET_URL and VNO_TARGET_SERVICE_ROLE_KEY are required');
const parsed = new URL(base);
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('D11 verification is restricted to an isolated local target');
}
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

async function request(route, extraHeaders = {}) {
  const response = await fetch(`${base.replace(/\/$/, '')}${route}`, { headers: { ...headers, ...extraHeaders } });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response;
}

async function rows(table, query) {
  return (await request(`/rest/v1/${table}?${query}`)).json();
}
async function exactCount(table, query = '') {
  const response = await request(`/rest/v1/${table}?select=*&${query}`, { Prefer: 'count=exact', Range: '0-0' });
  return Number(response.headers.get('content-range')?.split('/')[1] || 0);
}

const media = await rows('media_assets', 'select=id,bucket_id,object_path,size_bytes,sha256_hex,merchant_id,collaborator_id,publication_status,transfer_status&order=id');
let verifiedBytes = 0;
let hashFailures = 0;
for (const asset of media) {
  const encodedPath = asset.object_path.split('/').map(encodeURIComponent).join('/');
  const bytes = Buffer.from(await (await request(`/storage/v1/object/authenticated/${encodeURIComponent(asset.bucket_id)}/${encodedPath}`)).arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== Number(asset.size_bytes) || digest !== asset.sha256_hex) hashFailures += 1;
  verifiedBytes += bytes.length;
}

const [merchants, collaborators, transactions, categoryLinks, sourceRecordCount, authMaps] = await Promise.all([
  rows('merchant_details', 'select=merchant_system_id&legacy_tenant_id=eq.b7688a1c-23f9-637d-c2fb-3a16eb1befd2'),
  rows('collaborators', 'select=id&legacy_tenant_id=eq.b7688a1c-23f9-637d-c2fb-3a16eb1befd2'),
  rows('referral_transactions', 'select=id,merchant_id,legacy_restaurant_id,legacy_status,document_total,document_discount_amount,commission_amount&legacy_tenant_id=eq.b7688a1c-23f9-637d-c2fb-3a16eb1befd2'),
  rows('merchant_category_links', 'select=merchant_id,category_id&legacy_tenant_id=eq.b7688a1c-23f9-637d-c2fb-3a16eb1befd2'),
  exactCount('legacy_source_records'),
  rows('legacy_identity_map', 'select=legacy_user_id,auth_strategy,password_reset_required,migration_status'),
]);
const decimal4 = (value) => {
  const [whole, fraction = ''] = String(value || 0).split('.');
  return BigInt(whole) * 10000n + BigInt((fraction + '0000').slice(0, 4));
};
const format4 = (value) => `${value / 10000n}.${String(value % 10000n).padStart(4, '0')}`;
const totals = transactions.reduce((sum, row) => ({
  document: sum.document + decimal4(row.document_total),
  discount: sum.discount + decimal4(row.document_discount_amount),
  commission: sum.commission + decimal4(row.commission_amount),
}), { document: 0n, discount: 0n, commission: 0n });
const result = {
  status: hashFailures === 0 ? 'PASS' : 'FAIL',
  tenant_scope: { merchants: merchants.length, collaborators: collaborators.length, transactions: transactions.length, merchant_category_links: categoryLinks.length, scoped_relational_rows: sourceRecordCount },
  financials: { document_total: format4(totals.document), discount_total: format4(totals.discount), commission_total: format4(totals.commission) },
  orphan_transactions: transactions.filter((row) => row.legacy_restaurant_id && !row.merchant_id).length,
  source_statuses: Object.fromEntries([...new Set(transactions.map((row) => String(row.legacy_status)))].sort().map((status) => [status, transactions.filter((row) => String(row.legacy_status) === status).length])),
  media: { files: media.length, bytes: verifiedBytes, sha256_verified: media.length - hashFailures, hash_failures: hashFailures, merchant_files: media.filter((asset) => asset.bucket_id === 'merchant-media').length, collaborator_files: media.filter((asset) => asset.bucket_id === 'partner-media').length, legacy_effective_verified: media.filter((asset) => asset.publication_status === 'legacy_effective' && asset.transfer_status === 'verified').length },
  auth_mapping: { rows: authMaps.length, password_reset_strategy: authMaps.filter((row) => row.auth_strategy === 'password_reset' && row.password_reset_required === true).length, authentication_proven: false },
};
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'PASS') process.exitCode = 1;
