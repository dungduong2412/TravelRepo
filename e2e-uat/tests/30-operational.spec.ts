import { test, expect, Page } from '@playwright/test';
import { api, hasCreds, useIdentity } from '../lib/api';
import { Cred, config, creds, MERCHANT_TO_CORRECT, RUN_ID } from '../lib/env';
import { record } from '../lib/evidence';
import { approvedImages, Fixture, readFixture } from '../lib/fixture';
import { eq4, mul } from '../lib/money';
import { randomUUID } from 'node:crypto';

// REUSABLE OPERATIONAL TESTS. They never create or claim identities: they run on the fixture saved by a successful
// first-time onboarding run (same-run Merchant + Partner pair) and verify that pairing before doing anything.
const items = (b: any): any[] => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
let fx: Fixture | null = null; let reason = ''; let rates = { d: '', c: '' };
async function uiLogin(page: Page, c: Cred, landing: RegExp) {
  await page.goto('/login'); await page.getByPlaceholder('email@example.com').fill(c.email);
  await page.locator('input[type="password"]').fill(c.password); await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(landing, { timeout: 30_000 });
}
const step = async (id: string, title: string, fn: () => Promise<void>) => { try { await fn(); record(id, title, 'PASS'); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; } };

test.describe.serial('Operational (reusable): governed rate change, QR → transaction → commission → reports', () => {
  test.beforeAll(async () => {
    if (!hasCreds('admin')) { reason = 'BLOCKED: admin credentials missing'; return; }
    fx = readFixture();
    if (!fx) { reason = 'SKIP: no paired fixture — run a first-time onboarding with a fresh identity pair first'; return; }
    useIdentity('merchant', fx.merchant); useIdentity('partner', fx.partner);
    // Pairing proof: both identities are bound to records of the same onboarding run, and the app agrees they are paired.
    const m = (await api('merchant', 'GET', '/user-profiles/me')).body; const p = (await api('partner', 'GET', '/user-profiles/me')).body;
    const rec = (await api('admin', 'GET', `/merchants/${fx.merchantId}`)).body;
    const resolvedPartner = (await api('merchant', 'POST', '/qr/resolve', { payload: fx.partnerCode })).body?.collaborator_id;   // global Partner network: the pairing proof is identity, not an assignment
    const ok = m?.merchant_id === fx.merchantId && p?.collaborator_id === fx.partnerId && m?.user_profiles_status === 'active' && p?.user_profiles_status === 'active' && resolvedPartner === fx.partnerId && String(rec?.merchant_name).endsWith(fx.run);
    if (!ok) { reason = `BLOCKED: fixture from run ${fx.run} is no longer a valid paired set (resolved=${resolvedPartner}); refusing to substitute other identities`; fx = null; return; }
    rates = { d: String(rec.merchant_discount_value), c: String(rec.merchant_commission_value) };
  });

  test('P01 Governed rate correction of the synthetic D5 merchant (admin-only, idempotent)', async ({ page }) => {
    test.skip(!hasCreds('admin'), 'BLOCKED: admin credentials missing');
    await step('P01', 'UAT-M-D5-20261016-A4722D holds 0.0500 / 0.1000 via the Admin UI; merchant.updated audited', async () => {
      await uiLogin(page, creds('admin')!, /\/admin\/dashboard/);
      const cur = (await api('admin', 'GET', `/merchants/${MERCHANT_TO_CORRECT.id}`)).body;
      if (!(eq4(cur.merchant_discount_value, '0.0500') && eq4(cur.merchant_commission_value, '0.1000'))) {
        await page.goto('/admin/merchants'); await page.getByPlaceholder('Name, original code, email or phone').fill(MERCHANT_TO_CORRECT.code);
        await page.getByRole('button', { name: 'Details' }).first().click(); await page.getByRole('button', { name: 'Edit merchant' }).click();
        await page.getByLabel('Commission type').selectOption('percentage'); await page.getByLabel(/^Commission percentage points/).fill('10');
        await page.getByLabel('Discount type').selectOption('percentage'); await page.getByLabel(/^Discount percentage points/).fill('5');
        await page.getByLabel('Admin action note').fill(`UAT E2E ${RUN_ID} governed rate correction`).catch(() => undefined);
        await page.getByRole('button', { name: 'Save governed changes' }).click();
        await expect.poll(async () => eq4((await api('admin', 'GET', `/merchants/${MERCHANT_TO_CORRECT.id}`)).body.merchant_discount_value, '0.0500'), { timeout: 20_000 }).toBe(true);
      }
      const m = (await api('admin', 'GET', `/merchants/${MERCHANT_TO_CORRECT.id}`)).body;
      expect(eq4(m.merchant_discount_value, '0.0500') && eq4(m.merchant_commission_value, '0.1000'), `stored ${m.merchant_discount_value}/${m.merchant_commission_value}`).toBe(true);
      // Query the specific event instead of scanning "the latest N": the API caps that window at 250 rows, which a busy test environment outgrows.
      const k = process.env.SUPABASE_SERVICE_ROLE_KEY!; process.env.E2E_ADMIN_SERVICE_TOKEN = k;
      const r = await fetch(`${config().supabase}/rest/v1/audit_events?select=id&action=eq.merchant.updated&entity_id=eq.${MERCHANT_TO_CORRECT.id}&limit=1`, { headers: { apikey: k, Authorization: `Bearer ${k}` } });
      expect(((await r.json()) as unknown[]).length, 'merchant.updated audit').toBeGreaterThan(0);
    });
  });

  test.describe('on the paired fixture', () => {
    test.beforeEach(() => { test.skip(!fx, reason); });

    test('P02 Approved images persist with identical bytes', async () => {
      await step('P02', 'merchant and partner approved image bytes still equal the originally uploaded bytes', async () => {
        expect((await approvedImages('merchant', fx!.merchantId)).items.map((i) => i.sha)).toEqual([fx!.merchantImageSha]);
        if (fx!.partnerImageSha) expect((await approvedImages('collaborator', fx!.partnerId)).items.map((i) => i.sha)).toEqual([fx!.partnerImageSha]);
      });
    });

    test('P03 Partner QR page → Merchant scan → real transaction with exact amounts', async ({ browser }) => {
      await step('P03', 'QR shown to partner; merchant manual entry -> identity + discount -> payment -> receipt; exact 4-decimal discount and commission', async () => {
        const gross = `${1000 + (Date.now() % 9000)}.${String(Date.now() % 10000).padStart(4, '0')}`;
        const pctx = await browser.newContext(); const ppg = await pctx.newPage(); await uiLogin(ppg, fx!.partner, /collaborator\/dashboard/);
        await ppg.goto('/collaborator/dashboard/qr-code'); await expect(ppg.locator('img').first()).toBeVisible({ timeout: 20_000 });
        await expect(ppg.getByText(fx!.partnerCode).first()).toBeVisible(); await pctx.close();
        const mctx = await browser.newContext(); const m = await mctx.newPage(); await uiLogin(m, fx!.merchant, /merchant\/dashboard/);
        // scan page: manual entry -> Partner identity + discount -> continue -> amount -> confirm -> receipt (see 99-merchant-qr-scan.spec.ts for the full journey)
        await m.goto('/merchant/dashboard/new-transaction');
        await m.getByRole('tab', { name: /Nhập mã/ }).click();
        await m.getByTestId('manual-code').fill(fx!.partnerCode); await m.getByRole('button', { name: /Xem Đối tác và ưu đãi/ }).click();
        await expect(m.getByTestId('partner-code')).toHaveText(fx!.partnerCode, { timeout: 20_000 });
        await m.getByTestId('continue-payment').click();
        await m.getByTestId('gross-input').fill(gross);
        await expect(m.getByTestId('pay-final')).toBeVisible({ timeout: 20_000 });
        await m.getByTestId('confirm-payment').click();
        await expect(m.getByTestId('receipt')).toBeVisible({ timeout: 30_000 }); await mctx.close();
        const rep = items((await api('admin', 'GET', `/transactions/report?record_kind=real_transaction&merchant_id=${fx!.merchantId}&page_size=100`)).body).filter((t) => eq4(t.document_total, gross));
        expect(rep.length, 'exactly one transaction for this gross').toBe(1);
        expect(eq4(rep[0].document_discount_amount, mul(gross, rates.d)), `discount ${rep[0].document_discount_amount} vs ${mul(gross, rates.d)}`).toBe(true);
        expect(eq4(rep[0].commission_amount, mul(gross, rates.c)), `commission ${rep[0].commission_amount} vs ${mul(gross, rates.c)}`).toBe(true);
        expect(rep[0].payment_status ?? '').not.toMatch(/paid|settled/i);
        expect(rep[0].lifecycle_status).toBe('confirmed');
        // Governed clean-up of this test's own transaction (Admin reversal, audited) so the fixture Partner's confirmed earnings are not inflated by every run.
        expect((await api('admin', 'POST', `/transactions/${rep[0].id}/reverse`, { idempotency_key: randomUUID() })).status).toBeLessThan(300);
      });
    });

    test('P04 Three-role reconciliation and idempotent replay', async () => {
      await step('P04', 'admin = merchant = partner totals; replayed key returns the same transaction and adds nothing', async () => {
        const key = randomUUID(); const body = { collaborator_code: fx!.partnerCode, gross_amount: '100.0001', idempotency_key: key };
        const a = await api('merchant', 'POST', '/transactions/simulation', body);
        expect(a.status, JSON.stringify(a.body).slice(0, 120)).toBeLessThan(300);
        const sum = async (r: 'admin' | 'merchant' | 'partner', p: string) => (await api(r, 'GET', p)).body?.summary;
        const q = (r: 'admin' | 'merchant' | 'partner') => sum(r, r === 'admin' ? `/transactions/report?record_kind=uat_simulation&merchant_id=${fx!.merchantId}` : '/transactions/me/report?record_kind=uat_simulation');
        const before = { adm: await q('admin'), mer: await q('merchant'), par: await q('partner') };
        // A Partner sees what it earns, never the Merchant's customer discount: its summary has no discount total at all.
        expect('document_discount_amount' in before.par, 'partner summary carries no discount').toBe(false);
        for (const k of ['transaction_count', 'document_total', 'document_discount_amount', 'commission_amount']) { expect(String(before.mer[k]), `merchant ${k}`).toBe(String(before.adm[k])); if (k !== 'document_discount_amount') expect(String(before.par[k]), `partner ${k}`).toBe(String(before.adm[k])); }
        const b = await api('merchant', 'POST', '/transactions/simulation', body);
        expect(b.body.transaction_id).toBe(a.body.transaction_id); expect(b.body.idempotent_replay).toBe(true); expect(b.body.external_settlement_enabled).toBe(false);
        const after = await q('admin');
        expect(String(after.transaction_count)).toBe(String(before.adm.transaction_count)); expect(String(after.commission_amount)).toBe(String(before.adm.commission_amount));
      });
    });
  });
});
