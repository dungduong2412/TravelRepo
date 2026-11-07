import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { anonKey, hasCreds } from '../lib/api';
import { config, creds, Role, UAT } from '../lib/env';
import { record } from '../lib/evidence';

// Signup post-confirmation UX acceptance (read-only). Uses the existing fixture accounts only:
//   outsider = confirmed Auth user with NO profile (same state as a freshly confirmed signup),
//   merchant / partner = existing approved owners (a "previously signed-in" session).
// It never submits an onboarding form and never creates, changes or deletes an account. Every write attempt below is a NEGATIVE case
// that must be refused, and the surrounding DB row counts are compared separately (evidence script).
// Run in candidate mode: E2E_TARGET=candidate (local web :3011 + local API :3100, hosted UAT data).
test.skip(!hasCreds('outsider', 'merchant', 'partner'), 'BLOCKED: fixture credentials missing');

const REF = UAT.supabaseRef;
const step = async (id: string, title: string, fn: () => Promise<void>) => { try { await fn(); record(id, title, 'PASS'); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; } };

async function session(role: Role) {
  const c = creds(role)!;
  const r = await fetch(`${config().supabase}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: await anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(c),
  });
  if (!r.ok) throw new Error(`login ${role} HTTP ${r.status}`);
  const s: any = await r.json();
  process.env[`E2E_TOKEN_${role.toUpperCase()}_UX`] = s.access_token;
  return { s, email: c.email, token: s.access_token as string };
}

async function contextAs(browser: Browser, role: Role | null, draft?: { key: string; value: unknown }) {
  const ctx = await browser.newContext();
  if (role) {
    const { s } = await session(role);
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k as string, v as string), [`sb-${REF}-auth-token`, JSON.stringify(s)]);
  }
  if (draft) await ctx.addInitScript(([k, v]) => localStorage.setItem(k as string, v as string), [draft.key, JSON.stringify({ savedAt: Date.now(), value: draft.value })]);
  return ctx;
}

/** Records every request that could create something: any non-GET to the application endpoints. */
function watchWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (rq) => {
    if (rq.method() !== 'GET' && rq.method() !== 'OPTIONS' && /\/(collaborators|merchants)(\/|$|\?)/.test(new URL(rq.url()).pathname)) writes.push(`${rq.method()} ${new URL(rq.url()).pathname}`);
  });
  return writes;
}

const PARTNER_PAGE = '/collaborator/onboard';
const MERCHANT_PAGE = '/merchant/onboard';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const other = (email: string, tag: string) => email.replace(/\+[^@]*@/, `+${tag}@`);

test.describe('Signup post-confirmation UX', () => {
  test('PC1 confirmed session without profile: success banner, verified e-mail, no password, no auto-created application', async ({ browser }) => {
    for (const [page_, label, role] of [[PARTNER_PAGE, 'Đối tác', 'partner'], [MERCHANT_PAGE, 'Nhà cung cấp', 'merchant']] as const) {
      await step(`PC1-${role}`, `${role}: banner "Email đã xác nhận thành công. Vui lòng hoàn tất hồ sơ ${label}."; email read-only; no password field; no write request`, async () => {
        const { email } = await session('outsider');
        const ctx = await contextAs(browser, 'outsider'); const p = await ctx.newPage(); const writes = watchWrites(p);
        await p.goto(page_);
        await expect(p.getByText(`Email đã xác nhận thành công. Vui lòng hoàn tất hồ sơ ${label}.`)).toBeVisible({ timeout: 20_000 });
        const emailInput = p.locator(role === 'partner' ? 'input[name="email"]' : '#ownerEmail');
        await expect(emailInput).toHaveValue(email); await expect(emailInput).toHaveAttribute('readonly', '');
        await expect(p.locator('input[type="password"]')).toHaveCount(0);
        await expect(p.getByRole('button', { name: 'Gửi hồ sơ' })).toBeVisible();
        await expect(p.getByText(/nháp|draft|đã kích hoạt/i)).toHaveCount(0);
        await p.waitForTimeout(1500);
        expect(writes, 'loading the page and idling must not create any application').toEqual([]);
        await ctx.close();
      });
    }
  });

  test('PC9 initial signup CTA reads "Đăng ký & xác nhận email"; "Gửi hồ sơ" appears only for a verified session', async ({ browser }) => {
    for (const [page_, role] of [[PARTNER_PAGE, 'partner'], [MERCHANT_PAGE, 'merchant']] as const) {
      await step(`PC9-${role}`, `${role}: anonymous CTA, signup navigation stays on the form, verified session switches CTA`, async () => {
        const anon = await browser.newContext(); const p = await anon.newPage(); const writes = watchWrites(p);
        await p.goto(page_);
        await expect(p.getByRole('button', { name: 'Đăng ký & xác nhận email', exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(p.getByRole('button', { name: 'Gửi hồ sơ' })).toHaveCount(0);
        await expect(p.getByText(/Email đã xác nhận thành công/)).toHaveCount(0);
        await expect(p.locator('input[type="password"]')).toHaveCount(2);
        await p.getByRole('button', { name: 'Hủy' }).click(); await expect(p).toHaveURL(/\/$/);   // navigation away needs no session and creates nothing
        expect(writes).toEqual([]); await anon.close();
        const ctx = await contextAs(browser, 'outsider'); const q = await ctx.newPage(); await q.goto(page_);
        await expect(q.getByRole('button', { name: 'Gửi hồ sơ' })).toBeVisible({ timeout: 20_000 });
        await expect(q.getByRole('button', { name: 'Đăng ký & xác nhận email' })).toHaveCount(0);
        await ctx.close();
      });
    }
  });

  test('PC2 operational dashboards are closed to the confirmed-but-unapproved session', async ({ browser }) => {
    for (const path of ['/collaborator/dashboard', '/merchant/dashboard', '/admin/dashboard']) {
      await step(`PC2-${path.split('/')[1]}`, `${path} redirects the profile-less confirmed session to /login`, async () => {
        const ctx = await contextAs(browser, 'outsider'); const p = await ctx.newPage();
        await p.goto(path); await expect(p).toHaveURL(/\/login/, { timeout: 20_000 });
        await ctx.close();
      });
    }
  });

  test('PC3 operational API is closed to the profile-less session (local candidate API and deployed UAT API)', async () => {
    const { token } = await session('outsider');
    const probes: Array<[string, string, unknown?]> = [
      ['GET', '/collaborators/me'], ['GET', '/collaborators/me/qr-code'], ['GET', '/collaborators/members'], ['GET', '/merchants/members'],
      ['GET', '/transactions/me'], ['GET', '/transactions/me/report'], ['GET', '/commissions/me'], ['GET', '/media/me'],
      ['POST', '/qr/resolve', {}], ['POST', '/transactions/simulation', {}], ['POST', '/transactions/real', {}], ['GET', '/collaborators'], ['GET', '/merchants/admin-directory'],
    ];
    for (const base of [config().api, `https://${UAT.api}`]) {
      await step(`PC3-${base.includes('localhost') ? 'local' : 'uat'}`, `${probes.length} operational/admin endpoints refuse the profile-less session (${base.replace(/^https?:\/\//, '')})`, async () => {
        const bad: string[] = [];
        for (const [m, path, body] of probes) {
          const r = await fetch(base + path, { method: m, headers: bearer(token), body: body === undefined ? undefined : JSON.stringify(body) });
          if (r.status < 400) bad.push(`${m} ${path} -> ${r.status}`);
        }
        expect(bad, 'endpoints that answered 2xx/3xx').toEqual([]);
      });
    }
  });

  test('PC4 an existing Merchant/Partner session is never adopted as the identity of a different role sign-up', async ({ browser }) => {
    for (const [as, page_, label] of [['merchant', PARTNER_PAGE, 'Đối tác'], ['partner', MERCHANT_PAGE, 'Nhà cung cấp']] as const) {
      await step(`PC4-${as}`, `${as} session on the ${label} sign-up: existing-profile notice, no form, e-mail not adopted, no write`, async () => {
        const { email } = await session(as);
        const ctx = await contextAs(browser, as); const p = await ctx.newPage(); const writes = watchWrites(p);
        await p.goto(page_);
        await expect(p.getByText(`Bạn đang đăng nhập bằng ${email}`)).toBeVisible({ timeout: 20_000 });
        await expect(p.getByRole('button', { name: 'Gửi hồ sơ' })).toHaveCount(0);
        await expect(p.getByText(/Email đã xác nhận thành công/)).toHaveCount(0);
        await expect(p.locator('input[name="fullName"], #name')).toHaveCount(0);
        await p.waitForTimeout(1500); expect(writes).toEqual([]);
        // The way out is explicit: sign out, then the anonymous sign-up form is shown and the session is gone.
        await p.getByRole('button', { name: 'Đăng xuất để dùng email khác' }).click();
        await expect(p.locator('input[type="password"]').first()).toBeVisible();
        expect(await p.evaluate((k) => localStorage.getItem(k), `sb-${REF}-auth-token`)).toBeNull();
        await ctx.close();
      });
    }
  });

  test('PC5 a session for a different e-mail than the one being signed up is flagged, not silently used', async ({ browser }) => {
    await step('PC5', 'draft e-mail A + session of B: mismatch notice, form hidden, no write; signing out restores the sign-up form with draft A', async () => {
      const outsider = await session('outsider');
      const intended = other(outsider.email, 'uat-signup-partner2');
      const ctx = await contextAs(browser, 'outsider', { key: 'vno-collaborator-onboarding-draft', value: { email: intended, fullName: 'Draft Only' } });
      const p = await ctx.newPage(); const writes = watchWrites(p);
      await p.goto(PARTNER_PAGE);
      await expect(p.getByText('Phiên đăng nhập hiện tại không phải email đang đăng ký Đối tác')).toBeVisible({ timeout: 20_000 });
      await expect(p.getByText(`khác với email bạn đã nhập (${intended})`)).toBeVisible();
      await expect(p.getByRole('button', { name: 'Gửi hồ sơ' })).toHaveCount(0);
      await p.waitForTimeout(1500); expect(writes).toEqual([]);
      await p.getByRole('button', { name: 'Đăng xuất phiên này để tiếp tục' }).click();
      await expect(p.locator('input[name="email"]')).toHaveValue(intended);
      await expect(p.locator('input[type="password"]').first()).toBeVisible();
      await ctx.close();
    });
  });

  test('PC6 confirmation page: no "activated" wording; a left-over session is announced before it is replaced', async ({ browser }) => {
    await step('PC6', '/auth/confirm shows approval-aware copy, and warns when another account is signed in (token not spent)', async () => {
      const merchant = await session('merchant');
      const ctx = await contextAs(browser, 'merchant'); const p = await ctx.newPage();
      await p.goto('/auth/confirm?token_hash=uat-not-a-real-token&type=signup&next=/collaborator/onboard%3Fconfirmed%3D1');
      await expect(p.getByText(/tài khoản chỉ hoạt động sau khi Admin phê duyệt/)).toBeVisible({ timeout: 20_000 });
      await expect(p.getByText('Trình duyệt đang đăng nhập bằng tài khoản khác')).toBeVisible();
      await expect(p.getByText(`Phiên của ${merchant.email} sẽ được đăng xuất`)).toBeVisible();
      await expect(p.getByText(/kích hoạt tài khoản/)).toHaveCount(0);
      await ctx.close();
    });
  });

  test('PC7 after submission the page says "Hồ sơ đang chờ phê duyệt" (never draft / activated)', async ({ browser }) => {
    for (const type of ['collaborator', 'merchant']) {
      await step(`PC7-${type}`, `/success?type=${type}`, async () => {
        const ctx = await browser.newContext(); const p = await ctx.newPage();
        await p.goto(`/success?type=${type}`);
        await expect(p.getByRole('heading', { name: 'Hồ sơ đang chờ phê duyệt' })).toBeVisible({ timeout: 20_000 });
        await expect(p.getByText(/nháp|draft|đã được kích hoạt|tài khoản đã kích hoạt/i)).toHaveCount(0);
        await expect(p.getByText(/chưa hoạt động cho đến khi Admin phê duyệt/)).toBeVisible();
        await ctx.close();
      });
    }
  });

  test('PC8 two distinct aliases cannot create or bind to each other\'s profile (API refuses; nothing is written)', async () => {
    const outsider = await session('outsider'); const merchant = await session('merchant'); const partner = await session('partner');
    const partnerBody = (email: string) => ({ collaborators_name: 'UAT identity probe', collaborators_phone: '0900000099', collaborators_email: email });
    const merchantBody = (email: string) => ({ owner_email: email, merchant_name: 'UAT identity probe', merchant_email: email });
    const cases: Array<[string, string, string, unknown, RegExp]> = [
      ['outsider -> Partner for ANOTHER alias', '/collaborators', outsider.token, partnerBody(other(outsider.email, 'uat-signup-partner2')), /must match the verified Auth email/i],
      ['outsider -> Merchant for ANOTHER alias', '/merchants', outsider.token, merchantBody(other(outsider.email, 'uat-signup-merchant2')), /must match the verified Auth email/i],
      ['merchant owner -> Partner application (own e-mail)', '/collaborators', merchant.token, partnerBody(merchant.email), /already exists/i],
      ['partner owner -> Merchant application (own e-mail)', '/merchants', partner.token, merchantBody(partner.email), /already exists/i],
      ['merchant owner -> Partner for the OUTSIDER alias', '/collaborators', merchant.token, partnerBody(outsider.email), /must match the verified Auth email/i],
      ['partner owner -> Merchant for the OUTSIDER alias', '/merchants', partner.token, merchantBody(outsider.email), /must match the verified Auth email/i],
    ];
    for (const base of [config().api, `https://${UAT.api}`]) {
      for (const [name, path, token, body, expected] of cases) {
        await step(`PC8-${base.includes('localhost') ? 'local' : 'uat'}-${cases.findIndex((c) => c[0] === name) + 1}`, `${name}: refused (${base.replace(/^https?:\/\//, '')})`, async () => {
          const r = await fetch(base + path, { method: 'POST', headers: bearer(token), body: JSON.stringify(body) });
          const text = await r.text();
          expect(r.status, `HTTP ${r.status} ${text.slice(0, 160)}`).toBe(400);
          expect(text).toMatch(expected);
        });
      }
    }
  });
});
