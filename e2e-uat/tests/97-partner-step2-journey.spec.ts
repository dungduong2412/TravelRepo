import { test, expect, Page } from '@playwright/test';
import { anonKey, api, hasCreds } from '../lib/api';
import { config, creds, EVIDENCE_DIR, RUN_ID } from '../lib/env';
import { record } from '../lib/evidence';
import { getUserAsAdmin, issueSignupToken } from '../lib/admin-auth';
import { randomBytes } from 'node:crypto';

// PARTNER STEP 2/2 JOURNEY, rehearsed end to end on a brand-new synthetic identity (non-routable domain; the Auth admin API issues the confirmation token, so NO
// e-mail is sent and the Auth e-mail quota is untouched). It reproduces what the owner hit with Partner3:
//   confirm e-mail -> blank profile form -> (no submit) -> Admin list has nothing   =>  the page must make "Bước 2/2 - Gửi hồ sơ" unmistakable,
//   refuse a blank submit visibly, expose the exact HTTP result of the real submit, show the record under Admin > Pending without a stale list,
//   explain an approval 409, and finally approve -> login -> QR.
// It never touches Partner3 or any real/V1 record. The one existing record it reads is the E2E leftover that returned the 409 (guarded: skipped if it is no longer unclaimed).
// Run through `railway run --service vno-api` (service key for Auth admin + REST reads); before a deploy also with E2E_TARGET=candidate.
const step = async (id: string, title: string, fn: () => Promise<string | void>) => {
  try { const detail = await fn(); record(id, title, 'PASS', detail || ''); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; }
};
const items = (b: any): any[] => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
async function rest(path: string) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY!; process.env.E2E_ADMIN_SERVICE_TOKEN = k;
  const r = await fetch(`${config().supabase}/rest/v1/${path}`, { headers: { apikey: k, Authorization: `Bearer ${k}` } });
  if (!r.ok) throw new Error(`REST ${path.split('?')[0]} HTTP ${r.status}`); return r.json() as Promise<any[]>;
}
async function passwordToken(email: string, password: string) {
  const r = await fetch(`${config().supabase}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: await anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const b: any = await r.json(); if (!r.ok) throw new Error(`password grant HTTP ${r.status}`); process.env.E2E_TOKEN_STEP2 = b.access_token; return b.access_token as string;
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${EVIDENCE_DIR}/screens/${name}.png` });
const ORPHAN_ID = 'a71ce95a-f99c-4195-b5a5-df90ab47171f';   // E2E leftover from 2026-10-31: pending, no linked owner profile (the record behind the 409 at 2026-11-07T17:02:38Z)

test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY || !hasCreds('admin'), 'BLOCKED: run via `railway run --service vno-api` with admin credentials');

const email = `uat.e2e.step2.partner.${RUN_ID}@vno-uat-synthetic.example`;
const password = `Uat${randomBytes(4).toString('hex')}7`;
const bizName = `UAT-E2E-STEP2-${RUN_ID}`;
const adminLogin = async (p: Page) => {
  const a = creds('admin')!; await p.goto('/login');
  await p.getByPlaceholder('email@example.com').fill(a.email); await p.locator('input[type="password"]').fill(a.password); await p.locator('button[type="submit"]').click();
  await expect(p).toHaveURL(/\/admin/, { timeout: 30_000 });
};
const pendingCountOf = async (p: Page) => Number((await p.getByTestId('pending-count').innerText()).match(/^\d+/)![0]);
const rows = (p: Page, text: string) => p.locator('tbody tr', { hasText: text });
const evidence: Record<string, unknown> = { run: RUN_ID, email };

test.describe.serial('Partner step 2/2 journey (synthetic)', () => {
  let userId = ''; let collabId = ''; let collabCode = '';
  let ownerCtx: import('@playwright/test').BrowserContext; let owner: Page;
  let adminCtx: import('@playwright/test').BrowserContext; let adminPage: Page;
  const writes: string[] = [];
  const listRequests: Array<Record<string, string>> = [];
  let pendingBefore = 0;

  test('J0 an approval the API refuses (409 OWNER_NOT_CLAIMED) is explained INSIDE the drawer and changes nothing', async ({ browser }) => {
    await step('J0', 'Admin > existing unclaimed pending E2E record > Approve > HTTP 409 shown in the drawer with its code; record + audit trail unchanged', async () => {
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
      const body = await resp.json();
      const err = p.getByTestId('action-error');
      await expect(err).toBeVisible();                                          // inside the open drawer, not behind its overlay
      await expect(err).toContainText('HTTP 409 · OWNER_NOT_CLAIMED'); await expect(err).toContainText('unchanged'); await expect(err).toContainText('Chờ phê duyệt');
      await shot(p, 'J0-approve-409-explained');
      const [after] = await rest(`collaborators?select=collaborators_status,collaborators_verified,collaborators_qr_code&id=eq.${ORPHAN_ID}`);
      expect(after).toEqual({ collaborators_status: 'pending', collaborators_verified: false, collaborators_qr_code: null });
      expect((await rest(`audit_events?select=action&entity_id=eq.${ORPHAN_ID}`)).length).toBe(auditBefore);
      await ctx.close();
      return `POST approve HTTP ${resp.status()} code=${body.code}; record still pending/unverified, no QR, audit events ${auditBefore} -> ${auditBefore}`;
    });
  });

  test('J1 after e-mail confirmation the page says "Bước 2/2 — Hoàn tất và gửi hồ sơ" and that nothing is submitted yet', async ({ browser }) => {
    await step('J1', 'confirmed + profile-less -> Step 2/2 banner, "CHƯA được gửi", reminder next to the button; no write request; server: confirmed user, 0 profiles, 0 records', async () => {
      ownerCtx = await browser.newContext(); owner = await ownerCtx.newPage();
      owner.on('request', (rq) => { if (rq.method() === 'POST' && /\/(collaborators|merchants)$/.test(new URL(rq.url()).pathname)) writes.push(`${rq.method()} ${rq.url()}`); });
      const issued = await issueSignupToken(email, password, { requested_role: 'collaborator' }); userId = issued.userId; evidence.userId = userId;
      await owner.goto(`/auth/confirm?token_hash=${encodeURIComponent(issued.tokenHash)}&type=signup&next=${encodeURIComponent('/collaborator/onboard?confirmed=1')}`);
      await owner.getByRole('button', { name: 'Xác nhận email', exact: true }).click();
      const banner = owner.getByTestId('onboarding-step2');
      await expect(banner).toBeVisible({ timeout: 30_000 });
      await expect(banner).toContainText('Bước 2/2 — Hoàn tất và gửi hồ sơ Đối tác');
      await expect(banner).toContainText('Bước 1/2'); await expect(banner).toContainText('CHƯA được gửi');
      await expect(owner.getByText('Email đã xác nhận thành công. Vui lòng hoàn tất hồ sơ Đối tác.')).toBeVisible();
      await expect(owner.getByTestId('step2-reminder')).toContainText('chỉ được gửi khi bạn bấm “Gửi hồ sơ”');
      await shot(owner, 'J1-step2-banner');
      const u = await getUserAsAdmin(userId); expect(u.email_confirmed_at).toBeTruthy();
      expect(await rest(`user_profiles?select=id&user_id=eq.${userId}`)).toHaveLength(0);
      expect(await rest(`collaborators?select=id&collaborators_email=ilike.${encodeURIComponent(email)}`)).toHaveLength(0);
      expect(writes).toEqual([]);
      return `email_confirmed_at=${u.email_confirmed_at}; profiles=0 records=0 writes=0`;
    });
  });

  test('J2 pressing "Gửi hồ sơ" on the blank form is refused VISIBLY (no silent no-op)', async () => {
    await step('J2', 'blank name + phone -> red alert naming the fields, first field focused, no POST /collaborators, nothing created', async () => {
      await owner.getByRole('button', { name: 'Gửi hồ sơ' }).click();
      const err = owner.getByTestId('submit-error');
      await expect(err).toBeVisible({ timeout: 10_000 });
      await expect(err).toContainText('CHƯA được gửi'); await expect(err).toContainText('Họ và Tên'); await expect(err).toContainText('Số Điện Thoại');
      await expect(owner.locator('#fullName')).toBeFocused();
      await owner.waitForTimeout(1500);
      expect(writes).toEqual([]);
      expect(await rest(`collaborators?select=id&collaborators_email=ilike.${encodeURIComponent(email)}`)).toHaveLength(0);
      await shot(owner, 'J2-blank-submit-refused');
      return 'refused client-side with a visible alert; 0 write requests; 0 records';
    });
  });

  test('J3 real submit: exact HTTP response, exactly one pending record + one linked pending profile, Admin list refreshes to show it under Pending', async ({ browser }) => {
    await step('J3', 'Admin list open BEFORE the submit lacks the record; submit -> HTTP 2xx + code; success page shows the code; Admin Refresh -> row under Pending (cache: no-store)', async () => {
      adminCtx = await browser.newContext(); adminPage = await adminCtx.newPage();
      adminPage.on('request', (rq) => { if (rq.method() === 'GET' && new URL(rq.url()).pathname === '/collaborators') void rq.allHeaders().then((h) => listRequests.push(h), () => undefined); }); // allHeaders(): includes the headers the browser itself adds (cache: 'no-store' -> Cache-Control: no-cache)
      await adminLogin(adminPage); await adminPage.goto('/admin/collaborators');
      await expect(adminPage.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
      pendingBefore = await pendingCountOf(adminPage);
      await adminPage.getByPlaceholder('Name, code, email or phone').fill(bizName);
      await expect(adminPage.getByText('No partners match the current filters.')).toBeVisible();

      await owner.locator('input[name="fullName"]').fill(bizName); await owner.locator('input[name="phone"]').fill('0900000097');
      const t0 = new Date().toISOString();
      const [resp] = await Promise.all([
        owner.waitForResponse((r) => new URL(r.url()).pathname === '/collaborators' && r.request().method() === 'POST', { timeout: 30_000 }),
        owner.getByRole('button', { name: 'Gửi hồ sơ' }).click(),
      ]);
      const status = resp.status(); const body = await resp.json();
      expect([200, 201], `POST /collaborators HTTP ${status} ${JSON.stringify(body).slice(0, 160)}`).toContain(status);
      collabId = body.id; collabCode = body.collaborators_code;
      expect(body.collaborators_status).toBe('pending'); expect(body.collaborators_verified).toBe(false);
      await expect(owner).toHaveURL(/\/success\?type=collaborator&ref=/, { timeout: 30_000 });
      await expect(owner.getByRole('heading', { name: 'Hồ sơ đang chờ phê duyệt' })).toBeVisible();
      await expect(owner.getByTestId('application-ref')).toContainText(collabCode);
      await expect(owner.getByTestId('application-ref')).toContainText('Chờ phê duyệt');
      await shot(owner, 'J3-submitted');

      const recs = await rest(`collaborators?select=*&collaborators_email=ilike.${encodeURIComponent(email)}`);
      expect(recs, 'exactly one collaborators row').toHaveLength(1);
      expect(recs[0]).toMatchObject({ id: collabId, collaborators_status: 'pending', collaborators_verified: false });
      const profs = await rest(`user_profiles?select=*&user_id=eq.${userId}`);
      expect(profs, 'exactly one user_profiles row').toHaveLength(1);
      expect(profs[0]).toMatchObject({ role: 'collaborator', user_profiles_status: 'pending', collaborator_id: collabId });
      const audit = await rest(`audit_events?select=occurred_at,action&entity_id=eq.${collabId}&order=occurred_at.asc`);
      expect(audit.map((a) => a.action)).toContain('collaborator.application_submitted');

      // the Admin tab was loaded before the submit: it must not silently pretend to be current, and one Refresh must be enough
      const before = listRequests.length;
      await adminPage.getByTestId('refresh-list').click();
      await expect.poll(() => listRequests.length, { timeout: 15_000 }).toBeGreaterThan(before);
      expect(listRequests[listRequests.length - 1]['cache-control'], 'list is requested with cache: no-store').toBe('no-cache');
      await adminPage.getByTestId('pending-chip').click();
      await expect(rows(adminPage, bizName)).toHaveCount(1, { timeout: 15_000 });
      await expect(rows(adminPage, bizName).locator('[data-status="pending"]')).toHaveText('Chờ phê duyệt');
      expect(await pendingCountOf(adminPage)).toBe(pendingBefore + 1);
      await shot(adminPage, 'J3-admin-pending-list');
      evidence.submit = { t0, httpStatus: status, id: collabId, code: collabCode, registered: recs[0].collaborators_registered_date, profileId: profs[0].id, audit };
      return `POST /collaborators HTTP ${status} id=${collabId} code=${collabCode}; 1 row pending/unverified; 1 profile pending linked; audit ${audit.map((a) => a.action + '@' + a.occurred_at).join(', ')}; Admin pending ${pendingBefore} -> ${pendingBefore + 1}`;
    });
  });

  test('J4 Admin approves in the UI: approval response, audit event, active record + profile, QR generated', async () => {
    await step('J4', 'Approve in the drawer -> HTTP 2xx; green notice names status + QR; record active/verified with QR; profile active; audit collaborator.approved; Pending count back', async () => {
      adminPage.on('dialog', (d) => d.accept());
      await rows(adminPage, bizName).getByRole('button', { name: 'View details' }).click();
      const [resp] = await Promise.all([
        adminPage.waitForResponse((r) => r.url().endsWith(`/collaborators/${collabId}/approve`) && r.request().method() === 'POST', { timeout: 30_000 }),
        adminPage.getByRole('button', { name: 'Approve' }).click(),
      ]);
      const status = resp.status(); expect([200, 201], `approve HTTP ${status}`).toContain(status);
      const notice = adminPage.getByTestId('admin-notice');
      await expect(notice).toBeVisible({ timeout: 15_000 });
      await expect(notice).toContainText('Approved'); await expect(notice).toContainText('Đã duyệt'); await expect(notice).toContainText('QR code was generated');
      await shot(adminPage, 'J4-approved');
      const [rec] = await rest(`collaborators?select=collaborators_status,collaborators_verified,collaborators_qr_code&id=eq.${collabId}`);
      expect(rec.collaborators_status).toBe('active'); expect(rec.collaborators_verified).toBe(true); expect(rec.collaborators_qr_code).toBeTruthy();
      const [prof] = await rest(`user_profiles?select=user_profiles_status,collaborator_id&user_id=eq.${userId}`);
      expect(prof).toMatchObject({ user_profiles_status: 'active', collaborator_id: collabId });
      const audit = await rest(`audit_events?select=occurred_at,action&entity_id=eq.${collabId}&order=occurred_at.asc`);
      const approved = audit.find((a) => a.action === 'collaborator.approved'); expect(approved, 'collaborator.approved audit event').toBeTruthy();
      expect(await pendingCountOf(adminPage)).toBe(pendingBefore);
      evidence.approve = { httpStatus: status, audit };
      return `POST approve HTTP ${status}; record active+verified+QR; profile active; audit collaborator.approved@${approved.occurred_at}; Admin pending back to ${pendingBefore}`;
    });
  });

  test('J5 the approved Partner logs in and gets the QR', async ({ browser }) => {
    await step('J5', 'normal login -> /collaborator/dashboard (POST /auth/login 2xx, login_count>=1); GET /collaborators/me/qr-code 200 with the /c/<code> payload and an image', async () => {
      const ctx = await browser.newContext(); const p = await ctx.newPage();
      await p.goto('/login');
      await p.getByPlaceholder('email@example.com').fill(email); await p.locator('input[type="password"]').fill(password);
      const [login] = await Promise.all([
        p.waitForResponse((r) => new URL(r.url()).pathname === '/auth/login' && r.request().method() === 'POST', { timeout: 30_000 }),
        p.locator('button[type="submit"]').click(),
      ]);
      expect([200, 201]).toContain(login.status());
      await expect(p).toHaveURL(/collaborator\/dashboard/, { timeout: 30_000 });
      await shot(p, 'J5-partner-dashboard');
      const token = await passwordToken(email, password);
      const r = await fetch(`${config().api}/collaborators/me/qr-code`, { headers: { Authorization: `Bearer ${token}` } });
      const qr: any = await r.json();
      expect(r.status).toBe(200); expect(qr.collaborator_code ?? qr.code).toBe(collabCode);
      expect(String(qr.qr_payload)).toMatch(new RegExp(`/c/${collabCode}$`)); expect(String(qr.qr_code)).toMatch(/^data:image\/png;base64,/);
      const [prof] = await rest(`user_profiles?select=login_count,last_login_at&user_id=eq.${userId}`);
      expect(prof.login_count).toBeGreaterThanOrEqual(1);
      evidence.login = { httpStatus: login.status(), qrHttpStatus: r.status, qrPayload: qr.qr_payload, last_login_at: prof.last_login_at };
      await ctx.close(); await ownerCtx.close(); await adminCtx.close();
      require('node:fs').writeFileSync(`${EVIDENCE_DIR}/partner-step2-${RUN_ID}.json`, JSON.stringify(evidence, null, 2));
      return `POST /auth/login HTTP ${login.status()}; dashboard reached; GET qr-code HTTP ${r.status} payload=${qr.qr_payload}; last_login_at=${prof.last_login_at}`;
    });
  });
});
