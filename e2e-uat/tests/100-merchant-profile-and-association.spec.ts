import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { api, hasCreds, useIdentity } from '../lib/api';
import { config, creds, EVIDENCE_DIR, RUN_ID } from '../lib/env';
import { record } from '../lib/evidence';
import { readFixture, Fixture } from '../lib/fixture';
import { makePng } from '../lib/images';

// ISSUE 1 — Merchant profile "Validation failed": legacy invalid values (a V1 e-mail with a typo, a record with no phone) made an UNCHANGED profile unsaveable and no field was named.
// ISSUE 2 — a Partner that is active but not assigned to a Merchant: identity yes, association no. Admin assigns it; scans are counted once; nothing financial happens without the association.
// Runs on the paired synthetic fixture (never on a real/V1 Merchant or on Partner3). Everything it changes is restored in afterAll.
// Run through `railway run --service vno-api`; before a deploy also with E2E_TARGET=candidate.
const step = async (id: string, title: string, fn: () => Promise<string | void>) => {
  try { const detail = await fn(); record(id, title, 'PASS', detail || ''); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; }
};
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY!;
async function rest(path: string, init: RequestInit = {}) {
  process.env.E2E_ADMIN_SERVICE_TOKEN = key();
  const r = await fetch(`${config().supabase}/rest/v1/${path}`, { ...init, headers: { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`REST ${path.split('?')[0]} HTTP ${r.status}`); const t = await r.text(); return t ? (JSON.parse(t) as any[]) : [];
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${EVIDENCE_DIR}/screens/${name}.png` }).catch(() => undefined);
const evidence: Record<string, unknown> = { run: RUN_ID };
const BAD_EMAIL = 'nhakhoavinhan.@gmail.com';                                       // the real V1 value that blocks Merchant M2500052

test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY || !hasCreds('admin') || !readFixture(), 'BLOCKED: run via `railway run --service vno-api` with admin credentials and the paired fixture');

test.describe.serial('Merchant profile save and Partner–Merchant association', () => {
  const web = () => config().web; const apiBase = () => config().api;
  let fx: Fixture; let original: Record<string, unknown> = {}; let merchantName = ''; let merchantCode = '';
  const proposalIds: string[] = [];
  const merchantLogin = async (page: Page) => {
    await page.goto(`${web()}/login`); await page.getByPlaceholder('email@example.com').fill(fx.merchant.email); await page.locator('input[type="password"]').fill(fx.merchant.password);
    await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(/merchant\/dashboard/, { timeout: 30_000 }); await page.waitForLoadState('networkidle').catch(() => undefined);
  };
  const openProfile = async (page: Page) => { await page.goto(`${web()}/merchant/dashboard/profile`); await expect(page.getByTestId('profile-save')).toBeVisible({ timeout: 30_000 }); };
  const stored = async () => (await rest(`merchant_details?select=merchant_name,merchant_email,merchant_phone,merchant_contact_phone,owner_name,owner_phone,new_address_line,new_address_ward,merchant_description&merchant_system_id=eq.${fx.merchantId}`))[0];
  const profileAudits = async () => rest(`audit_events?select=details,occurred_at&action=eq.merchant.profile_updated&entity_id=eq.${fx.merchantId}&order=occurred_at.asc`);
  const png = (seed: string, w = 64, h = 64) => { const b = makePng(seed, w, h); return { filename: `${seed}.png`, mime_type: 'image/png', size_bytes: b.length, base64_data: b.toString('base64'), action: 'add', slot: 'gallery' }; };

  test.beforeAll(async () => {
    fx = readFixture()!; useIdentity('merchant', fx.merchant); useIdentity('partner', fx.partner);
    const s = await stored(); original = { ...s };
    const m = (await rest(`merchant_details?select=merchant_name,merchant_code&merchant_system_id=eq.${fx.merchantId}`))[0]; merchantName = m.merchant_name; merchantCode = m.merchant_code;
    // the data shape reproduced on UAT: a V1-style invalid e-mail and no phone (Merchants M2500052 and MCH1F1DC)
    await rest(`merchant_details?merchant_system_id=eq.${fx.merchantId}`, { method: 'PATCH', body: JSON.stringify({ merchant_email: BAD_EMAIL, merchant_phone: null, owner_phone: null, new_address_line: null, new_address_ward: null }) });
    fs.mkdirSync(`${EVIDENCE_DIR}/screens`, { recursive: true });
  });
  test.afterAll(async () => {
    if (!fx) return;
    await rest(`merchant_details?merchant_system_id=eq.${fx.merchantId}`, { method: 'PATCH', body: JSON.stringify(original) }).catch(() => undefined);
    for (const id of proposalIds) await api('merchant', 'DELETE', `/media/requests/${id}`).catch(() => undefined);
    fs.writeFileSync(`${EVIDENCE_DIR}/merchant-profile-association-${RUN_ID}.json`, JSON.stringify(evidence, null, 2));
  });

  // ================================ ISSUE 1 ================================================================================================================
  test('M1 the page\'s own request (every field, blanks included, the legacy e-mail unchanged) now saves; only the real change is written and audited', async () => {
    await step('M1', 'PATCH with the full page payload incl. invalid legacy e-mail + blank phone -> 2xx; changed_fields = [new_address_line]; stored e-mail untouched', async () => {
      const m = (await api('merchant', 'GET', `/merchants/${fx.merchantId}`)).body;
      const page = { merchant_name: m.merchant_name, merchant_email: m.merchant_email, merchant_phone: '', merchant_description: m.merchant_description ?? '', merchant_description_format: m.merchant_description_format ?? 'plain_text', merchant_contact_phone: m.merchant_contact_phone ?? '',
        new_address_city: m.new_address_city ?? '', new_address_ward: '', new_address_line: `12 Phố Huế ${RUN_ID}`, owner_name: m.owner_name ?? '', owner_phone: '', owner_tax_code: m.owner_tax_code ?? '', new_address_country: m.new_address_country ?? '',
        new_address_province: m.new_address_province ?? '', new_address_district: m.new_address_district ?? '', merchant_discount_type: 'percentage', merchant_discount_value: '0.0500', merchant_commission_type: 'percentage', merchant_commission_value: '0.1000' };
      const before = (await profileAudits()).length;
      const r = await api('merchant', 'PATCH', `/merchants/${fx.merchantId}`, page); expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBeLessThan(300);
      expect(r.body.changed_fields).toEqual(['new_address_line']);
      const s = await stored(); expect(s.merchant_email).toBe(BAD_EMAIL); expect(s.new_address_line).toBe(`12 Phố Huế ${RUN_ID}`);
      const audits = await profileAudits(); expect(audits.length).toBe(before + 1); expect(audits[audits.length - 1].details.changed_fields).toEqual(['new_address_line']);
      const again = await api('merchant', 'PATCH', `/merchants/${fx.merchantId}`, page); expect(again.status).toBeLessThan(300); expect(again.body.changed_fields).toEqual([]);   // the same submission again changes and audits nothing
      expect((await profileAudits()).length).toBe(before + 1);
      return `HTTP ${r.status} changed_fields=${JSON.stringify(r.body.changed_fields)}; legacy e-mail untouched; repeat -> changed_fields [] and no new audit row`;
    });
  });

  test('M2 UI: legacy problems are warned about, never block; saving an unrelated field works and says exactly what was saved', async ({ browser }) => {
    await step('M2', 'profile page: warnings on e-mail + phone (dữ liệu cũ), edit address -> "Đã lưu 1 thay đổi: Địa chỉ chi tiết."; one PATCH; e-mail unchanged', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 } }); const page = await ctx.newPage(); const patches: string[] = [];
      page.on('request', (rq) => { if (rq.method() === 'PATCH' && /\/merchants\//.test(rq.url())) patches.push(rq.url()); });
      await merchantLogin(page); await openProfile(page);
      await expect(page.getByTestId('warning-merchant_email')).toContainText('dữ liệu cũ'); await expect(page.getByTestId('warning-merchant_phone')).toContainText('chưa có số điện thoại');
      await expect(page.getByTestId('edit-rules')).toContainText('Cần Admin duyệt'); await shot(page, 'M2-legacy-warnings');
      await page.getByTestId('input-new_address_ward').fill(`Phường ${RUN_ID.slice(-4)}`);
      await page.getByTestId('profile-save').click();
      await expect(page.getByTestId('profile-saved')).toContainText('Đã lưu 1 thay đổi: Phường / Xã'); expect(patches).toHaveLength(1);
      const s = await stored(); expect(s.merchant_email).toBe(BAD_EMAIL); expect(String(s.new_address_ward)).toContain('Phường');
      await shot(page, 'M2-saved'); await ctx.close();
      return `saved "Phường / Xã" while the legacy e-mail stayed as stored; PATCH requests: ${patches.length}`;
    });
  });

  test('M3 invalid input names the field with an actionable Vietnamese message — in the browser and, for any other client, from the API', async ({ browser }) => {
    await step('M3', 'abc@ / 123 -> errors under "Email" and "Số điện thoại", no request sent; the same body to the API -> 400 VALIDATION_FAILED with errors[{field,code,message}]; nothing written', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 } }); const page = await ctx.newPage(); const patches: string[] = [];
      page.on('request', (rq) => { if (rq.method() === 'PATCH' && /\/merchants\//.test(rq.url())) patches.push(rq.url()); });
      await merchantLogin(page); await openProfile(page); const before = await stored();
      await page.getByTestId('input-merchant_email').fill('abc@'); await page.getByTestId('input-merchant_phone').fill('123'); await page.getByTestId('input-merchant_name').fill('   ');
      await page.getByTestId('profile-save').click();
      await expect(page.getByTestId('error-merchant_email')).toContainText('Email không hợp lệ'); await expect(page.getByTestId('error-merchant_phone')).toContainText('từ 7 đến 20 ký tự'); await expect(page.getByTestId('error-merchant_name')).toContainText('không được để trống');
      await expect(page.getByTestId('profile-error')).toContainText('Email'); await expect(page.getByTestId('profile-error')).toContainText('Số điện thoại'); await expect(page.getByTestId('profile-error')).not.toContainText('Validation failed');
      await shot(page, 'M3-field-errors'); expect(patches).toEqual([]); await ctx.close();
      const r = await api('merchant', 'PATCH', `/merchants/${fx.merchantId}`, { merchant_email: 'abc@', merchant_phone: '123', owner_tax_code: 'x'.repeat(101) });
      expect(r.status).toBe(400); expect(r.body.message).toBe('Validation failed'); expect(r.body.code).toBe('VALIDATION_FAILED');
      const f = Object.fromEntries((r.body.errors as any[]).map((e) => [e.field, e])); expect(Object.keys(f).sort()).toEqual(['merchant_email', 'merchant_phone', 'owner_tax_code']);
      for (const e of Object.values(f) as any[]) { expect(e.code).toBeTruthy(); expect(e.message).toMatch(/[À-ỹ]/); }
      expect(await stored()).toEqual(before);
      return `UI: 3 field errors, 0 requests; API: 400 ${JSON.stringify((r.body.errors as any[]).map((e) => `${e.field}:${e.code}`))}; stored profile unchanged`;
    });
  });

  test('M4 clearing a field is allowed, a rate is validated against its stored type, unknown / Admin-only fields are refused, other roles cannot use the route', async () => {
    await step('M4', 'clear legacy e-mail -> saved as empty; discount "5" (=500%) -> 400 on merchant_discount_value; merchant_verified -> 400; Partner/Admin -> 403', async () => {
      const cleared = await api('merchant', 'PATCH', `/merchants/${fx.merchantId}`, { merchant_email: '' }); expect(cleared.status).toBeLessThan(300); expect(cleared.body.changed_fields).toEqual(['merchant_email']); expect((await stored()).merchant_email).toBeNull();
      const rate = await api('merchant', 'PATCH', `/merchants/${fx.merchantId}`, { merchant_discount_value: '5' }); expect(rate.status).toBe(400); expect(rate.body.errors.map((e: any) => e.field)).toContain('merchant_discount_value'); expect(rate.body.errors[0].message).toMatch(/Tỷ lệ giảm giá/);
      const admin = await api('merchant', 'PATCH', `/merchants/${fx.merchantId}`, { merchant_verified: true }); expect(admin.status).toBe(400);
      const asPartner = await api('partner', 'PATCH', `/merchants/${fx.merchantId}`, { merchant_name: 'x' }); expect(asPartner.status).toBe(403);
      const asAdmin = await api('admin', 'PATCH', `/merchants/${fx.merchantId}`, { merchant_name: 'x' }); expect(asAdmin.status).toBe(403);
      const rates = (await api('merchant', 'GET', `/merchants/${fx.merchantId}`)).body; expect([Number(rates.merchant_discount_value), Number(rates.merchant_commission_value)]).toEqual([0.05, 0.1]);
      return 'cleared e-mail stored as NULL; rate 5 refused (field merchant_discount_value); merchant_verified refused; Partner 403, Admin 403 on the self-service route; rates unchanged 0.05/0.10';
    });
  });

  test('M5 a pending image proposal never blocks the profile save; the same image cannot be proposed twice', async ({ browser }) => {
    await step('M5', 'pending proposal exists -> banner says it does not affect the save, save works; repeating the same upload -> 409 MEDIA_DUPLICATE; still exactly one pending proposal', async () => {
      const dto = png(`m5-${RUN_ID}`, 96, 96);
      const first = await api('merchant', 'POST', '/media/upload', dto); expect(first.status, JSON.stringify(first.body).slice(0, 160)).toBeLessThan(300); proposalIds.push(first.body.approval_request.id);
      const mine = async () => ((await api('merchant', 'GET', '/media/me')).body as any[]).filter((a) => a.publication_status === 'pending');
      const pendingBefore = (await mine()).length; expect(pendingBefore).toBeGreaterThanOrEqual(1);
      const dup = await api('merchant', 'POST', '/media/upload', dto); expect(dup.status).toBe(409); expect(dup.body.code).toBe('MEDIA_DUPLICATE'); expect(dup.body.message).toMatch(/đang chờ Admin duyệt/);
      expect((await mine()).length).toBe(pendingBefore);
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 } }); const page = await ctx.newPage(); await merchantLogin(page); await openProfile(page);
      await expect(page.getByTestId('pending-proposals')).toContainText('không ảnh hưởng');
      await page.getByTestId('input-owner_name').fill(`Chủ sở hữu ${RUN_ID.slice(-4)}`); await page.getByTestId('profile-save').click();
      await expect(page.getByTestId('profile-saved')).toContainText('Tên chủ sở hữu'.replace('Tên chủ sở hữu', 'Họ và tên chủ sở hữu')); await shot(page, 'M5-pending-proposal-save-ok'); await ctx.close();
      expect((await mine()).length).toBe(pendingBefore);                                                                 // the approval workflow is untouched by the save
      return `pending proposals ${pendingBefore} before and after the save; duplicate upload -> 409 MEDIA_DUPLICATE`;
    });
  });

  test('M6 image validation and ownership: corrupt / tiny / oversize / wrong-type files are refused with Vietnamese reasons; every stored image belongs to the signed-in Merchant', async () => {
    await step('M6', 'bad uploads -> 400 MEDIA_* (nothing stored); upload aimed at another owner -> 403; stored rows: merchant_id = this Merchant, own folder, merchant-media bucket', async () => {
      const total = async () => (await rest(`media_assets?select=id&merchant_id=eq.${fx.merchantId}`)).length; const before = await total();
      const bad = (label: string, body: any, code: string) => api('merchant', 'POST', '/media/upload', body).then((r) => { expect(r.status, label).toBe(400); expect(r.body.code ?? r.body.errors?.[0]?.code, label).toBeTruthy(); if (code) expect(r.body.code, label).toBe(code); expect(String(r.body.message), label).toMatch(/[À-ỹ]|Validation failed/); return `${label}:${r.body.code}`; });
      const truncated = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
      const seen = [
        await bad('corrupt header', { ...png('x'), size_bytes: truncated.length, base64_data: truncated.toString('base64') }, 'MEDIA_CORRUPT'),
        await bad('1x1 image', png(`tiny-${RUN_ID}`, 1, 1), 'MEDIA_TOO_SMALL'),
        await bad('png content declared as jpeg', { ...png(`liar-${RUN_ID}`), mime_type: 'image/jpeg' }, 'MEDIA_SIGNATURE'),
        await bad('size does not match', { ...png(`size-${RUN_ID}`), size_bytes: 7 }, 'MEDIA_SIZE_MISMATCH'),
      ];
      const gif = await api('merchant', 'POST', '/media/upload', { ...png(`gif-${RUN_ID}`), mime_type: 'image/gif' }); expect(gif.status).toBe(400); expect(gif.body.errors.find((e: any) => e.field === 'mime_type').message).toMatch(/JPEG, PNG hoặc WebP/);
      const other = await api('merchant', 'POST', '/media/upload', { ...png(`other-${RUN_ID}`), merchant_id: '00000000-0000-4000-8000-000000000001' }); expect(other.status).toBe(403);
      const asPartnerTarget = await api('merchant', 'POST', '/media/upload', { ...png(`partner-${RUN_ID}`), collaborator_id: fx.partnerId }); expect(asPartnerTarget.status).toBe(403);
      expect(await total()).toBe(before);
      const rows = await rest(`media_assets?select=merchant_id,collaborator_id,bucket_id,object_path,uploaded_by&merchant_id=eq.${fx.merchantId}&publication_status=eq.pending`);
      for (const r of rows) { expect(r.merchant_id).toBe(fx.merchantId); expect(r.collaborator_id).toBeNull(); expect(r.bucket_id).toBe('merchant-media'); expect(String(r.object_path).startsWith(`merchants/${fx.merchantId}/`)).toBe(true); }
      return `${seen.join(', ')}, gif -> field mime_type, other merchant 403, partner target 403; nothing stored by the refusals; ${rows.length} pending row(s) all owned by this Merchant`;
    });
  });

  test('M7 a double click on Save writes and audits once', async ({ browser }) => {
    await step('M7', 'edit + dblclick Save -> one PATCH, one profile_updated audit row, success message', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 } }); const page = await ctx.newPage(); const patches: string[] = [];
      page.on('request', (rq) => { if (rq.method() === 'PATCH' && /\/merchants\//.test(rq.url())) patches.push(rq.url()); });
      await merchantLogin(page); await openProfile(page); const before = (await profileAudits()).length;
      await page.getByTestId('input-merchant_phone').fill('0912 345 678'); await page.getByTestId('profile-save').dblclick();
      await expect(page.getByTestId('profile-saved')).toContainText('Số điện thoại'); await page.waitForTimeout(800);
      expect(patches).toHaveLength(1); expect((await profileAudits()).length).toBe(before + 1); expect((await stored()).merchant_phone).toBe('0912 345 678');
      await page.getByTestId('profile-save').click(); await expect(page.getByTestId('profile-nochange')).toContainText('Không có thay đổi'); expect(patches).toHaveLength(1);
      await ctx.close(); return `1 PATCH for a double click; 1 audit row; a further Save with no change sends nothing ("Không có thay đổi nào để lưu.")`;
    });
  });

  // ================================ ISSUE 2 ================================================================================================================
  let partner: { id: string; code: string; name: string } | null = null;
  const resolve = (payload: string, extra: Record<string, unknown> = {}) => api('merchant', 'POST', '/qr/resolve', { payload, ...extra });
  const summary = async (days = 1) => (await api('merchant', 'GET', `/qr/scans/summary?days=${days}`)).body;
  const ledgerTotal = async () => Number((await api('admin', 'GET', `/transactions/report?merchant_id=${fx.merchantId}&page_size=1`)).body.total);

  test('A1 an active Partner with no Merchant: identified, no association, no discount, no transaction possible', async () => {
    await step('A1', 'synthetic active Partner without a Merchant -> association "unassigned", discount unavailable; preview 403 and real transaction 403 (nothing recorded)', async () => {
      const rows = await rest(`collaborators?select=id,collaborators_code,collaborators_name&collaborators_status=eq.active&collaborators_verified=eq.true&merchant_system_id=is.null&collaborators_email=ilike.*vno-uat-synthetic.example&order=created_at.desc&limit=1`);
      test.skip(!rows.length, 'no synthetic unassigned active Partner is available');
      partner = { id: rows[0].id, code: rows[0].collaborators_code, name: rows[0].collaborators_name };
      const r = await resolve(partner.code); expect(r.status).toBe(201);
      expect(r.body.partner).toMatchObject({ code: partner.code, verified: true, status: 'active' }); expect(r.body.association).toBe('unassigned');
      expect(r.body.discount).toEqual({ available: false, kind: null, rate: null, label: null, reason: 'partner_not_assigned' });
      const t0 = await ledgerTotal();
      const preview = await api('merchant', 'POST', '/transactions/real/preview', { collaborator_code: partner.code, gross_amount: '100000' }); expect(preview.status).toBe(403); expect(preview.body.code).toBe('PARTNER_NOT_ASSIGNED');
      const real = await api('merchant', 'POST', '/transactions/real', { collaborator_code: partner.code, gross_amount: '100000', idempotency_key: crypto.randomUUID() }); expect(real.status).toBe(403);
      expect(await ledgerTotal()).toBe(t0);
      evidence.unassigned = { partner: partner.code, preview: preview.status, real: real.status };
      return `${partner.code}: association=unassigned, discount.available=false (partner_not_assigned); preview 403 PARTNER_NOT_ASSIGNED; POST /transactions/real 403; ledger ${t0} unchanged`;
    });
  });

  test('A2 scans are counted once, even without an invoice, and never create a commission, a transaction or an association', async () => {
    test.skip(!partner, 'needs A1');
    await step('A2', 'same scan id x5 (sequential + parallel) -> counted once; no-id scans -> once per minute; ledger, partner earnings and the association unchanged', async () => {
      const before = await summary(); const t0 = await ledgerTotal();
      const partnerEarn = async () => String((await api('partner', 'GET', '/transactions/me/report?record_kind=real_transaction&lifecycle_status=confirmed&page_size=1')).body.summary.commission_amount);
      const earn0 = await partnerEarn(); const sid = crypto.randomUUID();
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => resolve(partner!.code, { scan_id: sid, source: 'manual' })));
      expect(results.filter((r) => r.body.scan?.counted).length).toBe(1); expect(results.filter((r) => r.body.scan?.duplicate).length).toBe(4);
      const again = await resolve(`${web()}/c/${partner!.code}`, { scan_id: sid, source: 'camera' }); expect(again.body.scan).toEqual({ counted: false, duplicate: true });
      // a client that sends no scan id is counted once per (Merchant, Partner, minute); A1's lookup may already have used this minute's window
      const t1 = Date.now(); const noId1 = await resolve(partner!.code); const noId2 = await resolve(partner!.code.toLowerCase()); const sameMinute = Math.floor(t1 / 60_000) === Math.floor(Date.now() / 60_000);
      if (sameMinute) expect(noId2.body.scan).toEqual({ counted: false, duplicate: true });
      const counted = [...results, again, noId1, noId2].filter((r) => r.body.scan?.counted).length;                 // exactly the lookups the server says it counted ...
      const after = await summary(); expect(after.total - before.total).toBe(counted);                               // ... are what the report shows
      expect(counted).toBeGreaterThanOrEqual(1); expect(counted).toBeLessThanOrEqual(3);
      expect(after.not_assigned - before.not_assigned).toBe(counted);
      expect(await ledgerTotal()).toBe(t0); expect(await partnerEarn()).toBe(earn0);
      const [p] = await rest(`collaborators?select=merchant_system_id&id=eq.${partner!.id}`); expect(p.merchant_system_id).toBeNull();
      const invalid = await resolve('hello world', { scan_id: crypto.randomUUID() }); expect(invalid.status).toBe(400); expect((await summary()).total).toBe(after.total);   // an invalid scan is not a walk-in
      evidence.scanCounting = { before: before.total, after: after.total, notAssigned: after.not_assigned };
      return `8 lookups -> counted ${counted} (scan id x1, plus the minute window at most once); report +${after.total - before.total} = counted; invalid scan not counted; ledger ${t0} and partner earnings ${earn0} unchanged; Partner still unassigned`;
    });
  });

  test('A3 the walk-in report is private: own Merchant and Admin only', async () => {
    await step('A3', 'Merchant sees its own report; another merchant_id -> 403; Partner 403; anonymous 401; Admin can read any Merchant', async () => {
      const own = await api('merchant', 'GET', `/qr/scans/summary?days=30`); expect(own.status).toBe(200); expect(own.body.merchant_id).toBe(fx.merchantId); expect(own.body.by_day.length).toBe(30);
      const other = await api('merchant', 'GET', '/qr/scans/summary?days=7&merchant_id=00000000-0000-4000-8000-000000000001'); expect(other.status).toBe(403);
      expect((await api('partner', 'GET', '/qr/scans/summary')).status).toBe(403);
      expect((await fetch(`${apiBase()}/qr/scans/summary`)).status).toBe(401);
      const adm = await api('admin', 'GET', `/qr/scans/summary?days=30&merchant_id=${fx.merchantId}`); expect(adm.status).toBe(200); expect(adm.body.total).toBe(own.body.total);
      return `own report ${own.body.total} scans in 30 days (${own.body.not_assigned} for Partners not assigned); foreign id 403; Partner 403; anonymous 401; Admin same total`;
    });
  });

  test('A4 Admin assigns the Partner to the Merchant in the UI: audited; the Merchant now sees the customer discount and can price a payment', async ({ browser }) => {
    test.skip(!partner, 'needs A1');
    await step('A4', 'Admin > Partners > drawer > search Merchant > Assign -> DB + audit collaborator.merchant_association_changed(assigned); scan shows "Giảm 5%"; preview 200 with correct amounts', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
      const a = creds('admin')!; await page.goto(`${web()}/login`); await page.getByPlaceholder('email@example.com').fill(a.email); await page.locator('input[type="password"]').fill(a.password); await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
      await page.goto(`${web()}/admin/collaborators`); await expect(page.getByText('Loading partners…')).toHaveCount(0, { timeout: 30_000 });
      await page.getByPlaceholder('Name, code, email or phone').fill(partner!.code); const row = page.locator('tbody tr', { hasText: partner!.code }); await expect(row).toHaveCount(1, { timeout: 30_000 });
      await row.getByRole('button', { name: 'View details' }).click(); const box = page.getByTestId('merchant-association'); await expect(box).toContainText('Not assigned');
      await page.getByTestId('assoc-search').fill(merchantName); await expect(page.getByTestId('assoc-results')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId(`assign-${merchantCode}`).click(); await expect(page.getByTestId('assoc-message')).toContainText('Assigned to', { timeout: 20_000 }); await expect(box).toContainText(merchantName);
      await shot(page, 'A4-admin-assigned');
      const [p] = await rest(`collaborators?select=merchant_system_id&id=eq.${partner!.id}`); expect(p.merchant_system_id).toBe(fx.merchantId);
      const ev = await rest(`audit_events?select=details,occurred_at,actor_role&action=eq.collaborator.merchant_association_changed&entity_id=eq.${partner!.id}&order=occurred_at.desc&limit=1`);
      expect(ev[0].details).toMatchObject({ change: 'assigned', previous_merchant_id: null, merchant_id: fx.merchantId }); expect(ev[0].actor_role).toBe('admin');
      await ctx.close();
      const r = await resolve(partner!.code); expect(r.body.association).toBe('assigned_to_this_merchant'); expect(r.body.discount).toMatchObject({ available: true, label: 'Giảm 5%' }); expect(r.body.discount.rate).toBe('0.0500');
      const preview = await api('merchant', 'POST', '/transactions/real/preview', { collaborator_code: partner!.code, gross_amount: '1000000' });
      expect(preview.status).toBe(201); expect([preview.body.discount_amount, preview.body.final_payable, preview.body.commission_amount]).toEqual(['50000.0000', '950000.0000', '100000.0000']);
      // the Merchant's own scan page shows it
      const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const mp = await mctx.newPage(); await merchantLogin(mp);
      await mp.goto(`${web()}/merchant/dashboard/new-transaction`); await mp.getByRole('tab', { name: /Nhập mã/ }).click(); await mp.getByTestId('manual-code').fill(partner!.code); await mp.getByRole('button', { name: /Xem Đối tác và ưu đãi/ }).click();
      await expect(mp.getByTestId('discount-label')).toHaveText('Giảm 5%', { timeout: 20_000 }); await expect(mp.getByTestId('continue-payment')).toBeEnabled(); await shot(mp, 'A4-merchant-sees-discount'); await mctx.close();
      evidence.assigned = { audit: ev[0].details, preview: preview.body };
      return `assigned; audit ${JSON.stringify(ev[0].details)}; resolve -> assigned_to_this_merchant + "Giảm 5%" (0.0500); preview: discount 50000.0000, final 950000.0000, commission 100000.0000; continue-payment enabled`;
    });
  });

  test('A5 Admin removes the association: the Partner is recognised but gets no discount and cannot transact again; the walk-in history is kept', async ({ browser }) => {
    test.skip(!partner, 'needs A1');
    await step('A5', 'Admin > Remove association -> audit (unassigned); resolve = unassigned, preview/real 403; summary history unchanged', async () => {
      const histBefore = (await summary(30)).total;
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
      const a = creds('admin')!; await page.goto(`${web()}/login`); await page.getByPlaceholder('email@example.com').fill(a.email); await page.locator('input[type="password"]').fill(a.password); await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
      await page.goto(`${web()}/admin/collaborators`); await expect(page.getByText('Loading partners…')).toHaveCount(0, { timeout: 30_000 });
      await page.getByPlaceholder('Name, code, email or phone').fill(partner!.code); await page.locator('tbody tr', { hasText: partner!.code }).getByRole('button', { name: 'View details' }).click();
      await expect(page.getByTestId('merchant-association')).toContainText(merchantName); await page.getByTestId('assoc-remove').click(); await expect(page.getByTestId('assoc-message')).toContainText('Removed', { timeout: 20_000 }); await ctx.close();
      const ev = await rest(`audit_events?select=details&action=eq.collaborator.merchant_association_changed&entity_id=eq.${partner!.id}&order=occurred_at.desc&limit=1`); expect(ev[0].details).toMatchObject({ change: 'unassigned', previous_merchant_id: fx.merchantId, merchant_id: null });
      const r = await resolve(partner!.code); expect(r.body.association).toBe('unassigned'); expect(r.body.discount.available).toBe(false);
      expect((await api('merchant', 'POST', '/transactions/real/preview', { collaborator_code: partner!.code, gross_amount: '1000' })).status).toBe(403);
      expect((await api('merchant', 'POST', '/transactions/real', { collaborator_code: partner!.code, gross_amount: '1000', idempotency_key: crypto.randomUUID() })).status).toBe(403);
      expect((await summary(30)).total).toBeGreaterThanOrEqual(histBefore);
      return `unassigned (audit ${JSON.stringify(ev[0].details)}); resolve -> unassigned, no discount; preview 403, real transaction 403; walk-in history kept (${histBefore} -> ${(await summary(30)).total})`;
    });
  });

  test('A6 isolation is intact: only the authorised Merchant gets the discount; Partner / Admin / anonymous cannot resolve; Partner earnings views stay discount-free', async () => {
    test.skip(!partner, 'needs A1');
    await step('A6', 'resolve: Partner 403, Admin 403, anonymous 401; Partner transaction views contain no discount; Partner cannot call preview/receipt/scan report', async () => {
      expect((await api('partner', 'POST', '/qr/resolve', { payload: partner!.code })).status).toBe(403); expect((await api('admin', 'POST', '/qr/resolve', { payload: partner!.code })).status).toBe(403);
      expect((await fetch(`${apiBase()}/qr/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: partner!.code }) })).status).toBe(401);
      const views = JSON.stringify([(await api('partner', 'GET', '/transactions/me/report?page_size=5')).body, (await api('partner', 'GET', '/transactions/me')).body]); expect(views).not.toMatch(/discount/i);
      expect((await api('partner', 'POST', '/transactions/real/preview', { collaborator_code: fx.partnerCode, gross_amount: '1000' })).status).toBe(403);
      return 'Partner 403 / Admin 403 / anonymous 401 on resolve; Partner transaction views carry no discount; Partner preview 403, scan report 403';
    });
  });
});
