import { test, expect, chromium, webkit, devices, Page, BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { api, hasCreds, useIdentity } from '../lib/api';
import { config, EVIDENCE_DIR, RUN_ID } from '../lib/env';
import { record } from '../lib/evidence';
import { readFixture, Fixture } from '../lib/fixture';
import { mul, eq4, fmt, toUnits } from '../lib/money';
import { fakeCameraArgs, hasFfmpeg, IPHONE_ZALO_UA, LONGTASK_PROBE, makeFeed, makePhoto, writeQrPng } from '../lib/qr-media';
import { formatRate, formatVnd } from '../../frontend/lib/qr/money';

// MERCHANT QR SCAN -> PARTNER IDENTITY + DISCOUNT (inquiry only) -> PAYMENT -> RECEIPT, on the paired Merchant/Partner fixture.
//   Camera scenarios use Chromium's fake camera fed with phone-screen-like video built from the Partner's REAL QR image; the Zalo / iPhone scenarios use the in-app
//   user agent and a WebKit engine. A physical iPhone inside Zalo cannot be driven from here: that last check is reported separately and is NOT claimed by this spec.
// Run through `railway run --service vno-api` (service key for the audit/ledger reads); before a deploy also with E2E_TARGET=candidate.
const step = async (id: string, title: string, fn: () => Promise<string | void>) => {
  try { const detail = await fn(); record(id, title, 'PASS', detail || ''); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; }
};
async function rest(path: string) {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY!; process.env.E2E_ADMIN_SERVICE_TOKEN = k;
  const r = await fetch(`${config().supabase}/rest/v1/${path}`, { headers: { apikey: k, Authorization: `Bearer ${k}` } });
  if (!r.ok) throw new Error(`REST ${path.split('?')[0]} HTTP ${r.status}`); return r.json() as Promise<any[]>;
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${EVIDENCE_DIR}/screens/${name}.png` }).catch(() => undefined);
const evidence: Record<string, unknown> = { run: RUN_ID };

const PENDING_PARTNER = 'COL-05C60E056C3D4B5B';          // E2E leftover from 2026-10-31: pending, unverified (a code that exists but is not active)
const UNKNOWN_CODE = 'COL-0000000000000000';

test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY || !hasCreds('admin') || !readFixture(), 'BLOCKED: run via `railway run --service vno-api` with admin credentials and the paired fixture');

test.describe.serial('Merchant QR scan, discount inquiry and payment', () => {
  const web = () => config().web; const apiBase = () => config().api;
  let fx: Fixture; let rates = { d: '0.0500', c: '0.1000' };
  let qrPng = ''; let partnerName = ''; let avatarUrl: string | null = null;
  let baselineTotal = 0;
  const media: Record<string, string> = {};
  const merchantTotal = async (kind?: string) => Number((await api('admin', 'GET', `/transactions/report?merchant_id=${fx.merchantId}&page_size=1${kind ? `&record_kind=${kind}` : ''}`)).body.total);
  const ledgerRows = (gross: string) => rest(`referral_transactions?select=id,document_total,document_discount_amount,document_discount_percent,commission_amount,commission_percent,lifecycle_status,payment_status&merchant_id=eq.${fx.merchantId}&record_kind=eq.real_transaction&document_total=eq.${gross}`);
  const merchantLogin = async (page: Page) => {
    await page.goto(`${web()}/login`); await page.getByPlaceholder('email@example.com').fill(fx.merchant.email); await page.locator('input[type="password"]').fill(fx.merchant.password);
    await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(/merchant\/dashboard/, { timeout: 30_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);   // let the dashboard finish its own data load: leaving mid-load makes the shell redirect to /login
  };
  const openScan = async (page: Page) => { await page.goto(`${web()}/merchant/dashboard/new-transaction`); await expect(page.getByTestId('qr-scanner')).toBeVisible({ timeout: 20_000 }); };
  const expectPartner = async (page: Page, timeout = 20_000) => {
    const result = page.getByTestId('partner-result'); await expect(result).toBeVisible({ timeout });
    await expect(result.getByTestId('partner-code')).toHaveText(fx.partnerCode); await expect(result.getByTestId('partner-name')).toHaveText(partnerName);
    await expect(result.getByTestId('partner-verified')).toContainText('Đã xác minh'); return result;
  };
  const stats = async (page: Page) => { const t: number[] = (await page.evaluate(() => (window as any).__lt)) || []; return { n: t.length, max: Math.max(0, ...t), total: t.reduce((a, x) => a + x, 0) }; };

  test.beforeAll(async () => {
    fx = readFixture()!; useIdentity('merchant', fx.merchant); useIdentity('partner', fx.partner);
    const m = (await api('admin', 'GET', `/merchants/${fx.merchantId}`)).body; rates = { d: fmt(toUnits(String(m.merchant_discount_value))), c: fmt(toUnits(String(m.merchant_commission_value))) };
    const q = (await api('partner', 'GET', '/collaborators/me/qr-code')).body; partnerName = q.collaborator_name; avatarUrl = q.avatar_url ?? null;
    fs.mkdirSync(`${EVIDENCE_DIR}/screens`, { recursive: true }); fs.mkdirSync(`${EVIDENCE_DIR}/qr-media`, { recursive: true });
    qrPng = `${EVIDENCE_DIR}/qr-media/partner-qr.png`; fs.writeFileSync(qrPng, Buffer.from(String(q.qr_code_image).split(',')[1], 'base64'));
    evidence.fixture = { merchantId: fx.merchantId, partnerCode: fx.partnerCode, rates, qrPayload: q.qr_payload };
    baselineTotal = await merchantTotal();
    if (hasFfmpeg) {
      media.cleanFeed = makeFeed(qrPng, 'feed-clean', { s: 360 });
      media.blankFeed = makeFeed(qrPng, 'feed-blank', { s: 2 });
      media.screenFeed = makeFeed(qrPng, 'feed-phone-screen', { s: 200, blur: 1, noise: 22, rot: 8 });
      media.cleanShot = makePhoto(qrPng, 'screenshot-clean.png', { W: 1170, H: 2532, s: 800, bg: '0xffffff' });
      media.noisyPhoto = makePhoto(qrPng, 'photo-noisy-12mp.jpg', { s: 600, rot: 8, persp: 120, noise: 22 });
      media.legacyQr = await writeQrPng(String(q.qr_payload), 'qr-legacy-h1.png', { margin: 1, ec: 'H' });
      media.otherQr = await writeQrPng('https://example.com/pay?id=123', 'qr-not-vno.png');
      media.unknownQr = await writeQrPng(`${web()}/c/${UNKNOWN_CODE}`, 'qr-unknown-code.png');
      media.pendingQr = await writeQrPng(`${web()}/c/${PENDING_PARTNER}`, 'qr-pending-partner.png');
    }
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  test('Q1 resolve: Partner name, avatar, code, status and the discount from the Merchant\'s own active policy', async () => {
    await step('Q1', 'POST /qr/resolve -> partner{name,avatar,code,verified,status} + discount from the Merchant policy; nothing about commission', async () => {
      const url = `${apiBase()}/c/${fx.partnerCode}`; void url;
      const r = await api('merchant', 'POST', '/qr/resolve', { payload: `${web()}/c/${fx.partnerCode}` });
      expect(r.status).toBe(201);
      const b = r.body; expect(b.partner).toMatchObject({ code: fx.partnerCode, name: partnerName, verified: true, status: 'active' });
      expect(b.association).toBe('assigned_to_this_merchant'); expect(b.financial_action_created).toBe(false);
      expect(b.discount).toMatchObject({ available: true, kind: 'percentage' }); expect(eq4(b.discount.rate, rates.d)).toBe(true);
      expect(b.discount.label).toBe(`Giảm ${formatRate(rates.d).replace('%', '')}%`);
      if (b.partner.avatar_url) expect(b.partner.avatar_url).toMatch(/^https:\/\//);
      expect(JSON.stringify(b).toLowerCase()).not.toMatch(/commission|collaborators_phone|collaborators_email|bank/);
      evidence.resolve = { status: r.status, discount: b.discount, avatar: Boolean(b.partner.avatar_url) };
      return `HTTP ${r.status}; ${b.partner.name} ${b.partner.code}; discount ${b.discount.label} (rate ${b.discount.rate}); avatar=${Boolean(b.partner.avatar_url)}; keys: ${Object.keys(b).join(',')}`;
    });
  });

  test('Q2 resolve errors are actionable, in Vietnamese, with stable codes', async () => {
    await step('Q2', 'unsupported / unknown / inactive / empty -> 400 QR_UNSUPPORTED, 404 PARTNER_NOT_FOUND, 409 PARTNER_NOT_ACTIVE; case + invisible characters tolerated', async () => {
      const cases: Array<[string, string, number, string]> = [
        ['not a VNO QR', 'https://example.com/pay?id=123', 400, 'QR_UNSUPPORTED'], ['plain text', 'hello world', 400, 'QR_UNSUPPORTED'], ['unknown code', UNKNOWN_CODE, 404, 'PARTNER_NOT_FOUND'],
        ['inactive partner', PENDING_PARTNER, 409, 'PARTNER_NOT_ACTIVE'],
      ];
      const seen: string[] = [];
      for (const [label, payload, status, code] of cases) {
        const r = await api('merchant', 'POST', '/qr/resolve', { payload }); expect(r.status, label).toBe(status); expect(r.body.code, label).toBe(code);
        expect(String(r.body.message), label).toMatch(/[À-ỹ]/); seen.push(`${label}:${r.status}/${r.body.code}`);
      }
      for (const [label, payload] of [['lower-case', fx.partnerCode.toLowerCase()], ['zero-width char', `${fx.partnerCode}​`], ['URL without scheme', `${new URL(web()).host}/c/${fx.partnerCode}`], ['padded', `  ${fx.partnerCode}\n`]] as const) {
        const r = await api('merchant', 'POST', '/qr/resolve', { payload }); expect(r.status, label).toBe(201); expect(r.body.partner.code, label).toBe(fx.partnerCode);
      }
      return seen.join('; ');
    });
  });

  test('Q3 an inquiry-only scan creates no financial record of any kind', async () => {
    await step('Q3', 'five resolves (incl. failures): transactions, ledger events and transaction audit rows unchanged', async () => {
      const t0 = await merchantTotal(); const ev0 = (await rest('transaction_events?select=id')).length; const au0 = (await rest('audit_events?select=id&action=like.transaction.*')).length;
      for (const p of [fx.partnerCode, `${web()}/c/${fx.partnerCode}`, PENDING_PARTNER, UNKNOWN_CODE, 'junk junk']) await api('merchant', 'POST', '/qr/resolve', { payload: p });
      const t1 = await merchantTotal(); const ev1 = (await rest('transaction_events?select=id')).length; const au1 = (await rest('audit_events?select=id&action=like.transaction.*')).length;
      expect([t1, ev1, au1]).toEqual([t0, ev0, au0]);
      return `transactions ${t0}->${t1}; ledger events ${ev0}->${ev1}; transaction audit rows ${au0}->${au1}`;
    });
  });

  test('Q4 RBAC: the customer discount is Merchant-only; a Partner sees earnings, never the discount', async () => {
    await step('Q4', 'Partner: resolve/preview/receipt 403; own transaction views carry no discount field, summary or sort; Merchant and Admin still do; anonymous 401', async () => {
      const p1 = await api('partner', 'POST', '/qr/resolve', { payload: fx.partnerCode }); expect(p1.status).toBe(403);
      const p2 = await api('partner', 'POST', '/transactions/real/preview', { collaborator_code: fx.partnerCode, gross_amount: '1000' }); expect(p2.status).toBe(403);
      const p3 = await api('partner', 'GET', `/transactions/${randomUUID()}/receipt`); expect(p3.status).toBe(403);
      const anon = await fetch(`${apiBase()}/qr/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: fx.partnerCode }) }); expect(anon.status).toBe(401);
      const rep = await api('partner', 'GET', '/transactions/me/report?page_size=5&sort=document_discount_amount&direction=desc'); expect(rep.status).toBe(200);
      const list = await api('partner', 'GET', '/transactions/me'); expect(list.status).toBe(200);
      const text = JSON.stringify([rep.body, list.body]); expect(text).not.toMatch(/discount/i);
      expect('commission_amount' in rep.body.summary).toBe(true);
      const mer = await api('merchant', 'GET', '/transactions/me/report?page_size=1'); expect('document_discount_amount' in mer.body.summary).toBe(true);
      const adm = await api('admin', 'GET', `/transactions/report?merchant_id=${fx.merchantId}&page_size=1`); expect('document_discount_amount' in adm.body.summary).toBe(true);
      return 'partner resolve 403, preview 403, receipt 403; partner report+list contain no "discount" at all; merchant/admin summaries keep it; anonymous 401';
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  test('Q5 CAMERA scan identifies the Partner (name, avatar, code, status, discount)', async () => {
    test.skip(!hasFfmpeg, 'ffmpeg missing: camera media cannot be generated');
    await step('Q5', 'fake camera showing the Partner QR -> identified; result shows name, avatar, code, verified, discount; camera released; no transaction', async () => {
      const browser = await chromium.launch({ args: fakeCameraArgs(media.cleanFeed) }); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] }); const page = await ctx.newPage();
      const resolves: string[] = []; page.on('request', (rq) => { if (rq.method() === 'POST' && rq.url().endsWith('/qr/resolve')) resolves.push(rq.url()); });
      await merchantLogin(page); await openScan(page);
      const t0 = Date.now(); await page.getByTestId('scanner-open-camera').click();
      const result = await expectPartner(page); const ms = Date.now() - t0;
      await expect(result.getByTestId('discount-label')).toHaveText(`Giảm ${formatRate(rates.d).replace('%', '')}%`);
      await expect(result.locator('[data-testid=partner-avatar], [data-testid=partner-avatar-fallback]').first()).toBeVisible();
      if (avatarUrl) { const img = result.getByTestId('partner-avatar'); await expect(img).toBeVisible(); await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0), { timeout: 15_000, message: 'the signed avatar URL loads as an image' }).toBe(true); }
      await expect(result.getByText('Chưa có giao dịch, thanh toán hay hoa hồng nào được tạo')).toBeVisible();
      const live = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement | null)?.srcObject ?? null); expect(live).toBeNull();      // camera released after the scan
      expect(resolves.length).toBe(1);
      await shot(page, 'Q5-camera-identified'); evidence.cameraClean = { ms, resolves: resolves.length };
      await ctx.close(); await browser.close();
      return `identified after ${ms} ms; resolve requests: ${resolves.length}; camera stream released`;
    });
  });

  test('Q6 CAMERA on another phone\'s screen (blur + noise + tilt): identified, and the page stays responsive', async () => {
    test.skip(!hasFfmpeg, 'ffmpeg missing: camera media cannot be generated');
    await step('Q6', 'phone-screen feed -> identified (was: NOT identified in 20 s with the main thread blocked 100%); longest main-thread block small', async () => {
      const browser = await chromium.launch({ args: fakeCameraArgs(media.screenFeed) }); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] }); const page = await ctx.newPage();
      await page.addInitScript(LONGTASK_PROBE); await merchantLogin(page); await openScan(page);
      const t0 = Date.now(); await page.getByTestId('scanner-open-camera').click(); await expectPartner(page, 30_000); const ms = Date.now() - t0; const lt = await stats(page);
      expect(lt.max, `longest block ${lt.max} ms`).toBeLessThan(700); expect(lt.total, `blocked ${lt.total} ms in total`).toBeLessThan(4000);
      evidence.cameraPhoneScreen = { ms, longTasks: lt, baseline: { identified: false, blockedMs: 20002, longestMs: 335 } };
      await shot(page, 'Q6-camera-phone-screen'); await ctx.close(); await browser.close();
      return `identified after ${ms} ms; long tasks n=${lt.n} max=${lt.max} ms total=${lt.total} ms (baseline: not identified in 20 s, 20002 ms blocked)`;
    });
  });

  test('Q7 UPLOADED images identify the same Partner (clean screenshot, noisy 12 MP photo, old-design QR)', async () => {
    test.skip(!hasFfmpeg, 'ffmpeg missing: image media cannot be generated');
    await step('Q7', 'upload clean screenshot / noisy 12MP photo / legacy margin-1 QR -> same Partner each time, quickly (baseline: 12MP photo froze the page ~60 s then "no QR found")', async () => {
      const browser = await chromium.launch(); const out: string[] = [];
      for (const [label, file] of [['clean screenshot', media.cleanShot], ['noisy 12MP photo', media.noisyPhoto], ['old-design QR (margin 1, EC H)', media.legacyQr]] as const) {
        const ctx = await browser.newContext({ ...devices['iPhone 13'], userAgent: IPHONE_ZALO_UA }); const page = await ctx.newPage();
        await page.addInitScript(LONGTASK_PROBE); await merchantLogin(page); await openScan(page);
        const t0 = Date.now(); await page.getByTestId('qr-file-upload').setInputFiles(file); await expectPartner(page, 30_000); const ms = Date.now() - t0; const lt = await stats(page);
        expect(lt.max, `${label}: longest block ${lt.max} ms`).toBeLessThan(1500); expect(ms, `${label}: ${ms} ms`).toBeLessThan(8000);
        out.push(`${label}: ${ms} ms, longest block ${lt.max} ms`); (evidence as any)[`upload_${label.replace(/\W+/g, '_')}`] = { ms, longestBlockMs: lt.max };
        if (label === 'noisy 12MP photo') await shot(page, 'Q7-upload-noisy-12mp'); await ctx.close();
      }
      await browser.close(); return out.join(' | ');
    });
  });

  test('Q8 repeated detection and camera lifecycle: one lookup, camera released on close / hide, restart works', async () => {
    test.skip(!hasFfmpeg, 'ffmpeg missing: camera media cannot be generated');
    await step('Q8', 'feed keeps showing the QR -> exactly one /qr/resolve; Close releases the stream; tab hidden releases it; scanning again works after "Đóng"', async () => {
      const browser = await chromium.launch({ args: fakeCameraArgs(media.cleanFeed) }); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] }); const page = await ctx.newPage();
      const resolves: string[] = []; page.on('request', (rq) => { if (rq.method() === 'POST' && rq.url().endsWith('/qr/resolve')) resolves.push(rq.url()); });
      await merchantLogin(page); await openScan(page);
      const hasStream = () => page.evaluate(() => Boolean((document.querySelector('video') as HTMLVideoElement | null)?.srcObject));
      // open then close without a scan: the stream must be released. Use a hidden-tab release too.
      await page.getByTestId('scanner-open-camera').click(); await expect(page.getByTestId('qr-scanner')).toHaveAttribute('data-phase', /scanning|done/, { timeout: 15_000 });
      await expectPartner(page); await page.waitForTimeout(2500); expect(resolves.length, 'the same code in front of the camera is looked up once').toBe(1); expect(await hasStream()).toBe(false);
      await page.getByTestId('close-result').click(); await expect(page.getByTestId('qr-scanner')).toBeVisible();
      await page.getByTestId('scanner-open-camera').click(); await expectPartner(page); expect(resolves.length, 'a fresh scan after closing is a new lookup').toBe(2);
      await ctx.close(); await browser.close();
      // a camera that sees NO code: hiding the page releases it, and the person can restart it
      const blank = await chromium.launch({ args: fakeCameraArgs(media.blankFeed) }); const bctx = await blank.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] }); const bp = await bctx.newPage();
      await merchantLogin(bp); await openScan(bp); await bp.getByTestId('scanner-open-camera').click(); await expect(bp.getByTestId('qr-scanner')).toHaveAttribute('data-phase', 'scanning', { timeout: 15_000 });
      expect(await bp.evaluate(() => Boolean((document.querySelector('video') as HTMLVideoElement | null)?.srcObject))).toBe(true);
      await bp.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await expect(bp.getByTestId('qr-scanner')).toHaveAttribute('data-phase', 'paused'); expect(await bp.evaluate(() => Boolean((document.querySelector('video') as HTMLVideoElement | null)?.srcObject))).toBe(false);
      await expect(bp.getByTestId('scanner-error')).toContainText('tạm dừng');
      await bp.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await bp.getByTestId('scanner-open-camera').click(); await expect(bp.getByTestId('qr-scanner')).toHaveAttribute('data-phase', 'scanning', { timeout: 15_000 });
      await bp.getByTestId('scanner-close-camera').click(); await expect(bp.getByTestId('qr-scanner')).toHaveAttribute('data-phase', 'idle'); expect(await bp.evaluate(() => Boolean((document.querySelector('video') as HTMLVideoElement | null)?.srcObject))).toBe(false);
      await bctx.close(); await blank.close(); const phase = 'paused';
      return `resolves=${resolves.length} for 2 scans; stream released after scan, on Close and when the page is hidden (phase=${phase}); restart after pause works`;
    });
  });
  // ------------------------------------------------------------------------------------------------------------------------------------------
  test('Q9 inquiry: close without paying leaves no financial trace', async ({ browser }) => {
    await step('Q9', 'manual code -> result -> Đóng; transactions/events unchanged; "Tiếp tục thanh toán" is the only way forward', async () => {
      const t0 = await merchantTotal(); const ev0 = (await rest('transaction_events?select=id')).length;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await merchantLogin(page); await openScan(page);
      await page.getByRole('tab', { name: /Nhập mã/ }).click(); await page.getByTestId('manual-code').fill(fx.partnerCode.toLowerCase()); await page.getByRole('button', { name: /Xem Đối tác và ưu đãi/ }).click();
      await expectPartner(page); await expect(page.getByTestId('continue-payment')).toBeEnabled(); await shot(page, 'Q9-inquiry-result');
      await page.getByTestId('close-result').click(); await expect(page.getByTestId('manual-code')).toBeVisible();   // back where the Merchant was: the manual-entry tab
      expect([await merchantTotal(), (await rest('transaction_events?select=id')).length]).toEqual([t0, ev0]); await ctx.close();
      return `transactions ${t0} unchanged; ledger events ${ev0} unchanged`;
    });
  });

  let paidGross = ''; let paidId = ''; let partnerCommissionBefore = '0.0000';
  test('Q10 PAYMENT: scanned Partner kept, original amount -> discount, final payable, independently computed commission; ONE transaction', async ({ browser }) => {
    await step('Q10', 'amount -> breakdown = independent arithmetic; double-click confirm -> exactly one transaction, recorded+confirmed once; receipt shown', async () => {
      paidGross = `${1000000 + (Date.now() % 900000)}.${String(Date.now() % 10000).padStart(4, '0')}`;
      const d = mul(paidGross, rates.d), c = mul(paidGross, rates.c), final = fmt(toUnits(paidGross) - toUnits(d));
      partnerCommissionBefore = String((await api('partner', 'GET', '/transactions/me/report?record_kind=real_transaction&lifecycle_status=confirmed&page_size=1')).body.summary.commission_amount);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await merchantLogin(page); await openScan(page);
      const writes: string[] = []; page.on('request', (rq) => { if (rq.method() === 'POST' && /\/transactions\/real$|\/confirm$/.test(new URL(rq.url()).pathname)) writes.push(new URL(rq.url()).pathname); });
      await page.getByRole('tab', { name: /Nhập mã/ }).click(); await page.getByTestId('manual-code').fill(`${web()}/c/${fx.partnerCode}`); await page.getByRole('button', { name: /Xem Đối tác và ưu đãi/ }).click();
      await expectPartner(page); await page.getByTestId('continue-payment').click();
      await expect(page.getByTestId('partner-identity')).toContainText(fx.partnerCode);                          // identity retained into the payment step
      await page.getByTestId('gross-input').fill(paidGross);
      await expect(page.getByTestId('pay-final')).toHaveText(formatVnd(final), { timeout: 15_000 });
      await expect(page.getByTestId('pay-original')).toHaveText(formatVnd(paidGross)); await expect(page.getByTestId('pay-discount')).toHaveText(`− ${formatVnd(d)}`); await expect(page.getByTestId('pay-commission')).toHaveText(formatVnd(c));
      expect(writes, 'previewing writes nothing').toEqual([]); expect((await ledgerRows(paidGross)).length).toBe(0);
      await shot(page, 'Q10-payment-breakdown');
      await page.getByTestId('confirm-payment').dblclick();                                                      // a double tap
      await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('receipt-original')).toHaveText(formatVnd(paidGross)); await expect(page.getByTestId('receipt-discount')).toHaveText(`− ${formatVnd(d)}`);
      await expect(page.getByTestId('receipt-final')).toHaveText(formatVnd(final)); await expect(page.getByTestId('receipt-commission')).toHaveText(formatVnd(c));
      const docNo = (await page.getByTestId('receipt-number').innerText()).trim(); await shot(page, 'Q10-receipt');
      const rows = await ledgerRows(paidGross); expect(rows, 'exactly one transaction for this payment').toHaveLength(1); paidId = rows[0].id;
      expect(eq4(rows[0].document_discount_amount, d) && eq4(rows[0].commission_amount, c) && eq4(rows[0].document_discount_percent, rates.d) && eq4(rows[0].commission_percent, rates.c)).toBe(true);
      expect(rows[0].lifecycle_status).toBe('confirmed'); expect(rows[0].payment_status).not.toMatch(/paid|settled/i);
      const events = await rest(`transaction_events?select=event_type,occurred_at&transaction_id=eq.${paidId}&order=occurred_at.asc`);
      expect(events.map((e) => e.event_type)).toEqual(['real_transaction_recorded', 'real_transaction_confirmed']);
      const audit = await rest(`audit_events?select=action,occurred_at&entity_id=eq.${paidId}&order=occurred_at.asc`); expect(audit.filter((a) => a.action === 'transaction.real_recorded')).toHaveLength(1);
      expect(writes.filter((w) => w.endsWith('/real'))).toHaveLength(1); expect(writes.filter((w) => w.endsWith('/confirm'))).toHaveLength(1);
      evidence.payment = { gross: paidGross, discount: d, final, commission: c, document: docNo, transactionId: paidId, events: events.map((e) => `${e.event_type}@${e.occurred_at}`), audit: audit.map((a) => a.action) };
      await ctx.close();
      return `${docNo}: gross ${paidGross}, discount ${d}, final ${final}, commission ${c} (independent arithmetic); 1 row; events ${events.map((e) => e.event_type).join('>')}; audit ${audit.map((a) => a.action).join(',')}; 1 create + 1 confirm request`;
    });
  });

  test('Q11 duplicate submission and duplicate commission accrual are impossible', async () => {
    await step('Q11', 'same idempotency key twice (create, confirm) -> same transaction, idempotent_replay; commission summaries move by exactly one commission; Admin = Merchant totals', async () => {
      const d = mul(paidGross, rates.d), c = mul(paidGross, rates.c);
      const partnerAfter = String((await api('partner', 'GET', '/transactions/me/report?record_kind=real_transaction&lifecycle_status=confirmed&page_size=1')).body.summary.commission_amount);
      expect(toUnits(partnerAfter) - toUnits(partnerCommissionBefore)).toBe(toUnits(c));                          // earnings accrued ONCE, by exactly the commission
      const key = randomUUID(); const gross2 = `${100 + (Date.now() % 800)}.0002`;
      const a = await api('merchant', 'POST', '/transactions/real', { collaborator_code: fx.partnerCode, gross_amount: gross2, idempotency_key: key }); expect(a.status).toBeLessThan(300);
      const b = await api('merchant', 'POST', '/transactions/real', { collaborator_code: fx.partnerCode, gross_amount: gross2, idempotency_key: key });
      expect([b.body.transaction_id, b.body.idempotent_replay]).toEqual([a.body.transaction_id, true]); expect((await ledgerRows(gross2)).length).toBe(1);
      const other = await api('merchant', 'POST', '/transactions/real', { collaborator_code: fx.partnerCode, gross_amount: `${gross2.split('.')[0]}.0003`, idempotency_key: key }); expect(other.status).toBe(409);
      const ck = randomUUID(); const c1 = await api('merchant', 'POST', `/transactions/${a.body.transaction_id}/confirm`, { idempotency_key: ck }); const c2 = await api('merchant', 'POST', `/transactions/${a.body.transaction_id}/confirm`, { idempotency_key: ck });
      expect([c1.status, c2.status, c2.body.idempotent_replay]).toEqual([201, 201, true]);
      const ev = await rest(`transaction_events?select=event_type&transaction_id=eq.${a.body.transaction_id}`); expect(ev.map((e) => e.event_type).sort()).toEqual(['real_transaction_confirmed', 'real_transaction_recorded']);
      const cancel = await api('merchant', 'POST', `/transactions/${a.body.transaction_id}/cancel`, { idempotency_key: randomUUID() }); expect(cancel.status).toBeGreaterThanOrEqual(400);   // a confirmed transaction cannot be cancelled
      const adm = (await api('admin', 'GET', `/transactions/report?record_kind=real_transaction&lifecycle_status=confirmed&merchant_id=${fx.merchantId}&page_size=1`)).body.summary;
      const mer = (await api('merchant', 'GET', '/transactions/me/report?record_kind=real_transaction&lifecycle_status=confirmed&page_size=1')).body.summary;
      for (const k of ['transaction_count', 'document_total', 'commission_amount']) expect(String(mer[k]), `merchant vs admin ${k}`).toBe(String(adm[k]));
      const rec = await api('merchant', 'GET', `/transactions/${paidId}/receipt`); expect(rec.status).toBe(200);
      expect([rec.body.gross_amount, rec.body.discount_amount, rec.body.commission_amount, rec.body.commission_base].map(String)).toEqual([fmt(toUnits(paidGross)), d, c, 'gross_amount']);
      evidence.duplicates = { replay: b.body.idempotent_replay, conflict: other.status, confirmReplay: c2.body.idempotent_replay, partnerCommissionDelta: fmt(toUnits(partnerAfter) - toUnits(partnerCommissionBefore)) };
      (evidence as any).secondTransaction = a.body.transaction_id;
      return `replay create -> same transaction; different input with same key -> ${other.status}; replay confirm -> idempotent; partner commission moved by exactly ${fmt(toUnits(partnerAfter) - toUnits(partnerCommissionBefore))}; merchant totals = admin totals`;
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  test('Q12 invalid QR shows an actionable error and creates nothing', async () => {
    test.skip(!hasFfmpeg, 'ffmpeg missing: QR images cannot be generated');
    await step('Q12', 'non-VNO QR (no lookup sent), unknown code, inactive Partner -> specific Vietnamese guidance; scanner restarts; no financial record', async () => {
      const t0 = await merchantTotal(); const ev0 = (await rest('transaction_events?select=id')).length;
      const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
      const resolves: string[] = []; page.on('request', (rq) => { if (rq.method() === 'POST' && rq.url().endsWith('/qr/resolve')) resolves.push(rq.url()); });
      await merchantLogin(page); await openScan(page); const seen: string[] = [];
      for (const [label, file, title, body] of [
        ['not a VNO QR', media.otherQr, 'Mã QR không hợp lệ', /không phải mã Đối tác của VNO/], ['unknown code', media.unknownQr, 'Không tìm thấy Đối tác', /kiểm tra lại mã/i], ['inactive Partner', media.pendingQr, 'Đối tác chưa hoạt động', /Admin VNO/],
      ] as const) {
        const before = resolves.length; await page.getByTestId('qr-file-upload').setInputFiles(file);
        const notice = page.getByTestId('scan-notice'); await expect(notice).toBeVisible({ timeout: 20_000 }); await expect(notice).toContainText(title); await expect(notice).toContainText(body); await expect(notice).toContainText('Chưa có giao dịch');
        if (label === 'not a VNO QR') expect(resolves.length, 'a QR that cannot be a Partner code is explained without a lookup').toBe(before);
        await shot(page, `Q12-${label.replace(/\W+/g, '-')}`); seen.push(`${label}: "${title}"`);
        await expect(page.getByTestId('qr-scanner')).toBeVisible();                                              // scanner is back, ready to retry
      }
      expect([await merchantTotal(), (await rest('transaction_events?select=id')).length]).toEqual([t0, ev0]); await ctx.close(); await browser.close();
      return seen.join(' | ');
    });
  });

  test('Q13 ZALO in-app browser (iPhone UA): no live camera -> guidance, photo capture and upload work; diagnostics reach the server', async () => {
    test.skip(!hasFfmpeg, 'ffmpeg missing: image media cannot be generated');
    await step('Q13', 'camera API missing / refused inside Zalo -> in-app notice (no dead end), "Chụp ảnh mã QR" + upload resolve the Partner; closed-vocabulary diagnostics posted', async () => {
      const results: string[] = [];
      for (const [label, script] of [['no camera API', `Object.defineProperty(navigator,'mediaDevices',{value:undefined,configurable:true})`], ['camera refused', `navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Permission denied','NotAllowedError'))`]] as const) {
        const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices['iPhone 13'], userAgent: IPHONE_ZALO_UA }); const page = await ctx.newPage();
        const diag: any[] = []; page.on('request', (rq) => { if (rq.url().endsWith('/qr/diagnostics')) { try { diag.push(JSON.parse(rq.postData() || '{}')); } catch { /* ignore */ } } });
        await page.addInitScript(script); await merchantLogin(page); await openScan(page);
        const notice = page.getByTestId('scanner-inapp-notice');
        if (label === 'camera refused') { await page.getByTestId('scanner-open-camera').click(); await expect(page.getByTestId('scanner-error')).toContainText('Zalo'); await expect(page.getByTestId('scanner-error')).toContainText('Chụp ảnh mã QR'); }
        await expect(notice).toBeVisible(); await expect(notice).toContainText('Zalo'); await expect(notice).toContainText('Safari'); await expect(page.getByTestId('qr-file-capture')).toHaveAttribute('capture', 'environment');
        await page.getByTestId('qr-file-capture').setInputFiles(media.noisyPhoto); await expectPartner(page, 30_000); await shot(page, `Q13-zalo-${label.replace(/\W+/g, '-')}`);
        const events = diag.map((d) => d.event); for (const e of ['page_open', 'camera_support', 'fallback_shown', 'upload_decoded', 'resolve_ok']) expect(events, `${label}: ${e}`).toContain(e);
        expect(diag.find((d) => d.event === 'camera_support')).toMatchObject({ inapp: 'zalo', os: 'ios' }); if (label === 'camera refused') expect(diag.some((d) => d.event === 'camera_error' && d.err === 'NotAllowedError')).toBe(true);
        expect(JSON.stringify(diag)).not.toContain(fx.partnerCode); results.push(`${label}: notice + capture upload resolved; events ${[...new Set(events)].join(',')}`);
        await ctx.close(); await browser.close();
      }
      return results.join(' | ');
    });
  });

  test('Q14 WEBKIT (the iOS engine) with the Zalo user agent: upload and manual entry resolve the Partner', async () => {
    test.skip(!hasFfmpeg, 'ffmpeg missing: image media cannot be generated');
    await step('Q14', 'real WebKit engine, iPhone viewport, Zalo UA: noisy 12MP photo + clean screenshot upload and manual code -> same Partner, no freeze', async () => {
      let browser; try { browser = await webkit.launch(); } catch (e: any) { test.skip(true, `WebKit not installed (npx playwright install webkit): ${String(e.message).split('\n')[0]}`); return; }
      const ctx: BrowserContext = await browser.newContext({ ...devices['iPhone 14'], userAgent: IPHONE_ZALO_UA }); const page = await ctx.newPage(); await page.addInitScript(LONGTASK_PROBE);
      await merchantLogin(page); const out: string[] = [];
      for (const [label, file] of [['noisy 12MP photo', media.noisyPhoto], ['clean screenshot', media.cleanShot]] as const) {
        await openScan(page); const t0 = Date.now(); await page.getByTestId('qr-file-upload').setInputFiles(file); await expectPartner(page, 40_000); out.push(`${label}: ${Date.now() - t0} ms`);
      }
      const lt = await stats(page); expect(lt.max, `longest block ${lt.max} ms`).toBeLessThan(2500);
      await openScan(page); await page.getByRole('tab', { name: /Nhập mã/ }).click(); await page.getByTestId('manual-code').fill(fx.partnerCode); await page.getByRole('button', { name: /Xem Đối tác và ưu đãi/ }).click(); await expectPartner(page);
      await shot(page, 'Q14-webkit-iphone'); evidence.webkit = { engine: 'webkit', results: out, longestBlockMs: lt.max }; await ctx.close(); await browser.close();
      return `WebKit: ${out.join(', ')}; longest block ${lt.max} ms; manual entry ok`;
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  test('Q15 PARTNER PORTAL: name, avatar and own QR; no customer discount anywhere', async ({ browser }) => {
    await step('Q15', 'Partner dashboard shows name + avatar/initials + QR code image; no "giảm giá" text/column/metric in dashboard or reports', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } }); const page = await ctx.newPage();
      await page.goto(`${web()}/login`); await page.getByPlaceholder('email@example.com').fill(fx.partner.email); await page.locator('input[type="password"]').fill(fx.partner.password); await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/collaborator\/dashboard/, { timeout: 30_000 });
      const card = page.getByTestId('partner-qr-card'); await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.getByTestId('partner-name')).toHaveText(partnerName); await expect(card.locator('[data-testid=partner-avatar], [data-testid=partner-avatar-fallback]').first()).toBeVisible();
      await expect(card.getByTestId('partner-qr-code')).toHaveText(fx.partnerCode); await expect(card.getByTestId('partner-qr-image')).toBeVisible();
      const img = await card.getByTestId('partner-qr-image').evaluate((e: HTMLImageElement) => ({ w: e.naturalWidth, ok: e.complete })); expect(img.ok && img.w >= 400).toBe(true);
      await expect(page.getByText(/giảm giá/i)).toHaveCount(0); await shot(page, 'Q15-partner-dashboard');
      await page.goto(`${web()}/collaborator/dashboard/reports`); await expect(page.getByText('Tổng hoa hồng')).toBeVisible({ timeout: 30_000 }); await expect(page.getByText(/giảm giá/i)).toHaveCount(0);
      await expect(page.locator('select option[value="document_discount_amount"]')).toHaveCount(0); await shot(page, 'Q15-partner-reports'); await ctx.close();
      return 'dashboard: name, avatar/initials, QR image (>=400px) and code; dashboard + reports: no discount text, metric, column or sort option';
    });
  });

  test('Q16 cleanup: reverse this run\'s confirmed test transaction(s) as Admin so the fixture\'s earnings are unchanged', async () => {
    await step('Q16', 'Admin reverses the confirmed test transactions (governed state change, audited); Partner confirmed commission back to the starting value', async () => {
      const ids = [paidId, (evidence as any).secondTransaction].filter(Boolean) as string[]; const out: string[] = [];
      for (const id of ids) { const r = await api('admin', 'POST', `/transactions/${id}/reverse`, { idempotency_key: randomUUID() }); out.push(`${id.slice(0, 8)}:${r.status}`); expect(r.status).toBeLessThan(300); }
      const after = String((await api('partner', 'GET', '/transactions/me/report?record_kind=real_transaction&lifecycle_status=confirmed&page_size=1')).body.summary.commission_amount);
      expect(after).toBe(partnerCommissionBefore); evidence.cleanup = { reversed: out, partnerCommission: after, baselineTransactionTotal: baselineTotal, endTotal: await merchantTotal() };
      fs.writeFileSync(`${EVIDENCE_DIR}/qr-scan-${RUN_ID}.json`, JSON.stringify(evidence, null, 2));
      return `reversed ${out.join(', ')}; partner confirmed commission ${after} (= before)`;
    });
  });
});
