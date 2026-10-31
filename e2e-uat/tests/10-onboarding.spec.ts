import { test, expect, Page, BrowserContext } from '@playwright/test';
import { api, hasCreds, probeIdentity, useIdentity } from '../lib/api';
import { Cred, creds, markConsumed, poolFor, RUN_ID } from '../lib/env';
import { record } from '../lib/evidence';
import { approvedImages, sha256, writeFixture } from '../lib/fixture';
import { makePng } from '../lib/images';

// FIRST-TIME ONBOARDING (consumes identities). Runs only with a verified, still-unclaimed Merchant AND Partner identity.
// If the pool has none, every test here is SKIPPED: claimed identities are never reused to imitate a fresh claim.
const M_NAME = `UAT-E2E-M-${RUN_ID}`; const P_NAME = `UAT-E2E-P-${RUN_ID}`;
const items = (b: any): any[] => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
let pair: { merchant: Cred; partner: Cred } | null = null; let skipReason = '';
let merchantId = ''; let partnerId = ''; let partnerCode = ''; let adminCtx: BrowserContext; let admin: Page;
let merchantSha = ''; let partnerSha = '';
const mPng = () => makePng(`m${RUN_ID}`); const pPng = () => makePng(`p${RUN_ID}`, 256, 256);

async function uiLogin(page: Page, c: Cred, landing: RegExp) {
  await page.goto('/login'); await page.getByPlaceholder('email@example.com').fill(c.email);
  await page.locator('input[type="password"]').fill(c.password); await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(landing, { timeout: 30_000 });
}
const step = async (id: string, title: string, fn: () => Promise<void>) => { try { await fn(); record(id, title, 'PASS'); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; } };

test.describe.serial('Onboarding (first-time): Admin creates → invitation → claim → approval → owner profile', () => {
  test.beforeAll(async ({ browser }) => {
    if (!hasCreds('admin')) { skipReason = 'BLOCKED: admin credentials missing'; return; }
    const pick = async (role: 'merchant' | 'partner') => { const base = creds(role); for (const c of [...poolFor(role), ...(base ? [base] : [])]) if (await probeIdentity(c) === 'unclaimed') return c; return null; };
    const m = await pick('merchant'); const p = await pick('partner');
    if (!m || !p) { skipReason = `SKIP: no unclaimed ${!m ? 'Merchant' : ''}${!m && !p ? ' and ' : ''}${!p ? 'Partner' : ''} identity in the pool — supply a fresh pair (README)`; record('O00', 'fresh identity pair available', 'SKIP', skipReason); return; }
    pair = { merchant: m, partner: p }; useIdentity('merchant', m); useIdentity('partner', p);
    record('O00', 'fresh identity pair available (unclaimed Merchant + Partner)', 'PASS');
    adminCtx = await browser.newContext(); admin = await adminCtx.newPage();
  });
  test.beforeEach(() => { test.skip(!pair, skipReason); });
  test.afterAll(async () => { await adminCtx?.close(); });

  test('O01 Admin logs in through the UI and is a real application Admin', async () => {
    await step('O01', 'admin UI login', async () => { await uiLogin(admin, creds('admin')!, /\/admin\/dashboard/); expect((await api('admin', 'GET', '/audit-events?limit=1')).status).toBe(200); });
  });

  test('O02 Admin creates the Merchant with a full profile and publishes an image', async () => {
    await step('O02', 'merchant created; approved image bytes match upload and persist after reload', async () => {
      await admin.goto('/admin/merchants'); await admin.getByRole('button', { name: /Create|New/i }).first().click();
      const f = (l: string, v: string) => admin.getByLabel(l, { exact: true }).first().fill(v);
      await f('Merchant name', M_NAME); await f('Owner name', 'UAT E2E Merchant Owner'); await f('Owner email', pair!.merchant.email);
      await f('Business email', pair!.merchant.email); await f('Business phone', '0900000001'); await f('Province', 'Da Nang'); await f('Street address', '1 Synthetic Street');
      await admin.getByLabel('Commission type').first().selectOption('percentage'); await admin.getByLabel(/^Commission % points/).fill('10');
      await admin.getByLabel('Discount type').first().selectOption('percentage'); await admin.getByLabel(/^Discount % points/).fill('5');
      await admin.getByRole('button', { name: 'Create pending merchant' }).click();
      await expect.poll(async () => items((await api('admin', 'GET', `/merchants/admin-directory?search=${M_NAME}&page_size=5`)).body).length).toBeGreaterThan(0);
      merchantId = items((await api('admin', 'GET', `/merchants/admin-directory?search=${M_NAME}&page_size=5`)).body).find((m) => m.merchant_name === M_NAME).merchant_system_id;
      const stored = (await api('admin', 'GET', `/merchants/${merchantId}`)).body;
      expect(String(stored.owner_email).toLowerCase()).toBe(pair!.merchant.email.toLowerCase());

      await admin.goto('/admin/merchants'); await admin.getByPlaceholder('Name, original code, email or phone').fill(M_NAME);
      await admin.getByRole('button', { name: 'Details' }).first().click();
      await admin.locator('input[type="file"]').first().setInputFiles({ name: `e2e-${RUN_ID}.png`, mimeType: 'image/png', buffer: mPng() });
      await expect(admin.getByText(/Uploading/)).toHaveCount(0, { timeout: 30_000 });
      merchantSha = sha256(mPng());
      for (const phase of ['after upload', 'after reload']) {
        if (phase === 'after reload') await admin.reload();
        const got = await approvedImages('merchant', merchantId);
        expect(got.items.length, `approved image count ${phase}`).toBe(1);
        expect(got.items[0].type, 'content type').toMatch(/image\/png/);
        expect(got.items[0].sha, `served bytes equal uploaded bytes ${phase}`).toBe(merchantSha);
      }
    });
  });

  test('O03 Admin creates the Partner assigned to that Merchant, with an avatar', async () => {
    await step('O03', 'partner created with merchant assignment; avatar bytes match upload', async () => {
      await admin.goto('/admin/collaborators'); await admin.getByRole('button', { name: /Create|New/i }).first().click();
      await admin.getByLabel('Name', { exact: true }).fill(P_NAME); await admin.getByLabel('Email', { exact: true }).fill(pair!.partner.email);
      await admin.getByLabel('Phone', { exact: true }).fill('0900000002'); await admin.getByLabel('Merchant system ID (UUID)').fill(merchantId);
      await admin.getByRole('button', { name: 'Create pending partner' }).click();
      const find = async () => items((await api('admin', 'GET', '/collaborators')).body).find((p) => p.collaborators_name === P_NAME);
      await expect.poll(async () => !!(await find())).toBe(true);
      const p = await find(); partnerId = p.id; partnerCode = p.collaborators_code;
      await admin.goto('/admin/collaborators'); await admin.getByPlaceholder('Name, code, email or phone').fill(P_NAME);
      await admin.getByRole('button', { name: 'View details' }).first().click();
      await admin.locator('input[type="file"]').first().setInputFiles({ name: `avatar-${RUN_ID}.png`, mimeType: 'image/png', buffer: pPng() });
      await expect(admin.getByText(/Uploading/)).toHaveCount(0, { timeout: 30_000 });
      partnerSha = sha256(pPng());
      const got = await approvedImages('collaborator', partnerId);
      expect(got.items.length, 'approved avatar count').toBe(1); expect(got.items[0].sha, 'avatar bytes equal upload').toBe(partnerSha);
    });
  });

  test('O04 R08: approving before the owner claims is a controlled 409 with no state change', async () => {
    await step('O04', 'unclaimed approval → 409 OWNER_NOT_CLAIMED; status, profiles and audit unchanged', async () => {
      const audit = async () => items((await api('admin', 'GET', '/audit-events?limit=500')).body).filter((a) => /approved/.test(a.action ?? '') && JSON.stringify(a).includes(merchantId)).length;
      const before = await audit();
      const r = await api('admin', 'POST', `/merchants/${merchantId}/approve`, {});
      expect(r.status, JSON.stringify(r.body).slice(0, 150)).toBe(409); expect(r.body?.code).toBe('OWNER_NOT_CLAIMED');
      const after = (await api('admin', 'GET', `/merchants/${merchantId}`)).body;
      expect(after.merchants_status, 'status unchanged').toBe('pending'); expect(after.merchant_verified, 'not verified').toBeFalsy();
      expect(await audit(), 'no merchant.approved audit').toBe(before);
      const pr = await api('admin', 'POST', `/collaborators/${partnerId}/approve`, {});
      expect(pr.status).toBe(409); expect(pr.body?.code).toBe('OWNER_NOT_CLAIMED');
      expect(items((await api('admin', 'GET', '/collaborators')).body).find((x) => x.id === partnerId).collaborators_status).toBe('pending');
    });
  });

  for (const [id, who, entity] of [['O05', 'merchant', 'merchant'], ['O06', 'partner', 'collaborator']] as const) {
    test(`${id} ${who} claims through the Admin-displayed link (first-time; replay is a failure here)`, async ({ browser }) => {
      await step(id, `${who} verified identity claims its own record → pending profile`, async () => {
        const c = pair![who]; const entityId = who === 'merchant' ? merchantId : partnerId;
        expect((await api(who, 'GET', '/user-profiles/me')).body?.role, 'identity must be unclaimed').toBeFalsy();
        const inv = await api('admin', 'POST', '/invitations', { entity_type: entity, entity_id: entityId }); expect(inv.status).toBeLessThan(300);
        process.env[`E2E_CLAIM_${id}`] = String(inv.body?.invite_link ?? '');
        const ctx = await browser.newContext(); const pg = await ctx.newPage();
        await pg.goto(String(inv.body.invite_link)); await pg.waitForURL(/\/claim\//, { timeout: 45_000 });
        await expect(pg.getByText(/bound to this|review and approve/i).first()).toBeVisible({ timeout: 30_000 }); await ctx.close();
        const me = (await api(who, 'GET', '/user-profiles/me')).body;
        expect(me.user_profiles_status).toBe('pending'); expect(me.email.toLowerCase()).toBe(c.email.toLowerCase());
        expect(who === 'merchant' ? me.merchant_id : me.collaborator_id, 'bound to the record of THIS run').toBe(entityId);
        markConsumed(c.email);
        const dup = items((await api('admin', 'GET', '/user-profiles')).body).filter((u: any) => (u.email ?? '').toLowerCase() === c.email.toLowerCase());
        expect(dup.length, 'exactly one profile per identity').toBe(1);
        const replay = await api(who, 'POST', `/invitations/claim/${entity}/${entityId}`); expect(replay.status, 'replay refused').toBeGreaterThanOrEqual(400);
      });
    });
  }

  test('O07 Admin approves both accounts', async () => {
    await step('O07', 'approval → both owners active', async () => {
      for (const path of [`/merchants/${merchantId}/approve`, `/collaborators/${partnerId}/approve`]) { const r = await api('admin', 'POST', path, {}); expect([200, 201], `${path} ${r.status}`).toContain(r.status); }
      for (const who of ['merchant', 'partner'] as const) expect((await api(who, 'GET', '/user-profiles/me')).body?.user_profiles_status).toBe('active');
    });
  });

  test('O08 Owners log in; profile shows THEIR approved image (identity, visibility, persistence)', async ({ browser }) => {
    await step('O08', 'owner logins; displayed image bytes equal the uploaded image after reload', async () => {
      for (const [who, landing, prof, owner, id, sha] of [['merchant', /merchant\/dashboard/, '/merchant/dashboard/profile', 'merchant', merchantId, merchantSha], ['partner', /collaborator\/dashboard/, '/collaborator/dashboard/profile', 'collaborator', partnerId, partnerSha]] as const) {
        const ctx = await browser.newContext(); const pg = await ctx.newPage(); await uiLogin(pg, pair![who], landing);
        const served = new Set<string>(); pg.on('response', async (r) => { if (r.request().resourceType() === 'image' && r.ok()) { try { served.add(sha256(await r.body())); } catch { /* ignore */ } } });
        for (const phase of ['first load', 'after reload']) {
          served.clear(); await (phase === 'first load' ? pg.goto(prof) : pg.reload()); await pg.waitForLoadState('networkidle');
          const shown = await pg.locator('img').evaluateAll((els) => (els as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).map((i) => i.currentSrc || i.src));
          expect(shown.length, `${who} ${phase}: a rendered image`).toBeGreaterThan(0);
          expect([...served].includes(sha), `${who} ${phase}: rendered image bytes equal the approved upload`).toBe(true);
        }
        const feed = await approvedImages(owner, id); expect(feed.items.map((i) => i.sha)).toEqual([sha]);
        await ctx.close();
      }
    });
  });

  test('O09 Pairing verified; fixture saved for operational tests', async () => {
    await step('O09', 'merchant scan resolves partner as assigned_to_this_merchant; fixture saved', async () => {
      const assoc = (await api('merchant', 'POST', '/qr/resolve', { payload: partnerCode })).body;
      expect(assoc.association).toBe('assigned_to_this_merchant'); expect(assoc.collaborator_id).toBe(partnerId);
      writeFixture({ run: RUN_ID, merchantId, partnerId, partnerCode, merchant: pair!.merchant, partner: pair!.partner, merchantImageSha: merchantSha, partnerImageSha: partnerSha });
    });
  });
});
