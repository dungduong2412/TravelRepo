#!/usr/bin/env node

import { createHash } from 'node:crypto';
const url = process.env.VNO_TARGET_URL; const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY; const anonKey = process.env.VNO_TARGET_ANON_KEY; const backend = process.env.VNO_TEST_BACKEND_URL;
if (!url || !serviceKey || !anonKey || !backend) throw new Error('Local rehearsal configuration is required');
if (![url, backend].every((value) => ['127.0.0.1', 'localhost', '::1'].includes(new URL(value).hostname))) throw new Error('D12 migrated-data acceptance is local-only');
const tenant = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2'; const password = 'Local-Rehearsal-Only!42';
async function raw(route) { const response = await fetch(`${url}${route}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }); const json = await response.json(); if (!response.ok) throw new Error(`REST ${response.status}`); return json; }
async function api(route, token) { const response = await fetch(`${backend}${route}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); const text = await response.text(); let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; } return { status: response.status, json }; }
const login = await fetch(`${backend}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'd2-admin@local.invalid', password }) }); const loginBody = await login.json(); if (!login.ok) throw new Error('Synthetic admin login failed'); const admin = loginBody.access_token;
const mediaRows = await raw('/rest/v1/media_assets?select=id,merchant_id,collaborator_id,sha256_hex,size_bytes,publication_status,transfer_status&publication_status=eq.legacy_effective&limit=618');
const merchantMedia = mediaRows.find((row) => row.merchant_id); const collaboratorMedia = mediaRows.find((row) => row.collaborator_id);
const merchantRows = await raw(`/rest/v1/merchant_details?select=merchant_system_id,merchant_code,legacy_country,legacy_province,legacy_district,legacy_ward&merchant_system_id=eq.${merchantMedia.merchant_id}&legacy_tenant_id=eq.${tenant}`);
const collaboratorRows = await raw(`/rest/v1/collaborators?select=id,collaborators_code,collaborators_bank_name,collaborators_bank_acc_name,collaborators_bank_acc_number&id=eq.${collaboratorMedia.collaborator_id}&legacy_tenant_id=eq.${tenant}`);
const results = []; const check = (name, pass, evidence) => { results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence }); if (!pass) process.exitCode = 1; };
const detail = await api(`/merchants/${merchantMedia.merchant_id}/operational-detail`, admin);
check('migrated merchant profile loads in application', detail.status === 200 && detail.json?.merchant?.merchant_system_id === merchantMedia.merchant_id, `HTTP ${detail.status}`);
check('migrated categories are exposed as associations', Array.isArray(detail.json?.categories), `${detail.json?.categories?.length ?? 0} categories`);
check('legacy geography is preserved without remapping', merchantRows.length === 1 && ['legacy_country','legacy_province','legacy_district','legacy_ward'].every((key) => Object.hasOwn(merchantRows[0], key)), 'four legacy geography fields retained');
const merchantGallery = await api(`/media/approved/merchant/${merchantMedia.merchant_id}`);
const collaboratorGallery = await api(`/media/approved/collaborator/${collaboratorMedia.collaborator_id}`);
check('original merchant gallery renders through signed URLs', merchantGallery.status === 200 && merchantGallery.json.some((row) => row.id === merchantMedia.id && row.publication_status === 'legacy_effective' && row.signed_url), `HTTP ${merchantGallery.status}`);
check('original collaborator avatar renders through signed URLs', collaboratorGallery.status === 200 && collaboratorGallery.json.some((row) => row.id === collaboratorMedia.id && row.publication_status === 'legacy_effective' && row.signed_url), `HTTP ${collaboratorGallery.status}`);
const signedRow = merchantGallery.json.find((row) => row.id === merchantMedia.id); const bytes = Buffer.from(await (await fetch(signedRow.signed_url)).arrayBuffer());
check('application-served media retains bytes and hash', bytes.length === Number(merchantMedia.size_bytes) && createHash('sha256').update(bytes).digest('hex') === merchantMedia.sha256_hex, `${bytes.length} bytes`);
const collaborators = await api('/collaborators', admin); const historical = collaborators.json?.find((row) => row.id === collaboratorMedia.collaborator_id);
check('admin can read migrated banking metadata', collaborators.status === 200 && historical && ['collaborators_bank_name','collaborators_bank_acc_name','collaborators_bank_acc_number'].every((key) => Object.hasOwn(historical, key)), `HTTP ${collaborators.status}`);
const publicReferral = await api(`/c/${encodeURIComponent(collaboratorRows[0].collaborators_code)}`);
check('public referral identity excludes banking metadata', publicReferral.status === 200 && !Object.keys(publicReferral.json || {}).some((key) => /bank|account/i.test(key)), `HTTP ${publicReferral.status}`);
const report = await api('/transactions/report?page=1&page_size=100', admin);
check('historical transactions and source statuses load', report.status === 200 && report.json?.summary?.transaction_count === 102 && Object.keys(report.json?.summary?.source_statuses || {}).length === 4, `HTTP ${report.status}; ${report.json?.summary?.transaction_count} rows`);
check('historical financial totals remain exact', report.json?.summary?.document_total === '377705162.0000' && report.json?.summary?.document_discount_amount === '24077880.8000' && report.json?.summary?.commission_amount === '27466958.1000', JSON.stringify(report.json?.summary));
const orphan = await api('/transactions/report?orphan_only=true&page=1&page_size=10', admin);
check('historical orphan remains unassigned', orphan.status === 200 && orphan.json?.total === 1 && orphan.json?.items?.[0]?.merchant_id === null, `HTTP ${orphan.status}; ${orphan.json?.total} rows`);
console.log(JSON.stringify({ status: results.every((row) => row.status === 'PASS') ? 'PASS' : 'FAIL', controls: results.length, results }, null, 2));
