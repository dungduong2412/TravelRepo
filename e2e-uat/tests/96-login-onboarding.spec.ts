import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { anonKey, api, hasCreds } from '../lib/api';
import { config, creds, RUN_ID, UAT } from '../lib/env';
import { record } from '../lib/evidence';
import { getUserAsAdmin, issueSignupToken } from '../lib/admin-auth';
import { randomBytes } from 'node:crypto';

// SIMPLE SIGNUP acceptance, both roles (new email -> sign up; registered email -> Login/Forgot password; confirmed email without a profile -> normal Login continues
// at the profile form; submitted -> pending; approved -> workspace). Brand-new synthetic identities on a non-routable domain (the UAT hook suppresses mail, nothing is sent;
// confirmation tokens are issued with the Auth admin API, like spec 60). The owner's real accounts and every existing record are never touched.
// Run through `railway run --service vno-api` (service key for Auth admin) and, before a deploy, with E2E_TARGET=candidate.
const step = async (id: string, title: string, fn: () => Promise<void>) => { try { await fn(); record(id, title, 'PASS'); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; } };
const items = (b: any): any[] => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const SBKEY = `sb-${UAT.supabaseRef}-auth-token`;
const CTA = 'Đăng ký & xác nhận email';

async function authUserCount(email: string): Promise<number> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; process.env.E2E_ADMIN_SERVICE_TOKEN = key; let n = 0;
  for (let page = 1; page < 30; page++) {
    const r = await fetch(`${config().supabase}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const users = ((await r.json()) as any).users ?? []; n += users.filter((u: any) => String(u.email).toLowerCase() === email).length;
    if (users.length < 1000) break;
  }
  return n;
}
async function sessionJson(email: string, password: string) {
  const r = await fetch(`${config().supabase}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: await anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`password grant HTTP ${r.status}`); return JSON.stringify(await r.json());
}
async function passwordToken(email: string, password: string) {
  const r = await fetch(`${config().supabase}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: await anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const b: any = await r.json(); if (!r.ok) throw new Error(`password grant HTTP ${r.status}`); process.env.E2E_TOKEN_RESUME = b.access_token; return b.access_token as string;
}

test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY || !hasCreds('admin'), 'BLOCKED: run via `railway run --service vno-api` with admin credentials');

// Partner: registration is a single form without a login-continuation step (98-partner-single-step.spec.ts). This continuation applies to the Merchant.
for (const kind of ['merchant'] as Array<'merchant' | 'partner'>) {
  const other = kind === 'partner' ? 'merchant' : 'partner';
  test.describe.serial(`Simple signup + login continuation: ${kind}`, () => {
    const tag = kind === 'merchant' ? 'M' : 'P';
    const email = `uat.e2e.login.${kind}.${RUN_ID}@vno-uat-synthetic.example`;
    const unconfirmedEmail = `uat.e2e.login.unconf.${kind}.${RUN_ID}@vno-uat-synthetic.example`;
    const password = `Uat${randomBytes(4).toString('hex')}7`;
    const bizName = `UAT-E2E-LOGIN-${tag}-${RUN_ID}`;
    const path = kind === 'merchant' ? '/merchant/onboard' : '/collaborator/onboard';
    const otherPath = kind === 'merchant' ? '/collaborator/onboard' : '/merchant/onboard';
    const landing = kind === 'merchant' ? /merchant\/dashboard/ : /collaborator\/dashboard/;
    const emailInput = (p: Page) => p.locator(kind === 'merchant' ? '#ownerEmail' : 'input[name="email"]');
    const nameInput = (p: Page) => p.locator(kind === 'merchant' ? '#name' : 'input[name="fullName"]');
    let ctxA: BrowserContext; let pageA: Page; let userId = ''; let entityId = '';

    const fillSignup = async (p: Page, mail: string) => {
      if (kind === 'merchant') { await p.locator('#ownerEmail').fill(mail); await p.locator('#name').fill(bizName); await p.locator('#ownerName').fill('UAT Login Owner'); await p.locator('#merchantPhone').fill('0900000021'); await p.locator('#province').fill('Da Nang'); }
      else { await p.locator('input[name="fullName"]').fill(bizName); await p.locator('input[name="phone"]').fill('0900000022'); await p.locator('input[name="email"]').fill(mail); }
      await p.locator('#password, input[name="password"]').first().fill(password);
      await p.locator('#confirmPassword, input[name="confirmPassword"]').first().fill(password);
    };
    const fillProfileOnly = async (p: Page) => {
      if (kind === 'merchant') { await p.locator('#name').fill(bizName); await p.locator('#ownerName').fill('UAT Login Owner'); await p.locator('#merchantPhone').fill('0900000021'); await p.locator('#province').fill('Da Nang'); }
      else { await p.locator('input[name="fullName"]').fill(bizName); await p.locator('input[name="phone"]').fill('0900000022'); }
    };
    const loginAs = async (p: Page, mail: string, pw: string) => {
      await p.goto('/login');
      await p.getByPlaceholder('email@example.com').fill(mail); await p.locator('input[type="password"]').fill(pw); await p.locator('button[type="submit"]').click();
    };
    const records = async () => kind === 'merchant'
      ? items((await api('admin', 'GET', `/merchants/admin-directory?search=${encodeURIComponent(bizName)}&page_size=10`)).body).filter((m) => m.merchant_name === bizName)
      : items((await api('admin', 'GET', '/collaborators')).body).filter((c) => c.collaborators_name === bizName);
    const profiles = async () => items((await api('admin', 'GET', '/user-profiles')).body).filter((x) => String(x.email).toLowerCase() === email);

    test(`LO1 ${kind}: new e-mail -> sign up -> confirm once -> green banner with the verified identity`, async ({ browser }) => {
      await step(`LO1-${tag}`, 'UI signup -> Auth user (unconfirmed) -> confirm click -> ready banner; one Auth user; nothing created', async () => {
        ctxA = await browser.newContext(); pageA = await ctxA.newPage(); await pageA.goto(path);
        await fillSignup(pageA, email);
        await pageA.getByRole('button', { name: CTA, exact: true }).click();
        await expect(pageA.getByText(/Kiểm tra email/)).toBeVisible({ timeout: 30_000 });
        const issued = await issueSignupToken(email, password); userId = issued.userId;
        await pageA.goto(`/auth/confirm?token_hash=${encodeURIComponent(issued.tokenHash)}&type=signup&next=${encodeURIComponent(`${path}?confirmed=1`)}`);
        await pageA.getByRole('button', { name: 'Xác nhận email', exact: true }).click();
        await expect(pageA.getByText(/Email đã xác nhận thành công/)).toBeVisible({ timeout: 30_000 });
        expect(await authUserCount(email)).toBe(1);
        expect((await getUserAsAdmin(userId)).email_confirmed_at).toBeTruthy();
        expect(await records()).toHaveLength(0); expect(await profiles()).toHaveLength(0);
      });
    });

    test(`LO2 ${kind}: registered e-mail -> Login / Forgot password only; no repeat sign-up, no resume panel`, async () => {
      await step(`LO2-${tag}`, 'session lost; sign-up again with the same e-mail -> "đã được đăng ký" + Đăng nhập + Quên mật khẩu links; still 1 Auth user; no "Tiếp tục hồ sơ" anywhere', async () => {
        await pageA.evaluate((k) => localStorage.removeItem(k), SBKEY); await pageA.reload();
        await expect(pageA.locator('input[type="password"]').first()).toBeVisible({ timeout: 20_000 });
        await expect(pageA.getByText(/Email đã xác nhận thành công/)).toHaveCount(0);
        await expect(nameInput(pageA)).toHaveValue(bizName, { timeout: 15_000 });             // non-sensitive draft survived the session loss
        await emailInput(pageA).fill(email);
        await pageA.locator('#password, input[name="password"]').first().fill(password);
        await pageA.locator('#confirmPassword, input[name="confirmPassword"]').first().fill(password);
        await pageA.getByRole('button', { name: CTA, exact: true }).click();
        await expect(pageA.getByText(/đã được đăng ký/).first()).toBeVisible({ timeout: 30_000 });
        await expect(pageA.getByRole('link', { name: 'Đăng nhập', exact: true })).toBeVisible();
        await expect(pageA.getByRole('link', { name: 'Quên mật khẩu', exact: true })).toBeVisible();
        await expect(pageA.getByText(/Tiếp tục hồ sơ/)).toHaveCount(0);
        expect(await authUserCount(email)).toBe(1);
      });
    });

    test(`LO3 ${kind}: normal login of the confirmed, profile-less e-mail continues at the profile form; the stale red message disappears`, async () => {
      await step(`LO3-${tag}`, 'wrong password -> message, no session; correct login in a 2nd tab -> onboarding ready banner; the 1st tab turns green with NO red error; nothing created', async () => {
        const pageB = await ctxA.newPage();
        await loginAs(pageB, email, 'Wrong-pass-123');
        await expect(pageB.getByText('Email hoặc mật khẩu không đúng')).toBeVisible({ timeout: 20_000 });
        expect(await pageB.evaluate((k) => localStorage.getItem(k), SBKEY)).toBeNull();
        await pageB.locator('input[type="password"]').fill(password); await pageB.locator('button[type="submit"]').click();
        await expect(pageB).toHaveURL(new RegExp(`${path}$`), { timeout: 30_000 });
        await expect(pageB.getByText(/Email đã xác nhận thành công/)).toBeVisible({ timeout: 30_000 });
        await expect(emailInput(pageB)).toHaveValue(email); await expect(emailInput(pageB)).toHaveAttribute('readonly', '');
        await expect(pageB.locator('input[type="password"]')).toHaveCount(0);
        await expect(pageB.getByText('Hồ sơ đang chờ phê duyệt')).toHaveCount(0);
        // the owner's contradiction: green "verified" next to a stale red "đã được đăng ký" in the tab that made the earlier attempt
        await expect(pageA.getByText(/Email đã xác nhận thành công/)).toBeVisible({ timeout: 30_000 });
        await expect(pageA.getByText(/đã được đăng ký/)).toHaveCount(0);
        await expect(pageA.getByText(/Kiểm tra email và mở liên kết/)).toHaveCount(0);
        await pageB.close();
        expect(await records()).toHaveLength(0); expect(await profiles()).toHaveLength(0);   // login creates nothing
      });
    });

    test(`LO4 ${kind}: a different device (new browser, no draft) logs in and lands on a blank profile form`, async ({ browser }) => {
      await step(`LO4-${tag}`, 'fresh context: no draft -> /login -> onboarding with the same e-mail; blank profile form; still nothing created', async () => {
        const ctxB = await browser.newContext(); const b = await ctxB.newPage(); await b.goto('/login');
        expect(await b.evaluate(() => Object.keys(localStorage).filter((k) => /draft/i.test(k)).length)).toBe(0);
        await loginAs(b, email, password);
        await expect(b).toHaveURL(new RegExp(`${path}$`), { timeout: 30_000 });
        await expect(b.getByText(/Email đã xác nhận thành công/)).toBeVisible({ timeout: 30_000 });
        await expect(emailInput(b)).toHaveValue(email); await expect(nameInput(b)).toHaveValue('');
        expect(await records()).toHaveLength(0); expect(await authUserCount(email)).toBe(1);
        await ctxB.close();
      });
    });

    test(`LO5 ${kind}: one explicit submit creates exactly one pending record + one linked pending profile; no duplicate is possible`, async () => {
      await step(`LO5-${tag}`, 'Gửi hồ sơ once -> pending page; 1 record pending/unverified, 1 profile pending linked to it; API duplicate refused; counts unchanged', async () => {
        await fillProfileOnly(pageA);
        await pageA.getByRole('button', { name: 'Gửi hồ sơ' }).click();
        await expect(pageA).toHaveURL(/\/success/, { timeout: 30_000 });
        await expect(pageA.getByRole('heading', { name: 'Hồ sơ đang chờ phê duyệt' })).toBeVisible();
        const recs = await records(); expect(recs, 'exactly one business record').toHaveLength(1);
        entityId = kind === 'merchant' ? recs[0].merchant_system_id : recs[0].id;
        expect(kind === 'merchant' ? recs[0].merchants_status : recs[0].collaborators_status).toBe('pending');
        const profs = await profiles(); expect(profs, 'exactly one profile').toHaveLength(1);
        expect(profs[0].user_profiles_status).toBe('pending');
        expect(profs[0].role).toBe(kind === 'merchant' ? 'merchant' : 'collaborator');
        expect(kind === 'merchant' ? profs[0].merchant_id : profs[0].collaborator_id).toBe(entityId);
        const token = await passwordToken(email, password);
        const dupBody = kind === 'merchant' ? { owner_email: email, merchant_name: `${bizName}-2`, merchant_email: email } : { collaborators_name: `${bizName}-2`, collaborators_phone: '0900000022', collaborators_email: email };
        for (const base of [config().api, `https://${UAT.api}`]) {
          const r = await fetch(`${base}${kind === 'merchant' ? '/merchants' : '/collaborators'}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(dupBody) });
          expect(r.status, `duplicate refused on ${base}`).toBe(400); expect(await r.text()).toMatch(/already exists/i);
        }
        expect(await records()).toHaveLength(1); expect(await profiles()).toHaveLength(1); expect(await authUserCount(email)).toBe(1);
      });
    });

    test(`LO6 ${kind}: a pending account logging in is told it awaits approval: no session, no form, no operational access`, async ({ browser }) => {
      await step(`LO6-${tag}`, '/login -> "Tài khoản đang chờ phê duyệt", stays on /login, no session kept; operational endpoints refuse', async () => {
        const ctxL = await browser.newContext(); const l = await ctxL.newPage();
        await loginAs(l, email, password);
        await expect(l.getByText('Tài khoản đang chờ phê duyệt')).toBeVisible({ timeout: 20_000 });
        await expect(l).toHaveURL(/\/login/); await expect(l).not.toHaveURL(landing);
        expect(await l.evaluate((k) => localStorage.getItem(k), SBKEY)).toBeNull();
        await ctxL.close();
        const token = await passwordToken(email, password);
        const probes: Array<[string, string, unknown?]> = [['GET', '/transactions/me'], ['GET', '/transactions/me/report'], ['GET', '/commissions/me'], ['GET', kind === 'merchant' ? '/merchants/members' : '/collaborators/members'], ['POST', '/transactions/simulation', {}], ['POST', '/qr/resolve', {}]];
        if (kind === 'partner') probes.push(['GET', '/collaborators/me/qr-code']);
        for (const base of [config().api, `https://${UAT.api}`]) for (const [m, pth, body] of probes) {
          const r = await fetch(base + pth, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
          expect(r.status, `${m} ${pth} on ${base}`).toBeGreaterThanOrEqual(400);
        }
      });
    });

    test(`LO7 ${kind}: cross-role and account-switching safety`, async ({ browser }) => {
      await step(`LO7-${tag}`, `this ${kind} session on the ${other} sign-up page shows its existing profile and no submit path; switching to another verified account shows that account`, async () => {
        const ctxB = await browser.newContext(); const b = await ctxB.newPage();
        const writes: string[] = []; b.on('request', (rq) => { if (rq.method() === 'POST' && /\/(collaborators|merchants)$/.test(new URL(rq.url()).pathname)) writes.push(rq.url()); });
        await b.goto('/login');
        await b.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [SBKEY, await sessionJson(email, password)]);
        await b.goto(otherPath);
        await expect(b.getByText(/Hồ sơ|đăng nhập bằng|không phải email đang đăng ký|đã thuộc về/).first()).toBeVisible({ timeout: 30_000 });
        await expect(b.getByRole('button', { name: 'Gửi hồ sơ' })).toHaveCount(0);     // never a submit path for the wrong role
        if (hasCreds('outsider')) {
          await b.getByRole('button', { name: /Đăng xuất/ }).first().click();
          await expect(b.locator('input[type="password"]').first()).toBeVisible();
          expect(await b.evaluate((k) => localStorage.getItem(k), SBKEY)).toBeNull();
          const o = creds('outsider')!;
          await b.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [SBKEY, await sessionJson(o.email, o.password)]); await b.reload();
          await expect(b.getByText(/Email đã xác nhận thành công/)).toBeVisible({ timeout: 30_000 });
          await expect(b.getByText(o.email)).toBeVisible(); await expect(b.getByText(email)).toHaveCount(0);
        }
        expect(writes).toEqual([]); await ctxB.close();
        expect(await records()).toHaveLength(1); expect(await profiles()).toHaveLength(1);
      });
    });

    test(`LO8 ${kind}: an unconfirmed address is told to confirm; no session`, async ({ browser }) => {
      await step(`LO8-${tag}`, 'UI signup without confirming -> /login -> "Email chưa được xác nhận", no session, nothing created', async () => {
        const ctxU = await browser.newContext(); const u = await ctxU.newPage(); await u.goto(path);
        await fillSignup(u, unconfirmedEmail);
        await u.getByRole('button', { name: CTA, exact: true }).click();
        await expect(u.getByText(/Kiểm tra email/)).toBeVisible({ timeout: 30_000 });
        await loginAs(u, unconfirmedEmail, password);
        await expect(u.getByText('Email chưa được xác nhận')).toBeVisible({ timeout: 20_000 });
        expect(await u.evaluate((k) => localStorage.getItem(k), SBKEY)).toBeNull();
        expect(await authUserCount(unconfirmedEmail)).toBe(1);
        await ctxU.close();
      });
    });

    test(`LO9 ${kind}: Admin approval, then normal login reaches the workspace`, async ({ browser }) => {
      await step(`LO9-${tag}`, 'admin approve -> /login lands in the workspace; onboarding page then shows "Hồ sơ đã được duyệt" (no form); counts unchanged', async () => {
        const approve = await api('admin', 'POST', `/${kind === 'merchant' ? 'merchants' : 'collaborators'}/${entityId}/approve`, {});
        expect([200, 201], `approve HTTP ${approve.status} ${JSON.stringify(approve.body).slice(0, 120)}`).toContain(approve.status);
        expect((await profiles())[0].user_profiles_status).toBe('active');
        const ctxL = await browser.newContext(); const l = await ctxL.newPage();
        await loginAs(l, email, password);
        await expect(l).toHaveURL(landing, { timeout: 30_000 });
        await l.goto(path);
        await expect(l.getByText('Hồ sơ đã được duyệt')).toBeVisible({ timeout: 30_000 });
        await expect(l.getByRole('button', { name: 'Gửi hồ sơ' })).toHaveCount(0);
        await ctxL.close();
        expect(await records()).toHaveLength(1); expect(await profiles()).toHaveLength(1); expect(await authUserCount(email)).toBe(1);
      });
    });
  });
}
