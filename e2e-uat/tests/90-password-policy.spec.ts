import { test, expect } from '@playwright/test';
import { anonKey } from '../lib/api';
import { config, RUN_ID } from '../lib/env';
import { record } from '../lib/evidence';
import { deleteUserAsAdmin, getUserAsAdmin, issueRecoveryToken, issueSignupToken, passwordGrantStatus } from '../lib/admin-auth';

// Owner decision 2026-11-07: the ONLY password rules are >= 8 chars, >= 1 letter, >= 1 digit. No uppercase/special rule, and Supabase leaked-password
// rejection is OFF. A password meeting the three rules must never be refused for another strength reason.
// Only synthetic identities on a non-routable domain (the UAT hook suppresses them, so no mail is ever sent). Every user created here is deleted.
const step = async (id: string, title: string, fn: () => Promise<void>) => { try { await fn(); record(id, title, 'PASS'); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; } };
const syn = (tag: string) => `uat.pwpolicy.${tag}.${RUN_ID}.${Math.random().toString(36).slice(2, 7)}@vno-uat-synthetic.example`;
const MEETS = ['abcdefg1', 'dungtest12345', 'password123', 'Password123', 'Qwerty123', 'abc12345', '1234567a', 'Abcdefg1!'];   // includes well-known leaked passwords
const FAILS: Array<[string, string]> = [['abcdef1', '7 characters'], ['abcdefgh', 'no digit'], ['12345678', 'no letter']];
const POLICY_TEXT = /ít nhất 8 ký tự, gồm ít nhất 1 chữ cái và 1 chữ số/;
const SERVER_TEXT = /không chấp nhận mật khẩu này dù đã đáp ứng quy tắc/;
const LEAKED_STYLE = process.env.E2E_POLICY_PASSWORD || 'password123';
const created: string[] = [];

test.describe.serial('Password policy (hosted UAT)', () => {
  test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY, 'BLOCKED: run via `railway run --service vno-api`');
  let anon = '';
  test.beforeAll(async () => { anon = await anonKey(); });
  test.afterAll(async () => { for (const id of created) await deleteUserAsAdmin(id).catch(() => undefined); });

  const signUpApi = async (email: string, password: string) => {
    const r = await fetch(`${config().supabase}/auth/v1/signup`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const b: any = await r.json().catch(() => ({})); const id = b.id ?? b.user?.id; if (id) created.push(id);
    return { status: r.status, code: String(b.error_code ?? ''), reasons: b.weak_password?.reasons ?? null, id };
  };

  MEETS.forEach((pw, i) => {
    test(`PP1.${i} Auth server accepts a password that meets the three rules: ${pw.length} chars ${/[A-Z]/.test(pw) ? 'with' : 'without'} uppercase${/[^a-zA-Z0-9]/.test(pw) ? ' + symbol' : ''} [${pw === 'password123' || pw === 'Password123' || pw === 'Qwerty123' ? 'known-leaked' : 'ordinary'}]`, async () => {
      await step(`PP1-${pw.length}-${MEETS.indexOf(pw)}`, `signup API accepts ${pw === 'password123' || pw === 'Password123' ? 'leaked-list password' : 'policy-compliant password'}`, async () => {
        const r = await signUpApi(syn('api'), pw);
        expect({ status: r.status, code: r.code, reasons: r.reasons }, 'must not be rejected for any strength reason').toEqual({ status: 200, code: '', reasons: null });
      });
    });
  });
  for (const [pw, why] of FAILS) {
    test(`PP1 Auth server rejects a password that breaks a rule (${why})`, async () => {
      await step(`PP1-neg-${why.replace(/\W+/g, '')}`, `signup API rejects (${why}) and creates nothing`, async () => {
        const r = await signUpApi(syn('neg'), pw);
        expect(r.status).toBe(422); expect(r.code).toBe('weak_password'); expect(r.id).toBeFalsy();
        expect(JSON.stringify(r.reasons), 'rejection is for the app rule, not leaked-list').not.toContain('pwned');
      });
    });
  }

  // The single-step Partner registration has no password at all (see 98-partner-single-step.spec.ts); the password policy applies to the Merchant form.
  for (const kind of ['merchant'] as const) {
    const path = kind === 'merchant' ? '/merchant/onboard' : '/collaborator/onboard';
    const fill = async (p: any, email: string, pw: string, confirm = pw) => {
      if (kind === 'merchant') {
        await p.locator('#ownerEmail').fill(email); await p.locator('#name').fill(`UAT-PWPOLICY-${RUN_ID}`); await p.locator('#ownerName').fill('UAT Policy Owner');
        await p.locator('#merchantPhone').fill('0900000021'); await p.locator('#province').fill('Da Nang');
      } else {
        await p.locator('input[name="fullName"]').fill(`UAT-PWPOLICY-${RUN_ID}`); await p.locator('input[name="phone"]').fill('0900000022'); await p.locator('input[name="email"]').fill(email);
      }
      await p.locator('#password, input[name="password"]').first().fill(pw); await p.locator('#confirmPassword, input[name="confirmPassword"]').first().fill(confirm);
    };
    test(`PP2 ${kind} signup form: same visible rule, client rejections use the one message, a compliant leaked-style password is accepted`, async ({ page }) => {
      await step(`PP2-${kind}`, 'hint visible; 7-char/letters-only/digits-only -> policy message; compliant password -> "Kiểm tra email" and an unconfirmed Auth user', async () => {
        await page.goto(path);
        await expect(page.getByText(/Ít nhất 8 ký tự, gồm ít nhất 1 chữ cái và 1 chữ số/).first()).toBeVisible();
        for (const bad of ['abcdef1', 'abcdefgh', '12345678']) {
          await fill(page, syn('ui'), bad);
          await page.getByRole('button', { name: 'Đăng ký & xác nhận email' }).click();
          await expect(page.getByText(POLICY_TEXT).first()).toBeVisible();
        }
        const email = syn(`ui-${kind}`);
        await fill(page, email, LEAKED_STYLE);
        await page.getByRole('button', { name: 'Đăng ký & xác nhận email' }).click();
        await expect(page.getByText(/Kiểm tra email/)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(SERVER_TEXT)).toHaveCount(0);
        const issued = await issueSignupToken(email, LEAKED_STYLE); created.push(issued.userId);   // also gives the user id; no mail
        expect((await getUserAsAdmin(issued.userId)).email_confirmed_at, 'confirmation still required').toBeFalsy();
      });
    });
  }

  test('PP3 reset password: messages are the one policy text; a compliant leaked-style password is accepted; old password stops working', async ({ page }) => {
    await step('PP3', 'recovery page -> policy messages -> new leaked-style password saved -> grant OK with new, refused with old', async () => {
      const email = syn('reset'); const initial = `Init${Math.random().toString(36).slice(2, 8)}9`;
      const c = await fetch(`${config().supabase}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: initial, email_confirm: true }) });
      expect(c.status, 'synthetic confirmed user').toBeLessThan(300); const userId = (await c.json() as any).id; created.push(userId);
      const { tokenHash } = await issueRecoveryToken(email);
      await page.goto(`/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`);
      await page.getByRole('button', { name: 'Tiếp tục đặt mật khẩu' }).click();
      await expect(page.locator('#new-password')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Ít nhất 8 ký tự, gồm ít nhất 1 chữ cái và 1 chữ số/).first()).toBeVisible();
      for (const bad of ['abcdef1', 'abcdefgh', '12345678']) {
        await page.locator('#new-password').fill(bad); await page.locator('#confirm-password').fill(bad);
        await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
        await expect(page.getByText(POLICY_TEXT).first()).toBeVisible();
      }
      await page.locator('#new-password').fill(LEAKED_STYLE); await page.locator('#confirm-password').fill(LEAKED_STYLE);
      await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
      await expect(page.getByText('Mật khẩu đã được cập nhật')).toBeVisible({ timeout: 20_000 });
      expect(await passwordGrantStatus(email, LEAKED_STYLE, anon)).toBe(200);
      expect(await passwordGrantStatus(email, initial, anon)).toBe(400);
    });
  });
});
