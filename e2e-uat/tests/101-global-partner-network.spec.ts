import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { api, hasCreds, useIdentity } from '../lib/api';
import { config, creds, EVIDENCE_DIR, RUN_ID } from '../lib/env';
import { record } from '../lib/evidence';
import { readFixture, Fixture } from '../lib/fixture';
import { eq4, fmt, mul, toUnits } from '../lib/money';
import { formatVnd } from '../../frontend/lib/qr/money';

// GLOBAL PARTNER NETWORK (owner decision 2026-11-09): every ACTIVE Partner can be scanned by and transact at every ACTIVE Merchant. There is NO Partner-to-Merchant assignment.
//   A  Partner3 (COL-986A45914FA0BF7E) scans successfully at a Merchant without any assignment            B  the same Partner scans at a SECOND active Merchant
//   C  each Merchant resolves its OWN discount policy; "Không có ưu đãi áp dụng" when none                 D  a valid scan with no invoice = one walk-in, no commission
//   E  the Merchant types ONLY the invoice amount; the system computes everything                          F  the transaction succeeds without an assignment (idempotent, audited, linked to its scan)
//   G  inactive Partner / unauthorised Merchant actions stay denied                                        H  Admin has no assignment controls; Merchant Profile fixes untouched (spec 100)
//   I  reporting stays scoped                                                                              P  no commercial policy configured = an explicit configuration answer
// Partner3 is only SCANNED (a scan row is written, as the acceptance asks); it is never modified, never given a Merchant and never given a transaction.
// A temporary synthetic second Merchant is created for B/C/G/P and removed afterwards. Transactions are recorded for a SYNTHETIC unassigned Partner only.
// Run through `railway run --service vno-api` (service key for reads and the temporary Merchant); before a deploy also with E2E_TARGET=candidate.
const step = async (id: string, title: string, fn: () => Promise<string | void>) => {
  try { const detail = await fn(); record(id, title, 'PASS', detail || ''); } catch (e: any) { record(id, title, 'FAIL', e?.message?.split('\n')[0]); throw e; }
};
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY!;
const svc = (extra: Record<string, string> = {}) => { process.env.E2E_ADMIN_SERVICE_TOKEN = key(); return { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...extra }; };
async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${config().supabase}/rest/v1/${path}`, { ...init, headers: svc({ Prefer: 'return=representation', ...((init.headers as Record<string, string>) || {}) }) });
  if (!r.ok) throw new Error(`REST ${(init.method || 'GET')} ${path.split('?')[0]} HTTP ${r.status}`); const t = await r.text(); return t ? (JSON.parse(t) as any[]) : [];
}
async function count(path: string) {
  const r = await fetch(`${config().supabase}/rest/v1/${path}`, { method: 'HEAD', headers: svc({ Prefer: 'count=exact' }) });
  if (!r.ok) throw new Error(`REST count ${path.split('?')[0]} HTTP ${r.status}`); return Number((r.headers.get('content-range') || '*/0').split('/')[1]);
}
async function authAdmin(path: string, init: RequestInit = {}) {
  const r = await fetch(`${config().supabase}/auth/v1/admin/${path}`, { ...init, headers: svc() }); const t = await r.text();
  if (!r.ok) throw new Error(`Auth admin ${(init.method || 'GET')} ${path.split('/')[0]} HTTP ${r.status}`); return t ? JSON.parse(t) : {};
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${EVIDENCE_DIR}/screens/${name}.png` }).catch(() => undefined);
const evidence: Record<string, unknown> = { run: RUN_ID };

const PARTNER3 = 'COL-986A45914FA0BF7E';
const PENDING_PARTNER = 'COL-05C60E056C3D4B5B';          // exists but is not active
const UNKNOWN_CODE = 'COL-0000000000000000';
const P3_COLUMNS = 'id,collaborators_code,collaborators_name,collaborators_status,collaborators_verified,merchant_system_id,collaborators_email,collaborators_phone';

test.skip(!process.env.SUPABASE_SERVICE_ROLE_KEY || !hasCreds('admin') || !readFixture(), 'BLOCKED: run via `railway run --service vno-api` with admin credentials and the paired fixture');

test.describe.serial('Global Partner network: any active Partner at any active Merchant', () => {
  const web = () => config().web; const apiBase = () => config().api;
  let fx: Fixture; let m1 = { d: '0.0500', c: '0.1000' };
  let p3: Record<string, any> | null = null; let synth: { id: string; code: string; name: string; assigned: string | null } | null = null;
  let B: { id: string; userId: string; email: string; password: string; code: string } | null = null;
  let assocAuditBefore = 0; let txForF: { id: string; docNo: string; key: string; scanId: string } | null = null;
  const b2 = { d: '0.0300', c: '0.0800' };

  const resolve = (role: 'merchant' | 'merchant2', payload: string, extra: Record<string, unknown> = {}) => api(role, 'POST', '/qr/resolve', { payload, ...extra });
  const preview = (role: 'merchant' | 'merchant2' | 'partner' | 'admin' | 'outsider', code: string, gross = '1000000') => api(role, 'POST', '/transactions/real/preview', { collaborator_code: code, gross_amount: gross });
  const create = (role: 'merchant' | 'merchant2' | 'partner' | 'admin' | 'outsider', code: string, gross: string, extra: Record<string, unknown> = {}) => api(role, 'POST', '/transactions/real', { collaborator_code: code, gross_amount: gross, idempotency_key: randomUUID(), ...extra });
  const p3Row = async () => (await rest(`collaborators?select=${P3_COLUMNS}&collaborators_code=eq.${PARTNER3}`))[0] ?? null;
  const ledgerOf = (merchantId: string) => count(`referral_transactions?merchant_id=eq.${merchantId}&record_kind=eq.real_transaction`);
  const summaryOf = async (role: 'merchant' | 'merchant2' | 'admin', q = 'days=30') => (await api(role, 'GET', `/qr/scans/summary?${q}`)).body;
  const patchB = (body: Record<string, unknown>) => rest(`merchant_details?merchant_system_id=eq.${B!.id}`, { method: 'PATCH', body: JSON.stringify(body) });
  const restoreB = () => patchB({ merchants_status: 'active', merchant_verified: true, merchant_discount_type: 'percentage', merchant_discount_value: Number(b2.d), merchant_commission_type: 'percentage', merchant_commission_value: Number(b2.c) });
  const uiLogin = async (page: Page, c: { email: string; password: string }, landing: RegExp) => {
    await page.goto(`${web()}/login`); await page.getByPlaceholder('email@example.com').fill(c.email); await page.locator('input[type="password"]').fill(c.password);
    await page.locator('button[type="submit"]').click(); await expect(page).toHaveURL(landing, { timeout: 30_000 }); await page.waitForLoadState('networkidle').catch(() => undefined);
  };
  const scanByCode = async (page: Page, code: string) => {
    await page.goto(`${web()}/merchant/dashboard/new-transaction`); await expect(page.getByTestId('qr-scanner')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('tab', { name: /Nhập mã/ }).click(); await page.getByTestId('manual-code').fill(code); await page.getByRole('button', { name: /Xem Đối tác và ưu đãi/ }).click();
    await expect(page.getByTestId('partner-result')).toBeVisible({ timeout: 20_000 });
  };

  test.beforeAll(async () => {
    fx = readFixture()!; useIdentity('merchant', fx.merchant); useIdentity('partner', fx.partner);
    const m = (await api('admin', 'GET', `/merchants/${fx.merchantId}`)).body; m1 = { d: fmt(toUnits(String(m.merchant_discount_value))), c: fmt(toUnits(String(m.merchant_commission_value))) };
    p3 = await p3Row();
    const rows = await rest(`collaborators?select=id,collaborators_code,collaborators_name,merchant_system_id&collaborators_status=eq.active&collaborators_verified=eq.true&merchant_system_id=is.null&collaborators_email=ilike.*vno-uat-synthetic.example&order=created_at.desc&limit=1`);
    if (rows.length) synth = { id: rows[0].id, code: rows[0].collaborators_code, name: rows[0].collaborators_name, assigned: rows[0].merchant_system_id };
    assocAuditBefore = await count('audit_events?action=eq.collaborator.merchant_association_changed');
    fs.mkdirSync(`${EVIDENCE_DIR}/screens`, { recursive: true });
    // a temporary, clearly-labelled SECOND active Merchant with its own policy (3% discount / 8% commission); no mail is ever sent (admin-created, confirmed, .example domain)
    const password = `Vn0-${randomBytes(9).toString('base64url')}`; const email = `uat-e2e-merchant-b-${RUN_ID}@vno-uat-synthetic.example`;
    const user = await authAdmin('users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) });
    const code = `UAT-E2E-B-${RUN_ID}`;
    const [merchant] = await rest('merchant_details', { method: 'POST', body: JSON.stringify({
      merchant_code: code, merchant_name: code, merchant_email: email, owner_email: email, merchant_verified: true, merchants_status: 'active',
      merchant_discount_type: 'percentage', merchant_discount_value: Number(b2.d), merchant_commission_type: 'percentage', merchant_commission_value: Number(b2.c),
      merchant_registered_date: new Date().toISOString(),
    }) });
    await rest('user_profiles', { method: 'POST', body: JSON.stringify({ user_id: user.id, email, role: 'merchant', merchant_id: merchant.merchant_system_id, user_profiles_status: 'active', login_count: 0 }) });
    B = { id: merchant.merchant_system_id, userId: user.id, email, password, code };
    process.env.E2E_MERCHANT2_EMAIL = email; process.env.E2E_MERCHANT2_PASSWORD = password; useIdentity('merchant2', { email, password });
  });

  test.afterAll(async () => {
    const notes: string[] = [];
    if (B) {
      const attempt = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (e: any) { notes.push(`${label}: ${e?.message}`); } };
      await attempt('scan rows', () => rest(`partner_scan_events?merchant_id=eq.${B!.id}`, { method: 'DELETE' }));
      await attempt('profile', () => rest(`user_profiles?user_id=eq.${B!.userId}`, { method: 'DELETE' }));
      await attempt('merchant', () => rest(`merchant_details?merchant_system_id=eq.${B!.id}`, { method: 'DELETE' }));
      await attempt('auth user', () => authAdmin(`users/${B!.userId}`, { method: 'DELETE' }));
      if (notes.length) { await attempt('deactivate merchant', () => rest(`merchant_details?merchant_system_id=eq.${B!.id}`, { method: 'PATCH', body: JSON.stringify({ merchants_status: 'inactive' }) })); await attempt('deactivate profile', () => rest(`user_profiles?user_id=eq.${B!.userId}`, { method: 'PATCH', body: JSON.stringify({ user_profiles_status: 'inactive' }) })); }
      evidence.temporaryMerchant = { code: B.code, removed: notes.length === 0, notes };
    }
    useIdentity('merchant2', { email: '', password: '' });
    fs.writeFileSync(`${EVIDENCE_DIR}/global-partner-network-${RUN_ID}.json`, JSON.stringify(evidence, null, 2));
  });

  // ============================ A / B / C : scanning and per-Merchant discount ====================================================================================
  test('A Partner3 scans successfully at a Merchant it was never assigned to', async () => {
    test.skip(!p3, 'BLOCKED: Partner3 COL-986A45914FA0BF7E does not exist in this database');
    await step('A', 'Partner3 (active, no Merchant) resolved at the fixture Merchant: identity + that Merchant\'s discount, one walk-in recorded, nothing else created, Partner3 untouched', async () => {
      expect(p3!.collaborators_status).toBe('active'); expect(p3!.merchant_system_id, 'Partner3 must still be unassigned for this scenario to mean anything').toBeNull();
      const tx0 = await count(`referral_transactions?collaborator_id=eq.${p3!.id}`); const sid = randomUUID();
      const r = await resolve('merchant', PARTNER3, { scan_id: sid, source: 'manual' });
      expect(r.status).toBe(201); expect(r.body.partner).toMatchObject({ code: PARTNER3, verified: true, status: 'active' }); expect(String(r.body.partner.name).length).toBeGreaterThan(0);
      expect('association' in r.body).toBe(false); expect(JSON.stringify(r.body)).not.toMatch(/chưa được gán|not_assigned|unassigned|partner_not_assigned/);
      expect(r.body.discount).toMatchObject({ available: true, kind: 'percentage' }); expect(eq4(r.body.discount.rate, m1.d)).toBe(true); expect(r.body.payment).toEqual({ available: true });
      expect(r.body.scan).toMatchObject({ counted: true, duplicate: false }); expect(r.body.financial_action_created).toBe(false);
      const [row] = await rest(`partner_scan_events?select=id,merchant_id,collaborator_id,source,key_kind&id=eq.${r.body.scan.id}`);
      expect(row).toMatchObject({ merchant_id: fx.merchantId, collaborator_id: p3!.id, source: 'manual', key_kind: 'scan_id' });
      expect(await count(`referral_transactions?collaborator_id=eq.${p3!.id}`)).toBe(tx0); expect(await p3Row()).toEqual(p3);
      evidence.A = { partner: PARTNER3, scanEvent: r.body.scan.id, discount: r.body.discount };
      return `${r.body.partner.name} ${PARTNER3}: ${r.body.discount.label} (rate ${r.body.discount.rate}); payment.available=true; walk-in ${r.body.scan.id} recorded; Partner3 row identical before/after; ${tx0} transactions before and after`;
    });
  });

  test('B the same Partner scans successfully at a second active Merchant', async () => {
    test.skip(!p3, 'BLOCKED: Partner3 does not exist in this database');
    await step('B', 'Partner3 resolved at the temporary second Merchant: its own scan row; Partner3 still unassigned and untouched', async () => {
      const sid = randomUUID(); const r = await resolve('merchant2', PARTNER3, { scan_id: sid, source: 'manual' });
      expect(r.status).toBe(201); expect(r.body.partner).toMatchObject({ code: PARTNER3, verified: true, status: 'active' }); expect(r.body.scan.counted).toBe(true);
      const [row] = await rest(`partner_scan_events?select=merchant_id,collaborator_id&id=eq.${r.body.scan.id}`); expect(row).toMatchObject({ merchant_id: B!.id, collaborator_id: p3!.id });
      expect(await p3Row()).toEqual(p3); expect(p3!.merchant_system_id).toBeNull();
      return `resolved at ${B!.code} (scan ${r.body.scan.id}); Partner3 merchant_system_id still null`;
    });
  });

  test('C each Merchant resolves its own customer-discount policy; "Không có ưu đãi áp dụng" when none', async ({ browser }) => {
    await step('C', 'fixture Merchant 5%, second Merchant 3%; no discount / legacy points -> unavailable with a reason; UI shows the exact Vietnamese sentence and never an "assigned" message', async () => {
      const code = p3 ? PARTNER3 : synth!.code;
      const a = await resolve('merchant', code); const b = await resolve('merchant2', code);
      expect(a.body.discount).toMatchObject({ available: true, label: `Giảm ${Number(m1.d) * 100}%` }); expect(eq4(a.body.discount.rate, m1.d)).toBe(true);
      expect(b.body.discount).toMatchObject({ available: true, label: 'Giảm 3%' }); expect(eq4(b.body.discount.rate, b2.d)).toBe(true);
      await patchB({ merchant_discount_type: null, merchant_discount_value: null });
      const none = await resolve('merchant2', code); expect(none.body.discount).toEqual({ available: false, kind: null, rate: null, label: null, reason: 'no_discount' }); expect(none.body.payment).toEqual({ available: true });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
      await uiLogin(page, { email: B!.email, password: B!.password }, /merchant\/dashboard/); await scanByCode(page, code);
      await expect(page.getByTestId('discount-label')).toHaveText('Không có ưu đãi áp dụng'); await expect(page.getByTestId('partner-result')).not.toContainText(/chưa được gán|chưa liên kết/);
      await expect(page.getByTestId('continue-payment')).toBeEnabled(); await shot(page, 'C-no-discount-ui');
      await patchB({ merchant_discount_type: 'points', merchant_discount_value: 8 });
      const legacy = await resolve('merchant2', code); expect(legacy.body.discount).toMatchObject({ available: false, reason: 'rate_not_reviewed' });
      await restoreB(); const again = await resolve('merchant2', code); expect(again.body.discount.label).toBe('Giảm 3%'); await ctx.close();
      evidence.C = { fixtureMerchant: a.body.discount, secondMerchant: b.body.discount };
      return `fixture Merchant ${a.body.discount.label} (${a.body.discount.rate}); second Merchant ${b.body.discount.label} (${b.body.discount.rate}); no policy -> "Không có ưu đãi áp dụng" (UI) with payment still possible; legacy points -> rate_not_reviewed; restored`;
    });
  });

  // ============================ D : scan-only is a walk-in, nothing financial ===================================================================================
  test('D a valid scan with no invoice counts as ONE walk-in and creates no commission', async () => {
    const code = p3 ? PARTNER3 : synth!.code;
    await step('D', 'same scan session x5 in parallel -> one walk-in; ledger, ledger events, transaction audit rows, Partner earnings and the report\'s "with transaction" unchanged; an invalid code is not a walk-in', async () => {
      const partnerId = p3 ? p3.id : synth!.id;
      const s0 = await summaryOf('merchant'); const l0 = await ledgerOf(fx.merchantId); const e0 = await count('transaction_events'); const a0 = await count('audit_events?action=like.transaction.*'); const earn0 = await count(`referral_transactions?collaborator_id=eq.${partnerId}&record_kind=eq.real_transaction`);
      const sid = randomUUID(); const rs = await Promise.all([1, 2, 3, 4, 5].map(() => resolve('merchant', code, { scan_id: sid, source: 'camera' })));
      expect(rs.filter((r) => r.body.scan?.counted).length).toBe(1); expect(rs.filter((r) => r.body.scan?.duplicate).length).toBe(4); expect(new Set(rs.map((r) => r.body.scan?.id)).size).toBe(1);
      expect(await count(`partner_scan_events?merchant_id=eq.${fx.merchantId}&scan_key=like.s:${sid}:*`)).toBe(1);
      const bad = await resolve('merchant', 'hello world', { scan_id: randomUUID() }); expect(bad.status).toBe(400);
      const s1 = await summaryOf('merchant'); expect(s1.total - s0.total).toBe(1); expect(s1.with_transaction).toBe(s0.with_transaction);
      expect([await ledgerOf(fx.merchantId), await count('transaction_events'), await count('audit_events?action=like.transaction.*'), await count(`referral_transactions?collaborator_id=eq.${partnerId}&record_kind=eq.real_transaction`)]).toEqual([l0, e0, a0, earn0]);
      evidence.D = { walkIns: s1.total - s0.total, ledger: l0 };
      return `5 detections of one scan session -> 1 walk-in (report +1); invalid code not counted; ledger ${l0}, ledger events ${e0}, transaction audit rows ${a0}, Partner transactions ${earn0} all unchanged`;
    });
  });

  // ============================ E / F : the Merchant types only the amount; the transaction succeeds without an assignment ==================================
  test('E+F the Merchant enters ONLY the invoice amount; every figure is computed; one explicit confirmation records the transaction for an UNASSIGNED Partner', async ({ browser }) => {
    test.skip(!synth, 'BLOCKED: no synthetic active unassigned Partner is available');
    test.setTimeout(240_000);
    const gross = '1250000'; const g4 = fmt(toUnits(gross)); const disc = mul(g4, m1.d); const commission = mul(g4, m1.c); const final = fmt(toUnits(g4) - toUnits(disc));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
    const reqs: string[] = []; page.on('request', (rq) => { if (rq.method() === 'POST' && /\/transactions\/real(\/preview)?$/.test(rq.url())) reqs.push(rq.url().replace(apiBase(), '')); });
    const earned0 = Number((await api('admin', 'GET', `/transactions/report?collaborator_id=${synth!.id}&record_kind=real_transaction&page_size=1`)).body.summary.commission_amount);
    await uiLogin(page, fx.merchant, /merchant\/dashboard/); await scanByCode(page, synth!.code);
    await step('E', 'unassigned Partner scanned by code -> "Tiếp tục thanh toán" enabled; the payment step has ONE input (the invoice amount); discount, final and commission appear from the server', async () => {
      await expect(page.getByTestId('partner-code')).toHaveText(synth!.code); await expect(page.getByTestId('continue-payment')).toBeEnabled(); await expect(page.getByTestId('payment-unavailable')).toHaveCount(0);
      await page.getByTestId('continue-payment').click(); await expect(page.getByTestId('payment-step')).toBeVisible();
      await expect(page.getByTestId('payment-step').locator('input')).toHaveCount(1);
      await page.getByTestId('gross-input').fill(gross);
      await expect(page.getByTestId('pay-original')).toHaveText(formatVnd(g4)); await expect(page.getByTestId('pay-discount')).toContainText(formatVnd(disc).replace(/\s/g, ' '));
      await expect(page.getByTestId('pay-final')).toHaveText(formatVnd(final)); await expect(page.getByTestId('pay-commission')).toHaveText(formatVnd(commission));
      expect(reqs.every((r) => r.endsWith('/preview'))).toBe(true); await shot(page, 'E-amount-only');
      return `only the amount ${gross} typed; shown: discount ${disc} (${m1.d}), final ${final}, commission ${commission} (${m1.c} on the original amount); before confirmation only /preview was called (${reqs.length}x)`;
    });
    await step('F', 'one confirmation -> receipt; the transaction exists for the UNASSIGNED Partner, linked to its scan, confirmed, audited; the Partner stays unassigned; replay is idempotent; commission counted once', async () => {
      await page.getByTestId('confirm-payment').click(); await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 40_000 });
      const docNo = (await page.getByTestId('receipt-number').innerText()).trim();
      await expect(page.getByTestId('receipt-original')).toHaveText(formatVnd(g4)); await expect(page.getByTestId('receipt-final')).toHaveText(formatVnd(final)); await expect(page.getByTestId('receipt-commission')).toHaveText(formatVnd(commission)); await shot(page, 'F-receipt');
      const rows = await rest(`referral_transactions?select=id,idempotency_key,collaborator_id,merchant_id,scan_event_id,record_kind,lifecycle_status,payment_status,document_total,document_discount_percent,document_discount_amount,commission_percent,commission_amount&document_number=eq.${docNo}`);
      expect(rows.length).toBe(1); const t = rows[0];
      expect(t).toMatchObject({ collaborator_id: synth!.id, merchant_id: fx.merchantId, record_kind: 'real_transaction', lifecycle_status: 'confirmed' }); expect(t.scan_event_id).toBeTruthy();
      expect([eq4(t.document_total, g4), eq4(t.document_discount_amount, disc), eq4(t.commission_amount, commission), eq4(t.document_discount_percent, m1.d), eq4(t.commission_percent, m1.c)]).toEqual([true, true, true, true, true]);
      const [scan] = await rest(`partner_scan_events?select=merchant_id,collaborator_id&id=eq.${t.scan_event_id}`); expect(scan).toMatchObject({ merchant_id: fx.merchantId, collaborator_id: synth!.id });
      const events = await rest(`transaction_events?select=event_type&transaction_id=eq.${t.id}&order=occurred_at.asc`); expect(events.map((e: any) => e.event_type)).toEqual(['real_transaction_recorded', 'real_transaction_confirmed']);
      const audit = await rest(`audit_events?select=details&action=eq.transaction.real_recorded&entity_id=eq.${t.id}`); expect(audit.length).toBe(1); expect(audit[0].details.scan_event_id).toBe(t.scan_event_id);
      const [sp] = await rest(`collaborators?select=merchant_system_id&id=eq.${synth!.id}`); expect(sp.merchant_system_id, 'nothing assigned the Partner').toBeNull();
      const l1 = await ledgerOf(fx.merchantId); const replay = await api('merchant', 'POST', '/transactions/real', { collaborator_code: synth!.code, gross_amount: gross, idempotency_key: t.idempotency_key, scan_event_id: t.scan_event_id });
      expect(replay.status).toBe(201); expect(replay.body.idempotent_replay).toBe(true); expect(replay.body.transaction_id).toBe(t.id); expect(await ledgerOf(fx.merchantId)).toBe(l1);
      expect((await api('merchant', 'POST', '/transactions/real', { collaborator_code: synth!.code, gross_amount: '1', idempotency_key: t.idempotency_key })).status).toBe(409);
      const earned1 = Number((await api('admin', 'GET', `/transactions/report?collaborator_id=${synth!.id}&record_kind=real_transaction&page_size=1`)).body.summary.commission_amount);
      expect(earned1 - earned0).toBeCloseTo(Number(commission), 4); const s = await summaryOf('merchant'); expect(s.with_transaction).toBeGreaterThanOrEqual(1);
      txForF = { id: t.id, docNo, key: t.idempotency_key, scanId: t.scan_event_id }; evidence.F = { docNo, scanEvent: t.scan_event_id, discount: disc, final, commission };
      await ctx.close();
      return `${docNo}: confirmed, Partner ${synth!.code} (merchant_system_id still null), linked to scan ${t.scan_event_id}; events recorded+confirmed; audit row carries the scan; replay = same transaction (no second commission); other input on the same key = 409; Partner commission +${commission} exactly once`;
    });
  });

  // ============================ P : no commercial policy configured -> an explicit answer ======================================================================
  test('P a Merchant without a commission policy gets an explicit configuration answer; nothing is guessed or recorded; an approved zero is allowed', async ({ browser }) => {
    test.skip(!synth, 'BLOCKED: no synthetic active unassigned Partner is available');
    await step('P', 'commission missing -> scan still counts, payment.available=false + 422 COMMISSION_POLICY_MISSING on preview and create, UI explains; nothing configured -> no discount AND no payment; explicit 0% commission -> allowed, 0 commission', async () => {
      const l0 = await ledgerOf(B!.id);
      await patchB({ merchant_commission_type: null, merchant_commission_value: null });
      const r = await resolve('merchant2', synth!.code, { scan_id: randomUUID() }); expect(r.status).toBe(201); expect(r.body.scan.counted).toBe(true);
      expect(r.body.payment).toMatchObject({ available: false, reason: 'COMMISSION_POLICY_MISSING' }); expect(String(r.body.payment.message)).toMatch(/hoa hồng/); expect(r.body.discount.available).toBe(true);
      const pv = await preview('merchant2', synth!.code); expect(pv.status).toBe(422); expect(pv.body.code).toBe('COMMISSION_POLICY_MISSING'); expect(String(pv.body.message)).toMatch(/[À-ỹ]/);
      const cr = await create('merchant2', synth!.code, '1000'); expect(cr.status).toBe(422); expect(cr.body.code).toBe('COMMISSION_POLICY_MISSING');
      expect(await ledgerOf(B!.id)).toBe(l0);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
      await uiLogin(page, { email: B!.email, password: B!.password }, /merchant\/dashboard/); await scanByCode(page, synth!.code);
      await expect(page.getByTestId('payment-unavailable')).toContainText('hoa hồng'); await expect(page.getByTestId('continue-payment')).toBeDisabled(); await shot(page, 'P-commission-missing-ui');
      await patchB({ merchant_discount_type: null, merchant_discount_value: null });
      const none = await resolve('merchant2', synth!.code, { scan_id: randomUUID() }); expect(none.body.discount.available).toBe(false); expect(none.body.payment.available).toBe(false);
      await page.reload(); await scanByCode(page, synth!.code); await expect(page.getByTestId('discount-label')).toHaveText('Không có ưu đãi áp dụng'); await expect(page.getByTestId('payment-unavailable')).toBeVisible(); await ctx.close();
      await patchB({ merchant_discount_type: 'percentage', merchant_discount_value: Number(b2.d), merchant_commission_type: 'percentage', merchant_commission_value: 0 });
      const zero = await preview('merchant2', synth!.code, '1000000'); expect(zero.status).toBe(201);
      expect([zero.body.discount_amount, zero.body.commission_rate, zero.body.commission_amount, zero.body.final_payable]).toEqual(['30000.0000', '0.0000', '0.0000', '970000.0000']);
      await patchB({ merchant_commission_type: 'percentage', merchant_commission_value: 1.5 });
      const bad = await preview('merchant2', synth!.code); expect(bad.status).toBe(422); expect(bad.body.code).toBe('COMMISSION_POLICY_NOT_REVIEWED');
      await restoreB(); const back = await preview('merchant2', synth!.code, '1000000'); expect([back.body.discount_amount, back.body.commission_amount]).toEqual([fmt(toUnits(mul('1000000.0000', b2.d))), fmt(toUnits(mul('1000000.0000', b2.c)))]);
      expect(await ledgerOf(B!.id)).toBe(l0);
      return 'COMMISSION_POLICY_MISSING (scan, preview 422, create 422, UI message, button disabled; 0 transactions); nothing configured -> "Không có ưu đãi áp dụng" + payment unavailable; explicit 0% -> commission 0.0000; 150% -> COMMISSION_POLICY_NOT_REVIEWED; restored';
    });
  });

  // ============================ G : denials stay denied ========================================================================================================
  test('G inactive Partner and unauthorised actions remain denied; Merchants stay isolated', async () => {
    await step('G', 'pending/unknown Partner refused; Partner / Admin / anonymous / outsider cannot scan, price or create; an unapproved Merchant cannot; Merchants cannot read or change each other; a scan of another Merchant cannot be used', async () => {
      const l1 = await ledgerOf(fx.merchantId); const l2 = await ledgerOf(B!.id); const out: string[] = [];
      const pend = await resolve('merchant', PENDING_PARTNER); expect([pend.status, pend.body.code]).toEqual([409, 'PARTNER_NOT_ACTIVE']);
      expect((await preview('merchant', PENDING_PARTNER)).status).toBe(400); expect((await create('merchant', PENDING_PARTNER, '1000')).status).toBe(400);
      expect((await resolve('merchant', UNKNOWN_CODE)).status).toBe(404); out.push('pending 409/400/400, unknown 404');
      const code = synth!.code; const anonymous = async (path: string, body: unknown) => (await fetch(`${apiBase()}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status;
      for (const role of ['partner', 'admin'] as const) {
        expect((await api(role, 'POST', '/qr/resolve', { payload: code })).status, `${role} resolve`).toBe(403); expect((await preview(role, code)).status, `${role} preview`).toBe(403); expect((await create(role, code, '1000')).status, `${role} create`).toBe(403);
      }
      expect([await anonymous('/qr/resolve', { payload: code }), await anonymous('/transactions/real/preview', { collaborator_code: code, gross_amount: '1' }), await anonymous('/transactions/real', { collaborator_code: code, gross_amount: '1', idempotency_key: randomUUID() })]).toEqual([401, 401, 401]);
      if (hasCreds('outsider')) { expect((await api('outsider', 'POST', '/qr/resolve', { payload: code })).status).toBe(403); expect((await create('outsider', code, '1000')).status).toBe(403); out.push('outsider 403'); }
      await patchB({ merchants_status: 'inactive' });
      const off = await resolve('merchant2', code); expect([off.status, off.body.code]).toEqual([403, 'MERCHANT_NOT_ACTIVE']); expect((await preview('merchant2', code)).status).toBe(403); expect((await create('merchant2', code, '1000')).status).toBe(403);
      await restoreB(); out.push('unapproved Merchant 403 x3');
      expect((await api('merchant', 'GET', `/qr/scans/summary?days=7&merchant_id=${B!.id}`)).status).toBe(403); expect((await api('merchant2', 'GET', `/qr/scans/summary?days=7&merchant_id=${fx.merchantId}`)).status).toBe(403);
      expect((await api('partner', 'GET', '/qr/scans/summary')).status).toBe(403); expect((await fetch(`${apiBase()}/qr/scans/summary`)).status).toBe(401);
      if (txForF) {
        expect((await api('merchant2', 'GET', `/transactions/${txForF.id}/receipt`)).status, 'another Merchant cannot read the receipt').toBe(404);
        const cancel = await api('merchant2', 'POST', `/transactions/${txForF.id}/cancel`, { idempotency_key: randomUUID() }); expect(cancel.status, 'another Merchant cannot cancel').toBeGreaterThanOrEqual(400); expect(cancel.status).toBeLessThan(500);
        const [still] = await rest(`referral_transactions?select=lifecycle_status&id=eq.${txForF.id}`); expect(still.lifecycle_status).toBe('confirmed');
        const mismatch = await create('merchant2', code, '1000', { scan_event_id: txForF.scanId }); expect([mismatch.status, mismatch.body.code]).toEqual([400, 'SCAN_EVENT_MISMATCH']); out.push('foreign receipt 404, foreign cancel refused, foreign scan SCAN_EVENT_MISMATCH');
      }
      const views = JSON.stringify([(await api('partner', 'GET', '/transactions/me/report?page_size=5')).body, (await api('partner', 'GET', '/transactions/me')).body]); expect(views).not.toMatch(/discount/i);
      expect([await ledgerOf(fx.merchantId), await ledgerOf(B!.id)]).toEqual([l1, l2]);
      return `${out.join('; ')}; Partner / Admin 403, anonymous 401 on resolve + preview + create; cross-Merchant reports 403; Partner views carry no discount; no transaction was recorded by any denied call`;
    });
  });

  // ============================ H / I : Admin has no assignment, nothing was auto-assigned, reporting is scoped ================================================
  test('H Admin has no Partner-to-Merchant assignment controls; the public Partner page is global; nothing was assigned or modified', async ({ browser }) => {
    await step('H', 'Admin > Partners: no association column / panel / create-form field; /c/<code> says the code works at every active Merchant; no collaborator.merchant_association_changed audit row was added by this run; Partner3 and the synthetic Partner unchanged', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); const page = await ctx.newPage();
      await uiLogin(page, creds('admin')!, /\/admin/); await page.goto(`${web()}/admin/collaborators`); await expect(page.getByText('Loading partners…')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.locator('thead')).not.toContainText(/Merchant association/i);
      if (synth) { await page.getByPlaceholder('Name, code, email or phone').fill(synth.code); await page.locator('tbody tr', { hasText: synth.code }).getByRole('button', { name: 'View details' }).click(); await expect(page.getByText('Account and activation e-mail')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('merchant-association')).toHaveCount(0); await expect(page.getByText(/Assign to a Merchant|Merchant association/)).toHaveCount(0); await shot(page, 'H-admin-partner-drawer'); await page.keyboard.press('Escape'); }
      await ctx.close();
      const pub = await fetch(`${apiBase()}/c/${p3 ? PARTNER3 : synth!.code}`); const body: any = await pub.json(); expect(pub.status).toBe(200);
      expect(body).toMatchObject({ applies_to: 'all_active_merchants' }); expect(Object.keys(body).some((k) => /merchant/i.test(k.replace('applies_to', '')))).toBe(false);
      const landing = await browser.newPage(); await landing.goto(`${web()}/c/${p3 ? PARTNER3 : synth!.code}`); await expect(landing.getByTestId('partner-network-note')).toBeVisible({ timeout: 20_000 });
      await expect(landing.locator('body')).not.toContainText(/chưa được gán|chưa liên kết/); await shot(landing, 'H-public-partner-page'); await landing.close();
      expect(await count('audit_events?action=eq.collaborator.merchant_association_changed')).toBe(assocAuditBefore);
      if (p3) expect(await p3Row()).toEqual(p3); if (synth) { const [sp] = await rest(`collaborators?select=merchant_system_id&id=eq.${synth.id}`); expect(sp.merchant_system_id).toBe(synth.assigned); }
      return 'no association column, panel or create-form field; public page + /c API are global (no Merchant); association audit rows unchanged; Partner3 row identical to the start of the run; synthetic Partner still unassigned';
    });
  });

  test('I reporting stays correctly scoped (Merchant: own; Admin: any or all; Partner / anonymous: none)', async () => {
    await step('I', 'each Merchant\'s report equals its own scan rows; Admin all = sum of Merchants; Admin filter works; transaction reports are scoped to the Merchant and to the Partner', async () => {
      const own1 = await summaryOf('merchant'); const own2 = await summaryOf('merchant2');
      expect(own1.merchant_id).toBe(fx.merchantId); expect(own2.merchant_id).toBe(B!.id); expect(own1.by_day.length).toBe(30); expect('assigned_to_merchant' in own1).toBe(false);
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      expect(await count(`partner_scan_events?merchant_id=eq.${fx.merchantId}&scanned_at=gte.${since}`)).toBe(own1.total); expect(await count(`partner_scan_events?merchant_id=eq.${B!.id}&scanned_at=gte.${since}`)).toBe(own2.total);
      const all = await summaryOf('admin'); const f1 = await summaryOf('admin', `days=30&merchant_id=${fx.merchantId}`); expect(f1.total).toBe(own1.total); expect(all.total).toBeGreaterThanOrEqual(own1.total + own2.total);
      expect(await count(`partner_scan_events?scanned_at=gte.${since}`)).toBe(all.total);
      const mrep = await api('merchant', 'GET', '/transactions/me/report?record_kind=real_transaction&page_size=100'); expect(mrep.body.items.every((x: any) => x.merchant_id === fx.merchantId)).toBe(true);
      const brep = await api('merchant2', 'GET', '/transactions/me/report?page_size=5'); expect(brep.status).toBe(200); expect(brep.body.total).toBe(0);
      const prep = await api('partner', 'GET', '/transactions/me/report?page_size=100'); expect(prep.body.items.every((x: any) => x.collaborator_id === fx.partnerId)).toBe(true);
      if (txForF) { const seenByAdmin = await api('admin', 'GET', `/transactions/report?collaborator_id=${synth!.id}&record_kind=real_transaction&page_size=50`); expect(seenByAdmin.body.items.some((x: any) => x.id === txForF!.id)).toBe(true); }
      return `Merchant ${own1.total} / ${own2.total} scans (equal to their own rows); Admin all ${all.total}, filtered ${f1.total}; Merchant reports contain only their own transactions (second Merchant: 0); Partner report contains only its own`;
    });
  });
});
