#!/usr/bin/env node

import { randomUUID } from 'node:crypto';

const backend = process.env.VNO_TEST_BACKEND_URL;
if (!backend || !['127.0.0.1', 'localhost', '::1'].includes(new URL(backend).hostname)) {
  throw new Error('D13 integrated API test is restricted to an isolated local backend');
}
const password = 'Local-Rehearsal-Only!42';
const results = [];
const check = (name, pass, evidence) => { results.push({ name, status: pass ? 'PASS' : 'FAIL', evidence }); if (!pass) process.exitCode = 1; };

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${backend}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}
async function login(email, userType) {
  const result = await call('/auth/login', { method: 'POST', body: { email, password, userType } });
  if (!result.json?.access_token) throw new Error(`${userType} login failed: HTTP ${result.status}`);
  return result.json.access_token;
}

const [admin, merchant, collaborator] = await Promise.all([
  login('d2-admin@local.invalid', 'admin'), login('d2-merchant@local.invalid', 'merchant'), login('d2-collaborator@local.invalid', 'collaborator'),
]);
const key = randomUUID();
const payload = { collaborator_code: 'D2-TEST-C', gross_amount: '1234.5678', idempotency_key: key };

const qr = await call('/qr/resolve', { token: merchant, method: 'POST', body: { payload: 'D2-TEST-C' } });
check('Merchant resolves assigned Collaborator QR', qr.status === 201 && qr.json?.association === 'assigned_to_this_merchant', `HTTP ${qr.status}; ${qr.json?.association}`);

const created = await call('/transactions/simulation', { token: merchant, method: 'POST', body: payload });
check('Merchant creates isolated simulation', created.status === 201 && created.json?.record_kind === 'uat_simulation' && created.json?.simulation_status === 'OPEN', `HTTP ${created.status}`);
check('database calculates exact gross-based amounts', created.json?.gross_amount === 1234.5678 || created.json?.gross_amount === '1234.5678', JSON.stringify({ discount: created.json?.discount_amount, commission: created.json?.commission_amount }));
check('discount and commission reconcile at four decimals', String(created.json?.discount_amount) === '123.4568' && String(created.json?.commission_amount) === '61.7284', `${created.json?.discount_amount} / ${created.json?.commission_amount}`);
check('external settlement is disabled', created.json?.external_settlement_enabled === false && created.json?.payment_status === 'unverified', `settlement ${created.json?.external_settlement_enabled}`);

const replay = await call('/transactions/simulation', { token: merchant, method: 'POST', body: payload });
check('identical retry returns one transaction', replay.status === 201 && replay.json?.transaction_id === created.json?.transaction_id && replay.json?.idempotent_replay === true, `HTTP ${replay.status}`);
const conflict = await call('/transactions/simulation', { token: merchant, method: 'POST', body: { ...payload, gross_amount: '999.0000' } });
check('changed payload cannot reuse idempotency key', conflict.status === 409, `HTTP ${conflict.status}`);

for (const [role, token] of [['admin', admin], ['collaborator', collaborator]]) {
  const denied = await call('/transactions/simulation', { token, method: 'POST', body: { ...payload, idempotency_key: randomUUID() } });
  check(`${role} cannot create Merchant simulation`, denied.status === 403, `HTTP ${denied.status}`);
}

for (const [role, token] of [['admin', admin], ['merchant', merchant], ['collaborator', collaborator]]) {
  const report = await call(`${role === 'admin' ? '/transactions/report' : '/transactions/me/report'}?record_kind=uat_simulation&page=1&page_size=10`, { token });
  check(`${role} sees authorized simulation report`, report.status === 200 && report.json?.summary?.transaction_count === 1 && report.json?.items?.[0]?.id === created.json?.transaction_id, `HTTP ${report.status}; rows ${report.json?.summary?.transaction_count}`);
}

for (const route of ['/transactions/confirm', '/transactions/cancel', '/transactions/pay', '/transactions/settle']) {
  const absent = await call(route, { token: merchant, method: 'POST', body: { transaction_id: created.json?.transaction_id } });
  check(`${route} remains unavailable`, absent.status === 404, `HTTP ${absent.status}`);
}

console.log(JSON.stringify({ status: results.every((item) => item.status === 'PASS') ? 'PASS' : 'FAIL', transaction_id: created.json?.transaction_id, idempotency_key: key, controls: results.length, results }, null, 2));
