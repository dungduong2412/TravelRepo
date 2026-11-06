#!/usr/bin/env node
// D14 Real Transaction Lifecycle — API integration test.
//
// Tests the complete business journey through the deployed API (not the DB).
// Requires the D14 migration to be applied and the API to be running.
//
// Usage (against hosted UAT API):
//   node test-d14-real-transactions.mjs
//   env: VNO_TEST_BACKEND_URL (default: https://vno-api-uat.up.railway.app)
//        VNO_D14_MERCHANT_EMAIL, VNO_D14_MERCHANT_PASSWORD
//        VNO_D14_ADMIN_EMAIL, VNO_D14_ADMIN_PASSWORD
//        VNO_D14_PARTNER_CODE (a synthetic partner already assigned to that merchant)
//
// Usage (against local backend):
//   VNO_TEST_BACKEND_URL=http://localhost:3001 node test-d14-real-transactions.mjs
//
// Synthetic data only — no real customer data is written.
// The test cleans up real_transaction rows it creates using cancel/reverse.

import { randomUUID } from 'node:crypto';

const BACKEND = (process.env.VNO_TEST_BACKEND_URL || 'https://vno-api-uat.up.railway.app').replace(/\/$/, '');
const MERCHANT_EMAIL = process.env.VNO_D14_MERCHANT_EMAIL;
const MERCHANT_PASS  = process.env.VNO_D14_MERCHANT_PASSWORD;
const ADMIN_EMAIL    = process.env.VNO_D14_ADMIN_EMAIL;
const ADMIN_PASS     = process.env.VNO_D14_ADMIN_PASSWORD;
const PARTNER_CODE   = process.env.VNO_D14_PARTNER_CODE;

if (!MERCHANT_EMAIL || !MERCHANT_PASS || !ADMIN_EMAIL || !ADMIN_PASS || !PARTNER_CODE) {
  console.error('Required env vars: VNO_D14_MERCHANT_EMAIL, VNO_D14_MERCHANT_PASSWORD, VNO_D14_ADMIN_EMAIL, VNO_D14_ADMIN_PASSWORD, VNO_D14_PARTNER_CODE');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const results = [];
const check = (id, name, pass, evidence) => {
  results.push({ id, name, status: pass ? 'PASS' : 'FAIL', evidence });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} [${id}] ${name}`);
  if (!pass) { console.error(`         evidence: ${JSON.stringify(evidence).slice(0, 300)}`); process.exitCode = 1; }
};

async function call(path, { token, method = 'GET', body, expectStatus } = {}) {
  const r = await fetch(`${BACKEND}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (expectStatus && r.status !== expectStatus) {
    throw new Error(`${method} ${path}: expected HTTP ${expectStatus}, got ${r.status} — ${text.slice(0, 200)}`);
  }
  return { status: r.status, json };
}

async function login(email, password, userType) {
  const { status, json } = await call('/auth/login', { method: 'POST', body: { email, password, userType } });
  if (!json?.access_token) throw new Error(`${userType} login failed (${status}): ${JSON.stringify(json).slice(0, 200)}`);
  return json.access_token;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

console.log(`\nD14 Real Transaction Integration Test`);
console.log(`Backend: ${BACKEND}`);
console.log(`Partner: ${PARTNER_CODE}\n`);

const [merchantToken, adminToken] = await Promise.all([
  login(MERCHANT_EMAIL, MERCHANT_PASS, 'merchant'),
  login(ADMIN_EMAIL, ADMIN_PASS, 'admin'),
]);
console.log('  Tokens acquired for merchant and admin.\n');

// ── T01: Resolve Partner QR ──────────────────────────────────────────────────
console.log('── T01 Resolve Partner QR ──');
const resolveRes = await call('/qr/resolve', {
  token: merchantToken, method: 'POST',
  body: { payload: PARTNER_CODE },
  expectStatus: 201,
});
check('T01-a', 'QR resolves for merchant', resolveRes.json?.association === 'assigned_to_this_merchant', resolveRes.json);
check('T01-b', 'collaborator_code present', typeof resolveRes.json?.collaborator_code === 'string', resolveRes.json);
const partnerCode = resolveRes.json?.collaborator_code || PARTNER_CODE;

// ── T02: Create real transaction ─────────────────────────────────────────────
console.log('\n── T02 Create real transaction ──');
const createKey = randomUUID();
const grossAmount = '1500000'; // 1,500,000 VND
const createRes = await call('/transactions/real', {
  token: merchantToken, method: 'POST',
  body: { collaborator_code: partnerCode, gross_amount: grossAmount, idempotency_key: createKey },
  expectStatus: 201,
});
const tx = createRes.json;
check('T02-a', 'transaction_id present', typeof tx?.transaction_id === 'string', tx);
check('T02-b', 'lifecycle_status=recorded', tx?.lifecycle_status === 'recorded', tx);
check('T02-c', 'document_number starts with VNO', typeof tx?.document_number === 'string' && tx.document_number.startsWith('VNO'), tx);
check('T02-d', 'gross_amount correct', Number(tx?.gross_amount) === Number(grossAmount), tx);
check('T02-e', 'discount_amount = gross × discount_rate (4dp)', (() => {
  const gross = BigInt(Math.round(Number(tx?.gross_amount) * 10000));
  const rate  = BigInt(Math.round(Number(tx?.discount_rate) * 10000));
  const expected = (gross * rate) / 10000n;
  const actual   = BigInt(Math.round(Number(tx?.discount_amount) * 10000));
  return actual === expected;
})(), tx);
check('T02-f', 'commission_amount = gross × commission_rate (4dp)', (() => {
  const gross = BigInt(Math.round(Number(tx?.gross_amount) * 10000));
  const rate  = BigInt(Math.round(Number(tx?.commission_rate) * 10000));
  const expected = (gross * rate) / 10000n;
  const actual   = BigInt(Math.round(Number(tx?.commission_amount) * 10000));
  return actual === expected;
})(), tx);
check('T02-g', 'idempotent_replay=false on first create', tx?.idempotent_replay === false, tx);

const txId = tx?.transaction_id;

// ── T03: Idempotent replay ───────────────────────────────────────────────────
console.log('\n── T03 Idempotent replay ──');
const replayRes = await call('/transactions/real', {
  token: merchantToken, method: 'POST',
  body: { collaborator_code: partnerCode, gross_amount: grossAmount, idempotency_key: createKey },
  expectStatus: 201,
});
check('T03-a', 'idempotent_replay=true on second create with same key', replayRes.json?.idempotent_replay === true, replayRes.json);
check('T03-b', 'same transaction_id returned', replayRes.json?.transaction_id === txId, replayRes.json);

// ── T04: Duplicate key with different amount rejected ───────────────────────
console.log('\n── T04 Duplicate key with different amount rejected ──');
const dupRes = await call('/transactions/real', {
  token: merchantToken, method: 'POST',
  body: { collaborator_code: partnerCode, gross_amount: '9999', idempotency_key: createKey },
});
check('T04-a', 'different amount with same key returns 409 or 400', [400, 409].includes(dupRes.status), dupRes);

// ── T05: Unauthorized actions rejected ───────────────────────────────────────
console.log('\n── T05 Unauthorized actions ──');
const noAuthRes = await call(`/transactions/${txId}/confirm`, { method: 'POST', body: { idempotency_key: randomUUID() } });
check('T05-a', 'confirm without token → 401', noAuthRes.status === 401, noAuthRes);

const wrongMerchantRes = await call(`/transactions/${txId}/reverse`, {
  token: merchantToken, method: 'POST', body: { idempotency_key: randomUUID() },
});
check('T05-b', 'merchant cannot reverse (admin-only) → 403', wrongMerchantRes.status === 403, wrongMerchantRes);

const adminConfirmRes = await call(`/transactions/${txId}/confirm`, {
  token: adminToken, method: 'POST', body: { idempotency_key: randomUUID() },
});
check('T05-c', 'admin cannot confirm (merchant-only) → 403', adminConfirmRes.status === 403, adminConfirmRes);

// ── T06: Cancel from RECORDED ────────────────────────────────────────────────
// Use a fresh transaction so we can also test confirm/reverse separately.
console.log('\n── T06 Cancel from RECORDED ──');
const cancelKey = randomUUID();
const cancelTxRes = await call('/transactions/real', {
  token: merchantToken, method: 'POST',
  body: { collaborator_code: partnerCode, gross_amount: '500000', idempotency_key: cancelKey },
  expectStatus: 201,
});
const cancelTxId = cancelTxRes.json?.transaction_id;

const cancelRes = await call(`/transactions/${cancelTxId}/cancel`, {
  token: merchantToken, method: 'POST', body: { idempotency_key: randomUUID() },
  expectStatus: 201,
});
check('T06-a', 'cancel from RECORDED → lifecycle_status=cancelled', cancelRes.json?.lifecycle_status === 'cancelled', cancelRes.json);
check('T06-b', 'cancel idempotent_replay=false on first cancel', cancelRes.json?.idempotent_replay === false, cancelRes.json);

// Idempotent cancel replay
const cancelReplay = await call(`/transactions/${cancelTxId}/cancel`, {
  token: merchantToken, method: 'POST', body: { idempotency_key: randomUUID() },
  expectStatus: 201,
});
check('T06-c', 'cancel idempotent_replay=true on second cancel', cancelReplay.json?.idempotent_replay === true, cancelReplay.json);

// Cannot confirm a cancelled transaction
const confirmCancelledRes = await call(`/transactions/${cancelTxId}/confirm`, {
  token: merchantToken, method: 'POST', body: { idempotency_key: randomUUID() },
});
check('T06-d', 'confirm on CANCELLED → 400 or 422', [400, 422].includes(confirmCancelledRes.status), confirmCancelledRes);

// ── T07: Confirm from RECORDED ───────────────────────────────────────────────
console.log('\n── T07 Confirm from RECORDED ──');
const confirmRes = await call(`/transactions/${txId}/confirm`, {
  token: merchantToken, method: 'POST', body: { idempotency_key: randomUUID() },
  expectStatus: 201,
});
check('T07-a', 'confirm from RECORDED → lifecycle_status=confirmed', confirmRes.json?.lifecycle_status === 'confirmed', confirmRes.json);
check('T07-b', 'confirm idempotent_replay=false', confirmRes.json?.idempotent_replay === false, confirmRes.json);

// Cannot cancel a confirmed transaction
const cancelConfirmedRes = await call(`/transactions/${txId}/cancel`, {
  token: merchantToken, method: 'POST', body: { idempotency_key: randomUUID() },
});
check('T07-c', 'cancel on CONFIRMED → 400 or 422', [400, 422].includes(cancelConfirmedRes.status), cancelConfirmedRes);

// ── T08: Reverse from CONFIRMED (admin) ──────────────────────────────────────
console.log('\n── T08 Reverse from CONFIRMED (admin) ──');
const reverseRes = await call(`/transactions/${txId}/reverse`, {
  token: adminToken, method: 'POST', body: { idempotency_key: randomUUID() },
  expectStatus: 201,
});
check('T08-a', 'reverse from CONFIRMED → lifecycle_status=reversed', reverseRes.json?.lifecycle_status === 'reversed', reverseRes.json);
check('T08-b', 'reverse idempotent_replay=false', reverseRes.json?.idempotent_replay === false, reverseRes.json);

// Cannot reverse twice (idempotent replay)
const reverseReplay = await call(`/transactions/${txId}/reverse`, {
  token: adminToken, method: 'POST', body: { idempotency_key: randomUUID() },
  expectStatus: 201,
});
check('T08-c', 'reverse idempotent_replay=true on second call', reverseReplay.json?.idempotent_replay === true, reverseReplay.json);

// ── T09: Commission filtering ─────────────────────────────────────────────────
// (Real transactions only earn commission when CONFIRMED; reversed and cancelled do not.)
// We verify this via the commissions list endpoint.
console.log('\n── T09 Commission list filtering ──');
const commRes = await call('/commissions', { token: adminToken, expectStatus: 200 });
// The confirmed txId was reversed so should NOT be in commissions anymore.
// The cancelTxId was cancelled so should NOT be.
// UAT simulations should NOT be in results for real_transaction filtering.
const rows = Array.isArray(commRes.json?.items || commRes.json) ? (commRes.json?.items || commRes.json) : [];
const hasReversed = rows.some((r) => r.transaction_id === txId && r.lifecycle_status === 'reversed');
const hasCancelled = rows.some((r) => r.transaction_id === cancelTxId);
check('T09-a', 'reversed transaction not in commission earned', !hasReversed, { txId, count: rows.length });
check('T09-b', 'cancelled transaction not in commission earned', !hasCancelled, { cancelTxId, count: rows.length });

// ── T10: V1 data unchanged ────────────────────────────────────────────────────
// GET /transactions returns ALL record types (no filter support). We verify
// that v1_import rows are present and have lifecycle_status=null (pre-D14 rows
// were created before the lifecycle_status column had real_transaction values).
console.log('\n── T10 V1 data integrity ──');
const v1Res = await call('/transactions', { token: adminToken });
check('T10-a', 'v1_import records still accessible', v1Res.status === 200, v1Res.json);
check('T10-b', 'at least one v1_import row present and lifecycle_status is null', (() => {
  const items = Array.isArray(v1Res.json?.items || v1Res.json) ? (v1Res.json?.items || v1Res.json) : [];
  const v1Rows = items.filter((r) => r.record_kind === 'v1_import');
  return v1Rows.length > 0 && v1Rows.every((r) => r.lifecycle_status === null || r.lifecycle_status === undefined);
})(), { total: Array.isArray(v1Res.json?.items || v1Res.json) ? (v1Res.json?.items || v1Res.json).length : 0 });

// ── T11: Customer QR landing page resolves ────────────────────────────────────
console.log('\n── T11 Customer QR landing (GET /c/:code) ──');
const landingRes = await call(`/c/${encodeURIComponent(PARTNER_CODE)}`);
check('T11-a', 'GET /c/:code returns 200', landingRes.status === 200, landingRes.json);
check('T11-b', 'partner_name present in response', typeof landingRes.json?.partner_name === 'string', landingRes.json);
check('T11-c', 'merchant_id present in response', typeof landingRes.json?.merchant_id === 'string', landingRes.json);

// ── T12: Legacy raw QR code still resolves via /qr/resolve ───────────────────
console.log('\n── T12 Legacy raw QR code backwards compatibility ──');
const legacyRes = await call('/qr/resolve', {
  token: merchantToken, method: 'POST',
  body: { payload: PARTNER_CODE }, // raw code, not URL
  expectStatus: 201,
});
check('T12-a', 'legacy raw code resolves via /qr/resolve', legacyRes.json?.collaborator_code === partnerCode, legacyRes.json);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n── Test Summary ──');
const passed = results.filter((r) => r.status === 'PASS').length;
const failed = results.filter((r) => r.status === 'FAIL').length;
results.forEach((r) => { if (r.status === 'FAIL') console.error(`  FAIL [${r.id}] ${r.name}`); });
console.log(`\n  ${passed} PASS / ${failed} FAIL out of ${results.length} checks`);
if (failed > 0) {
  console.error(`\n  ${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log('\n  All D14 integration tests PASSED.');
}
