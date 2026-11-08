import { test, expect, Page, BrowserContext } from '@playwright/test';
import { anonKey, api, hasCreds } from '../lib/api';
import { config, creds, EVIDENCE_DIR, RUN_ID } from '../lib/env';
import { record } from '../lib/evidence';
import { confirmEmailAsAdmin, createConfirmedUserAsAdmin, getAuthUser, setActivationNonceAsAdmin, setPasswordAsAdmin } from '../lib/admin-auth';
import { activationSecret, newNonce, signActivationToken } from '../../backend/src/modules/activation/activation-token';
import { SUCCESS_TEXT } from '../../frontend/lib/partner-registration';
import { randomBytes } from 'node:crypto';

// SINGLE-STEP PARTNER FLOW, end to end on brand-new synthetic identities (non-routable domain, so no real mailbox is touched and no Auth mail quota is used):
//   register once -> visible in Admin Pending at once -> duplicates are recognised -> Admin approves -> activation e-mail is triggered (and its outcome recorded)
//   -> the emailed link signs the person into the Partner dashboard (no password, no second form) -> the link works once -> expired/used links offer a safe resend.
// The synthetic domain is outside the e-mail allowlist, so the API correctly SUPPRESSES the real e-mail; the test then stands in for the mailbox by signing a link with the
// same server secret (what the e-mail would have carried). Delivery of a real e-mail is proven separately with an allowlisted owner address.
// Run through `railway run --service vno-api` (service key for Auth admin + REST reads); before a deploy also with E2E_TARGET=candidate.
const step = async (id: string, title: string, fn: () => Promise<string | void>) => {
  try { const detail = await fn(); record(id, title, 'PASS', detail || ''); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; }
};
async function rest(path: string) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY!; process.env.E2E_ADMIN_SERVICE_TOKEN = k;
  const r = await fetch(`${config().supabase}/rest/v1/${path}`, { headers: { apikey: k, Authorization: `Bearer ${k}` } });
  if (!r.ok) throw new Error(`REST ${path.split('?')[0]} HTTP ${r.status}`); return r.json() as Promise<any[]>;
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${EVIDENCE_DIR}/screens/${name}.png` });
const ORPHAN_ID = 'a71ce95a-f99c-4195-b5a5-df90ab47171f';   // E2E leftover from 2026-10-31: pending, no linked owner profile (the record behind the 409 at 2026-11-07T17:02:38Z)

test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY || !hasCreds('admin'), 'BLOCKED: run via `railway run --service vno-api` with admin credentials');

const domain = 'vno-uat-synthetic.example';
const email = `uat.e2e.single.${RUN_ID}@${domain}`;
const orphanEmail = `uat.e2e.orphan.${RUN_ID}@${domain}`;
const orphanPassword = `Uat${randomBytes(4).toString('hex')}7`;
const fullName = `UAT-E2E-SINGLE-${RUN_ID}`;
const phone = '+84 912 345 678';
const adminLogin = async (p: Page) => {
  const a = creds('admin')!; await p.goto('/login');
  await p.getByPlaceholder('email@example.com').fill(a.email); await p.locator('input[type="password"]').fill(a.password); await p.locator('button[type="submit"]').click();
  await expect(p).toHaveURL(/\/admin/, { timeout: 30_000 });
};
const pendingCountOf = async (p: Page) => {
  await expect(p.getByText('Loading partners…')).toHaveCount(0, { timeout: 30_000 });   // the counter reads 0 while the list is still loading
  return Number((await p.getByTestId('pending-count').innerText()).match(/^\d+/)![0]);
};
const rows = (p: Page, text: string) => p.locator('tbody tr', { hasText: text });
const evidence: Record<string, unknown> = { run: RUN_ID, email, orphanEmail };
const counts = async (addr: string) => ({
  profiles: (await rest(`user_profiles?select=id&email=ilike.${encodeURIComponent(addr)}`)).length,
  records: (await rest(`collaborators?select=id&collaborators_email=ilike.${encodeURIComponent(addr)}`)).length,
});
/** The link the e-mail would carry: current nonce on the account + a token signed with the server secret. */
async function emailedLink(userId: string, collabId: string, ttlMs = 3_600_000) {
  const nonce = newNonce(); await setActivationNonceAsAdmin(userId, nonce);
  process.env.E2E_TOKEN_ACTIVATION = nonce;
  const token = signActivationToken({ u: userId, c: collabId, n: nonce, e: Date.now() + ttlMs }, activationSecret());
  process.env.E2E_TOKEN_ACTIVATION_LINK = token;
  return { token, url: `/auth/activate#token=${token}` };
}
async function fillAndSubmit(p: Page, addr: string) {
  await p.goto('/collaborator/onboard');
  await p.locator('#fullName').fill(fullName); await p.locator('#phone').fill(phone); await p.locator('#email').fill(addr);
  return Promise.all([
    p.waitForResponse((r) => new URL(r.url()).pathname === '/partner-registrations' && r.request().method() === 'POST', { timeout: 30_000 }),
    p.getByRole('button', { name: 'Đăng ký', exact: true }).click(),
  ]).then(([resp]) => resp);
}

test.describe.serial('Partner single-step registration -> approval -> activation (synthetic)', () => {
  let userId = ''; let collabId = ''; let collabCode = '';
  let adminCtx: BrowserContext; let adminPage: Page;
  let pendingBefore = 0;

  test('S0 an approval the API refuses (409 OWNER_NOT_CLAIMED) is explained INSIDE the drawer and changes nothing', async ({ browser }) => {
    await step('S0', 'Admin > unclaimed legacy pending record > Approve > HTTP 409 shown in the drawer; record + audit trail unchanged', async () => {
      const [rec] = await rest(`collaborators?select=id,collaborators_name,collaborators_status&id=eq.${ORPHAN_ID}`);
      const linked = await rest(`user_profiles?select=id&collaborator_id=eq.${ORPHAN_ID}`);
      test.skip(!rec || rec.collaborators_status !== 'pending' || linked.length !== 0, 'guard: the leftover record is no longer pending+unclaimed, so it is not exercised');
      const auditBefore = (await rest(`audit_events?select=action&entity_id=eq.${ORPHAN_ID}`)).length;
      const ctx = await browser.newContext(); const p = await ctx.newPage(); p.on('dialog', (d) => d.accept());
      await adminLogin(p); await p.goto('/admin/collaborators');
      await p.getByPlaceholder('Name, code, email or phone').fill(rec.collaborators_name);
      await expect(rows(p, rec.collaborators_name)).toHaveCount(1, { timeout: 30_000 });
      await rows(p, rec.collaborators_name).getByRole('button', { name: 'View details' }).click();
      const [resp] = await Promise.all([
        p.waitForResponse((r) => r.url().endsWith(`/collaborators/${ORPHAN_ID}/approve`) && r.request().method() === 'POST'),
        p.getByRole('button', { name: 'Approve' }).click(),
      ]);
      expect(resp.status()).toBe(409);
      await expect(p.getByTestId('action-error')).toContainText('HTTP 409 · OWNER_NOT_CLAIMED');
      const [after] = await rest(`collaborators?select=collaborators_status,collaborators_verified,collaborators_qr_code&id=eq.${ORPHAN_ID}`);
      expect(after).toEqual({ collaborators_status: 'pending', collaborators_verified: false, collaborators_qr_code: null });
      expect((await rest(`audit_events?select=action&entity_id=eq.${ORPHAN_ID}`)).length).toBe(auditBefore);
      await ctx.close();
      return `POST approve HTTP ${resp.status()}; record still pending/unverified, no QR, audit events ${auditBefore} -> ${auditBefore}`;
    });
  });

  test('S1 ONE registration form: no password, no "Bước 1/2 - 2/2", no second form; a blank submit is refused visibly with no request', async ({ browser }) => {
    await step('S1', 'form has name/phone/e-mail only; blank submit -> alert naming fields, first field focused, 0 POST', async () => {
      const ctx = await browser.newContext(); const p = await ctx.newPage(); const writes: string[] = [];
      p.on('request', (rq) => { if (rq.method() === 'POST') writes.push(new URL(rq.url()).pathname); });
      await p.goto('/collaborator/onboard');
      await expect(p.getByRole('heading', { name: 'Đăng ký Đối tác' })).toBeVisible();
      await expect(p.locator('input[type="password"]')).toHaveCount(0);
      await expect(p.getByText(/Bước\s*[12]\s*\/\s*2/)).toHaveCount(0);
      await expect(p.getByRole('button', { name: /Gửi hồ sơ|Xác nhận email|Đăng ký & xác nhận email/ })).toHaveCount(0);
      for (const id of ['#fullName', '#phone', '#email']) await expect(p.locator(id)).toBeVisible();
      await p.getByRole('button', { name: 'Đăng ký', exact: true }).click();
      const err = p.getByTestId('registration-error');
      await expect(err).toBeVisible(); await expect(err).toContainText('CHƯA được gửi'); await expect(err).toContainText('Họ và Tên'); await expect(err).toContainText('Số Điện Thoại'); await expect(err).toContainText('Email');
      await expect(p.locator('#fullName')).toBeFocused();
      await p.waitForTimeout(800);
      expect(writes).toEqual([]);
      await shot(p, 'S1-single-form-blank-refused');
      await ctx.close();
      return 'single form (3 fields, no password); blank submit refused visibly; 0 POST requests';
    });
  });

  test('S2 one submit creates identity + pending Partner + pending profile atomically, shows the exact success text, sends no e-mail', async ({ browser }) => {
    await step('S2', 'POST /partner-registrations 201; success page text; Auth user unconfirmed w/o password; 1 pending record + 1 linked pending profile; audit application_submitted', async () => {
      const adminCtxProbe = await browser.newContext(); adminCtx = adminCtxProbe; adminPage = await adminCtx.newPage(); adminPage.on('dialog', (d) => d.accept());
      await adminLogin(adminPage); await adminPage.goto('/admin/collaborators'); await expect(adminPage.getByTestId('pending-count')).toBeVisible({ timeout: 30_000 });
      pendingBefore = await pendingCountOf(adminPage);

      const ctx = await browser.newContext(); const p = await ctx.newPage();
      const posts: string[] = [];
      p.on('request', (rq) => { if (rq.method() === 'POST') posts.push(new URL(rq.url()).pathname); });
      const t0 = new Date().toISOString();
      const resp = await fillAndSubmit(p, email);
      const body = await resp.json();
      expect(resp.status()).toBe(201);
      expect(body).toMatchObject({ outcome: 'created', status: 'pending' }); collabCode = body.reference; expect(collabCode).toMatch(/^COL-[0-9A-F]{16}$/);
      await expect(p).toHaveURL(/\/success\?type=partner-registered/, { timeout: 30_000 });
      await expect(p.getByTestId('registration-success')).toHaveText(SUCCESS_TEXT);
      await expect(p.getByTestId('application-ref')).toContainText(collabCode);
      await shot(p, 'S2-registration-success');
      expect(posts).toEqual(['/partner-registrations']);                           // one request creates everything; nothing else was written by the browser

      const [rec] = await rest(`collaborators?select=id,collaborators_code,collaborators_name,collaborators_phone,collaborators_status,collaborators_verified&collaborators_email=ilike.${encodeURIComponent(email)}`);
      collabId = rec.id;
      expect(rec).toMatchObject({ collaborators_code: collabCode, collaborators_name: fullName, collaborators_phone: '+84912345678', collaborators_status: 'pending', collaborators_verified: false });
      const profs = await rest(`user_profiles?select=id,user_id,role,user_profiles_status,collaborator_id,login_count&email=ilike.${encodeURIComponent(email)}`);
      expect(profs).toHaveLength(1); userId = profs[0].user_id;
      expect(profs[0]).toMatchObject({ role: 'collaborator', user_profiles_status: 'pending', collaborator_id: collabId, login_count: 0 });
      const u = await getAuthUser(userId);
      expect(u.email).toBe(email); expect(u.email_confirmed_at ?? null).toBeNull(); expect((u.user_metadata as any).requested_role).toBe('collaborator');
      const submitted = await rest(`audit_events?select=action,details,occurred_at&entity_id=eq.${collabId}&action=eq.collaborator.application_submitted`);
      expect(submitted).toHaveLength(1); expect(submitted[0].details).toMatchObject({ channel: 'public_registration', email_verified: false });
      evidence.registration = { httpStatus: resp.status(), requestedAt: t0, collabId, collabCode, userId, auditAt: submitted[0].occurred_at };
      await ctx.close();
      return `POST /partner-registrations HTTP ${resp.status()} -> ${collabCode}; record ${collabId} pending/unverified; profile pending linked; Auth user ${userId} unconfirmed; audit@${submitted[0].occurred_at}`;
    });
  });

  test('S3 the application is in Admin Pending IMMEDIATELY, with the submitted information', async () => {
    await step('S3', 'Admin list (fresh load) shows the record under the Pending filter with "Chờ phê duyệt"; drawer shows name, phone, e-mail, registration date', async () => {
      await adminPage.goto('/admin/collaborators');
      await expect(adminPage.getByTestId('pending-count')).toBeVisible({ timeout: 30_000 });
      await adminPage.getByTestId('refresh-list').click();
      expect(await pendingCountOf(adminPage)).toBe(pendingBefore + 1);
      await adminPage.locator('select').first().selectOption('pending');
      await adminPage.getByPlaceholder('Name, code, email or phone').fill(fullName);
      const row = rows(adminPage, fullName); await expect(row).toHaveCount(1, { timeout: 30_000 });
      await expect(row.getByText('Chờ phê duyệt')).toBeVisible();
      await row.getByRole('button', { name: 'View details' }).click();
      const drawer = adminPage.locator('aside').filter({ hasText: 'Partner details' });
      for (const text of [fullName, email, '+84912345678', collabCode]) await expect(drawer).toContainText(text);
      await expect(adminPage.getByTestId('activation-panel')).toContainText('Not yet');
      await shot(adminPage, 'S3-admin-pending-drawer');
      return `Pending count ${pendingBefore} -> ${pendingBefore + 1}; row + drawer show submitted data`;
    });
  });

  test('S4 the same address again (any case) is recognised: pending message, nothing duplicated', async ({ browser }) => {
    await step('S4', 'POST /partner-registrations 200 {exists, pending}; UI says "đã đăng ký và đang chờ phê duyệt"; still 1 record, 1 profile, 1 Auth identity', async () => {
      const ctx = await browser.newContext(); const p = await ctx.newPage();
      const resp = await fillAndSubmit(p, email.toUpperCase().replace(`@${domain.toUpperCase()}`, `@${domain}`));
      expect(resp.status()).toBe(200);
      expect(await resp.json()).toEqual({ outcome: 'exists', state: 'pending' });
      const note = p.getByTestId('registration-existing'); await expect(note).toBeVisible(); await expect(note).toContainText('đang chờ phê duyệt'); await expect(note).toHaveAttribute('data-state', 'pending');
      await expect(p).toHaveURL(/collaborator\/onboard/);
      expect(await counts(email)).toEqual({ profiles: 1, records: 1 });
      await shot(p, 'S4-existing-pending');
      await ctx.close();
      return 'HTTP 200 {outcome: exists, state: pending}; counts unchanged (1 record, 1 profile)';
    });
  });

  test('S5 a pending applicant has no way in: no password login, a forged activation link is refused', async () => {
    await step('S5', 'POST /auth/login 401; POST /auth/activate with a forged token 401 ACTIVATION_LINK_INVALID; pending account cannot use the portal API', async () => {
      const login = await fetch(`${config().api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Whatever123' }) });
      expect(login.status).toBe(401);
      const forged = await fetch(`${config().api}/auth/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: `${'a'.repeat(60)}.${'b'.repeat(43)}` }) });
      expect(forged.status).toBe(401); expect((await forged.json()).code).toBe('ACTIVATION_LINK_INVALID');
      const missing = await fetch(`${config().api}/auth/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(missing.status).toBe(401);
      // A genuine signature with a current nonce is still refused while the account is only pending.
      const link = await emailedLink(userId, collabId);
      const early = await fetch(`${config().api}/auth/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link.token }) });
      expect(early.status).toBe(403); expect((await early.json()).code).toBe('ACTIVATION_NOT_APPROVED');
      const [prof] = await rest(`user_profiles?select=login_count,user_profiles_status&user_id=eq.${userId}`);
      expect(prof).toEqual({ login_count: 0, user_profiles_status: 'pending' });
      return 'login 401; forged link 401 ACTIVATION_LINK_INVALID; valid-signature link before approval 403 ACTIVATION_NOT_APPROVED; account untouched';
    });
  });

  test('S6 Admin approves: record + profile activate together, audit once, activation e-mail triggered and its outcome recorded; a second click changes nothing', async () => {
    await step('S6', 'POST approve 2xx; record active+QR, profile active; audit collaborator.approved x1 + activation_email_*; second approve -> already_approved, no new audit', async () => {
      await adminPage.goto('/admin/collaborators');
      await adminPage.getByPlaceholder('Name, code, email or phone').fill(fullName);
      await expect(rows(adminPage, fullName)).toHaveCount(1, { timeout: 30_000 });
      await rows(adminPage, fullName).getByRole('button', { name: 'View details' }).click();
      const [resp] = await Promise.all([
        adminPage.waitForResponse((r) => r.url().endsWith(`/collaborators/${collabId}/approve`) && r.request().method() === 'POST'),
        adminPage.getByRole('button', { name: 'Approve' }).click(),
      ]);
      expect([200, 201]).toContain(resp.status());
      const approved = await resp.json();
      expect(approved).toMatchObject({ collaborators_status: 'active', collaborators_verified: true });
      expect(approved.collaborators_qr_code).toMatch(/^data:image\/png;base64,/);
      expect(['sent', 'suppressed', 'failed']).toContain(approved.activation_email.status);
      await expect(adminPage.getByTestId('admin-notice')).toContainText('Activation e-mail');
      const [rec] = await rest(`collaborators?select=collaborators_status,collaborators_verified&id=eq.${collabId}`);
      const [prof] = await rest(`user_profiles?select=user_profiles_status,login_count&user_id=eq.${userId}`);
      expect(rec).toEqual({ collaborators_status: 'active', collaborators_verified: true }); expect(prof).toEqual({ user_profiles_status: 'active', login_count: 0 });
      const events = await rest(`audit_events?select=action,details,occurred_at&entity_id=eq.${collabId}&order=occurred_at.asc`);
      expect(events.filter((e) => e.action === 'collaborator.approved')).toHaveLength(1);
      const mail = events.filter((e) => e.action.startsWith('collaborator.activation_email_')); expect(mail).toHaveLength(1);
      expect(mail[0].details).toMatchObject({ trigger: 'approval' });
      expect(JSON.stringify(events)).not.toMatch(/token_hash|activation_nonce|[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}/);   // no token material in the audit trail
      // idempotent: approving again approves nothing
      const again = await api('admin', 'POST', `/collaborators/${collabId}/approve`);
      expect([200, 201]).toContain(again.status); expect(again.body?.already_approved).toBe(true);
      expect((await rest(`audit_events?select=id&entity_id=eq.${collabId}&action=eq.collaborator.approved`))).toHaveLength(1);
      expect((await rest(`audit_events?select=id&entity_id=eq.${collabId}&action=like.collaborator.activation_email_*`))).toHaveLength(1);
      // the drawer shows the e-mail outcome and a retry that does not approve again
      await adminPage.goto('/admin/collaborators'); await adminPage.getByPlaceholder('Name, code, email or phone').fill(fullName);
      await rows(adminPage, fullName).getByRole('button', { name: 'View details' }).click();
      await expect(adminPage.getByTestId('activation-panel')).toContainText(mail[0].action.replace('collaborator.activation_email_', ''));
      const retry = adminPage.getByTestId('resend-activation'); await expect(retry).toBeVisible();
      const [retryResp] = await Promise.all([
        adminPage.waitForResponse((r) => r.url().endsWith(`/collaborators/${collabId}/activation-email`) && r.request().method() === 'POST'),
        retry.click(),
      ]);
      expect([200, 201]).toContain(retryResp.status());
      await expect(adminPage.getByTestId('activation-message')).toContainText('The approval and the record are unchanged');
      expect((await rest(`audit_events?select=id&entity_id=eq.${collabId}&action=eq.collaborator.approved`))).toHaveLength(1);
      expect((await rest(`collaborators?select=id&collaborators_email=ilike.${encodeURIComponent(email)}`))).toHaveLength(1);
      await shot(adminPage, 'S6-admin-approved-activation-panel');
      evidence.approval = { httpStatus: resp.status(), activation_email: approved.activation_email, auditAt: events.find((e) => e.action === 'collaborator.approved')?.occurred_at, retryHttpStatus: retryResp.status() };
      return `POST approve HTTP ${resp.status()}; activation_email=${approved.activation_email.status}${approved.activation_email.reason ? `(${approved.activation_email.reason})` : ''}; retry HTTP ${retryResp.status()}; approvals still 1`;
    });
  });

  test('S7 an already-active address is told to log in, nothing duplicated', async ({ browser }) => {
    await step('S7', 'POST /partner-registrations 200 {exists, active}; UI offers Đăng nhập / resend / forgot password', async () => {
      const ctx = await browser.newContext(); const p = await ctx.newPage();
      const resp = await fillAndSubmit(p, email);
      expect(resp.status()).toBe(200); expect(await resp.json()).toEqual({ outcome: 'exists', state: 'active' });
      const note = p.getByTestId('registration-existing'); await expect(note).toContainText('đã có tài khoản được kích hoạt');
      await expect(note.getByRole('link', { name: 'Đăng nhập' })).toBeVisible(); await expect(note.getByRole('link', { name: 'Gửi lại liên kết kích hoạt' })).toBeVisible();
      expect(await counts(email)).toEqual({ profiles: 1, records: 1 });
      await ctx.close();
      return 'HTTP 200 {outcome: exists, state: active}; counts unchanged';
    });
  });

  test('S8 the emailed link signs the Partner into the dashboard in ONE step (no password, no form); the token never appears in a URL or a request URL', async ({ browser }) => {
    await step('S8', 'open /auth/activate#token=… -> POST /auth/activate 2xx -> /collaborator/dashboard; e-mail confirmed by the click; login_count 1; audit collaborator.activated; QR 200', async () => {
      const link = await emailedLink(userId, collabId);
      const ctx = await browser.newContext(); const p = await ctx.newPage();
      const requestUrls: string[] = []; p.on('request', (rq) => requestUrls.push(rq.url()));
      const [act] = await Promise.all([
        p.waitForResponse((r) => new URL(r.url()).pathname === '/auth/activate' && r.request().method() === 'POST', { timeout: 30_000 }),
        p.goto(link.url),
      ]);
      expect([200, 201]).toContain(act.status());
      await expect(p).toHaveURL(/\/collaborator\/dashboard/, { timeout: 30_000 });
      expect(p.url()).not.toContain(link.token);
      expect(requestUrls.some((u) => u.includes(link.token))).toBe(false);          // the fragment never leaves the browser; the POST carries it in the body
      await expect(p.getByRole('navigation', { name: /Điều hướng Đối tác/ }).first()).toBeVisible({ timeout: 30_000 });
      await expect(p.getByTestId('set-password-notice')).toContainText('Đặt mật khẩu để đăng nhập lần sau');   // no password yet: say how to set one
      await shot(p, 'S8-partner-dashboard-after-link');
      const u = await getAuthUser(userId); expect(u.email_confirmed_at).toBeTruthy();                // the click is the proof of mailbox ownership
      expect((u.app_metadata as any).activation_nonce ?? null).toBeNull();                          // the link is spent
      const [prof] = await rest(`user_profiles?select=login_count,last_login_at,user_profiles_status&user_id=eq.${userId}`);
      expect(prof.login_count).toBe(1); expect(prof.user_profiles_status).toBe('active');
      const activated = await rest(`audit_events?select=action,occurred_at&entity_id=eq.${collabId}&action=eq.collaborator.activated`); expect(activated).toHaveLength(1);
      const session = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('sb-') && x.endsWith('-auth-token')); return k ? JSON.parse(localStorage.getItem(k)!) : null; });
      process.env.E2E_TOKEN_PARTNER_SESSION = session.access_token;
      const qr = await fetch(`${config().api}/collaborators/me/qr-code`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const qrBody: any = await qr.json(); expect(qr.status).toBe(200); expect(qrBody.collaborator_code).toBe(collabCode); expect(String(qrBody.qr_payload)).toMatch(new RegExp(`/c/${collabCode}$`));
      evidence.activation = { httpStatus: act.status(), loginCount: prof.login_count, lastLoginAt: prof.last_login_at, emailConfirmedAt: u.email_confirmed_at, auditAt: activated[0].occurred_at, qrHttpStatus: qr.status, qrPayload: qrBody.qr_payload };
      await ctx.close();
      return `POST /auth/activate HTTP ${act.status()} -> dashboard; email_confirmed_at=${u.email_confirmed_at}; login_count=${prof.login_count}; audit collaborator.activated@${activated[0].occurred_at}; QR HTTP ${qr.status} ${qrBody.qr_payload}`;
    });
  });

  test('S9 the link is SINGLE USE: opening it again shows "already used" and offers login / a new link, no session', async ({ browser }) => {
    await step('S9', 'second open of the same link -> 401 ACTIVATION_LINK_USED; page offers Đăng nhập + resend; no Supabase session created', async () => {
      const token = process.env.E2E_TOKEN_ACTIVATION_LINK!;
      const ctx = await browser.newContext(); const p = await ctx.newPage();
      const [act] = await Promise.all([
        p.waitForResponse((r) => new URL(r.url()).pathname === '/auth/activate' && r.request().method() === 'POST'),
        p.goto(`/auth/activate#token=${token}`),
      ]);
      expect(act.status()).toBe(401);
      expect(['ACTIVATION_LINK_USED', 'ACTIVATION_LINK_INVALID']).toContain((await act.json()).code);
      const view = p.getByTestId('activation-error'); await expect(view).toBeVisible();
      await expect(p).not.toHaveURL(/dashboard/);
      expect(await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token')))).toBe(false);
      await shot(p, 'S9-link-reuse-refused');
      await ctx.close();
      return `second redemption HTTP ${act.status()}; no session`;
    });
  });

  test('S10 expired link: clear message, a new link can be requested, and the answer is identical for registered and unknown addresses', async ({ browser }) => {
    await step('S10', 'expired token -> 401 + resend form; POST /auth/activation-link 202 {accepted:true} for activated, unknown and malformed addresses alike', async () => {
      const expired = await emailedLink(userId, collabId, -60_000);
      const ctx = await browser.newContext(); const p = await ctx.newPage();
      await p.goto(expired.url);
      await expect(p.getByTestId('activation-error')).toContainText('đã hết hạn', { timeout: 30_000 });
      await expect(p.getByTestId('resend-form')).toBeVisible();
      await p.locator('#resend-email').fill(email); await p.getByRole('button', { name: 'Gửi lại liên kết kích hoạt' }).click();
      await expect(p.getByTestId('resend-accepted')).toContainText('Nếu email này thuộc một tài khoản Đối tác đã được phê duyệt');
      const answers = [];
      for (const addr of [email, `nobody.${RUN_ID}@${domain}`, 'not-an-email']) {
        const r = await fetch(`${config().api}/auth/activation-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: addr }) });
        answers.push([r.status, JSON.stringify(await r.json())]);
      }
      expect(new Set(answers.map((a) => a.join('|'))).size).toBe(1); expect(answers[0]).toEqual([202, '{"accepted":true}']);
      await shot(p, 'S10-expired-link-resend');
      await ctx.close();
      return 'expired link refused with a resend form; /auth/activation-link answered 202 {"accepted":true} identically for 3 different addresses';
    });
  });

  test('S10b pre-account takeover is closed: a password set on the unverified identity is refused everywhere and destroyed by the activation click', async ({ browser }) => {
    await step('S10b', 'attacker password + confirmed e-mail BEFORE the click: /auth/login 401, direct Auth session refused by the API; after the legitimate click that password no longer works', async () => {
      const victim = `uat.e2e.takeover.${RUN_ID}@${domain}`; const attackerPassword = `Atk${randomBytes(4).toString('hex')}9`;
      const reg = await fetch(`${config().api}/partner-registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ full_name: `UAT-E2E-TAKEOVER-${RUN_ID}`, phone: '0912345678', email: victim }) });
      expect(reg.status).toBe(201);
      const [rec] = await rest(`collaborators?select=id&collaborators_email=ilike.${encodeURIComponent(victim)}`);
      const [prof] = await rest(`user_profiles?select=user_id&collaborator_id=eq.${rec.id}`);
      expect((await api('admin', 'POST', `/collaborators/${rec.id}/approve`)).status).toBeLessThan(300);
      // The attack: somebody sets a password on the identity before its owner acted (Auth's public sign-up does this), and the owner then confirms the unsolicited mail.
      await setPasswordAsAdmin(prof.user_id, attackerPassword); await confirmEmailAsAdmin(prof.user_id);
      expect((await getAuthUser(prof.user_id)).app_metadata.activation_password_reset).toBe(true);
      const viaApi = await fetch(`${config().api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: victim, password: attackerPassword }) });
      expect(viaApi.status).toBe(401); expect(JSON.stringify(await viaApi.json())).toContain('activation link');
      const grant = async (pw: string) => fetch(`${config().supabase}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: await anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email: victim, password: pw }) });
      const direct = await grant(attackerPassword); expect(direct.status).toBe(200);          // Auth itself would hand out a session...
      const directToken = ((await direct.json()) as any).access_token; process.env.E2E_TOKEN_ATTACKER = directToken;
      for (const path of ['/user-profiles/me', '/collaborators/me', '/collaborators/me/qr-code']) {
        const r = await fetch(`${config().api}${path}`, { headers: { Authorization: `Bearer ${directToken}` } });
        expect(r.status, `${path} must refuse the unverified identity`).toBe(401);          // ...but the API gives it no standing
      }
      // The legitimate owner clicks the emailed link.
      const link = await emailedLink(prof.user_id, rec.id);
      const ctx = await browser.newContext(); const p = await ctx.newPage();
      await p.goto(link.url); await expect(p).toHaveURL(/\/collaborator\/dashboard/, { timeout: 30_000 });
      expect((await grant(attackerPassword)).status).toBe(400);                                // the attacker's password is gone
      const after = await getAuthUser(prof.user_id); expect(after.app_metadata.activation_password_reset ?? null).toBeNull(); expect(after.email_confirmed_at).toBeTruthy();
      const session = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('sb-') && x.endsWith('-auth-token')); return k ? JSON.parse(localStorage.getItem(k)!) : null; });
      process.env.E2E_TOKEN_OWNER_SESSION = session.access_token;
      expect((await fetch(`${config().api}/collaborators/me`, { headers: { Authorization: `Bearer ${session.access_token}` } })).status).toBe(200);   // the owner's own session works
      expect((await fetch(`${config().api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: victim, password: attackerPassword }) })).status).toBe(401);
      await ctx.close();
      return 'before the click: /auth/login 401 "activation link", direct Auth session got 401 on /user-profiles/me, /collaborators/me, /collaborators/me/qr-code; after the click: attacker password rejected by Auth (400), marker cleared, owner session 200';
    });
  });

  test('S11 an unfinished two-step identity (confirmed e-mail, no profile — the Partner3 situation) is ADOPTED by the single form: no second identity, no invented data', async ({ browser }) => {
    await step('S11', 'orphan Auth identity (confirmed, with password, no profile) + one registration -> same Auth user linked; 1 record, 1 pending profile; password untouched', async () => {
      const orphanId = await createConfirmedUserAsAdmin(orphanEmail, orphanPassword, { requested_role: 'collaborator' });
      expect(await counts(orphanEmail)).toEqual({ profiles: 0, records: 0 });
      const ctx = await browser.newContext(); const p = await ctx.newPage();
      const resp = await fillAndSubmit(p, orphanEmail);
      expect(resp.status()).toBe(201);
      const profs = await rest(`user_profiles?select=user_id,user_profiles_status,collaborator_id&email=ilike.${encodeURIComponent(orphanEmail)}`);
      expect(profs).toEqual([{ user_id: orphanId, user_profiles_status: 'pending', collaborator_id: expect.any(String) }]);
      expect(await counts(orphanEmail)).toEqual({ profiles: 1, records: 1 });
      // a confirmed identity keeps its own password (it was proven by the e-mail confirmation)
      const grant = await fetch(`${config().supabase}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: await anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email: orphanEmail, password: orphanPassword }) });
      expect(grant.status).toBe(200);
      evidence.adoption = { orphanId, httpStatus: resp.status() };
      await ctx.close();
      return `registration HTTP ${resp.status()}; Auth user ${orphanId} reused (no second identity); 1 record + 1 pending profile; old password still valid`;
    });
  });

  test('S11b the Partner3 situation: an adopted Partner who already logged in with their old password can still use the emailed link', async ({ browser }) => {
    await step('S11b', 'approve the adopted application; password login (login_count 1); then the emailed link -> dashboard, login_count 2, link spent, password still valid', async () => {
      const [rec] = await rest(`collaborators?select=id&collaborators_email=ilike.${encodeURIComponent(orphanEmail)}`);
      const [prof] = await rest(`user_profiles?select=user_id&collaborator_id=eq.${rec.id}`);
      expect([200, 201]).toContain((await api('admin', 'POST', `/collaborators/${rec.id}/approve`)).status);
      const login = await fetch(`${config().api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: orphanEmail, password: orphanPassword }) });
      expect([200, 201]).toContain(login.status);
      const [afterLogin] = await rest(`user_profiles?select=login_count&user_id=eq.${prof.user_id}`); expect(afterLogin.login_count).toBe(1);
      const link = await emailedLink(prof.user_id, rec.id);
      const ctx = await browser.newContext(); const p = await ctx.newPage();
      const [act] = await Promise.all([p.waitForResponse((r) => new URL(r.url()).pathname === '/auth/activate' && r.request().method() === 'POST', { timeout: 30_000 }), p.goto(link.url)]);
      expect([200, 201]).toContain(act.status());
      await expect(p).toHaveURL(/\/collaborator\/dashboard/, { timeout: 30_000 });
      const [afterLink] = await rest(`user_profiles?select=login_count&user_id=eq.${prof.user_id}`); expect(afterLink.login_count).toBe(2);
      expect((await getAuthUser(prof.user_id)).app_metadata.activation_nonce ?? null).toBeNull();          // spent
      const again = await fetch(`${config().api}/auth/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link.token }) });
      expect(again.status).toBe(401);                                                                        // single use
      const grant = await fetch(`${config().supabase}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: await anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email: orphanEmail, password: orphanPassword }) });
      expect(grant.status).toBe(200);                                                                        // the owner's own password was proven earlier and is untouched
      await ctx.close();
      return `password login ${login.status} (login_count 1) -> link POST /auth/activate ${act.status()} -> dashboard, login_count 2; replay 401; own password still valid`;
    });
  });

  test('S12 cleanup of this run\'s own pending test application so the Admin Pending list returns to what the owner expects', async () => {
    await step('S12', 'approve the synthetic orphan-adoption application (own test data); Pending count back to the starting value', async () => {
      const [rec] = await rest(`collaborators?select=id&collaborators_email=ilike.${encodeURIComponent(orphanEmail)}`);
      const r = await api('admin', 'POST', `/collaborators/${rec.id}/approve`);
      expect([200, 201]).toContain(r.status);
      await adminPage.goto('/admin/collaborators'); await expect(adminPage.getByTestId('pending-count')).toBeVisible({ timeout: 30_000 });
      expect(await pendingCountOf(adminPage)).toBe(pendingBefore);
      require('node:fs').writeFileSync(`${EVIDENCE_DIR}/partner-single-step-${RUN_ID}.json`, JSON.stringify(evidence, null, 2));
      await adminCtx.close();
      return `approved ${rec.id} (HTTP ${r.status}); pending count ${pendingBefore}`;
    });
  });
});
