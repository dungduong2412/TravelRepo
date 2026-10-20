#!/usr/bin/env node

const url = process.env.VNO_TARGET_URL;
const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
const anonKey = process.env.VNO_TARGET_ANON_KEY;
const backend = process.env.VNO_TEST_BACKEND_URL;
if (!url || !serviceKey || !anonKey || !backend) throw new Error('local configuration required');
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) {
  throw new Error('D10B category test must be local');
}

const password = 'Local-Rehearsal-Only!42';
const v2MerchantId = '60000000-0000-5000-8000-000000000001';
const legacyMerchantId = '61000000-0000-5000-8000-000000000001';
const legacyRestaurantId = '61000000-0000-5000-8000-000000000002';
const tenantId = '61000000-0000-5000-8000-000000000003';
const categoryIds = [1, 2, 3, 4].map((n) => `62000000-0000-5000-8000-${String(n).padStart(12, '0')}`);
const legacyCategoryIds = [1, 2, 3, 4].map((n) => `63000000-0000-5000-8000-${String(n).padStart(12, '0')}`);
const legacySourceCategoryIds = [1, 2, 3, 4].map((n) => `64000000-0000-5000-8000-${String(n).padStart(12, '0')}`);

async function request(base, route, { key = serviceKey, token = key, method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}

const raw = (route, options) => request(url, route, options);
const api = (route, token, options = {}) => request(backend, route, { ...options, key: undefined, token });
async function login(email) {
  const result = await raw('/auth/v1/token?grant_type=password', {
    key: anonKey,
    token: anonKey,
    method: 'POST',
    body: { email, password },
  });
  if (!result.json?.access_token) throw new Error(`login failed: ${email}`);
  return result.json.access_token;
}

const results = [];
const check = (name, pass, evidence = '') => {
  results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence });
  if (!pass) process.exitCode = 1;
};
const requireStatus = (label, response, expected) => {
  if (!expected.includes(response.status)) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${JSON.stringify(response.json)}`);
  }
};

const admin = await login('d2-admin@local.invalid');

try {
  const v2Categories = categoryIds.map((id, index) => ({
    id,
    category_name: `D10B category ${index + 1}`,
    category_name_vi: `D10B category ${index + 1}`,
    is_active: true,
    display_order: 9000 + index,
    legacy_category_id: null,
    legacy_tenant_id: null,
  }));
  const legacyCategories = legacyCategoryIds.map((id, index) => ({
    id,
    category_name: `D10B legacy category ${index + 1}`,
    category_name_vi: `D10B legacy category ${index + 1}`,
    is_active: true,
    display_order: 9100 + index,
    legacy_category_id: legacySourceCategoryIds[index],
    legacy_tenant_id: tenantId,
  }));
  const categoryFixture = await raw('/rest/v1/categories?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: [...v2Categories, ...legacyCategories],
  });
  requireStatus('category fixture', categoryFixture, [200, 201]);
  const v2MerchantFixture = await raw('/rest/v1/merchant_details?on_conflict=merchant_system_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      merchant_system_id: v2MerchantId,
      merchant_code: 'D10B-V2-CATEGORY',
      merchant_name: 'D10B V2 category merchant',
      merchants_status: 'active',
    },
  });
  requireStatus('V2 merchant fixture', v2MerchantFixture, [200, 201]);

  for (const count of [0, 1, 2, 3]) {
    const response = await api(`/merchants/${v2MerchantId}/admin`, admin, {
      method: 'PATCH',
      body: { category_ids: categoryIds.slice(0, count) },
    });
    const stored = await raw(`/rest/v1/merchant_category_links?merchant_id=eq.${v2MerchantId}&select=category_id`);
    check(`${count} distinct category selections accepted`, response.status === 200 && stored.json?.length === count, `HTTP ${response.status}; stored ${stored.json?.length}`);
  }

  const overLimit = await api(`/merchants/${v2MerchantId}/admin`, admin, {
    method: 'PATCH',
    body: { category_ids: categoryIds },
  });
  const afterOverLimit = await raw(`/rest/v1/merchant_category_links?merchant_id=eq.${v2MerchantId}&select=category_id`);
  check('4 category selections rejected without changing current links', overLimit.status === 400 && afterOverLimit.json?.length === 3, `HTTP ${overLimit.status}; stored ${afterOverLimit.json?.length}`);

  const duplicate = await api(`/merchants/${v2MerchantId}/admin`, admin, {
    method: 'PATCH',
    body: { category_ids: [categoryIds[0], categoryIds[0]] },
  });
  const afterDuplicate = await raw(`/rest/v1/merchant_category_links?merchant_id=eq.${v2MerchantId}&select=category_id`);
  check('duplicate category selections rejected without changing current links', duplicate.status === 400 && afterDuplicate.json?.length === 3, `HTTP ${duplicate.status}; stored ${afterDuplicate.json?.length}`);

  await api(`/merchants/${v2MerchantId}/admin`, admin, { method: 'PATCH', body: { category_ids: [] } });
  const directThree = await raw('/rest/v1/merchant_category_links', {
    method: 'POST',
    prefer: 'return=minimal',
    body: categoryIds.slice(0, 3).map((category_id) => ({ merchant_id: v2MerchantId, category_id, association_source: 'v2' })),
  });
  const directFourth = await raw('/rest/v1/merchant_category_links', {
    method: 'POST',
    prefer: 'return=minimal',
    body: { merchant_id: v2MerchantId, category_id: categoryIds[3], association_source: 'v2' },
  });
  const directStored = await raw(`/rest/v1/merchant_category_links?merchant_id=eq.${v2MerchantId}&select=category_id`);
  check('database trigger blocks a direct fourth V2 association', directThree.status === 201 && directFourth.status === 400 && directStored.json?.length === 3, `three ${directThree.status}; fourth ${directFourth.status}; stored ${directStored.json?.length}`);

  await api(`/merchants/${v2MerchantId}/admin`, admin, { method: 'PATCH', body: { category_ids: [] } });
  await raw('/rest/v1/merchant_category_links', {
    method: 'POST',
    prefer: 'return=minimal',
    body: categoryIds.slice(0, 2).map((category_id) => ({ merchant_id: v2MerchantId, category_id, association_source: 'v2' })),
  });
  const concurrent = await Promise.all(categoryIds.slice(2).map((category_id) => raw('/rest/v1/merchant_category_links', {
    method: 'POST',
    prefer: 'return=minimal',
    body: { merchant_id: v2MerchantId, category_id, association_source: 'v2' },
  })));
  const concurrentStored = await raw(`/rest/v1/merchant_category_links?merchant_id=eq.${v2MerchantId}&select=category_id`);
  check('concurrent direct inserts cannot race beyond 3 categories', concurrent.filter((response) => response.status === 201).length === 1 && concurrent.filter((response) => response.status === 400).length === 1 && concurrentStored.json?.length === 3, `${concurrent.map((response) => response.status).join(',')}; stored ${concurrentStored.json?.length}`);

  const legacyMerchantFixture = await raw('/rest/v1/merchant_details?on_conflict=merchant_system_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      merchant_system_id: legacyMerchantId,
      merchant_code: 'D10B-LEGACY-CATEGORY',
      merchant_name: 'D10B legacy category merchant',
      merchants_status: 'unmapped',
      legacy_restaurant_id: legacyRestaurantId,
      legacy_tenant_id: tenantId,
    },
  });
  requireStatus('legacy merchant fixture', legacyMerchantFixture, [200, 201]);
  const legacyInsert = await raw('/rest/v1/merchant_category_links', {
    method: 'POST',
    prefer: 'return=minimal',
    body: legacyCategoryIds.map((category_id) => ({
      merchant_id: legacyMerchantId,
      category_id,
      legacy_tenant_id: tenantId,
      association_source: 'v1_import',
    })),
  });
  const legacyBeforeEdit = await raw(`/rest/v1/merchant_category_links?merchant_id=eq.${legacyMerchantId}&select=category_id,association_source`);
  check('validated V1 import preserves more than 3 historical associations', legacyInsert.status === 201 && legacyBeforeEdit.json?.length === 4 && legacyBeforeEdit.json.every((row) => row.association_source === 'v1_import'), `HTTP ${legacyInsert.status}; stored ${legacyBeforeEdit.json?.length}`);

  const unrelatedEdit = await api(`/merchants/${legacyMerchantId}/admin`, admin, {
    method: 'PATCH',
    body: { merchant_name: 'D10B unrelated profile edit' },
  });
  const legacyAfterEdit = await raw(`/rest/v1/merchant_category_links?merchant_id=eq.${legacyMerchantId}&select=category_id,association_source`);
  check('unrelated profile edit does not disturb legacy associations above limit', unrelatedEdit.status === 200 && legacyAfterEdit.json?.length === 4, `HTTP ${unrelatedEdit.status}; stored ${legacyAfterEdit.json?.length}`);

  const auditRows = await raw(`/rest/v1/audit_events?action=eq.merchant.categories_updated&entity_id=eq.${v2MerchantId}&select=id`);
  check('successful category changes remain audited', Array.isArray(auditRows.json) && auditRows.json.length >= 4, `${auditRows.json?.length || 0} audit rows`);
} finally {
  await raw(`/rest/v1/merchant_category_links?merchant_id=eq.${v2MerchantId}`, { method: 'DELETE' });
  await raw(`/rest/v1/merchant_category_links?merchant_id=eq.${legacyMerchantId}`, { method: 'DELETE' });
  await raw(`/rest/v1/merchant_details?merchant_system_id=eq.${v2MerchantId}`, { method: 'DELETE' });
  await raw(`/rest/v1/merchant_details?merchant_system_id=eq.${legacyMerchantId}`, { method: 'DELETE' });
  for (const id of [...categoryIds, ...legacyCategoryIds]) {
    await raw(`/rest/v1/categories?id=eq.${id}`, { method: 'DELETE' });
  }
}

console.log(JSON.stringify({
  status: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL',
  controls: results.length,
  results,
}, null, 2));
