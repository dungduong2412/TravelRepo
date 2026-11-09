// Integration test for the GLOBAL Partner network: the REAL QrService and TransactionsService -> the REAL supabase-js client -> PostgREST v14.5 -> the
// REAL Postgres with migration 20261109000001 applied. It proves what the in-memory fake in test-merchant-qr-flow.ts cannot: the ON CONFLICT DO NOTHING
// upsert, the five-argument create_real_transaction through PostgREST named arguments, the scan <-> transaction link and the summary queries.
//
// Needs the rehearsal database (see migration/v2/rehearsal/README.md): Postgres on :54999 with every repo migration applied, PostgREST on :54998.
// It talks to hosted UAT NEVER; it only runs when VNO_REHEARSAL=1 and refuses any other target.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { QrService } from '../src/modules/qr/qr.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';

if (process.env.VNO_REHEARSAL !== '1') { console.error('Refusing to run: set VNO_REHEARSAL=1 (this test is for the local rehearsal database only).'); process.exit(2); }
const REST = process.env.VNO_REHEARSAL_REST || 'http://localhost:54998';
const PROXY_PORT = 54997;
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(REST)) { console.error('Refusing to run: the REST target must be loopback'); process.exit(2); }

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (() => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ role: 'service_role', iss: 'rehearsal', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', 'rehearsal-jwt-secret-0123456789-abcdefghij').update(`${h}.${p}`).digest('base64url')}`; })();

// supabase-js calls <url>/rest/v1/...; bare PostgREST serves from /. This is the part Kong plays on hosted Supabase.
const proxy = http.createServer((req, res) => {
  const up = http.request(`${REST}${(req.url || '').replace(/^\/rest\/v1/, '')}`, { method: req.method, headers: { ...req.headers, host: new URL(REST).host } }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up);
});

const code = (e: any) => e?.getResponse?.().code; const http_ = (e: any) => e?.getStatus?.();
let controls = 0; const ok = async (label: string, fn: () => Promise<void>) => { try { await fn(); controls += 1; } catch (e) { console.error(`FAIL: ${label}`); throw e; } };

(async () => {
  await new Promise<void>((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${PROXY_PORT}`; process.env.SUPABASE_SERVICE_ROLE_KEY = jwt; process.env.SUPABASE_ANON_KEY = jwt;
  const supabase = new SupabaseService(); const silent = console.log; console.log = () => undefined; await supabase.onModuleInit(); console.log = silent;
  const db = supabase.getClient();
  const media: any = { effectiveAvatar: async () => null };
  const qr = new QrService(supabase, media); const tx = new TransactionsService(supabase);

  // ---- seed (unique per run; the rehearsal database is disposable) --------------------------------------------------------------------------------
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const authIds = { a: randomUUID(), b: randomUUID(), d: randomUUID() }; const mid = { a: randomUUID(), b: randomUUID(), d: randomUUID() };
  const must = async (p: PromiseLike<{ error: any }>) => { const { error } = await p; if (error) throw new Error(error.message); };
  for (const k of ['a', 'b', 'd'] as const) {
    // auth.users is not exposed over REST and the profiles reference it: insert it straight into the disposable rehearsal container
    execFileSync('docker', ['exec', '-i', process.env.VNO_REHEARSAL_PG || 'vno-rehearsal-pg', 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-q', '-v', 'ON_ERROR_STOP=1', '-c',
      `insert into auth.users (id,email,instance_id,aud,role) values ('${authIds[k]}','${k}-${tag}@rehearsal.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated')`]);
  }
  await must(db.from('merchant_details').insert([
    { merchant_system_id: mid.a, merchant_code: `IA-${tag}`, merchant_name: `Merchant A ${tag}`, merchant_verified: true, merchants_status: 'active', merchant_discount_type: 'percentage', merchant_discount_value: 0.05, merchant_commission_type: 'percentage', merchant_commission_value: 0.1 },
    { merchant_system_id: mid.b, merchant_code: `IB-${tag}`, merchant_name: `Merchant B ${tag}`, merchant_verified: true, merchants_status: 'active', merchant_discount_type: 'percentage', merchant_discount_value: 0.03, merchant_commission_type: 'percentage', merchant_commission_value: 0.08 },
    { merchant_system_id: mid.d, merchant_code: `ID-${tag}`, merchant_name: `Merchant D ${tag}`, merchant_verified: true, merchants_status: 'active', merchant_discount_type: null, merchant_discount_value: null, merchant_commission_type: null, merchant_commission_value: null },
  ]));
  await must(db.from('user_profiles').insert([
    { user_id: authIds.a, email: `a-${tag}@rehearsal.invalid`, role: 'merchant', merchant_id: mid.a, user_profiles_status: 'active' },
    { user_id: authIds.b, email: `b-${tag}@rehearsal.invalid`, role: 'merchant', merchant_id: mid.b, user_profiles_status: 'active' },
    { user_id: authIds.d, email: `d-${tag}@rehearsal.invalid`, role: 'merchant', merchant_id: mid.d, user_profiles_status: 'active' },
  ]));
  const P = { free: `COL-FREE-${tag}`, hist: `COL-HIST-${tag}`, pending: `COL-PEND-${tag}` };
  await must(db.from('collaborators').insert([
    { collaborators_code: P.free, collaborators_name: 'Unassigned Partner', collaborators_verified: true, collaborators_status: 'active', merchant_system_id: null },
    { collaborators_code: P.hist, collaborators_name: 'Historically assigned to A', collaborators_verified: true, collaborators_status: 'active', merchant_system_id: mid.a },
    { collaborators_code: P.pending, collaborators_name: 'Pending Partner', collaborators_verified: false, collaborators_status: 'pending', merchant_system_id: null },
  ]));
  const partner = async (c: string) => (await db.from('collaborators').select('id,merchant_system_id').eq('collaborators_code', c).single()).data as any;
  const assignments = async () => JSON.stringify((await db.from('collaborators').select('collaborators_code,merchant_system_id').in('collaborators_code', Object.values(P)).order('collaborators_code')).data);
  const assignmentsBefore = await assignments();
  const ledger = async () => (await db.from('referral_transactions').select('id', { count: 'exact', head: true }).in('merchant_id', Object.values(mid))).count ?? 0;

  // ---- scans --------------------------------------------------------------------------------------------------------------------------------------
  await ok('I1 an UNASSIGNED Partner and a historically-assigned Partner both resolve at Merchant A and at Merchant B, each with that Merchant\'s own discount', async () => {
    for (const c of [P.free, P.hist]) {
      const a: any = await qr.resolveForMerchant(authIds.a, c, { scanId: randomUUID(), source: 'camera' }); const b: any = await qr.resolveForMerchant(authIds.b, c, { scanId: randomUUID(), source: 'manual' });
      assert.equal(a.partner.code, c); assert.equal(b.partner.code, c);
      assert.equal(a.discount.label, 'Giảm 5%'); assert.equal(b.discount.label, 'Giảm 3%'); assert.deepEqual([a.payment, b.payment], [{ available: true }, { available: true }]);
      assert.equal(a.scan.counted && b.scan.counted, true); assert.notEqual(a.scan.id, b.scan.id);
    }
  });
  await ok('I2 the SAME scan session is one walk-in even when 6 requests race (the database unique key, through PostgREST)', async () => {
    const sid = randomUUID(); const rs: any[] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => qr.resolveForMerchant(authIds.a, P.free, { scanId: sid, source: 'camera' })));
    assert.equal(rs.filter((r) => r.scan.counted).length, 1, 'exactly one request inserted the row'); assert.equal(rs.filter((r) => r.scan.duplicate).length, 5);
    assert.equal(new Set(rs.map((r) => r.scan.id)).size, 1, 'every request returns the same scan event id');
    const { count } = await db.from('partner_scan_events').select('id', { count: 'exact', head: true }).eq('merchant_id', mid.a).like('scan_key', `s:${sid}:%`); assert.equal(count, 1);
    const other: any = await qr.resolveForMerchant(authIds.b, P.free, { scanId: sid }); assert.equal(other.scan.counted, true, 'the same scan id at another Merchant is another walk-in');
  });
  await ok('I3 without a scan id: once per (Merchant, Partner, minute); an invalid / pending / unknown lookup is never a walk-in', async () => {
    const before = (await db.from('partner_scan_events').select('id', { count: 'exact', head: true }).eq('merchant_id', mid.d)).count;
    const r1: any = await qr.resolveForMerchant(authIds.d, P.free); const r2: any = await qr.resolveForMerchant(authIds.d, P.free.toLowerCase());
    assert.ok(r1.scan.counted); assert.ok(r2.scan.duplicate || Math.floor(Date.now() / 60_000) !== Math.floor((Date.now() - 50) / 60_000));
    for (const bad of [P.pending, 'COL-0000000000000000', 'hello world']) await assert.rejects(qr.resolveForMerchant(authIds.d, bad));
    const after = (await db.from('partner_scan_events').select('id', { count: 'exact', head: true }).eq('merchant_id', mid.d)).count;
    assert.ok((after ?? 0) - (before ?? 0) <= 2 && (after ?? 0) - (before ?? 0) >= 1);
  });
  await ok('I4 Merchant D has NO commercial policy: the scan still works and counts, no discount is invented, and the payment answer is an explicit configuration message', async () => {
    const r: any = await qr.resolveForMerchant(authIds.d, P.hist, { scanId: randomUUID() });
    assert.deepEqual(r.discount, { available: false, kind: null, rate: null, label: null, reason: 'no_discount' }); assert.equal(r.payment.available, false); assert.equal(r.payment.reason, 'COMMISSION_POLICY_MISSING'); assert.ok(/hoa hồng/.test(r.payment.message)); assert.ok(r.scan.counted);
    await assert.rejects(tx.previewRealTransaction(authIds.d, { collaborator_code: P.hist, gross_amount: '1000' }), (e: any) => code(e) === 'COMMISSION_POLICY_MISSING' && http_(e) === 422);
    const before = await ledger();
    await assert.rejects(tx.createRealTransaction(authIds.d, { collaborator_code: P.hist, gross_amount: '1000', idempotency_key: randomUUID() }), (e: any) => code(e) === 'COMMISSION_POLICY_MISSING' && http_(e) === 422);
    assert.equal(await ledger(), before, 'nothing recorded');
  });

  // ---- transactions -------------------------------------------------------------------------------------------------------------------------------
  const scanFor = async (user: string, c: string) => ((await qr.resolveForMerchant(user, c, { scanId: randomUUID(), source: 'camera' })) as any).scan.id as string;
  let txA: any; let scanA = '';
  await ok('I5 an UNASSIGNED Partner transacts at Merchant A: the Merchant sends only the amount (+ the scan); discount, final and commission come from A\'s policy; the transaction links to its scan', async () => {
    scanA = await scanFor(authIds.a, P.free); const key = randomUUID();
    const preview: any = await tx.previewRealTransaction(authIds.a, { collaborator_code: P.free, gross_amount: '1250000' });
    assert.deepEqual([preview.discount_amount, preview.final_payable, preview.commission_amount], ['62500.0000', '1187500.0000', '125000.0000']);
    txA = await tx.createRealTransaction(authIds.a, { collaborator_code: P.free, gross_amount: '1250000', idempotency_key: key, scan_event_id: scanA });
    assert.deepEqual([Number(txA.discount_amount), txA.final_payable, Number(txA.commission_amount), txA.lifecycle_status, txA.scan_event_id, txA.idempotent_replay], [62500, '1187500.0000', 125000, 'recorded', scanA, false]);   // PostgREST returns numerics as JSON numbers
    const row = (await db.from('referral_transactions').select('scan_event_id,collaborator_id,merchant_id,commission_amount,record_kind').eq('id', txA.transaction_id).single()).data as any;
    assert.deepEqual([row.scan_event_id, row.merchant_id, row.record_kind, Number(row.commission_amount)], [scanA, mid.a, 'real_transaction', 125000]);
    const ev = (await db.from('transaction_events').select('event_type,details').eq('transaction_id', txA.transaction_id)).data as any[]; assert.equal(ev.length, 1); assert.equal(ev[0].details.scan_event_id, scanA);
    assert.equal((await partner(P.free)).merchant_system_id, null, 'nothing assigned the Partner');
    // idempotent replay: same key, same input = the same transaction, no second commission
    const before = await ledger(); const again: any = await tx.createRealTransaction(authIds.a, { collaborator_code: P.free, gross_amount: '1250000', idempotency_key: key, scan_event_id: scanA });
    assert.equal(again.idempotent_replay, true); assert.equal(again.transaction_id, txA.transaction_id); assert.equal(await ledger(), before);
    await assert.rejects(tx.createRealTransaction(authIds.a, { collaborator_code: P.free, gross_amount: '1', idempotency_key: key }), (e: any) => http_(e) === 409);
  });
  await ok('I6 the same Partner transacts at Merchant B with B\'s own policy (3% / 8%); a historically-assigned Partner transacts at B too', async () => {
    for (const c of [P.free, P.hist]) {
      const t: any = await tx.createRealTransaction(authIds.b, { collaborator_code: c, gross_amount: '1000000', idempotency_key: randomUUID(), scan_event_id: await scanFor(authIds.b, c) });
      assert.deepEqual([Number(t.discount_amount), t.final_payable, Number(t.commission_amount)], [30000, '970000.0000', 80000], c);
    }
  });
  await ok('I7 a scan can only be used by ITS Merchant for ITS Partner; nothing is recorded by the refusals', async () => {
    const before = await ledger();
    await assert.rejects(tx.createRealTransaction(authIds.b, { collaborator_code: P.free, gross_amount: '1000', idempotency_key: randomUUID(), scan_event_id: scanA }), (e: any) => code(e) === 'SCAN_EVENT_MISMATCH' && http_(e) === 400);
    await assert.rejects(tx.createRealTransaction(authIds.a, { collaborator_code: P.hist, gross_amount: '1000', idempotency_key: randomUUID(), scan_event_id: scanA }), (e: any) => code(e) === 'SCAN_EVENT_MISMATCH');
    await assert.rejects(tx.createRealTransaction(authIds.a, { collaborator_code: P.pending, gross_amount: '1000', idempotency_key: randomUUID() }), (e: any) => code(e) === 'PARTNER_NOT_ACTIVE' && http_(e) === 400);
    await assert.rejects(tx.createRealTransaction('00000000-0000-4000-8000-0000000000ff', { collaborator_code: P.free, gross_amount: '1000', idempotency_key: randomUUID() }), (e: any) => http_(e) === 403);
    await assert.rejects(tx.createRealTransaction(authIds.a, { collaborator_code: P.free, gross_amount: '0', idempotency_key: randomUUID() }), (e: any) => http_(e) === 400);
    assert.equal(await ledger(), before);
  });
  await ok('I8 the walk-in report counts only this Merchant, and "with transaction" follows the link (a cancelled transaction does not count)', async () => {
    const sa: any = await qr.scanSummary(authIds.a, { days: 7 } as any); const sb: any = await qr.scanSummary(authIds.b, { days: 7 } as any);
    assert.equal('assigned_to_merchant' in sa, false); assert.ok(sa.total >= 4 && sb.total >= 4); assert.equal(sa.with_transaction, 1);
    assert.equal((await db.from('partner_scan_events').select('id', { count: 'exact', head: true }).eq('merchant_id', mid.a)).count, sa.total, 'the report equals the table for this Merchant only');
    await assert.rejects(qr.scanSummary(authIds.a, { days: 7, merchant_id: mid.b } as any), (e: any) => http_(e) === 403);
    await tx.cancelTransaction(authIds.a, txA.transaction_id, { idempotency_key: randomUUID() });
    const after: any = await qr.scanSummary(authIds.a, { days: 7 } as any); assert.equal(after.with_transaction, 0, 'cancelled = not converted');
    const t2: any = await tx.createRealTransaction(authIds.a, { collaborator_code: P.free, gross_amount: '1250000', idempotency_key: randomUUID(), scan_event_id: scanA });   // the corrected attempt on the SAME scan
    assert.equal(t2.scan_event_id, scanA); assert.equal(((await qr.scanSummary(authIds.a, { days: 7 } as any)) as any).with_transaction, 1);
  });
  await ok('I9 a scan never writes anything but its own row: no association, transaction, commission, audit or ledger event', async () => {
    const q = async () => JSON.stringify([(await db.from('transaction_events').select('id', { count: 'exact', head: true })).count, (await db.from('audit_events').select('id', { count: 'exact', head: true })).count, await ledger(), await assignments()]);
    const before = await q(); for (const u of [authIds.a, authIds.b, authIds.d]) await qr.resolveForMerchant(u, P.free, { scanId: randomUUID() });
    assert.equal(await q(), before);
    assert.equal(await assignments(), assignmentsBefore, 'Partner assignments are exactly as they were: nothing was auto-assigned, nothing removed');
  });

  console.log(JSON.stringify({ status: 'PASS', controls, target: 'rehearsal Postgres + PostgREST v14.5 (loopback)' }));
  proxy.close();
})().catch((e) => { console.error(e); proxy.close(); process.exit(1); });
