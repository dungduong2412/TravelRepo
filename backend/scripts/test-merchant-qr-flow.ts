// Merchant QR scan / discount inquiry / payment preview, against an in-memory Supabase fake (no network, no real data).
// Covers: the payload parser, the resolver's rules (identity, status, association, discount policy, read-only, rate limit, Merchant-only),
// the preview's arithmetic against an independent reference, and the Partner-side discount redaction.
import assert from 'node:assert/strict';
import { parsePartnerQrPayload } from '../src/modules/qr/partner-qr-payload';
import { QrService } from '../src/modules/qr/qr.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';

// ---- in-memory Supabase -----------------------------------------------------------------------------------------------------------------------
type Row = Record<string, any>;
class Fake {
  tables: Record<string, Row[]> = {};
  writes: string[] = []; selects: Array<{ table: string; cols: string }> = [];
  from(table: string) {
    const db = this; const filters: Array<(r: Row) => boolean> = []; let cols = '*'; let limit = Infinity; let mode: 'select' | 'write' = 'select';
    const rows = () => (db.tables[table] || []).filter((r) => filters.every((f) => f(r))).slice(0, limit);
    const q: any = {
      select: (c: string) => { cols = c; db.selects.push({ table, cols: c }); return q; },
      insert: () => { db.writes.push(`insert ${table}`); mode = 'write'; return q; }, update: () => { db.writes.push(`update ${table}`); mode = 'write'; return q; }, delete: () => { db.writes.push(`delete ${table}`); mode = 'write'; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      ilike: (c: string, v: string) => { const plain = v.replace(/\\([\\%_])/g, '$1').toLowerCase(); filters.push((r) => String(r[c] ?? '').toLowerCase() === plain); return q; },
      or: () => q, order: () => q, range: () => q, is: () => q, gte: () => q, lte: () => q,
      limit: (n: number) => { limit = n; return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'none' } }),
      then: (res: any, rej: any) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(res, rej),
    };
    void mode; void cols;
    return q;
  }
  rpc() { this.writes.push('rpc'); return { single: async () => ({ data: null, error: { message: 'rpc not expected' } }) }; }
}

const MERCHANT_USER = 'user-merchant'; const PARTNER_USER = 'user-partner'; const MID = 'm-1'; const OTHER_MID = 'm-2';
function world(over: { discount?: any; discountType?: any; commission?: any; partner?: Partial<Row>; merchant?: Partial<Row> } = {}) {
  const db = new Fake();
  db.tables.user_profiles = [
    { user_id: MERCHANT_USER, role: 'merchant', user_profiles_status: 'active', merchant_id: MID },
    { user_id: PARTNER_USER, role: 'collaborator', user_profiles_status: 'active', collaborator_id: 'c-1' },
    { user_id: 'user-admin', role: 'admin', user_profiles_status: 'active' },
  ];
  db.tables.merchant_details = [{ merchant_system_id: MID, merchant_verified: true, merchants_status: 'active', merchant_discount_type: 'discountType' in over ? over.discountType : 'percentage', merchant_discount_value: 'discount' in over ? over.discount : 0.05, merchant_commission_type: 'percentage', merchant_commission_value: 'commission' in over ? over.commission : 0.1, ...over.merchant }];
  db.tables.collaborators = [
    { id: 'c-1', collaborators_code: 'COL-D600ABC8D5C2C528', collaborators_name: 'Hướng dẫn viên A', collaborators_verified: true, collaborators_status: 'active', merchant_system_id: MID, collaborators_phone: '0900000000', collaborators_email: 'secret@x.test', ...over.partner },
    { id: 'c-2', collaborators_code: 'COL-ELSEWHERE00000000', collaborators_name: 'Partner B', collaborators_verified: true, collaborators_status: 'active', merchant_system_id: OTHER_MID },
    { id: 'c-3', collaborators_code: 'COL-FREE0000000000000', collaborators_name: 'Partner C', collaborators_verified: true, collaborators_status: 'active', merchant_system_id: null },
    { id: 'c-4', collaborators_code: 'COL-PENDING00000000000', collaborators_name: 'Partner D', collaborators_verified: false, collaborators_status: 'pending', merchant_system_id: MID },
    { id: 'c-5', collaborators_code: 'COL-INACTIVE0000000000', collaborators_name: 'Partner E', collaborators_verified: false, collaborators_status: 'inactive', merchant_system_id: MID },
  ];
  const supabase: any = { getClient: () => db };
  const media: any = { effectiveAvatar: async (_t: string, id: string) => (id === 'c-1' ? { id: 'a-1', signed_url: 'https://files.example.test/avatar.png?sig=1', expires_in: 300 } : null) };
  return { db, qr: new QrService(supabase, media), tx: new TransactionsService(supabase) };
}
const code = (e: any) => e?.getResponse?.().code; const http = (e: any) => e?.getStatus?.();
let controls = 0; const ok = (label: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(() => { controls += 1; }, (e) => { console.error(`FAIL: ${label}`); throw e; });
const CODE = 'COL-D600ABC8D5C2C528';

(async () => {
  // ---- parser -----------------------------------------------------------------------------------------------------------------------------------
  await ok('P1 every form a person or an app can produce resolves to the same code', () => {
    const accept: Array<[string, string]> = [
      [CODE, CODE], [`https://vno-web-uat.up.railway.app/c/${CODE}`, CODE], [`http://localhost:3000/c/${CODE}`, CODE], [`https://old.example.org/c/${CODE}/`, CODE],
      [`https://x.test/c/${CODE}?utm=1#frag`, CODE], [`vno-web-uat.up.railway.app/c/${CODE}`, CODE], [`localhost:3000/c/${CODE}`, CODE], [`  ${CODE}\n`, CODE],
      [`${CODE}​`, CODE], [`﻿${CODE}`, CODE], [`${CODE} `, CODE], [`https://x.test/c/${CODE.toLowerCase()}`, CODE.toLowerCase()], [CODE.toLowerCase(), CODE.toLowerCase()],
      [`https://x.test/c/%43OL-D600ABC8D5C2C528`, CODE], ['ＣＯＬ－D600ABC8D5C2C528'.replace('－', '-'), CODE], ['C2500228', 'C2500228'], ['https://x.test/path/c/C2500228', 'C2500228'],
    ];
    for (const [input, expected] of accept) { const r = parsePartnerQrPayload(input); assert.equal((r as any).code, expected, `accept ${JSON.stringify(input)}`); assert.equal(r.ok, true); }
  });
  await ok('P2 anything else is "unsupported" or "empty" and never reaches a lookup', () => {
    for (const bad of ['', '   ', '​​', 'hello world', '{"a":1}', 'https://example.com/pay?id=123', 'https://x.test/d/COL-ABC', 'https://x.test/c/', 'https://x.test/c/a b', 'javascript:alert(1)//c/COL-ABC',
      'ftp://x.test/c/COL-ABC', 'C', '--bad', 'a'.repeat(65), 'COL- D600', 'https://x.test/c/%E0%A4%A', 'mailto:a@b.test', 12345 as any, null as any, undefined as any]) {
      const r = parsePartnerQrPayload(bad); assert.equal(r.ok, false, `reject ${JSON.stringify(bad)}`);
    }
    assert.equal((parsePartnerQrPayload('   ') as any).reason, 'empty'); assert.equal((parsePartnerQrPayload('hello world') as any).reason, 'unsupported');
  });

  // ---- resolver ---------------------------------------------------------------------------------------------------------------------------------
  await ok('R1 identity: name, avatar, code, status; the established fields are unchanged', async () => {
    const w = world(); const r: any = await w.qr.resolveForMerchant(MERCHANT_USER, `https://vno-web-uat.up.railway.app/c/${CODE}`);
    assert.deepEqual(r.partner, { id: 'c-1', code: CODE, name: 'Hướng dẫn viên A', avatar_url: 'https://files.example.test/avatar.png?sig=1', verified: true, status: 'active' });
    assert.deepEqual([r.collaborator_id, r.collaborator_code, r.collaborator_name, r.verified, r.status, r.association, r.idempotent, r.financial_action_created], ['c-1', CODE, 'Hướng dẫn viên A', true, 'active', 'assigned_to_this_merchant', true, false]);
  });
  await ok('R2 a typed or pasted code resolves case-insensitively; two case variants are refused as ambiguous', async () => {
    const w = world(); assert.equal(((await w.qr.resolveForMerchant(MERCHANT_USER, CODE.toLowerCase())) as any).partner.code, CODE);
    w.db.tables.collaborators.push({ id: 'c-9', collaborators_code: CODE.toLowerCase(), collaborators_name: 'Dup', collaborators_verified: true, collaborators_status: 'active', merchant_system_id: MID });
    assert.equal(((await w.qr.resolveForMerchant(MERCHANT_USER, CODE)) as any).partner.id, 'c-1', 'an exact-case match wins');
    await assert.rejects(w.qr.resolveForMerchant(MERCHANT_USER, 'cOl-d600abc8d5c2c528'), (e: any) => code(e) === 'PARTNER_NOT_FOUND', 'ambiguous case-insensitive match is refused');
  });
  await ok('R3 discount: shown for an assigned Partner when the Merchant policy is a reviewed fraction; label and rate match the catalog rule', async () => {
    const w = world({ discount: 0.05 }); const d = ((await w.qr.resolveForMerchant(MERCHANT_USER, CODE)) as any).discount;
    assert.deepEqual(d, { available: true, kind: 'percentage', rate: '0.0500', label: 'Giảm 5%' });
    assert.equal(((await world({ discount: 0.125 }).qr.resolveForMerchant(MERCHANT_USER, CODE)) as any).discount.label, 'Giảm 12,5%');
  });
  await ok('R4 "no discount" cases: zero, missing, legacy points (8), non-percentage, unassigned Partner — each says why, none shows a discount', async () => {
    const expectNone = async (w: ReturnType<typeof world>, payload: string, reason: string) => { const d = ((await w.qr.resolveForMerchant(MERCHANT_USER, payload)) as any).discount; assert.deepEqual(d, { available: false, kind: null, rate: null, label: null, reason }); };
    await expectNone(world({ discount: 0 }), CODE, 'no_discount'); await expectNone(world({ discount: null }), CODE, 'no_discount');
    await expectNone(world({ discount: 8 }), CODE, 'rate_not_reviewed'); await expectNone(world({ discountType: 'fixed', discount: 0.05 }), CODE, 'rate_not_reviewed');
    await expectNone(world(), 'COL-ELSEWHERE00000000', 'partner_not_assigned'); await expectNone(world(), 'COL-FREE0000000000000', 'partner_not_assigned');
  });
  await ok('R5 nothing private leaks: no commission, phone, e-mail, bank or ids of the Merchant policy in the answer', async () => {
    const w = world({ commission: 0.123456 }); const text = JSON.stringify(await w.qr.resolveForMerchant(MERCHANT_USER, CODE));
    for (const secret of ['0.1234', 'commission', '0900000000', 'secret@x.test', 'bank', 'merchant_commission']) assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, `leaked ${secret}`);
  });
  await ok('R6 scanning is read-only: no insert, update, delete or RPC of any kind', async () => {
    const w = world(); for (const p of [CODE, 'COL-ELSEWHERE00000000', 'COL-FREE0000000000000']) await w.qr.resolveForMerchant(MERCHANT_USER, p);
    await assert.rejects(w.qr.resolveForMerchant(MERCHANT_USER, 'COL-PENDING00000000000')); await assert.rejects(w.qr.resolveForMerchant(MERCHANT_USER, 'nope nope'));
    assert.deepEqual(w.db.writes, []);
  });
  await ok('R7 actionable errors with stable codes', async () => {
    const w = world(); const rej = (p: any, c: string, s: number) => assert.rejects(w.qr.resolveForMerchant(MERCHANT_USER, p), (e: any) => code(e) === c && http(e) === s && /[À-ỹ]/.test(String(e.getResponse().message)), `${c}`);
    await rej('hello world', 'QR_UNSUPPORTED', 400); await rej('https://example.com/x', 'QR_UNSUPPORTED', 400); await rej('', 'QR_UNSUPPORTED', 400);
    await rej('COL-0000000000000000', 'PARTNER_NOT_FOUND', 404); await rej('COL-PENDING00000000000', 'PARTNER_NOT_ACTIVE', 409); await rej('COL-INACTIVE0000000000', 'PARTNER_NOT_ACTIVE', 409);
  });
  await ok('R8 Merchant only: a Partner, an Admin, an unknown user and a not-yet-approved Merchant are refused', async () => {
    const w = world();
    for (const user of [PARTNER_USER, 'user-admin', 'nobody']) await assert.rejects(w.qr.resolveForMerchant(user, CODE), (e: any) => http(e) === 403 && code(e) === 'MERCHANT_REQUIRED', user);
    const w2 = world({ merchant: { merchant_verified: false } }); await assert.rejects(w2.qr.resolveForMerchant(MERCHANT_USER, CODE), (e: any) => code(e) === 'MERCHANT_NOT_ACTIVE' && http(e) === 403);
  });
  await ok('R9 enumeration is rate limited per Merchant account', async () => {
    const w = world(); let limited = 0;
    for (let i = 0; i < 100; i += 1) { try { await w.qr.resolveForMerchant(MERCHANT_USER, `COL-${String(i).padStart(16, '0')}`); } catch (e: any) { if (code(e) === 'QR_RATE_LIMITED') limited += 1; } }
    assert.ok(limited >= 9, `limited=${limited}`);
  });

  // ---- preview arithmetic -----------------------------------------------------------------------------------------------------------------------
  const ref = (gross: string, rate: string) => { // independent reference: BigInt on 1e-8 then round half up to 1e-4
    const [gw, gf = ''] = gross.split('.'); const [rw, rf = ''] = rate.split('.');
    const g = BigInt(gw) * 10000n + BigInt((gf + '0000').slice(0, 4)); const r = BigInt(rw) * 10000n + BigInt((rf + '0000').slice(0, 4));
    const prod = g * r; const q = prod / 10000n; const rem = prod % 10000n; const v = rem >= 5000n ? q + 1n : q;
    return `${v / 10000n}.${String(v % 10000n).padStart(4, '0')}`;
  };
  await ok('M1 preview = round4(gross x rate) for discount and commission, final = gross - discount; commission base is the ORIGINAL amount, independent of the discount rate', async () => {
    for (const [gross, d, c] of [['1250000', 0.05, 0.1], ['1234.5678', 0.05, 0.1], ['99999999999999.9999', 0.07, 0.123], ['0.0001', 0.5, 0.5], ['0.0003', 0.5, 0.5], ['100.0001', 0.0333, 0.0777], ['1', 1, 1], ['500000', 0.2, 0.0001]] as const) {
      const w = world({ discount: d, commission: c }); const p: any = await w.tx.previewRealTransaction(MERCHANT_USER, { collaborator_code: CODE, gross_amount: gross });
      const dr = (d as number).toFixed(4), cr = (c as number).toFixed(4);
      assert.equal(p.discount_amount, ref(gross, dr), `discount ${gross}x${dr}`); assert.equal(p.commission_amount, ref(gross, cr), `commission ${gross}x${cr}`);
      const g4 = ref(gross, '1'); const expectedFinal = ((BigInt(g4.replace('.', '')) - BigInt(p.discount_amount.replace('.', '')))); assert.equal(BigInt(p.final_payable.replace('.', '')), expectedFinal, `final ${gross}`);
      assert.deepEqual([p.discount_rate, p.commission_rate, p.commission_base, p.financial_action_created], [dr, cr, 'gross_amount', false]);
    }
    const a: any = await world({ discount: 0.05, commission: 0.1 }).tx.previewRealTransaction(MERCHANT_USER, { collaborator_code: CODE, gross_amount: '1000000' });
    const b: any = await world({ discount: 0.2, commission: 0.1 }).tx.previewRealTransaction(MERCHANT_USER, { collaborator_code: CODE, gross_amount: '1000000' });
    assert.equal(a.commission_amount, b.commission_amount, 'a different discount rate never changes the commission'); assert.equal(a.commission_amount, '100000.0000');
    assert.deepEqual([a.discount_amount, a.final_payable, b.discount_amount, b.final_payable], ['50000.0000', '950000.0000', '200000.0000', '800000.0000']);
  });
  await ok('M2 preview enforces the same rules as the transaction function and writes nothing', async () => {
    const run = (w: ReturnType<typeof world>, user = MERCHANT_USER, c = CODE, g = '100') => w.tx.previewRealTransaction(user, { collaborator_code: c, gross_amount: g });
    await assert.rejects(run(world(), MERCHANT_USER, CODE, '0'), (e: any) => code(e) === 'AMOUNT_INVALID');
    await assert.rejects(run(world(), PARTNER_USER), (e: any) => code(e) === 'MERCHANT_REQUIRED' && http(e) === 403);
    await assert.rejects(run(world({ discount: 8 })), (e: any) => code(e) === 'RATES_NOT_REVIEWED' && http(e) === 400);
    await assert.rejects(run(world({ merchant: { merchants_status: 'blocked' } })), (e: any) => code(e) === 'MERCHANT_NOT_ACTIVE');
    await assert.rejects(run(world(), MERCHANT_USER, 'COL-PENDING00000000000'), (e: any) => code(e) === 'PARTNER_NOT_ACTIVE');
    await assert.rejects(run(world(), MERCHANT_USER, 'COL-ELSEWHERE00000000'), (e: any) => code(e) === 'PARTNER_NOT_ASSIGNED' && http(e) === 403);
    const w = world(); await run(w); assert.deepEqual(w.db.writes, []);
  });

  // ---- Partner redaction ------------------------------------------------------------------------------------------------------------------------
  await ok('D1 a Partner can never fetch the customer discount: not in the list, the report, its summary, or as a sort key', async () => {
    const w = world(); w.db.tables.referral_transactions = [{ id: 't-1', document_total: '1000', document_discount_amount: '50', commission_amount: '100', payment_status: 'unverified', lifecycle_status: 'confirmed', legacy_status: null, record_kind: 'real_transaction', collaborator_id: 'c-1' }];
    const report: any = await w.tx.reportForActor(PARTNER_USER, { page: 1, page_size: 25, sort: 'document_discount_amount', direction: 'desc', orphan_only: false } as any);
    await w.tx.findForActor(PARTNER_USER);
    const partnerSelects = w.db.selects.filter((s) => s.table === 'referral_transactions').map((s) => s.cols).join('|');
    assert.equal(/document_discount/.test(partnerSelects), false, 'no query for a Partner selects a discount column');
    assert.equal('document_discount_amount' in report.summary, false, 'no discount in the summary'); assert.ok('commission_amount' in report.summary, 'earnings stay visible');
    assert.equal(JSON.stringify(report.summary).includes('discount'), false);
    const mw = world(); mw.db.tables.referral_transactions = w.db.tables.referral_transactions;
    const merchantReport: any = await mw.tx.reportForActor(MERCHANT_USER, { page: 1, page_size: 25, sort: 'document_date_utc', direction: 'desc', orphan_only: false } as any);
    assert.ok('document_discount_amount' in merchantReport.summary, 'the Merchant still sees its own discount totals');
    assert.ok(mw.db.selects.some((s) => /document_discount_amount/.test(s.cols)));
  });

  console.log(JSON.stringify({ status: 'PASS', controls }));
})().catch((e) => { console.error(e); process.exit(1); });
