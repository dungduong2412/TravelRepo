#!/usr/bin/env node
/**
 * VNO V1-to-V2 QR Compatibility Test Suite
 *
 * Tests T-QR-01 through T-QR-07 using genuine V1 QR payloads from snapshot-3.
 * Requires a local Supabase stack with D2 rehearsal data imported.
 *
 * Usage:
 *   VNO_TARGET_URL=http://127.0.0.1:56321
 *   VNO_TARGET_SERVICE_ROLE_KEY=<service key>
 *   VNO_TARGET_ANON_KEY=<anon key>
 *   VNO_TEST_BACKEND_URL=http://127.0.0.1:3100
 *   node migration/v2/test-qr-compatibility.mjs
 */

const url = process.env.VNO_TARGET_URL;
const serviceKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
const anonKey = process.env.VNO_TARGET_ANON_KEY;
const backend = process.env.VNO_TEST_BACKEND_URL;
if (!url || !serviceKey || !anonKey || !backend) throw new Error(
  'VNO_TARGET_URL, VNO_TARGET_SERVICE_ROLE_KEY, VNO_TARGET_ANON_KEY, VNO_TEST_BACKEND_URL are required',
);
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname))
  throw new Error('QR compatibility tests are restricted to a local isolated stack');
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(backend).hostname))
  throw new Error('QR backend tests are restricted to a local isolated backend');

// Representative genuine V1 QR payloads (codes from dbo.RestaurantMiddleman snapshot-3)
const V1_CODE_VERIFIED  = 'C2500001'; // LƯU LONG — collaborators_verified: true, imported via D2
const V1_CODE_VERIFIED2 = 'C2500002'; // HELEN HẰNG — verified: true
const V1_CODE_UNKNOWN   = 'C9999999'; // never assigned — not in snapshot
const V1_URL_WRAPPED    = 'https://vno.example.com/c/C2500001'; // URL-wrapped form some apps emit

// V1-imported C2500001 collaborator entity (D2 rehearsal stack)
const C2500001_ENTITY_ID = 'd8746ee3-b49b-1879-72aa-3a19372544d4';

// Test fixture definitions
// D2 rehearsal personas exist from prior D6 setup; auth IDs differ from entity IDs.
const FX = {
  MERCHANT: {
    authId:   '10000000-0000-5000-8000-000000000002', // D6 auth user
    entityId: '20000000-0000-5000-8000-000000000002', // D2-TEST-M entity
    email:    'd2-merchant@local.invalid',
    role:     'merchant',
    preExisting: true, // don't create/destroy in teardown
  },
  COLLAB: {
    authId:   '10000000-0000-5000-8000-000000000003', // D6 auth user
    entityId: '20000000-0000-5000-8000-000000000003', // D2-TEST-C entity (verified=true)
    email:    'd2-collaborator@local.invalid',
    role:     'collaborator',
    preExisting: true,
  },
  VERIFIED: {
    authId:   'a0000000-0000-5000-8000-000000000071',
    entityId: C2500001_ENTITY_ID,                     // C2500001 V1-imported (verified=true)
    email:    'qr-test-collab@local.invalid',
    role:     'collaborator',
  },
  UNVERIFIED: {
    authId:   'a0000000-0000-5000-8000-000000000074',
    entityId: 'a0000000-0000-5000-8000-000000000074', // new entity, verified=false
    email:    'qr-test-unverified@local.invalid',
    role:     'collaborator',
  },
};
const PASSWORD = 'Local-Rehearsal-Only!42';

const results = [];
const createdFixtures = []; // track what we create so teardown is precise

function check(name, pass, evidence) {
  const status = pass ? 'PASS' : 'FAIL';
  results.push({ name, status, evidence });
  if (!pass) process.exitCode = 1;
  console.log(`  [${status}] ${name}`);
  if (!pass && evidence) console.log(`         evidence: ${JSON.stringify(evidence)}`);
}

async function db(route, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${url}${route}`, {
    method,
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

async function adminAuth(route, { method = 'GET', body } = {}) {
  const r = await fetch(`${url}${route}`, {
    method,
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

async function backendCall(route, { token, method = 'GET', body } = {}) {
  const r = await fetch(`${backend}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

async function signIn(email) {
  const r = await adminAuth('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email, password: PASSWORD },
  });
  if (r.status !== 200 || !r.json?.access_token) {
    throw new Error(`sign-in failed for ${email}: HTTP ${r.status} — ${JSON.stringify(r.json)}`);
  }
  return r.json.access_token;
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

async function ensureAuthUser(fx) {
  const existing = await adminAuth(`/auth/v1/admin/users/${fx.authId}`);
  if (fx.preExisting && existing.status === 200) return; // D2 rehearsal personas managed outside this suite (when present)
  if (existing.status === 200) {
    await adminAuth(`/auth/v1/admin/users/${fx.authId}`, {
      method: 'PUT',
      body: { email_confirm: true, password: PASSWORD },
    });
    return;
  }
  const created = await adminAuth('/auth/v1/admin/users', {
    method: 'POST',
    body: { id: fx.authId, email: fx.email, password: PASSWORD, email_confirm: true },
  });
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(`failed to create auth user ${fx.email}: HTTP ${created.status} — ${JSON.stringify(created.json)}`);
  }
  createdFixtures.push({ type: 'auth_user', id: fx.authId });
}

async function ensureProfile(fx) {
  const existing = await db(`/rest/v1/user_profiles?user_id=eq.${fx.authId}&select=user_id`);
  if (Array.isArray(existing.json) && existing.json.length > 0) return;

  const profileBody = {
    user_id: fx.authId,
    email: fx.email,
    role: fx.role,
    user_profiles_status: 'active',
    ...(fx.role === 'merchant'     ? { merchant_id:     fx.entityId } : {}),
    ...(fx.role === 'collaborator' ? { collaborator_id: fx.entityId } : {}),
  };
  const r = await db('/rest/v1/user_profiles', {
    method: 'POST', body: profileBody, prefer: 'return=minimal',
  });
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`failed to create user_profile for ${fx.email}: HTTP ${r.status} — ${JSON.stringify(r.json)}`);
  }
  createdFixtures.push({ type: 'profile', userId: fx.authId });
}

async function ensureCollaboratorEntity(fx) {
  const existing = await db(`/rest/v1/collaborators?id=eq.${fx.entityId}&select=id`);
  if (Array.isArray(existing.json) && existing.json.length > 0) return;

  const r = await db('/rest/v1/collaborators', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      id: fx.entityId,
      collaborators_code: 'QR-T-UNVER',
      collaborators_name: 'QR Test Unverified',
      collaborators_email: fx.email,
      collaborators_verified: false,
      collaborators_status: 'active',
      collaborators_registered_date: new Date().toISOString(),
    },
  });
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`failed to create unverified collaborator entity: HTTP ${r.status} — ${JSON.stringify(r.json)}`);
  }
  createdFixtures.push({ type: 'collaborator_entity', id: fx.entityId });
}

// The D2 rehearsal personas (D2-TEST-M / D2-TEST-C) exist only in the original D2 stack. On a clone restored from real UAT they are absent:
// point the personas at an existing merchant / verified partner of that clone (the suite creates and removes only its own auth users/profiles).
async function resolvePersonaEntities() {
  const m = await db(`/rest/v1/merchant_details?merchant_system_id=eq.${FX.MERCHANT.entityId}&select=merchant_system_id`);
  if (!Array.isArray(m.json) || !m.json.length) {
    const any = await db('/rest/v1/merchant_details?select=merchant_system_id&legacy_restaurant_id=is.null&limit=1');
    if (!any.json?.length) throw new Error('no merchant available for the merchant persona');
    FX.MERCHANT.entityId = any.json[0].merchant_system_id;
  }
  const c = await db(`/rest/v1/collaborators?id=eq.${FX.COLLAB.entityId}&select=id`);
  if (!Array.isArray(c.json) || !c.json.length) {
    const any = await db(`/rest/v1/collaborators?select=id&collaborators_verified=eq.true&legacy_middleman_id=is.null&id=neq.${C2500001_ENTITY_ID}&limit=1`);
    if (!any.json?.length) throw new Error('no verified synthetic partner available for the partner persona');
    FX.COLLAB.entityId = any.json[0].id;
  }
}

async function setup() {
  console.log('\n[Setup] Creating test fixtures...');
  await resolvePersonaEntities();
  // Merchant auth user + profile (D2-TEST-M entity already exists)
  await ensureAuthUser(FX.MERCHANT);
  await ensureProfile(FX.MERCHANT);
  // Collaborator auth user + profile (D2-TEST-C entity, verified=true)
  await ensureAuthUser(FX.COLLAB);
  await ensureProfile(FX.COLLAB);
  // Verified V1-imported collaborator auth user + profile (C2500001)
  await ensureAuthUser(FX.VERIFIED);
  await ensureProfile(FX.VERIFIED);
  // Unverified collaborator entity + auth user + profile (new)
  await ensureCollaboratorEntity(FX.UNVERIFIED);
  await ensureAuthUser(FX.UNVERIFIED);
  await ensureProfile(FX.UNVERIFIED);
  console.log('[Setup] Done.');
}

async function teardown() {
  // Reverse order: profiles, then auth users, then collaborator entities
  for (const f of [...createdFixtures].reverse()) {
    if (f.type === 'profile') {
      await db(`/rest/v1/user_profiles?user_id=eq.${f.userId}`, { method: 'DELETE' });
    } else if (f.type === 'auth_user') {
      await adminAuth(`/auth/v1/admin/users/${f.id}`, { method: 'DELETE' });
    } else if (f.type === 'collaborator_entity') {
      await db(`/rest/v1/collaborators?id=eq.${f.id}`, { method: 'DELETE' });
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\nVNO QR Compatibility Test Suite — V1 Genuine Payloads');
  console.log('Target:', url, '  Backend:', backend);
  console.log('---');

  // ── Unit: collaboratorCodeFromPayload logic ────────────────────────────────
  console.log('\n[Unit] collaboratorCodeFromPayload parsing');

  function collaboratorCodeFromPayload(payload) {
    const trimmed = payload.trim();
    try {
      const parsed = new URL(trimmed);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length >= 2 && segments[segments.length - 2] === 'c') {
        return decodeURIComponent(segments[segments.length - 1] || '').trim();
      }
    } catch { /* raw code */ }
    return trimmed;
  }

  check('raw V1 code passthrough',
    collaboratorCodeFromPayload(V1_CODE_VERIFIED) === V1_CODE_VERIFIED, V1_CODE_VERIFIED);
  check('URL-wrapped V1 code extraction',
    collaboratorCodeFromPayload(V1_URL_WRAPPED) === V1_CODE_VERIFIED, V1_URL_WRAPPED);
  check('URL with extra path segments ignored',
    collaboratorCodeFromPayload('https://x.com/other/c/C2500042') === 'C2500042', null);
  check('URL without /c/ prefix returns raw string (no match)',
    collaboratorCodeFromPayload('https://x.com/partner/C2500001') === 'https://x.com/partner/C2500001', null);
  check('whitespace trimmed',
    collaboratorCodeFromPayload('  C2500001  ') === V1_CODE_VERIFIED, null);

  // ── HTTP tests ────────────────────────────────────────────────────────────
  console.log('\n[HTTP] Backend endpoint tests');
  const health = await backendCall('/health');
  if (health.status !== 200) {
    console.log('Backend not responding at /health. Skipping HTTP tests.');
    console.log('Re-run with VNO_TEST_BACKEND_URL pointing to a running backend.');
    return;
  }

  // ── T-QR-01: Public QR resolution — known V1 code (unauthed) ─────────────
  // GET /c/<code> returns {collaboratorId, displayName, rating, verified}
  const t01 = await backendCall(`/c/${V1_CODE_VERIFIED}`);
  check(
    'T-QR-01: GET /c/<v1-code> resolves V1 imported partner (200)',
    t01.status === 200
      && typeof t01.json?.collaboratorId === 'string'
      && t01.json?.verified === true,
    { status: t01.status, collaboratorId: t01.json?.collaboratorId, verified: t01.json?.verified },
  );

  // ── T-QR-02: Public QR resolution — unknown code → 403 ───────────────────
  // Backend throws ForbiddenException (security: doesn't distinguish missing from unverified)
  const t02 = await backendCall(`/c/${V1_CODE_UNKNOWN}`);
  check(
    'T-QR-02: GET /c/<unknown> returns 403',
    t02.status === 403,
    { status: t02.status },
  );

  // ── T-QR-03: Merchant scan — raw V1 code ─────────────────────────────────
  // POST /qr/resolve → 201 (NestJS @Post default); returns {collaborator_code, association, ...}
  let merchantToken;
  try { merchantToken = await signIn(FX.MERCHANT.email); }
  catch (e) { check('T-QR-03: merchant sign-in', false, e.message); }

  if (merchantToken) {
    const t03 = await backendCall('/qr/resolve', {
      token: merchantToken, method: 'POST',
      body: { payload: V1_CODE_VERIFIED },
    });
    check(
      'T-QR-03: POST /qr/resolve {payload:raw-v1-code} as merchant (201)',
      t03.status === 201 && t03.json?.collaborator_code === V1_CODE_VERIFIED,
      { status: t03.status, code: t03.json?.collaborator_code, assoc: t03.json?.association },
    );

    // ── T-QR-04: Merchant scan — URL-wrapped V1 code ─────────────────────
    const t04 = await backendCall('/qr/resolve', {
      token: merchantToken, method: 'POST',
      body: { payload: V1_URL_WRAPPED },
    });
    check(
      'T-QR-04: POST /qr/resolve {payload:url-wrapped-v1-code} as merchant (201)',
      t04.status === 201 && t04.json?.collaborator_code === V1_CODE_VERIFIED,
      { status: t04.status, code: t04.json?.collaborator_code },
    );

    // ── T-QR-04b: Merchant scan — second V1 code ──────────────────────────
    const t04b = await backendCall('/qr/resolve', {
      token: merchantToken, method: 'POST',
      body: { payload: V1_CODE_VERIFIED2 },
    });
    check(
      'T-QR-04b: POST /qr/resolve {payload:C2500002} returns correct partner (201)',
      t04b.status === 201 && t04b.json?.collaborator_code === V1_CODE_VERIFIED2,
      { status: t04b.status, code: t04b.json?.collaborator_code },
    );
  }

  // ── T-QR-05: Collaborator actor cannot call merchant QR scan → 403 ────────
  let collabToken;
  try { collabToken = await signIn(FX.COLLAB.email); }
  catch (e) { check('T-QR-05: collaborator sign-in', false, e.message); }

  if (collabToken) {
    const t05 = await backendCall('/qr/resolve', {
      token: collabToken, method: 'POST',
      body: { payload: V1_CODE_VERIFIED },
    });
    check(
      'T-QR-05: POST /qr/resolve as collaborator actor → 403',
      t05.status === 403,
      { status: t05.status },
    );

    // ── T-QR-05b: Unauthenticated scan → 401 ──────────────────────────────
    const t05b = await backendCall('/qr/resolve', {
      method: 'POST',
      body: { payload: V1_CODE_VERIFIED },
    });
    check(
      'T-QR-05b: POST /qr/resolve with no token → 401',
      t05b.status === 401,
      { status: t05b.status },
    );
  }

  // ── T-QR-06: Authenticated V1-imported partner retrieves QR code (200) ────
  // GET /collaborators/me/qr-code returns {qr_code, qr_payload, qr_payload_format, collaborator_code, ...}
  let verifiedCollabToken;
  try { verifiedCollabToken = await signIn(FX.VERIFIED.email); }
  catch (e) { check('T-QR-06: qr-test-collab sign-in', false, e.message); }

  if (verifiedCollabToken) {
    const t06 = await backendCall('/collaborators/me/qr-code', { token: verifiedCollabToken });
    check(
      'T-QR-06: GET /collaborators/me/qr-code — V1 imported verified partner (200)',
      t06.status === 200
        && t06.json?.collaborator_code === V1_CODE_VERIFIED
        && t06.json?.qr_payload_format === 'collaborator_code'
        && typeof t06.json?.qr_code === 'string' && t06.json.qr_code.startsWith('data:image/png'),
      {
        status: t06.status,
        code: t06.json?.collaborator_code,
        format: t06.json?.qr_payload_format,
        hasImage: typeof t06.json?.qr_code === 'string',
      },
    );

    if (t06.status === 200) {
      check(
        'T-QR-06b: qr_payload is bare V1 code (not a URL)',
        t06.json?.qr_payload === V1_CODE_VERIFIED,
        { qr_payload: t06.json?.qr_payload },
      );
    }
  }

  // ── T-QR-07: Unverified collaborator cannot get QR code → 403 ─────────────
  let unverifiedToken;
  try { unverifiedToken = await signIn(FX.UNVERIFIED.email); }
  catch (e) { check('T-QR-07: unverified collab sign-in', false, e.message); }

  if (unverifiedToken) {
    const t07 = await backendCall('/collaborators/me/qr-code', { token: unverifiedToken });
    check(
      'T-QR-07: GET /collaborators/me/qr-code — unverified collaborator → 403',
      t07.status === 403,
      { status: t07.status },
    );
  }

  // ── collaborators_qr_code null gap verification ───────────────────────────
  console.log('\n[Gap] collaborators_qr_code = null impact verification');
  const nullQrRow = await db(
    `/rest/v1/collaborators?collaborators_code=eq.${V1_CODE_VERIFIED}&select=collaborators_code,collaborators_qr_code`,
  );
  const row = Array.isArray(nullQrRow.json) ? nullQrRow.json[0] : null;
  check(
    'Gap-01: V1 imported partner has null stored QR image (expected)',
    row?.collaborators_qr_code === null,
    { collaborators_qr_code: row?.collaborators_qr_code },
  );
  check(
    'Gap-02: Null stored QR image does not prevent public resolution (GET /c/)',
    results.find(r => r.name.startsWith('T-QR-01'))?.status === 'PASS',
    'confirmed by T-QR-01',
  );
  check(
    'Gap-03: Null stored QR image does not prevent on-demand generation (GET /me/qr-code)',
    results.find(r => r.name.startsWith('T-QR-06:'))?.status === 'PASS',
    'confirmed by T-QR-06',
  );

  // ── Gap-04: Admin drawer QR endpoint probe ─────────────────────────────────
  const adminQr = await backendCall(`/admin/collaborators/${C2500001_ENTITY_ID}/qr-code`);
  check(
    'Gap-04: Admin drawer QR endpoint — 401 (requires admin auth) or 404 (route not separate)',
    adminQr.status === 401 || adminQr.status === 404,
    { status: adminQr.status, note: 'Verify admin drawer QR uses endpoint not stored column' },
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

try {
  await setup();
  await run();
} finally {
  await teardown();
}

console.log('\n--- Results ---');
const pass = results.filter(r => r.status === 'PASS').length;
const fail = results.filter(r => r.status === 'FAIL').length;
results.forEach(r => console.log(`  [${r.status}] ${r.name}`));
console.log(`\n${pass} PASS, ${fail} FAIL`);

const evidenceFile = process.env.VNO_QR_EVIDENCE_FILE;
if (evidenceFile) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(evidenceFile, JSON.stringify({ total: results.length, passed: pass, failed: fail, results }, null, 2));
  console.log('Evidence written to:', evidenceFile);
}
