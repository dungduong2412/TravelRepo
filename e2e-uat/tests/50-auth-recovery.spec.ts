import { test, expect, Page, BrowserContext } from '@playwright/test';
import { anonKey, hasCreds } from '../lib/api';
import { config, creds } from '../lib/env';
import { record } from '../lib/evidence';
import { issueRecoveryToken, passwordGrantStatus, setPasswordAsAdmin, verifyTokenStatus } from '../lib/admin-auth';
import { randomBytes } from 'node:crypto';
import { rotateAccountPassword } from '../lib/credential-store';

// Recovery behaviour of the web app, driven with admin-issued tokens (no mailbox). Mail delivery is verified separately.
// Passwords of the two approved synthetic accounts are changed during the run and ROTATED to fresh random values in afterAll (never restored).
// WARNING: issuing recovery tokens supersedes any recovery mail already sent to these accounts. Do not run this spec while an owner mailbox test is in progress.
const step = async (id: string, title: string, fn: () => Promise<void>) => { try { await fn(); record(id, title, 'PASS'); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; } };
const newPassword = () => `Uat${randomBytes(4).toString('hex')}9`;
const INVALID = /Liên kết không hợp lệ hoặc đã hết hạn/;

test.describe.serial('Recovery safety (admin-issued tokens)', () => {
  test.skip(process.env.E2E_ALLOW_TOKEN_ISSUE !== '1', 'GUARDED: issues recovery tokens for the approved accounts (supersedes any mail already sent). Set E2E_ALLOW_TOKEN_ISSUE=1 only when no owner mailbox test is in progress');
  test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY || !hasCreds('merchant', 'partner'), 'BLOCKED: run via `railway run --service vno-api` with merchant+partner credentials');
  let anon = '';
  let merchant = { email: '', original: '', current: '', id: '' };
  let partner = { email: '', original: '', current: '', id: '' };
  let linkA = '';

  test.beforeAll(async () => {
    anon = await anonKey();
    const m = creds('merchant')!; const p = creds('partner')!;
    merchant = { email: m.email, original: m.password, current: m.password, id: '' };
    partner = { email: p.email, original: p.password, current: p.password, id: '' };
  });

  // The two long-lived accounts are NEVER put back to a shared/previously known password: each is rotated to a fresh random one that is
  // written only to the git-ignored 0600 .env.uat.local (never printed). If a run aborts before this point the account keeps its last password.
  test.afterAll(async () => {
    for (const [key, a] of [['E2E_MERCHANT_PASSWORD', merchant], ['E2E_PARTNER_PASSWORD', partner]] as const) {
      if (!a.id) continue;
      const ok = await rotateAccountPassword({ envKey: key, userId: a.id, email: a.email, anon }).catch(() => 0);
      record('ROTATE', `fresh credential issued for ${a.email.replace(/^(.{3}).*(@.*)$/, '$1***$2')} (stored in the local git-ignored env file only)`, ok === 200 ? 'PASS' : 'FAIL', `HTTP ${ok}`);
    }
  });

  async function uiLogin(page: Page, email: string, password: string, landing: RegExp) {
    await page.goto('/login');
    await page.getByPlaceholder('email@example.com').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(landing, { timeout: 30_000 });
  }
  const linkFor = (tokenHash: string) => `/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
  const startOf = async (ctx: BrowserContext, path: string) => { const pg = await ctx.newPage(); await pg.goto(path); return pg; };

  test('RC1 a plain GET of the link (scanner/prefetch) does not consume it; click-through sets the password for the intended Merchant', async ({ browser, request }) => {
    await step('RC1', 'prefetch-safe; token spent only after click; policy errors are specific; new password works, old one does not', async () => {
      const issued = await issueRecoveryToken(merchant.email); merchant.id = issued.userId; linkA = linkFor(issued.tokenHash);
      const scan = await request.get(config().web + linkA); // what a mail scanner / link preview does
      expect(scan.status()).toBe(200);
      const ctx = await browser.newContext(); const page = await startOf(ctx, linkA);
      await expect(page.getByRole('button', { name: 'Tiếp tục đặt mật khẩu' })).toBeVisible();
      await expect(page.locator('#new-password')).toHaveCount(0); // nothing is enabled before the explicit click
      expect(page.url()).not.toContain('token_hash'); // token stripped from the address bar
      await page.getByRole('button', { name: 'Tiếp tục đặt mật khẩu' }).click();
      await expect(page.locator('#new-password')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(merchant.email[0] + '***@')).toBeVisible(); // intended identity is shown, masked
      // password-policy failure must NOT claim the link expired
      await page.locator('#new-password').fill('abcdefgh'); await page.locator('#confirm-password').fill('abcdefgh');
      await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
      await expect(page.getByText(/ít nhất 8 ký tự/).first()).toBeVisible();
      await expect(page.getByText(INVALID)).toHaveCount(0);
      await page.locator('#new-password').fill('Abcdef12'); await page.locator('#confirm-password').fill('Abcdef13');
      await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
      await expect(page.getByText('Hai mật khẩu không khớp.')).toBeVisible();
      merchant.current = newPassword();
      await page.locator('#new-password').fill(merchant.current); await page.locator('#confirm-password').fill(merchant.current);
      await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
      await expect(page.getByText('Mật khẩu đã được cập nhật')).toBeVisible({ timeout: 20_000 });
      await ctx.close();
      expect(await passwordGrantStatus(merchant.email, merchant.current, anon), 'new password logs in').toBe(200);
      expect(await passwordGrantStatus(merchant.email, merchant.original, anon), 'previous password is rejected').toBe(400);
      // sign in through the real login UI with the new password
      const c2 = await browser.newContext(); const p2 = await c2.newPage();
      await uiLogin(p2, merchant.email, merchant.current, /merchant\/dashboard/); await c2.close();
    });
  });

  test('RC2 the consumed link cannot change the password again', async ({ browser }) => {
    await step('RC2', 'reused link: UI shows invalid + no form; Auth rejects the spent token', async () => {
      const ctx = await browser.newContext(); const page = await startOf(ctx, linkA);
      await page.getByRole('button', { name: 'Tiếp tục đặt mật khẩu' }).click();
      await expect(page.getByText(INVALID).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#new-password')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Yêu cầu liên kết mới' })).toBeVisible();
      await ctx.close();
      const tokenHash = decodeURIComponent(new URL(config().web + linkA).searchParams.get('token_hash')!);
      const direct = await verifyTokenStatus(tokenHash, 'recovery', anon);
      expect(direct.status, `spent token: ${direct.code}`).toBeGreaterThanOrEqual(400);
      expect(await passwordGrantStatus(merchant.email, merchant.current, anon), 'password unchanged by the replay').toBe(200);
    });
  });

  test('RC3 an ordinary signed-in session never enables the reset form (original defect)', async ({ browser }) => {
    await step('RC3', 'signed-in Partner opening /reset-password with no token, a junk token, or an error hash gets no form', async () => {
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await uiLogin(page, partner.email, partner.current, /collaborator\/dashboard/);
      await page.goto('/reset-password');
      await expect(page.getByText(INVALID).first()).toBeVisible();
      await expect(page.locator('#new-password')).toHaveCount(0);
      await page.goto('/reset-password#error=access_denied&error_code=otp_expired&error_description=expired');
      await expect(page.getByText(INVALID).first()).toBeVisible();
      await expect(page.locator('#new-password')).toHaveCount(0);
      await page.goto(linkFor('00000000junk00000000')); await page.getByRole('button', { name: 'Tiếp tục đặt mật khẩu' }).click();
      await expect(page.getByText(INVALID).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('#new-password')).toHaveCount(0);
      // legacy implicit-flow shape with a forged access_token must not enable the form either
      await page.goto('/reset-password#access_token=forged&refresh_token=forged&type=recovery');
      await expect(page.getByText(INVALID).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('#new-password')).toHaveCount(0);
      await ctx.close();
      expect(await passwordGrantStatus(partner.email, partner.original, anon), 'partner password untouched').toBe(200);
    });
  });

  test('RC4 recovery while ANOTHER account is signed in resets only the account named by the link', async ({ browser }) => {
    await step('RC4', 'Merchant signed in; Partner link opened: Partner password changes, Merchant password does not', async () => {
      const issued = await issueRecoveryToken(partner.email); partner.id = issued.userId;
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await uiLogin(page, merchant.email, merchant.current, /merchant\/dashboard/);
      await page.goto(linkFor(issued.tokenHash));
      await page.getByRole('button', { name: 'Tiếp tục đặt mật khẩu' }).click();
      await expect(page.locator('#new-password')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(partner.email[0] + '***@')).toBeVisible();
      partner.current = newPassword();
      await page.locator('#new-password').fill(partner.current); await page.locator('#confirm-password').fill(partner.current);
      await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
      await expect(page.getByText('Mật khẩu đã được cập nhật')).toBeVisible({ timeout: 20_000 });
      const leftovers = await page.evaluate(() => ['user', 'userRole', 'merchant', 'collaborator'].filter((k) => localStorage.getItem(k) !== null));
      expect(leftovers, 'app session keys cleared after reset').toEqual([]);
      await ctx.close();
      expect(await passwordGrantStatus(partner.email, partner.current, anon), 'Partner: new password works').toBe(200);
      expect(await passwordGrantStatus(partner.email, partner.original, anon), 'Partner: old password rejected').toBe(400);
      expect(await passwordGrantStatus(merchant.email, merchant.current, anon), 'Merchant (the signed-in account) unchanged').toBe(200);
    });
  });

  test('RC5 after a genuine failure the user is offered exactly one path to a new link', async ({ browser }) => {
    await step('RC5', 'invalid page -> forgot-password with explanatory notice (no mail sent by this test)', async () => {
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await page.goto('/reset-password#error=access_denied&error_code=otp_expired&error_description=expired');
      await page.getByRole('link', { name: 'Yêu cầu liên kết mới' }).click();
      await expect(page).toHaveURL(/forgot-password\?reason=otp_expired/);
      await expect(page.getByText('Liên kết trước không dùng được')).toBeVisible();
      await expect(page.locator('#forgot-email')).toBeVisible();
      await ctx.close();
    });
  });
});
