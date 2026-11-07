import { test, expect, Page } from '@playwright/test';
import { anonKey, api, hasCreds } from '../lib/api';
import { config, RUN_ID } from '../lib/env';
import { record } from '../lib/evidence';
import { getUserAsAdmin, issueSignupToken, passwordGrantStatus } from '../lib/admin-auth';
import { randomBytes } from 'node:crypto';

// Signup journeys for BOTH roles with brand-new synthetic identities (never migrated V1 accounts, no existing account is touched).
// Addresses are on a non-routable synthetic domain: the UAT hook suppresses them (proving the allowlist) and the confirmation token
// is issued with the Auth admin API. Real mail receipt on an allowlisted mailbox is verified in the controlled manual pass.
const step = async (id: string, title: string, fn: () => Promise<void>) => { try { await fn(); record(id, title, 'PASS'); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; } };
const items = (b: any): any[] => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);

type Kind = 'merchant' | 'partner';
const KINDS: Kind[] = ['merchant', 'partner'];

for (const kind of KINDS) {
  test.describe.serial(`Signup journey: ${kind}`, () => {
    test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY || !hasCreds('admin'), 'BLOCKED: run via `railway run --service vno-api` with admin credentials');
    const tag = kind === 'merchant' ? 'M' : 'P';
    const email = `uat.e2e.auth.${kind}.${RUN_ID}@vno-uat-synthetic.example`;
    const password = process.env.E2E_SIGNUP_PASSWORD || `Uat${randomBytes(4).toString('hex')}7`; // override lets the owner-policy run use a leaked-list style password
    const bizName = `UAT-E2E-AUTH-${tag}-${RUN_ID}`;
    const path = kind === 'merchant' ? '/merchant/onboard' : '/collaborator/onboard';
    const landing = kind === 'merchant' ? /merchant\/dashboard/ : /collaborator\/dashboard/;
    let anon = ''; let userId = ''; let entityId = '';
    let tokenHash = '';
    let pageA: Page;

    const fill = async (p: Page) => {
      if (kind === 'merchant') {
        await p.locator('#ownerEmail').fill(email); await p.locator('#name').fill(bizName); await p.locator('#ownerName').fill('UAT E2E Owner');
        await p.locator('#merchantPhone').fill('0900000011'); await p.locator('#province').fill('Da Nang');
      } else {
        await p.locator('input[name="fullName"]').fill(bizName); await p.locator('input[name="phone"]').fill('0900000012'); await p.locator('input[name="email"]').fill(email);
      }
      await p.locator('#password, input[name="password"]').first().fill(password);
      await p.locator('#confirmPassword, input[name="confirmPassword"]').first().fill(password);
    };

    test.beforeAll(async () => { anon = await anonKey(); });

    test(`SG1 ${kind}: register with the browser form; Auth creates an unconfirmed user and asks the person to check e-mail`, async ({ browser }) => {
      await step(`SG1-${tag}`, 'signUp via UI; user exists, email_confirmed_at is null; draft saved without password', async () => {
        const ctx = await browser.newContext(); (globalThis as any).__ctx = (globalThis as any).__ctx || {}; (globalThis as any).__ctx[kind] = ctx;
        pageA = await ctx.newPage(); await pageA.goto(path); await fill(pageA);
        await pageA.getByRole('button', { name: 'Xác nhận email' }).click();
        await expect(pageA.getByText(/Kiểm tra email/)).toBeVisible({ timeout: 30_000 });
        const draft = await pageA.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => /draft/i.test(k))));
        expect(draft.length, 'a draft is persisted for the confirmation round trip').toBeGreaterThan(10);
        expect(draft).not.toContain(password);
        // issue a fresh signup token for the user the UI just created (no mail needed); this also gives us the user id
        const issued = await issueSignupToken(email, password); userId = issued.userId; tokenHash = issued.tokenHash;
        const u = await getUserAsAdmin(userId); expect(u.email.toLowerCase()).toBe(email); expect(u.email_confirmed_at).toBeFalsy();
      });
    });

    test(`SG2 ${kind}: an unverified e-mail cannot sign in or reach a workspace`, async ({ browser }) => {
      await step(`SG2-${tag}`, 'password grant = 400 email_not_confirmed; login UI says confirm e-mail; no profile endpoint access', async () => {
        expect(await passwordGrantStatus(email, password, anon)).toBe(400);
        const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto('/login');
        await p.getByPlaceholder('email@example.com').fill(email); await p.locator('input[type="password"]').fill(password); await p.locator('button[type="submit"]').click();
        await expect(p.getByText(/Email chưa được xác nhận|Không thể đăng nhập|không đúng/).first()).toBeVisible({ timeout: 20_000 });
        await expect(p).not.toHaveURL(landing);
        await ctx.close();
        const anonymousCreate = await api(null, 'POST', kind === 'merchant' ? '/merchants' : '/collaborators', { merchant_name: 'x', collaborators_name: 'x' });
        expect([401, 403]).toContain(anonymousCreate.status);
      });
    });

    test(`SG3 ${kind}: confirmation opened ONCE in a different tab; the original tab keeps its data and finishes onboarding`, async ({ request }) => {
      await step(`SG3-${tag}`, 'scanner GET does not confirm; click confirms once; draft survives; tab A becomes verified and submits', async () => {
        const ctx = (globalThis as any).__ctx[kind];
        const next = `${path}?confirmed=1`;
        const url = `/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=signup&next=${encodeURIComponent(next)}`;
        expect((await request.get(config().web + url)).status()).toBe(200);
        expect((await getUserAsAdmin(userId)).email_confirmed_at, 'a plain GET must not confirm the e-mail').toBeFalsy();
        const tabB: Page = await ctx.newPage(); await tabB.goto(url);
        await expect.poll(() => tabB.url()).not.toContain('token_hash');
        await tabB.getByRole('button', { name: 'Xác nhận email' }).click();
        await expect(tabB).toHaveURL(new RegExp(`${path}\\?confirmed=1`), { timeout: 30_000 });
        expect((await getUserAsAdmin(userId)).email_confirmed_at, 'Auth recorded email_confirmed_at').toBeTruthy();
        // the draft restored in the new tab (same browser profile)
        await expect(kind === 'merchant' ? tabB.locator('#name') : tabB.locator('input[name="fullName"]')).toHaveValue(bizName, { timeout: 15_000 });
        await tabB.close();
        // tab A (original, still holding its React state) picks up the verified session without a reload
        await expect(pageA.getByRole('button', { name: 'Gửi hồ sơ' })).toBeVisible({ timeout: 20_000 });
        await expect(pageA.locator(kind === 'merchant' ? '#name' : 'input[name="fullName"]')).toHaveValue(bizName);
        await pageA.getByRole('button', { name: 'Gửi hồ sơ' }).click();
        await expect(pageA).toHaveURL(/\/success/, { timeout: 30_000 });
        // a second use of the same link must fail
        const ctx2 = await ctx.browser()!.newContext(); const again = await ctx2.newPage(); await again.goto(url);
        await again.getByRole('button', { name: 'Xác nhận email' }).click();
        await expect(again.getByText(/không hợp lệ hoặc đã dùng rồi/)).toBeVisible({ timeout: 20_000 });
        await ctx2.close();
      });
    });

    test(`SG4 ${kind}: a pending business profile exists, Admin approves, the owner reaches the correct workspace`, async ({ browser }) => {
      await step(`SG4-${tag}`, 'pending profile -> login says pending -> admin approves -> login lands in workspace', async () => {
        if (kind === 'merchant') {
          const hit = items((await api('admin', 'GET', `/merchants/admin-directory?search=${bizName}&page_size=5`)).body).find((m) => m.merchant_name === bizName);
          expect(hit, 'merchant record created from the onboarding form').toBeTruthy(); entityId = hit.merchant_system_id;
          expect(hit.merchants_status).toBe('pending');
        } else {
          const hit = items((await api('admin', 'GET', '/collaborators')).body).find((c) => c.collaborators_name === bizName);
          expect(hit, 'partner record created from the onboarding form').toBeTruthy(); entityId = hit.id;
          expect(hit.collaborators_status ?? 'pending').toBe('pending');
        }
        const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto('/login');
        await p.getByPlaceholder('email@example.com').fill(email); await p.locator('input[type="password"]').fill(password); await p.locator('button[type="submit"]').click();
        await expect(p.getByText('Tài khoản đang chờ duyệt')).toBeVisible({ timeout: 20_000 });
        const approve = await api('admin', 'POST', `/${kind === 'merchant' ? 'merchants' : 'collaborators'}/${entityId}/approve`, {});
        expect([200, 201], `approve HTTP ${approve.status} ${JSON.stringify(approve.body).slice(0, 120)}`).toContain(approve.status);
        await p.goto('/login');
        await p.getByPlaceholder('email@example.com').fill(email); await p.locator('input[type="password"]').fill(password); await p.locator('button[type="submit"]').click();
        await expect(p).toHaveURL(landing, { timeout: 30_000 });
        await ctx.close();
      });
    });

    test(`SG5 ${kind}: registering the same (now confirmed) address again is rejected with a clear message`, async ({ browser }) => {
      await step(`SG5-${tag}`, 'duplicate registration -> "đã được đăng ký"; no second account', async () => {
        const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(path); await fill(p);
        await p.getByRole('button', { name: 'Xác nhận email' }).click();
        await expect(p.getByText(/đã được đăng ký/)).toBeVisible({ timeout: 30_000 });
        await ctx.close();
      });
    });
    test(`SG6 ${kind}: the approved owner changes the password from Account settings (same policy, accurate messages)`, async ({ browser }) => {
      await step(`SG6-${tag}`, 'settings form shows the rule; 7-char rejected with the policy text; compliant leaked-style password saved; new password works', async () => {
        const next = process.env.E2E_SIGNUP_PASSWORD_NEXT || 'password1234';
        const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto('/login');
        await p.getByPlaceholder('email@example.com').fill(email); await p.locator('input[type="password"]').fill(password); await p.locator('button[type="submit"]').click();
        await expect(p).toHaveURL(landing, { timeout: 30_000 });
        await p.goto(`/${kind === 'merchant' ? 'merchant' : 'collaborator'}/dashboard/settings`);
        await expect(p.getByText(/Ít nhất 8 ký tự, gồm ít nhất 1 chữ cái và 1 chữ số/)).toBeVisible();
        const fields = p.locator('input[type="password"]');
        await fields.nth(0).fill('abcdef1'); await fields.nth(1).fill('abcdef1'); await p.getByRole('button', { name: 'Đổi mật khẩu' }).click();
        await expect(p.locator('p[role="alert"]')).toContainText(/ít nhất 8 ký tự, gồm ít nhất 1 chữ cái và 1 chữ số/);
        await fields.nth(0).fill(next); await fields.nth(1).fill(next); await p.getByRole('button', { name: 'Đổi mật khẩu' }).click();
        await expect(p.locator('p[role="alert"]')).toContainText('Đã cập nhật mật khẩu', { timeout: 20_000 });
        expect(await passwordGrantStatus(email, next, anon)).toBe(200);
        await ctx.close();
      });
    });
  });
}
