// Merchant QR scan / discount inquiry / payment preview for the GLOBAL Partner network, against an in-memory Supabase fake (no network, no real data).
// Business rule under test (owner decision 2026-11-09): every ACTIVE Partner can be scanned by and transact at every ACTIVE Merchant; there is NO
// Partner-to-Merchant assignment. Covers: the payload parser, the resolver (identity, status, per-Merchant discount, payment readiness, read-only, rate
// limit, Merchant-only), walk-in counting and its report, the Merchant commercial policy (independent discount / commission, never defaulted), the
// preview's arithmetic against an independent reference, the create call's error mapping, and the Partner-side discount redaction.
import assert from 'node:assert/strict';
import { parsePartnerQrPayload } from '../src/modules/qr/partner-qr-payload';
import { QrService } from '../src/modules/qr/qr.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { resolvePaymentPolicy, resolveCustomerDiscount, rate4 } from '../src/modules/commercial/commercial-policy';

// ---- in-memory Supabase -----------------------------------------------------------------------------------------------------------------------
type Row = Record<string, any>;
class Fake {
  tables: Record<string, Row[]> = {};
  writes: string[] = []; selects: Array<{ table: string; cols: string }> = []; rpcCalls: Array<{ name: string; args: Row }> = [];
  rpcResult: { data: any; error: any } = { data: null, error: { message: 'rpc not expected' } };
  from(table: string) {
    const db = this; const filters: Array<(r: Row) => boolean> = []; let limit = Infinity; let pending: { kind: 'insert' | 'update' | 'delete' | 'upsert'; rows?: Row[] } | null = null;
    const rows = () => (db.tables[table] || []).filter((r) => filters.every((f) => f(r))).slice(0, limit);
    const read = (r: Row, col: string) => (col.includes('->>') ? (r[col.split('->>')[0]] ?? {})[col.split('->>')[1]] : r[col]);
    const q: any = {
      select: (c: string) => { db.selects.push({ table, cols: c }); return q; },
      insert: (row: Row) => { db.writes.push(`insert ${table}`); (db.tables[table] ||= []).push({ id: `${table}-${(db.tables[table] || []).length + 1}`, occurred_at: new Date().toISOString(), ...row }); pending = { kind: 'insert' }; return q; },
      // INSERT ... ON CONFLICT (onConflict) DO NOTHING RETURNING: the row, or nothing when the key exists (the database's uniqueness, not a lock)
      upsert: (row: Row, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
        db.writes.push(`upsert ${table}`); const list = (db.tables[table] ||= []); const keys = (opts.onConflict || 'id').split(',');
        if (list.some((r) => keys.every((k) => r[k] === row[k]))) { pending = { kind: 'upsert', rows: [] }; return q; }
        const created = { id: `${table}-${list.length + 1}`, scanned_at: new Date().toISOString(), ...row }; list.push(created); pending = { kind: 'upsert', rows: [created] }; return q;
      },
      update: () => { db.writes.push(`update ${table}`); pending = { kind: 'update' }; return q; }, delete: () => { db.writes.push(`delete ${table}`); pending = { kind: 'delete' }; return q; },
      eq: (c: string, v: any) => { filters.push((r) => read(r, c) === v); return q; },
      not: (c: string, op: string) => { filters.push((r) => (op === 'is' ? r[c] !== null && r[c] !== undefined : true)); return q; },
      filter: (c: string, op: string, v: any) => { filters.push((r) => (op === 'eq' ? read(r, c) === v : true)); return q; },
      ilike: (c: string, v: string) => { const plain = v.replace(/\\([\\%_])/g, '$1').toLowerCase(); filters.push((r) => String(r[c] ?? '').toLowerCase() === plain); return q; },
      in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return q; }, lte: () => q,
      or: () => q, order: () => q, range: () => q, is: () => q,
      limit: (n: number) => { limit = n; return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'none' } }),
      then: (res: any, rej: any) => Promise.resolve(pending?.kind === 'upsert' ? { data: pending.rows, error: null } : pending?.kind === 'insert' ? { data: null, error: null } : { data: rows(), error: null, count: rows().length }).then(res, rej),
    };
    return q;
  }
  rpc(name: string, args: Row) { this.writes.push('rpc'); this.rpcCalls.push({ name, args }); return { single: async () => this.rpcResult }; }
}

const MERCHANT_USER = 'user-merchant'; const MERCHANT2_USER = 'user-merchant-2'; const PARTNER_USER = 'user-partner'; const MID = 'm-1'; const MID2 = 'm-2';
type Over = { discount?: any; discountType?: any; commission?: any; commissionType?: any; partner?: Partial<Row>; merchant?: Partial<Row>; merchant2?: Partial<Row> };
function world(over: Over = {}) {
  const db = new Fake();
  db.tables.user_profiles = [
    { user_id: MERCHANT_USER, role: 'merchant', user_profiles_status: 'active', merchant_id: MID },
    { user_id: MERCHANT2_USER, role: 'merchant', user_profiles_status: 'active', merchant_id: MID2 },
    { user_id: PARTNER_USER, role: 'collaborator', user_profiles_status: 'active', collaborator_id: 'c-1' },
    { user_id: 'user-admin', role: 'admin', user_profiles_status: 'active' },
  ];
  db.tables.merchant_details = [
    { merchant_system_id: MID, merchant_verified: true, merchants_status: 'active', merchant_discount_type: 'discountType' in over ? over.discountType : 'percentage', merchant_discount_value: 'discount' in over ? over.discount : 0.05,
      merchant_commission_type: 'commissionType' in over ? over.commissionType : 'percentage', merchant_commission_value: 'commission' in over ? over.commission : 0.1, ...over.merchant },
    // a SECOND active Merchant with its own, different policy (3% / 8%)
    { merchant_system_id: MID2, merchant_verified: true, merchants_status: 'active', merchant_discount_type: 'percentage', merchant_discount_value: 0.03, merchant_commission_type: 'percentage', merchant_commission_value: 0.08, ...over.merchant2 },
  ];
  // Partner-to-Merchant assignment is HISTORY only: c-1 was assigned to m-1, c-2 to m-2, c-3 to nobody. None of it may matter.
  db.tables.collaborators = [
    { id: 'c-1', collaborators_code: 'COL-D600ABC8D5C2C528', collaborators_name: 'Hướng dẫn viên A', collaborators_verified: true, collaborators_status: 'active', merchant_system_id: MID, collaborators_phone: '0900000000', collaborators_email: 'secret@x.test', ...over.partner },
    { id: 'c-2', collaborators_code: 'COL-ELSEWHERE00000000', collaborators_name: 'Partner B', collaborators_verified: true, collaborators_status: 'active', merchant_system_id: MID2 },
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
const CODE = 'COL-D600ABC8D5C2C528'; const UNKNOWN = 'COL-0000000000000000';
const ALL_ACTIVE = [CODE, 'COL-ELSEWHERE00000000', 'COL-FREE0000000000000'];     // every active Partner, whatever its (historical) assignment

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
  await ok('R1 identity: name, avatar, code, status; the established fields are unchanged; NO association field exists any more', async () => {
    const w = world(); const r: any = await w.qr.resolveForMerchant(MERCHANT_USER, `https://vno-web-uat.up.railway.app/c/${CODE}`);
    assert.deepEqual(r.partner, { id: 'c-1', code: CODE, name: 'Hướng dẫn viên A', avatar_url: 'https://files.example.test/avatar.png?sig=1', verified: true, status: 'active' });
    assert.deepEqual([r.collaborator_id, r.collaborator_code, r.collaborator_name, r.verified, r.status, r.idempotent, r.financial_action_created], ['c-1', CODE, 'Hướng dẫn viên A', true, 'active', true, false]);
    assert.equal('association' in r, false, 'the scan never talks about an assignment'); assert.equal(JSON.stringify(r).includes('assigned'), false); assert.equal(JSON.stringify(r).includes('merchant_system_id'), false);
  });
  await ok('R2 a typed or pasted code resolves case-insensitively; two case variants are refused as ambiguous', async () => {
    const w = world(); assert.equal(((await w.qr.resolveForMerchant(MERCHANT_USER, CODE.toLowerCase())) as any).partner.code, CODE);
    w.db.tables.collaborators.push({ id: 'c-9', collaborators_code: CODE.toLowerCase(), collaborators_name: 'Dup', collaborators_verified: true, collaborators_status: 'active', merchant_system_id: MID });
    assert.equal(((await w.qr.resolveForMerchant(MERCHANT_USER, CODE)) as any).partner.id, 'c-1', 'an exact-case match wins');
    await assert.rejects(w.qr.resolveForMerchant(MERCHANT_USER, 'cOl-d600abc8d5c2c528'), (e: any) => code(e) === 'PARTNER_NOT_FOUND', 'ambiguous case-insensitive match is refused');
  });
  await ok('G1 GLOBAL network: every active Partner resolves at EVERY active Merchant — assigned here, assigned elsewhere, or never assigned', async () => {
    const w = world();
    for (const user of [MERCHANT_USER, MERCHANT2_USER]) for (const p of ALL_ACTIVE) {
      const r: any = await w.qr.resolveForMerchant(user, p, { scanId: crypto.randomUUID(), source: 'camera' });
      assert.equal(r.partner.code, p, `${p} at ${user}`); assert.equal(r.scan.counted, true); assert.equal(r.financial_action_created, false);
    }
    assert.equal(w.db.tables.partner_scan_events.length, 6, '3 Partners x 2 Merchants, each a walk-in');
  });
  await ok('G2 each Merchant resolves ITS OWN discount for the same Partner (never another Merchant\'s, never "not assigned")', async () => {
    const w = world();
    for (const p of ALL_ACTIVE) {
      const a: any = await w.qr.resolveForMerchant(MERCHANT_USER, p); const b: any = await w.qr.resolveForMerchant(MERCHANT2_USER, p);
      assert.deepEqual(a.discount, { available: true, kind: 'percentage', rate: '0.0500', label: 'Giảm 5%' }, `m-1 ${p}`);
      assert.deepEqual(b.discount, { available: true, kind: 'percentage', rate: '0.0300', label: 'Giảm 3%' }, `m-2 ${p}`);
    }
  });
  await ok('R3 discount label and rate follow the catalog rule', async () => {
    const w = world({ discount: 0.05 }); const d = ((await w.qr.resolveForMerchant(MERCHANT_USER, CODE)) as any).discount;
    assert.deepEqual(d, { available: true, kind: 'percentage', rate: '0.0500', label: 'Giảm 5%' });
    assert.equal(((await world({ discount: 0.125 }).qr.resolveForMerchant(MERCHANT_USER, CODE)) as any).discount.label, 'Giảm 12,5%');
  });
  await ok('R4 "no discount" cases: zero, missing, legacy points (8), non-percentage — each says why, none shows a discount, none mentions an assignment', async () => {
    const expectNone = async (w: ReturnType<typeof world>, payload: string, reason: string) => {
      const r: any = await w.qr.resolveForMerchant(MERCHANT_USER, payload); assert.deepEqual(r.discount, { available: false, kind: null, rate: null, label: null, reason }, `${payload}`);
      assert.equal(JSON.stringify(r).includes('chưa được gán'), false); assert.equal(JSON.stringify(r).includes('not_assigned'), false);
    };
    await expectNone(world({ discount: 0 }), CODE, 'no_discount'); await expectNone(world({ discount: null }), CODE, 'no_discount');
    await expectNone(world({ discount: 8 }), CODE, 'rate_not_reviewed'); await expectNone(world({ discountType: 'fixed', discount: 0.05 }), CODE, 'rate_not_reviewed');
    for (const p of ALL_ACTIVE) await expectNone(world({ discount: null }), p, 'no_discount');         // an unassigned Partner is NOT a reason: it is simply "no discount configured"
  });
  await ok('R5 nothing private leaks: no commission rate, phone, e-mail, bank or ids of the Merchant policy in the answer', async () => {
    const w = world({ commission: 0.123456 }); const text = JSON.stringify(await w.qr.resolveForMerchant(MERCHANT_USER, CODE));
    for (const secret of ['0.1234', '0.1235', 'commission_rate', '0900000000', 'secret@x.test', 'bank', 'merchant_commission']) assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, `leaked ${secret}`);
  });
  await ok('R6 scanning creates no financial or association record: the ONLY write is the walk-in event, and no Partner is ever (re)assigned', async () => {
    const w = world(); for (const p of ALL_ACTIVE) await w.qr.resolveForMerchant(MERCHANT_USER, p);
    await assert.rejects(w.qr.resolveForMerchant(MERCHANT_USER, 'COL-PENDING00000000000')); await assert.rejects(w.qr.resolveForMerchant(MERCHANT_USER, 'nope nope'));
    assert.deepEqual([...new Set(w.db.writes)], ['upsert partner_scan_events']);
    assert.ok(!w.db.writes.some((x) => /transactions|transaction_events|collaborators|merchant_details|user_profiles|audit|rpc/.test(x)), w.db.writes.join(','));
    assert.deepEqual(w.db.tables.collaborators.map((c) => c.merchant_system_id), [MID, MID2, null, MID, MID], 'history is untouched: no association was created or changed');
    assert.equal(w.db.writes.length, 3, 'only the three VALID scans were counted (pending Partner and junk were not)');
    assert.equal(w.db.rpcCalls.length, 0, 'no transaction function is ever called by a scan');
  });
  await ok('Y1 payment readiness: ready when the commission policy is configured; otherwise an explicit business-rule answer (the scan itself still succeeds and counts)', async () => {
    const ready: any = await world().qr.resolveForMerchant(MERCHANT_USER, CODE); assert.deepEqual(ready.payment, { available: true });
    for (const [over, reason] of [[{ commission: null }, 'COMMISSION_POLICY_MISSING'], [{ commissionType: null }, 'COMMISSION_POLICY_MISSING'], [{ commission: 1.5 }, 'COMMISSION_POLICY_NOT_REVIEWED'], [{ discount: 8 }, 'DISCOUNT_POLICY_NOT_REVIEWED']] as const) {
      const w = world(over); const r: any = await w.qr.resolveForMerchant(MERCHANT_USER, CODE);
      assert.equal(r.payment.available, false); assert.equal(r.payment.reason, reason); assert.ok(/[À-ỹ]/.test(r.payment.message), 'Vietnamese message'); assert.equal(r.scan.counted, true, 'a scan without a payment policy is still a walk-in');
      assert.equal(w.db.rpcCalls.length, 0);
    }
    const none: any = await world({ discount: null, commission: null, commissionType: null }).qr.resolveForMerchant(MERCHANT_USER, CODE);
    assert.deepEqual([none.discount.available, none.payment.available, none.payment.reason], [false, false, 'COMMISSION_POLICY_MISSING'], 'no policy at all: no discount shown AND an explicit configuration answer');
  });
  await ok('S1 a valid scan is counted ONCE: same scan id (retry / repeated detection), concurrent requests, and the no-id window; the scan id is returned for the transaction link', async () => {
    const w = world(); const sid = '11111111-1111-4111-8111-111111111111';
    const first: any = await w.qr.resolveForMerchant(MERCHANT_USER, CODE, { scanId: sid, source: 'camera' }); assert.equal(first.scan.counted, true); assert.equal(first.scan.duplicate, false); assert.ok(first.scan.id);
    const again: any = await w.qr.resolveForMerchant(MERCHANT_USER, `https://x.test/c/${CODE}`, { scanId: sid, source: 'camera' }); assert.deepEqual([again.scan.counted, again.scan.duplicate, again.scan.id], [false, true, first.scan.id], 'a repeated detection returns the SAME scan event');
    const burst: any[] = await Promise.all([1, 2, 3, 4].map(() => w.qr.resolveForMerchant(MERCHANT_USER, CODE, { scanId: '22222222-2222-4222-8222-222222222222' })));
    assert.equal(burst.filter((r) => r.scan.counted).length, 1, 'four simultaneous requests for one scan: one count'); assert.equal(new Set(burst.map((r) => r.scan.id)).size, 1);
    const w2 = world(); const a: any = await w2.qr.resolveForMerchant(MERCHANT_USER, CODE); const b: any = await w2.qr.resolveForMerchant(MERCHANT_USER, CODE.toLowerCase());
    assert.deepEqual([a.scan.counted, b.scan.counted, b.scan.duplicate], [true, false, true], 'without a scan id: one per Partner per minute');
    const events = w.db.tables.partner_scan_events; assert.equal(events.length, 2);
    assert.deepEqual([events[0].merchant_id, events[0].collaborator_id, events[0].source, events[0].key_kind, events[0].actor_auth_user_id], [MID, 'c-1', 'camera', 'scan_id', MERCHANT_USER]);
    const other: any = await w.qr.resolveForMerchant(MERCHANT2_USER, CODE, { scanId: sid }); assert.equal(other.scan.counted, true, 'the same scan id at ANOTHER Merchant is a different scan (unique per Merchant)');
  });
  await ok('S2 only VALID scans count; an unassigned Partner is a normal walk-in', async () => {
    const w = world();
    for (const p of ['hello world', UNKNOWN, 'COL-PENDING00000000000', 'COL-INACTIVE0000000000']) await assert.rejects(w.qr.resolveForMerchant(MERCHANT_USER, p, { scanId: crypto.randomUUID() }));
    assert.equal(w.db.tables.partner_scan_events?.length ?? 0, 0, 'invalid, unknown and inactive lookups are not walk-ins');
    for (const p of ALL_ACTIVE.slice(1)) await w.qr.resolveForMerchant(MERCHANT_USER, p, { scanId: crypto.randomUUID() });
    assert.deepEqual(w.db.tables.partner_scan_events.map((e) => e.collaborator_id), ['c-2', 'c-3']);
    assert.deepEqual(w.db.tables.collaborators.map((c) => c.merchant_system_id), [MID, MID2, null, MID, MID]);
  });
  await ok('S3 a counting failure never fails the lookup', async () => {
    const w = world(); (w.db as any).from = ((orig) => (t: string) => { if (t === 'partner_scan_events') throw new Error('scan table unavailable'); return orig.call(w.db, t); })(w.db.from);
    const r: any = await w.qr.resolveForMerchant(MERCHANT_USER, CODE); assert.equal(r.partner.code, CODE); assert.deepEqual(r.scan, { id: null, counted: false, duplicate: false });
  });
  await ok('S4 the walk-in report: per day (Vietnam time), distinct Partners, scans that led to a transaction, own Merchant only', async () => {
    const w = world(); const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push(((await w.qr.resolveForMerchant(MERCHANT_USER, CODE, { scanId: crypto.randomUUID() })) as any).scan.id);
    await w.qr.resolveForMerchant(MERCHANT_USER, 'COL-FREE0000000000000', { scanId: crypto.randomUUID() });
    await w.qr.resolveForMerchant(MERCHANT2_USER, CODE, { scanId: crypto.randomUUID() });                  // another Merchant's walk-in: never in m-1's report
    w.db.tables.referral_transactions = [
      { id: 't-1', scan_event_id: ids[0], merchant_id: MID, lifecycle_status: 'confirmed', created_at: new Date().toISOString() },
      { id: 't-2', scan_event_id: ids[1], merchant_id: MID, lifecycle_status: 'cancelled', created_at: new Date().toISOString() },      // cancelled: not converted
      { id: 't-3', scan_event_id: ids[1], merchant_id: MID, lifecycle_status: 'recorded', created_at: new Date().toISOString() },       // corrected attempt on the same scan
      { id: 't-4', scan_event_id: null, merchant_id: MID, lifecycle_status: 'confirmed', created_at: new Date().toISOString() },
    ];
    const sum: any = await w.qr.scanSummary(MERCHANT_USER, { days: 7 } as any);
    assert.deepEqual([sum.total, sum.distinct_partners, sum.with_transaction, sum.truncated], [4, 2, 2, false]);
    assert.equal('assigned_to_merchant' in sum || 'not_assigned' in sum, false, 'no assigned / not-assigned split exists any more');
    assert.equal(sum.by_day.length, 7); assert.equal(sum.by_day.reduce((a: number, d: any) => a + d.count, 0), 4); assert.deepEqual([sum.top_partners[0].partner_code, sum.top_partners[0].count], [CODE, 3]);
    await assert.rejects(w.qr.scanSummary(MERCHANT_USER, { days: 7, merchant_id: MID2 } as any), (e: any) => http(e) === 403, 'a Merchant cannot read another Merchant\'s report');
    for (const user of [PARTNER_USER, 'nobody']) await assert.rejects(w.qr.scanSummary(user, { days: 7 } as any), (e: any) => http(e) === 403);
    const asAdmin: any = await w.qr.scanSummary('user-admin', { days: 7, merchant_id: MID2 } as any); assert.equal(asAdmin.total, 1);
    const adminAll: any = await w.qr.scanSummary('user-admin', { days: 7 } as any); assert.equal(adminAll.total, 5, 'Admin without a filter sees every Merchant');
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
    assert.equal(w2.db.tables.partner_scan_events?.length ?? 0, 0, 'an unapproved Merchant\'s lookup is not a walk-in');
  });
  await ok('R9 enumeration is rate limited per Merchant account', async () => {
    const w = world(); let limited = 0;
    for (let i = 0; i < 100; i += 1) { try { await w.qr.resolveForMerchant(MERCHANT_USER, `COL-${String(i).padStart(16, '0')}`); } catch (e: any) { if (code(e) === 'QR_RATE_LIMITED') limited += 1; } }
    assert.ok(limited >= 9, `limited=${limited}`);
  });

  // ---- commercial policy ------------------------------------------------------------------------------------------------------------------------
  await ok('Y2 policy parity with create_real_transaction (the cases asserted against the real function on the rehearsal database)', () => {
    type C = [string, any, any, any, any, string]; // label, discType, discValue, commType, commValue, expected ("ready d/c" or the refusal code)
    const cases: C[] = [
      ['5% / 10%', 'percentage', 0.05, 'percentage', 0.1, 'ready 0.0500/0.1000'],
      ['3% / 8%', 'percentage', 0.03, 'percentage', 0.08, 'ready 0.0300/0.0800'],
      ['no discount, EXPLICIT 0 commission', null, null, 'percentage', 0, 'ready 0.0000/0.0000'],
      ['discount 0, commission 8%', 'percentage', 0, 'percentage', 0.08, 'ready 0.0000/0.0800'],
      ['discount 0 under a legacy type is still "no discount"', 'points', 0, 'percentage', 0.08, 'ready 0.0000/0.0800'],
      ['100% / 100% are the inclusive bounds', 'percentage', 1, 'percentage', 1, 'ready 1.0000/1.0000'],
      ['nothing configured', null, null, null, null, 'COMMISSION_POLICY_MISSING'],
      ['commission value missing', 'percentage', 0.05, 'percentage', null, 'COMMISSION_POLICY_MISSING'],
      ['commission value blank', 'percentage', 0.05, 'percentage', '', 'COMMISSION_POLICY_MISSING'],
      ['commission type missing (a bare 0 is NOT an approved zero)', 'percentage', 0.05, null, 0, 'COMMISSION_POLICY_MISSING'],
      ['commission type legacy points', 'percentage', 0.05, 'points', 10, 'COMMISSION_POLICY_MISSING'],
      ['commission above 100%', 'percentage', 0.05, 'percentage', 1.5, 'COMMISSION_POLICY_NOT_REVIEWED'],
      ['commission negative', 'percentage', 0.05, 'percentage', -0.1, 'COMMISSION_POLICY_NOT_REVIEWED'],
      ['discount legacy points (8)', 'points', 8, 'percentage', 0.1, 'DISCOUNT_POLICY_NOT_REVIEWED'],
      ['discount above 100%', 'percentage', 8, 'percentage', 0.1, 'DISCOUNT_POLICY_NOT_REVIEWED'],
      ['discount negative', 'percentage', -0.05, 'percentage', 0.1, 'DISCOUNT_POLICY_NOT_REVIEWED'],
      ['discount value without a type', null, 0.05, 'percentage', 0.1, 'DISCOUNT_POLICY_NOT_REVIEWED'],
    ];
    for (const [label, dt, dv, ct, cv, expected] of cases) {
      const p: any = resolvePaymentPolicy({ merchant_discount_type: dt, merchant_discount_value: dv, merchant_commission_type: ct, merchant_commission_value: cv });
      const got = p.ready ? `ready ${p.discountRate}/${p.commissionRate}` : p.code; assert.equal(got, expected, label);
      if (!p.ready) assert.ok(/[À-ỹ]/.test(p.message), `${label}: Vietnamese message`);
    }
    assert.equal(rate4(0.123456), '0.1235'); assert.equal(rate4('0.05'), '0.0500'); assert.equal(rate4(1e-7), '0.0000'); assert.equal(rate4(null), null); assert.equal(rate4('x'), null);
    assert.equal(resolveCustomerDiscount({ merchant_discount_type: 'percentage', merchant_discount_value: 0.05 }).label, 'Giảm 5%');
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
  await ok('M2 preview enforces the same rules as the transaction function and writes nothing; NO Partner assignment is needed', async () => {
    const run = (w: ReturnType<typeof world>, user = MERCHANT_USER, c = CODE, g = '100') => w.tx.previewRealTransaction(user, { collaborator_code: c, gross_amount: g });
    await assert.rejects(run(world(), MERCHANT_USER, CODE, '0'), (e: any) => code(e) === 'AMOUNT_INVALID');
    await assert.rejects(run(world(), PARTNER_USER), (e: any) => code(e) === 'MERCHANT_REQUIRED' && http(e) === 403);
    await assert.rejects(run(world({ discount: 8 })), (e: any) => code(e) === 'DISCOUNT_POLICY_NOT_REVIEWED' && http(e) === 422);
    await assert.rejects(run(world({ commission: null })), (e: any) => code(e) === 'COMMISSION_POLICY_MISSING' && http(e) === 422 && /hoa hồng/.test(String(e.getResponse().message)));
    await assert.rejects(run(world({ merchant: { merchants_status: 'blocked' } })), (e: any) => code(e) === 'MERCHANT_NOT_ACTIVE');
    await assert.rejects(run(world(), MERCHANT_USER, 'COL-PENDING00000000000'), (e: any) => code(e) === 'PARTNER_NOT_ACTIVE');
    await assert.rejects(run(world(), MERCHANT_USER, 'COL-INACTIVE0000000000'), (e: any) => code(e) === 'PARTNER_NOT_ACTIVE');
    for (const p of ALL_ACTIVE) { // assigned here, assigned elsewhere, never assigned: all price identically (the Merchant's own policy)
      const pv: any = await run(world(), MERCHANT_USER, p, '1000000'); assert.deepEqual([pv.discount_amount, pv.final_payable, pv.commission_amount, pv.financial_action_created], ['50000.0000', '950000.0000', '100000.0000', false], p);
      assert.equal('association' in pv, false);
    }
    const second: any = await run(world(), MERCHANT2_USER, CODE, '1000000'); assert.deepEqual([second.discount_amount, second.commission_amount], ['30000.0000', '80000.0000'], 'the second Merchant prices with ITS policy');
    const noDiscount: any = await run(world({ discount: null }), MERCHANT_USER, 'COL-FREE0000000000000', '1000000'); assert.deepEqual([noDiscount.discount_rate, noDiscount.discount_amount, noDiscount.final_payable, noDiscount.commission_amount], ['0.0000', '0.0000', '1000000.0000', '100000.0000'], 'no discount policy: the customer pays the full amount, commission still on the original amount');
    const zero: any = await run(world({ discount: null, commission: 0 }), MERCHANT_USER, CODE, '1000000'); assert.deepEqual([zero.commission_rate, zero.commission_amount], ['0.0000', '0.0000'], 'zero commission only because the policy explicitly says 0');
    const w = world(); await run(w); assert.deepEqual(w.db.writes, []);
  });
  await ok('T1 creating: the Merchant sends ONLY the amount (+ the scan it came from); policy refusals from the database become stable Vietnamese codes; nothing assigns a Partner', async () => {
    const w = world(); const idem = '33333333-3333-4333-8333-333333333333'; const scan = '44444444-4444-4444-8444-444444444444';
    w.db.rpcResult = { data: { transaction_id: 'tx-1', document_number: 'VNO261109-X', merchant_id: MID, collaborator_id: 'c-3', gross_amount: '1000000.0000', discount_rate: '0.0500', discount_amount: '50000.0000', commission_rate: '0.1000', commission_amount: '100000.0000', lifecycle_status: 'recorded', idempotent_replay: false, scan_event_id: scan }, error: null };
    const r: any = await w.tx.createRealTransaction(MERCHANT_USER, { collaborator_code: 'COL-FREE0000000000000', gross_amount: '1000000', idempotency_key: idem, scan_event_id: scan });
    assert.deepEqual(w.db.rpcCalls[0], { name: 'create_real_transaction', args: { p_actor_user_id: MERCHANT_USER, p_collaborator_code: 'COL-FREE0000000000000', p_gross_amount: '1000000', p_idempotency_key: idem, p_scan_event_id: scan } });
    assert.deepEqual([r.final_payable, r.record_kind, r.scan_event_id], ['950000.0000', 'real_transaction', scan]);
    await w.tx.createRealTransaction(MERCHANT_USER, { collaborator_code: CODE, gross_amount: '5', idempotency_key: idem }); assert.equal(w.db.rpcCalls[1].args.p_scan_event_id, null, 'the scan link is optional');
    assert.ok(w.db.writes.every((x) => x === 'rpc'), 'the API itself writes nothing: the database function is the only writer');
    const refuse = (error: any) => { w.db.rpcResult = { data: null, error }; return w.tx.createRealTransaction(MERCHANT_USER, { collaborator_code: CODE, gross_amount: '5', idempotency_key: idem }); };
    await assert.rejects(refuse({ code: '22023', message: 'Merchant commission policy is not configured' }), (e: any) => code(e) === 'COMMISSION_POLICY_MISSING' && http(e) === 422 && /[À-ỹ]/.test(String(e.getResponse().message)));
    await assert.rejects(refuse({ code: '22023', message: 'Merchant commission policy is not a reviewed fraction' }), (e: any) => code(e) === 'COMMISSION_POLICY_NOT_REVIEWED' && http(e) === 422);
    await assert.rejects(refuse({ code: '22023', message: 'Merchant discount policy is not a reviewed fraction' }), (e: any) => code(e) === 'DISCOUNT_POLICY_NOT_REVIEWED' && http(e) === 422);
    await assert.rejects(refuse({ code: '22023', message: 'Scan event does not belong to this Merchant and Partner' }), (e: any) => code(e) === 'SCAN_EVENT_MISMATCH' && http(e) === 400);
    await assert.rejects(refuse({ code: '22023', message: 'Active verified Partner required' }), (e: any) => code(e) === 'PARTNER_NOT_ACTIVE' && http(e) === 400);
    await assert.rejects(refuse({ code: '42501', message: 'Active Merchant profile required' }), (e: any) => http(e) === 403);
    await assert.rejects(refuse({ code: '23505', message: 'Idempotency key was already used with different input' }), (e: any) => http(e) === 409);
    await assert.rejects(refuse({ code: 'XX000', message: 'internal detail must not leak' }), (e: any) => http(e) === 500 && !JSON.stringify(e.getResponse()).includes('internal detail'));
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
