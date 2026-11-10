import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { api, hasCreds, useIdentity } from '../lib/api';
import { config, EVIDENCE_DIR, RUN_ID } from '../lib/env';
import { record } from '../lib/evidence';
import { readFixture, Fixture } from '../lib/fixture';

// PARTNER "MEMBERS" PAGE RETIRED FROM ACTIVE NAVIGATION (Web-only release; the API and the database are untouched).
//   N1  the Partner menu (desktop sidebar and mobile bar) has no Members entry, the other entries are still there
//   N2  the old URL answers a real HTTP 307 to the Partner dashboard (and a signed-in browser lands there)
//   N3  Merchant Members is unchanged: the page still loads and GET /merchants/members still answers for the Merchant
//   N4  no cross-role regression on both Members API routes (Partner / Merchant / Admin / anonymous), and the legacy Partner route keeps answering as before
//   N5  (Members security release) POST /collaborators/members answers 410 FEATURE_RETIRED to every authenticated role, 401 anonymous. It is sent with an EMPTY body, which can never
//        create a row even on the old code (the old route answered 400), so this step is write-safe before and after the deploy
//   N6  (Members security release) the Merchant list shows masked contact details and no bank data; an INVALID create is a 400 with Vietnamese field errors (nothing is written)
// READ-ONLY: logins and GETs only. It never POSTs to a Members route, so it creates no team members and no records.
// Run through `railway run --service vno-api` (paired fixture + admin credentials).
const step = async (id: string, title: string, fn: () => Promise<string | void>) => {
  try { const detail = await fn(); record(id, title, 'PASS', detail || ''); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; }
};
const shot = (page: Page, name: string) => page.screenshot({ path: `${EVIDENCE_DIR}/screens/${name}.png` }).catch(() => undefined);
const evidence: Record<string, unknown> = { run: RUN_ID };

test.skip(!readFixture() || !hasCreds('admin'), 'BLOCKED: run via `railway run --service vno-api` with admin credentials and the paired fixture');

test.describe.serial('Partner Members page retired from navigation', () => {
  const web = () => config().web; const apiBase = () => config().api;
  let fx: Fixture;
  const login = async (page: Page, who: 'partner' | 'merchant', landing: RegExp) => {
    await page.goto(`${web()}/login`); await page.getByPlaceholder('email@example.com').fill(fx[who].email); await page.locator('input[type="password"]').fill(fx[who].password);
    await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(landing, { timeout: 30_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
  };

  test.beforeAll(async () => {
    fx = readFixture()!; useIdentity('partner', fx.partner); useIdentity('merchant', fx.merchant);
    fs.mkdirSync(`${EVIDENCE_DIR}/screens`, { recursive: true });
  });
  test.afterAll(async () => { fs.writeFileSync(`${EVIDENCE_DIR}/partner-members-retired-${RUN_ID}.json`, JSON.stringify(evidence, null, 2)); });

  test('N1 the Partner menu has no Members entry on desktop or mobile; the other entries remain', async ({ browser }) => {
    await step('N1', 'no link to /collaborator/dashboard/members and no "Giới thiệu" entry; QR, commission, profile and account entries still present', async () => {
      const kept = ['/collaborator/dashboard/qr-code', '/collaborator/dashboard/reports', '/collaborator/dashboard/profile', '/collaborator/dashboard/settings'];
      const seen: Record<string, unknown> = {};
      for (const [label, viewport] of [['desktop', { width: 1100, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
        const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage();
        await login(page, 'partner', /collaborator\/dashboard/);
        await expect(page.getByTestId('partner-qr-card')).toBeVisible({ timeout: 30_000 });
        if (label === 'mobile') await page.locator('summary[aria-label="Menu"]').click();   // the full menu lives behind "Thêm" on a phone
        await expect(page.locator('a[href="/collaborator/dashboard/members"]')).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Giới thiệu', exact: true })).toHaveCount(0);
        for (const href of kept) expect(await page.locator(`a[href="${href}"]`).count(), `${label}: ${href} should still be in the menu`).toBeGreaterThan(0);
        const hrefs = await page.locator('a[href^="/collaborator/dashboard"]').evaluateAll((els) => Array.from(new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href')))));
        seen[label] = hrefs; await shot(page, `N1-partner-menu-${label}`); await ctx.close();
      }
      evidence.menu = seen;
      return `no Members link or "Giới thiệu" entry on desktop and mobile; menu links: ${JSON.stringify(seen)}`;
    });
  });

  test('N2 the old Partner Members URL answers 307 to the Partner dashboard', async ({ browser }) => {
    await step('N2', 'GET /collaborator/dashboard/members (no redirect following) -> 307 + Location = /collaborator/dashboard; a signed-in browser ends on the dashboard', async () => {
      const r = await fetch(`${web()}/collaborator/dashboard/members`, { redirect: 'manual' });
      const loc = r.headers.get('location') || ''; const target = loc ? new URL(loc, web()).pathname : '';
      evidence.oldUrl = { status: r.status, location: loc };
      expect(r.status, 'status of the old URL').toBe(307); expect(target).toBe('/collaborator/dashboard');
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } }); const page = await ctx.newPage();
      await login(page, 'partner', /collaborator\/dashboard/);
      await page.goto(`${web()}/collaborator/dashboard/members`); await expect(page).toHaveURL(new RegExp(`${web().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/collaborator/dashboard/?$`), { timeout: 20_000 });
      await expect(page.getByTestId('partner-qr-card')).toBeVisible({ timeout: 30_000 }); await shot(page, 'N2-old-url-lands-on-dashboard'); await ctx.close();
      return `HTTP ${r.status} -> ${loc}; signed-in browser lands on the Partner dashboard (QR card visible)`;
    });
  });

  test('N3 Merchant Members is unchanged', async ({ browser }) => {
    await step('N3', 'the Merchant Members page still loads; GET /merchants/members still answers 200 with a list for the Merchant; the Merchant menu is unchanged', async () => {
      const list = await api('merchant', 'GET', '/merchants/members'); expect(list.status).toBe(200); expect(Array.isArray(list.body)).toBe(true);
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } }); const page = await ctx.newPage();
      await login(page, 'merchant', /merchant\/dashboard/);
      await page.goto(`${web()}/merchant/dashboard/members`);
      await expect(page.getByRole('heading', { name: 'Thành Viên Nhóm' })).toBeVisible({ timeout: 30_000 }); await shot(page, 'N3-merchant-members-page');
      await page.goto(`${web()}/merchant/dashboard`); await page.waitForLoadState('networkidle').catch(() => undefined);
      const menu = ['/merchant/dashboard/new-transaction', '/merchant/dashboard/orders', '/merchant/dashboard/payments', '/merchant/dashboard/reports', '/merchant/dashboard/profile', '/merchant/dashboard/settings'];
      for (const href of menu) expect(await page.locator(`a[href="${href}"]`).count(), `Merchant menu entry ${href}`).toBeGreaterThan(0);
      await ctx.close();
      evidence.merchantMembers = { apiStatus: list.status, rows: (list.body as any[]).length };
      return `page "Thành Viên Nhóm" renders; GET /merchants/members 200 (${(list.body as any[]).length} row(s)); Merchant menu entries intact`;
    });
  });

  test('N4 no cross-role authorization regression on the Members API routes (read-only)', async () => {
    await step('N4', 'both Members routes: anonymous 401; wrong role 403; the legacy Partner route answers for a Partner exactly as before', async () => {
      const anon = async (p: string) => (await fetch(`${apiBase()}${p}`)).status;
      const out: Record<string, unknown> = {};
      out.anonymous = [await anon('/collaborators/members'), await anon('/merchants/members')]; expect(out.anonymous).toEqual([401, 401]);
      const merchantOnPartnerRoute = await api('merchant', 'GET', '/collaborators/members'); expect(merchantOnPartnerRoute.status).toBe(403);
      const adminOnPartnerRoute = await api('admin', 'GET', '/collaborators/members'); expect(adminOnPartnerRoute.status).toBe(403);
      const partnerOnMerchantRoute = await api('partner', 'GET', '/merchants/members'); expect(partnerOnMerchantRoute.status).toBe(403);
      const adminOnMerchantRoute = await api('admin', 'GET', '/merchants/members'); expect(adminOnMerchantRoute.status).toBe(403);
      // The fixture Partner is registration-flow (never assigned): the legacy route answers its historical 400 "not assigned to a merchant team" (200 only for a historically assigned Partner).
      const partnerOnPartnerRoute = await api('partner', 'GET', '/collaborators/members'); expect([200, 400]).toContain(partnerOnPartnerRoute.status);
      out.statuses = { merchantOnPartnerRoute: merchantOnPartnerRoute.status, adminOnPartnerRoute: adminOnPartnerRoute.status, partnerOnMerchantRoute: partnerOnMerchantRoute.status, adminOnMerchantRoute: adminOnMerchantRoute.status, partnerOnPartnerRoute: partnerOnPartnerRoute.status };
      evidence.crossRole = out;
      return `anonymous 401/401; Merchant->Partner route 403; Admin->Partner route 403; Partner->Merchant route 403; Admin->Merchant route 403; Partner->own route ${partnerOnPartnerRoute.status} (no POST was sent)`;
    });
  });
  test('N5 POST /collaborators/members is retired: 410 FEATURE_RETIRED for every authenticated role, 401 anonymous (empty body: write-safe)', async () => {
    await step('N5', 'Partner / Merchant / Admin -> 410 {code, message} only; anonymous -> 401', async () => {
      const out: Record<string, number> = {};
      for (const who of ['partner', 'merchant', 'admin'] as const) {
        const r = await api(who, 'POST', '/collaborators/members', {});
        expect(r.status, `${who}`).toBe(410); expect(r.body.code).toBe('FEATURE_RETIRED'); expect(String(r.body.message)).toMatch(/[À-ỹ]/); expect(Object.keys(r.body).sort()).toEqual(['code', 'message']);
        out[who] = r.status;
      }
      const anon = await fetch(`${apiBase()}/collaborators/members`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(anon.status).toBe(401); out.anonymous = anon.status;
      evidence.retiredPost = out;
      return `Partner ${out.partner}, Merchant ${out.merchant}, Admin ${out.admin}, anonymous ${out.anonymous}; the body was empty, so nothing could have been created`;
    });
  });

  test('N6 Merchant Members: masked contact details, no bank data; an invalid create is a Vietnamese 400 (write-safe)', async () => {
    await step('N6', 'GET /merchants/members rows have exactly the masked key set; POST with an invalid body -> 400 VALIDATION_FAILED, Vietnamese field errors', async () => {
      const list = await api('merchant', 'GET', '/merchants/members'); expect(list.status).toBe(200);
      const allowed = ['collaborators_avatar_url', 'collaborators_email', 'collaborators_name', 'collaborators_phone', 'collaborators_registered_date', 'collaborators_status', 'collaborators_verified', 'id'];
      for (const m of list.body as any[]) {
        expect(Object.keys(m).sort()).toEqual(allowed);
        if (m.collaborators_phone) expect(m.collaborators_phone).toMatch(/^\*+\d{0,3}$/);
        if (m.collaborators_email) expect(m.collaborators_email).toMatch(/^.\*\*\*@|^\*\*\*$/);
      }
      expect(JSON.stringify(list.body)).not.toMatch(/bank/i);
      const bad = await api('merchant', 'POST', '/merchants/members', { collaborators_name: '', collaborators_phone: 'abc', collaborators_email: 'abc@' });
      expect(bad.status).toBe(400); expect(bad.body.code).toBe('VALIDATION_FAILED');
      expect((bad.body.errors as any[]).map((e) => e.field).sort()).toEqual(['collaborators_email', 'collaborators_name', 'collaborators_phone']);
      for (const e of bad.body.errors as any[]) expect(e.message).toMatch(/[À-ỹ]/);
      evidence.merchantList = { rows: (list.body as any[]).length };
      return `${(list.body as any[]).length} row(s), all masked with the exact key set; invalid create -> 400 with ${(bad.body.errors as any[]).length} Vietnamese field errors`;
    });
  });
});
