// Integration test for the MEMBERS routes after the security change: a REAL Nest app (real JwtGuard / AdminGuard / controllers / pipes) over the REAL MerchantsService
// and CollaboratorsService -> the REAL supabase-js client -> PostgREST v14.5 -> the REAL migrated Postgres.
// Only two things are stood in for, because the disposable rehearsal database has no Supabase Auth:
//   - GET /auth/v1/user (what JwtGuard calls to turn a bearer token into a user)  -> a loopback fake that maps test tokens to the seeded users
//   - UserProfilesService.assertIdentityAvailable (calls auth.admin.listUsers)       -> checks user_profiles in the real database + an in-memory "auth-only" set
//
// Proves: the retired Partner route (410 for every authenticated role, 401 anonymous, nothing written) · Merchant create (normalised row, minimal answer, audit without
// personal data) · idempotent replay · duplicate-e-mail answers that do not enumerate · LIKE-wildcard safety · validation over HTTP · concurrency · cross-instance
// races · rate limits (429) · the pending cap (409) · authorization matrix · isolation between Merchants · masked contact details and no bank data anywhere ·
// AUDIT ATOMICITY (section 9): application row + creation audit event commit together or not at all (fault injection on the audit write), two-instance races,
// reconciliation of an application whose original audit is missing (one distinct event, never a duplicate), the database functions' own guards and ACL,
// and the ROLLBACK DRILL (the real rollback script; the API fails closed without the functions; re-apply restores).
// VNO_CONTINUE_ON_FAIL=1 runs everything and lists every failing control (used to reproduce the defect on the previously deployed build).
//
// Needs the rehearsal database (migration/v2/rehearsal/start-rehearsal-stack.sh). It talks to the hosted environment NEVER and refuses any non-loopback target.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as express from 'express';
import { BadRequestException, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MerchantsController } from '../src/modules/merchants/merchants.controller';
import { MerchantsService } from '../src/modules/merchants/merchants.service';
import { CollaboratorsController } from '../src/modules/collaborators/collaborators.controller';
import { CollaboratorsService } from '../src/modules/collaborators/collaborators.service';
import { JwtGuard } from '../src/common/auth/jwt.guard';
import { AdminGuard } from '../src/common/auth/admin.guard';
import { escapeLike } from '../src/modules/merchants/merchant-members';

if (process.env.VNO_REHEARSAL !== '1') { console.error('Refusing to run: set VNO_REHEARSAL=1 (this test is for the local rehearsal database only).'); process.exit(2); }
const REST = process.env.VNO_REHEARSAL_REST || 'http://localhost:54998';
const PG = process.env.VNO_REHEARSAL_PG || 'vno-rehearsal-pg';
const PROXY_PORT = 54997; const APP_PORT = 54996; const APP2_PORT = 54995;
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(REST)) { console.error('Refusing to run: the REST target must be loopback'); process.exit(2); }

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const serviceJwt = (() => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ role: 'service_role', iss: 'rehearsal', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', 'rehearsal-jwt-secret-0123456789-abcdefghij').update(`${h}.${p}`).digest('base64url')}`; })();

// ---- loopback: PostgREST behind /rest/v1 (what Kong does on hosted Supabase) + a fake GoTrue /auth/v1/user ---------------------------------------------------
const users = new Map<string, { id: string; email: string }>();   // bearer token -> user
const proxy = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/auth/v1/user')) {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, ''); const u = users.get(token);
    if (!u) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' })); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() })); return;
  }
  const up = http.request(`${REST}${(req.url || '').replace(/^\/rest\/v1/, '')}`, { method: req.method, headers: { ...req.headers, host: new URL(REST).host } }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up);
});

let controls = 0; const failed: string[] = [];
// VNO_CONTINUE_ON_FAIL=1 runs the WHOLE suite against an older build and lists every control it fails (used to reproduce the audit-atomicity defect on a384f48).
const CONTINUE = process.env.VNO_CONTINUE_ON_FAIL === '1';
const ok = async (label: string, fn: () => Promise<void>) => {
  try { await fn(); controls += 1; }
  catch (e: any) { console.error(`FAIL: ${label}\n      ${String(e?.message ?? e).split('\n')[0].slice(0, 320)}`); if (!CONTINUE) throw e; failed.push(label); }
};
const VIETNAMESE = /[À-ỹ]/;

(async () => {
  await new Promise<void>((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${PROXY_PORT}`; process.env.SUPABASE_SERVICE_ROLE_KEY = serviceJwt; process.env.SUPABASE_ANON_KEY = serviceJwt;
  const supabase = new SupabaseService(); const silent = console.log; console.log = () => undefined; await supabase.onModuleInit(); console.log = silent;
  const db = supabase.getClient();
  const must = async (p: PromiseLike<{ error: any }>) => { const { error } = await p; if (error) throw new Error(error.message); };

  // ---- seed (unique per run; the rehearsal database is disposable) ---------------------------------------------------------------------------------------
  const tag = randomUUID().slice(0, 8).toLowerCase();
  const who = ['mA', 'mB', 'mPending', 'mInactive', 'partnerH', 'partnerU', 'admin'] as const;
  const uid = Object.fromEntries(who.map((k) => [k, randomUUID()])) as Record<typeof who[number], string>;
  const mail = (k: string) => `${k.toLowerCase()}-${tag}@rehearsal.invalid`;
  for (const k of who) execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-q', '-v', 'ON_ERROR_STOP=1', '-c',
    `insert into auth.users (id,email,instance_id,aud,role) values ('${uid[k]}','${mail(k)}','00000000-0000-0000-0000-000000000000','authenticated','authenticated')`]);
  const mid = { A: randomUUID(), B: randomUUID(), P: randomUUID() };
  const baseMerchant = { merchant_discount_type: 'percentage', merchant_discount_value: 0.05, merchant_commission_type: 'percentage', merchant_commission_value: 0.1 };
  await must(db.from('merchant_details').insert([
    { merchant_system_id: mid.A, merchant_code: `MA-${tag}`, merchant_name: `Merchant A ${tag}`, merchant_verified: true, merchants_status: 'active', ...baseMerchant },
    { merchant_system_id: mid.B, merchant_code: `MB-${tag}`, merchant_name: `Merchant B ${tag}`, merchant_verified: true, merchants_status: 'active', ...baseMerchant },
    { merchant_system_id: mid.P, merchant_code: `MP-${tag}`, merchant_name: `Merchant P ${tag}`, merchant_verified: false, merchants_status: 'pending', ...baseMerchant },
  ]));
  const colId = { H: randomUUID(), U: randomUUID(), T: randomUUID() };
  const HIST = { phone: '0988777666', email: `hist-${tag}@rehearsal.invalid`, bank: '9876543210', bankName: 'Techcombank' };
  await must(db.from('collaborators').insert([
    { id: colId.H, collaborators_code: `COL-H-${tag}`, collaborators_name: 'Historical Partner H', collaborators_phone: HIST.phone, collaborators_email: HIST.email, collaborators_bank_name: HIST.bankName, collaborators_bank_acc_number: HIST.bank, collaborators_verified: true, collaborators_status: 'active', merchant_system_id: mid.A },
    { id: colId.T, collaborators_code: `COL-T-${tag}`, collaborators_name: 'Teammate T of H', collaborators_phone: '0977111222', collaborators_email: `team-${tag}@rehearsal.invalid`, collaborators_bank_name: 'ACB', collaborators_bank_acc_number: '1112223334', collaborators_verified: true, collaborators_status: 'active', merchant_system_id: mid.A },
    { id: colId.U, collaborators_code: `COL-U-${tag}`, collaborators_name: 'Unassigned Partner U', collaborators_phone: '0966555444', collaborators_email: mail('partnerU'), collaborators_verified: true, collaborators_status: 'active', merchant_system_id: null },
  ]));
  await must(db.from('user_profiles').insert([
    { user_id: uid.mA, email: mail('mA'), role: 'merchant', merchant_id: mid.A, user_profiles_status: 'active' },
    { user_id: uid.mB, email: mail('mB'), role: 'merchant', merchant_id: mid.B, user_profiles_status: 'active' },
    { user_id: uid.mPending, email: mail('mPending'), role: 'merchant', merchant_id: mid.P, user_profiles_status: 'active' },
    { user_id: uid.mInactive, email: mail('mInactive'), role: 'merchant', merchant_id: mid.B, user_profiles_status: 'inactive' },
    { user_id: uid.partnerH, email: mail('partnerH'), role: 'collaborator', collaborator_id: colId.H, user_profiles_status: 'active' },
    { user_id: uid.partnerU, email: mail('partnerU'), role: 'collaborator', collaborator_id: colId.U, user_profiles_status: 'active' },
    { user_id: uid.admin, email: mail('admin'), role: 'admin', user_profiles_status: 'active' },
  ]));
  // a HISTORICAL audit row from before this change must survive everything below
  await must(db.from('audit_events').insert({ actor_auth_user_id: uid.partnerH, actor_role: 'collaborator', action: 'collaborator.member_application_created', entity_type: 'collaborator', entity_id: colId.T, source: 'v2-admin-api', details: { merchant_id: mid.A, auth_invitation_required: true } }));

  const token = Object.fromEntries(who.map((k) => [k, `tok-${k}-${tag}`])) as Record<typeof who[number], string>;
  for (const k of who) users.set(token[k], { id: uid[k], email: mail(k) });

  // ---- services under test --------------------------------------------------------------------------------------------------------------------------------
  const authOnly = new Set<string>();
  let beforeInsertHook: ((email: string) => Promise<void>) | null = null;       // used to simulate a competing instance between "check" and "insert"
  const userProfilesStub: any = {
    assertIdentityAvailable: async (email: string) => {
      const { data } = await db.from('user_profiles').select('id').ilike('email', escapeLike(email)).limit(1);
      if ((data && data.length) || authOnly.has(email.toLowerCase())) throw new BadRequestException('An account already exists for this email');
      if (beforeInsertHook) await beforeInsertHook(email);
    },
  };
  const audit = new AuditService(supabase);
  const makeMerchants = (env: Record<string, string>) => {
    const keys = ['MERCHANT_MEMBER_CREATES_PER_HOUR', 'MERCHANT_MEMBER_CREATES_PER_DAY', 'MERCHANT_MEMBER_PENDING_CAP']; const saved = keys.map((k) => process.env[k]);
    Object.assign(process.env, { MERCHANT_MEMBER_CREATES_PER_HOUR: '1000', MERCHANT_MEMBER_CREATES_PER_DAY: '1000', MERCHANT_MEMBER_PENDING_CAP: '1000', ...env });
    const svc = new MerchantsService(supabase, userProfilesStub, audit, {} as any);
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
    return svc;
  };
  const collabs = new CollaboratorsService(supabase, userProfilesStub, audit, {} as any, {} as any);
  const startApp = async (merchants: MerchantsService, port: number) => {
    @Module({ controllers: [MerchantsController, CollaboratorsController], providers: [
      { provide: SupabaseService, useValue: supabase }, { provide: MerchantsService, useValue: merchants }, { provide: CollaboratorsService, useValue: collabs }, JwtGuard, AdminGuard] })
    class RehearsalModule {}
    const app = await NestFactory.create(RehearsalModule, { logger: false });
    app.use(express.json({ limit: '1mb' })); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.listen(port, '127.0.0.1'); return app;
  };
  const mainSvc = makeMerchants({});
  const app = await startApp(mainSvc, APP_PORT);
  const call = async (port: number, tok: string | null, method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, json, text };
  };
  const api = (tok: string | null, method: string, path: string, body?: unknown) => call(APP_PORT, tok, method, path, body);

  const rowsByEmail = async (email: string) => ((await db.from('collaborators').select('*').ilike('collaborators_email', escapeLike(email))).data ?? []) as any[];
  const countAll = async (table: string) => (await db.from(table).select('id', { count: 'exact', head: true })).count ?? 0;
  const memberCode = () => `COL${randomBytes(4).toString('hex').toUpperCase().slice(0, 7)}`;   // the code shape the Members API generates
  const seededIds = new Set<string>();                                                          // rows the tests insert by hand (not created through the API)
  const member = (n: string, over: Record<string, unknown> = {}) => ({ collaborators_name: `Thành viên ${n}`, collaborators_phone: '0911222333', collaborators_email: `m-${n}-${tag}@rehearsal.invalid`, ...over });

  // ======================================================= 1. the retired Partner route ============================================================================
  await ok('POST /collaborators/members: 401 anonymous / bad token; 410 FEATURE_RETIRED for EVERY authenticated role; nothing is written', async () => {
    const before = { c: await countAll('collaborators'), a: await countAll('audit_events'), p: await countAll('user_profiles') };
    const body = member('retired');
    assert.equal((await api(null, 'POST', '/collaborators/members', body)).status, 401);
    assert.equal((await api('not-a-token', 'POST', '/collaborators/members', body)).status, 401);
    for (const k of ['partnerH', 'partnerU', 'mA', 'admin', 'mPending'] as const) {
      const r = await api(token[k], 'POST', '/collaborators/members', body);
      assert.equal(r.status, 410, `${k}: ${r.text}`); assert.equal(r.json.code, 'FEATURE_RETIRED'); assert.match(r.json.message, VIETNAMESE); assert.deepEqual(Object.keys(r.json).sort(), ['code', 'message']);
    }
    // the body is neither read nor validated: garbage and an empty body get the same answer
    for (const garbage of [{}, { collaborators_email: 'not-an-email' }, { merchant_system_id: mid.A, collaborators_status: 'active', collaborators_verified: true }]) {
      const r = await api(token.partnerH, 'POST', '/collaborators/members', garbage); assert.equal(r.status, 410); assert.equal(r.json.code, 'FEATURE_RETIRED');
    }
    assert.deepEqual({ c: await countAll('collaborators'), a: await countAll('audit_events'), p: await countAll('user_profiles') }, before, 'the retired route must not write anything');
    assert.equal((await rowsByEmail(body.collaborators_email)).length, 0);
  });

  // ======================================================= 2. Merchant create ======================================================================================
  const A1 = member('one', { collaborators_name: '  Nguyễn   Văn  Một ', collaborators_phone: '+84 (912) 345-678', collaborators_email: `  M-One_${tag}@Rehearsal.INVALID `, collaborators_bank_name: ' Vietcombank ', collaborators_bank_acc_number: '0123 4567-89' });
  const A1email = `m-one_${tag}@rehearsal.invalid`; let A1id = '';
  await ok('Merchant A creates a member: 201, normalised pending row for A, minimal answer, no personal / bank data in the answer', async () => {
    const r = await api(token.mA, 'POST', '/merchants/members', A1); assert.equal(r.status, 201, r.text);
    assert.deepEqual(Object.keys(r.json).sort(), ['collaborators_code', 'collaborators_name', 'collaborators_registered_date', 'collaborators_status', 'collaborators_verified', 'id', 'idempotent_replay']);
    assert.equal(r.json.idempotent_replay, false); assert.equal(r.json.collaborators_status, 'pending'); assert.equal(r.json.collaborators_verified, false); A1id = r.json.id;
    assert.doesNotMatch(r.text, /0123456789|Vietcombank|912345678|m-one_/i);
    const rows = await rowsByEmail(A1email); assert.equal(rows.length, 1); const row = rows[0];
    assert.equal(row.merchant_system_id, mid.A); assert.equal(row.collaborators_status, 'pending'); assert.equal(row.collaborators_verified, false); assert.equal(row.collaborators_password, null);
    assert.equal(row.collaborators_name, 'Nguyễn Văn Một'); assert.equal(row.collaborators_phone, '+84912345678'); assert.equal(row.collaborators_email, A1email);
    assert.equal(row.collaborators_bank_name, 'Vietcombank'); assert.equal(row.collaborators_bank_acc_number, '0123456789');
  });
  await ok('the audit row names who/which Merchant but carries no personal or bank data', async () => {
    const { data } = await db.from('audit_events').select('*').eq('action', 'collaborator.member_application_created').eq('entity_id', A1id);
    assert.equal(data!.length, 1); assert.equal(data![0].actor_auth_user_id, uid.mA); assert.equal(data![0].actor_role, 'merchant');
    assert.deepEqual(data![0].details, { merchant_id: mid.A, auth_invitation_required: true });
    assert.doesNotMatch(JSON.stringify(data![0]), /m-one_|0123456789|912345678|Vietcombank|Nguyễn/i);
  });

  // ======================================================= 3. idempotency and duplicates ============================================================================
  await ok('the same submission again (different case / spacing / separators) is an idempotent replay: same row, no second row, no second audit entry', async () => {
    const again = { ...A1, collaborators_email: A1email.toUpperCase(), collaborators_phone: '+84912345678', collaborators_name: 'nguyễn văn một', collaborators_bank_acc_number: '0123456789' };
    const r = await api(token.mA, 'POST', '/merchants/members', again); assert.equal(r.status, 201, r.text); assert.equal(r.json.idempotent_replay, true); assert.equal(r.json.id, A1id);
    assert.equal((await rowsByEmail(A1email)).length, 1);
    assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('action', 'collaborator.member_application_created').eq('entity_id', A1id)).count, 1);
  });
  const conflictBody = (r: any) => JSON.stringify(r.json);
  await ok('same e-mail with DIFFERENT details, another Merchant, an existing account and an auth-only identity all get the SAME generic 409 (no enumeration, nothing created or changed)', async () => {
    const before = await countAll('collaborators'); authOnly.add(`authonly-${tag}@rehearsal.invalid`);
    const attempts = [
      await api(token.mA, 'POST', '/merchants/members', { ...A1, collaborators_name: 'Người Khác' }),                       // same Merchant, different details
      await api(token.mB, 'POST', '/merchants/members', { ...A1 }),                                                             // another Merchant
      await api(token.mA, 'POST', '/merchants/members', member('acct', { collaborators_email: mail('partnerU') })),           // an existing account / profile
      await api(token.mA, 'POST', '/merchants/members', member('auth', { collaborators_email: `authonly-${tag}@rehearsal.invalid` })), // an identity that only exists in Auth
      await api(token.mA, 'POST', '/merchants/members', member('hist', { collaborators_email: HIST.email })),                 // a real approved Partner's e-mail
    ];
    for (const r of attempts) { assert.equal(r.status, 409, r.text); assert.equal(r.json.code, 'MEMBER_EMAIL_UNAVAILABLE'); assert.deepEqual(Object.keys(r.json).sort(), ['code', 'message']); assert.match(r.json.message, VIETNAMESE); }
    assert.equal(new Set(attempts.map(conflictBody)).size, 1, 'every kind of conflict must look identical to the caller');
    assert.equal(await countAll('collaborators'), before); assert.equal((await rowsByEmail(A1email))[0].collaborators_name, 'Nguyễn Văn Một');
    assert.doesNotMatch(attempts.map((a) => a.text).join(), new RegExp(`${A1id}|${colId.H}|Historical|${HIST.phone}`));
  });
  await ok('LIKE wildcards are literal: x_y@… and xzy@… are different e-mails; each replays only to itself', async () => {
    const u = member('under', { collaborators_email: `x_y-${tag}@rehearsal.invalid` }); const z = member('under2', { collaborators_email: `xzy-${tag}@rehearsal.invalid` });
    const r1 = await api(token.mA, 'POST', '/merchants/members', u); const r2 = await api(token.mA, 'POST', '/merchants/members', z);
    assert.equal(r1.status, 201, r1.text); assert.equal(r2.status, 201, r2.text); assert.equal(r1.json.idempotent_replay, false); assert.equal(r2.json.idempotent_replay, false); assert.notEqual(r1.json.id, r2.json.id);
    const again = await api(token.mA, 'POST', '/merchants/members', u); assert.equal(again.json.idempotent_replay, true); assert.equal(again.json.id, r1.json.id);
    assert.equal((await rowsByEmail(u.collaborators_email)).length, 1); assert.equal((await rowsByEmail(z.collaborators_email)).length, 1);
  });
  await ok('8 parallel identical submissions (double click / retry storm): exactly one row, one audit entry, exactly one non-replay answer', async () => {
    const body = member('parallel'); const rs = await Promise.all(Array.from({ length: 8 }, () => api(token.mA, 'POST', '/merchants/members', body)));
    assert.ok(rs.every((r) => r.status === 201), JSON.stringify(rs.map((r) => r.status))); assert.equal(new Set(rs.map((r) => r.json.id)).size, 1);
    assert.equal(rs.filter((r) => r.json.idempotent_replay === false).length, 1); assert.equal((await rowsByEmail(body.collaborators_email)).length, 1);
    assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('action', 'collaborator.member_application_created').eq('entity_id', rs[0].json.id)).count, 1);
  });
  await ok('a competing row committed between our pre-check and our insert: the function reports EMAIL_HELD and writes nothing; another Merchant\'s row -> generic 409, our own identical pending row -> replay', async () => {
    // (a) the competing row belongs to ANOTHER Merchant and is older: we must end with 409 and the competing row intact
    const a = member('race-a'); let competing = '';
    beforeInsertHook = async (email) => { beforeInsertHook = null; const { data } = await db.from('collaborators').insert({ merchant_system_id: mid.B, collaborators_code: `COL-RACE-${tag}-a`, collaborators_name: 'Competing', collaborators_phone: '0900000001', collaborators_email: email, collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: '2020-01-01T00:00:00Z' }).select('id').single(); competing = data!.id; };
    const ra = await api(token.mA, 'POST', '/merchants/members', a); assert.equal(ra.status, 409, ra.text); assert.equal(ra.json.code, 'MEMBER_EMAIL_UNAVAILABLE');
    const rowsA = await rowsByEmail(a.collaborators_email); assert.equal(rowsA.length, 1); assert.equal(rowsA[0].id, competing); assert.equal(rowsA[0].merchant_system_id, mid.B);
    assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', competing).eq('action', 'collaborator.member_application_created')).count, 0, 'the loser writes no audit entry');
    assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', competing).eq('action', 'collaborator.member_application_audit_reconciled')).count, 0, 'another Merchant\'s application is never reconciled by us');
    // (b) the competing row is the SAME submission by the SAME Merchant and older: we return it as a replay
    const b = member('race-b'); let same = '';
    beforeInsertHook = async (email) => { beforeInsertHook = null; const { data } = await db.from('collaborators').insert({ merchant_system_id: mid.A, collaborators_code: memberCode(), collaborators_name: b.collaborators_name, collaborators_phone: b.collaborators_phone, collaborators_email: email, collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: '2020-01-01T00:00:00Z' }).select('id').single(); same = data!.id; seededIds.add(same); };
    const rb = await api(token.mA, 'POST', '/merchants/members', b); assert.equal(rb.status, 201, rb.text); assert.equal(rb.json.idempotent_replay, true); assert.equal(rb.json.id, same);
    assert.equal((await rowsByEmail(b.collaborators_email)).length, 1);
    // the competing row was hand-inserted WITHOUT an audit event (as a partial write of the old code would be): the replay records ONE reconciliation, not a created event
    assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', same).eq('action', 'collaborator.member_application_created')).count, 0);
    assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', same).eq('action', 'collaborator.member_application_audit_reconciled')).count, 1);
  });

  // ======================================================= 4. validation over HTTP ==================================================================================
  await ok('invalid input over HTTP: 400 VALIDATION_FAILED with Vietnamese field errors, never the English text, nothing written', async () => {
    const before = await countAll('collaborators');
    const r = await api(token.mA, 'POST', '/merchants/members', { collaborators_name: '<b>x</b>', collaborators_phone: 'abc', collaborators_email: 'abc@', collaborators_bank_acc_number: '12ab' });
    assert.equal(r.status, 400); assert.equal(r.json.code, 'VALIDATION_FAILED');
    assert.deepEqual(r.json.errors.map((e: any) => e.field).sort(), ['collaborators_bank_acc_number', 'collaborators_email', 'collaborators_name', 'collaborators_phone']);
    for (const e of r.json.errors) assert.match(e.message, VIETNAMESE);
    const extra = await api(token.mA, 'POST', '/merchants/members', { ...member('x'), merchant_system_id: mid.B, collaborators_status: 'active', collaborators_verified: true });
    assert.equal(extra.status, 400); assert.equal(extra.json.code, 'VALIDATION_FAILED');
    assert.equal(await countAll('collaborators'), before);
  });

  // ======================================================= 5. authorization matrix ==================================================================================
  await ok('POST/GET /merchants/members: 401 anonymous & bad token; 403 Partner, Admin, inactive profile; unapproved Merchant: GET ok, POST 403 MERCHANT_NOT_ACTIVE', async () => {
    const before = await countAll('collaborators');
    for (const m of ['POST', 'GET']) {
      assert.equal((await api(null, m, '/merchants/members', m === 'POST' ? member('z') : undefined)).status, 401);
      assert.equal((await api('bogus', m, '/merchants/members', m === 'POST' ? member('z') : undefined)).status, 401);
      for (const k of ['partnerH', 'partnerU', 'admin', 'mInactive'] as const) assert.equal((await api(token[k], m, '/merchants/members', m === 'POST' ? member('z') : undefined)).status, 403, `${m} ${k}`);
    }
    const pend = await api(token.mPending, 'POST', '/merchants/members', member('pend')); assert.equal(pend.status, 403); assert.equal(pend.json.code, 'MERCHANT_NOT_ACTIVE'); assert.match(pend.json.message, VIETNAMESE);
    assert.equal((await api(token.mPending, 'GET', '/merchants/members')).status, 200);
    assert.equal(await countAll('collaborators'), before);
  });
  await ok('GET /collaborators/members: 401 anonymous; 403 Merchant and Admin; 400 for a Partner without a historical team; the historical team still lists', async () => {
    assert.equal((await api(null, 'GET', '/collaborators/members')).status, 401);
    for (const k of ['mA', 'admin', 'mPending'] as const) assert.equal((await api(token[k], 'GET', '/collaborators/members')).status, 403, k);
    const u = await api(token.partnerU, 'GET', '/collaborators/members'); assert.equal(u.status, 400);
    const h = await api(token.partnerH, 'GET', '/collaborators/members'); assert.equal(h.status, 200); assert.ok(h.json.length >= 2, 'history is preserved: the team is still listed');
  });

  // ======================================================= 6. privacy: masked contact details, no bank data, isolation ===============================================
  const LIST_KEYS = ['collaborators_avatar_url', 'collaborators_email', 'collaborators_name', 'collaborators_phone', 'collaborators_registered_date', 'collaborators_status', 'collaborators_verified', 'id'];
  await ok('Merchant list: only its own Partners, contact masked, NO bank data, exact key set; the other Merchant sees none of it', async () => {
    const a = await api(token.mA, 'GET', '/merchants/members'); assert.equal(a.status, 200);
    const ids = a.json.map((m: any) => m.id); assert.ok(ids.includes(colId.H) && ids.includes(colId.T) && ids.includes(A1id), 'history and own applications are listed');
    for (const m of a.json) assert.deepEqual(Object.keys(m).sort(), LIST_KEYS);
    const h = a.json.find((m: any) => m.id === colId.H); assert.equal(h.collaborators_phone, '*******666'); assert.equal(h.collaborators_email, `h***@rehearsal.invalid`);
    assert.doesNotMatch(a.text, new RegExp(`${HIST.bank}|${HIST.bankName}|${HIST.phone}|hist-${tag}|1112223334|0977111222|0123456789|Vietcombank|912345678|m-one_`));
    const b = await api(token.mB, 'GET', '/merchants/members'); assert.equal(b.status, 200);
    for (const id of [colId.H, colId.T, A1id]) assert.ok(!b.json.some((m: any) => m.id === id), 'Merchant B must not see Merchant A\'s Partners');
  });
  await ok('Partner list (legacy team): contact masked, no bank data, exact key set', async () => {
    const r = await api(token.partnerH, 'GET', '/collaborators/members'); assert.equal(r.status, 200);
    for (const m of r.json) assert.deepEqual(Object.keys(m).sort(), LIST_KEYS);
    assert.doesNotMatch(r.text, new RegExp(`${HIST.bank}|${HIST.bankName}|${HIST.phone}|hist-${tag}|1112223334|0977111222`));
  });
  await ok('history preserved: the legacy Partner rows, their bank data in the database and the older audit row are untouched by all of the above', async () => {
    const { data } = await db.from('collaborators').select('collaborators_bank_acc_number,merchant_system_id,collaborators_status').eq('id', colId.H).single();
    assert.deepEqual(data, { collaborators_bank_acc_number: HIST.bank, merchant_system_id: mid.A, collaborators_status: 'active' });
    assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', colId.T).eq('action', 'collaborator.member_application_created')).count, 1);
  });

  // ======================================================= 7. limits ================================================================================================
  await ok('rate limit over HTTP: the 3rd request in an hour is 429 MEMBER_RATE_LIMITED (Vietnamese, with the limit); another Merchant has its own bucket; replays count', async () => {
    const limited = makeMerchants({ MERCHANT_MEMBER_CREATES_PER_HOUR: '2' }); const app2 = await startApp(limited, APP2_PORT);
    try {
      const c = (tok: string, n: string) => call(APP2_PORT, tok, 'POST', '/merchants/members', member(n));
      const r1 = await c(token.mA, 'rl1'); const r2 = await c(token.mA, 'rl2'); assert.equal(r1.status, 201); assert.equal(r2.status, 201);
      const r3 = await c(token.mA, 'rl3'); assert.equal(r3.status, 429, r3.text); assert.equal(r3.json.code, 'MEMBER_RATE_LIMITED'); assert.equal(r3.json.limit, 2); assert.match(r3.json.message, VIETNAMESE);
      assert.equal((await rowsByEmail(member('rl3').collaborators_email)).length, 0, 'a limited request writes nothing');
      assert.equal((await call(APP2_PORT, token.mA, 'POST', '/merchants/members', member('rl1'))).status, 429, 'a replay is still a request');
      assert.equal((await c(token.mB, 'rl-b')).status, 201, 'Merchant B has its own bucket');
    } finally { await app2.close(); }
  });
  await ok('daily limit: the 3rd creation in a day is 429 MEMBER_DAILY_LIMIT', async () => {
    const svc = makeMerchants({ MERCHANT_MEMBER_CREATES_PER_DAY: '2' });
    await svc.createMember(uid.mB, { collaborators_name: 'Dl One', collaborators_phone: '0911222333', collaborators_email: `dl1-${tag}@rehearsal.invalid` });
    await svc.createMember(uid.mB, { collaborators_name: 'Dl Two', collaborators_phone: '0911222333', collaborators_email: `dl2-${tag}@rehearsal.invalid` });
    await assert.rejects(svc.createMember(uid.mB, { collaborators_name: 'Dl Three', collaborators_phone: '0911222333', collaborators_email: `dl3-${tag}@rehearsal.invalid` }), (e: any) => e.getStatus() === 429 && e.getResponse().code === 'MEMBER_DAILY_LIMIT');
  });
  await ok('pending cap (durable, counted in the database): the 3rd distinct application is 409 MEMBER_LIMIT_REACHED; a replay still works at the cap; approved Partners do not count', async () => {
    const svc = makeMerchants({ MERCHANT_MEMBER_PENDING_CAP: '2' });
    // Merchant P2: a fresh Merchant so earlier rows do not interfere; its history includes an ACTIVE verified Partner, which must not count
    const m2 = randomUUID(); const u2 = randomUUID(); execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `insert into auth.users (id,email,instance_id,aud,role) values ('${u2}','cap-${tag}@rehearsal.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated')`]);
    await must(db.from('merchant_details').insert({ merchant_system_id: m2, merchant_code: `MC-${tag}`, merchant_name: `Merchant Cap ${tag}`, merchant_verified: true, merchants_status: 'active', ...baseMerchant }));
    await must(db.from('user_profiles').insert({ user_id: u2, email: `cap-${tag}@rehearsal.invalid`, role: 'merchant', merchant_id: m2, user_profiles_status: 'active' }));
    await must(db.from('collaborators').insert({ collaborators_code: `COL-CAPH-${tag}`, collaborators_name: 'Approved history', collaborators_email: `caph-${tag}@rehearsal.invalid`, collaborators_verified: true, collaborators_status: 'active', merchant_system_id: m2 }));
    const mk = (n: string) => ({ collaborators_name: `Cap ${n}`, collaborators_phone: '0911222333', collaborators_email: `cap-${n}-${tag}@rehearsal.invalid` });
    const first = await svc.createMember(u2, mk('1')); await svc.createMember(u2, mk('2'));
    await assert.rejects(svc.createMember(u2, mk('3')), (e: any) => e.getStatus() === 409 && e.getResponse().code === 'MEMBER_LIMIT_REACHED' && e.getResponse().limit === 2);
    assert.equal((await rowsByEmail(mk('3').collaborators_email)).length, 0);
    const replay = await svc.createMember(u2, mk('1')); assert.equal(replay.idempotent_replay, true); assert.equal(replay.id, first.id);
    // a NEW instance (restart / second instance) is still held by the database count
    await assert.rejects(makeMerchants({ MERCHANT_MEMBER_PENDING_CAP: '2' }).createMember(u2, mk('4')), (e: any) => e.getResponse().code === 'MEMBER_LIMIT_REACHED');
  });

  // ======================================================= 9. audit atomicity: fault injection, concurrency, reconciliation, function guards ==========================
  // The application row and its creation audit event must commit TOGETHER or not at all. A trigger on audit_events makes the audit INSERT fail for one action
  // (same effect as an audit outage, a constraint failure or a dropped connection at exactly that step); it exists only while a control runs and is always removed.
  const CREATED = 'collaborator.member_application_created'; const RECONCILED = 'collaborator.member_application_audit_reconciled';
  const psql = (sql: string) => execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  const FAULT = 'vno_test_fail_audit';
  const injectAuditFault = (action: string) => psql(`create or replace function public.${FAULT}() returns trigger language plpgsql as $f$ begin if new.action = '${action}' then raise exception 'injected audit failure (test only)' using errcode = 'XX000'; end if; return new; end $f$; drop trigger if exists ${FAULT} on public.audit_events; create trigger ${FAULT} before insert on public.audit_events for each row execute function public.${FAULT}();`);
  const clearAuditFault = () => psql(`drop trigger if exists ${FAULT} on public.audit_events; drop function if exists public.${FAULT}();`);
  const auditCount = async (action: string, entityId?: string) => { let q = db.from('audit_events').select('id', { count: 'exact', head: true }).eq('action', action); if (entityId) q = q.eq('entity_id', entityId); return (await q).count ?? 0; };
  // counts scoped to THIS run's Merchants (random per run): nothing else writing to the shared rehearsal database can disturb a control
  const MIDS = [mid.A, mid.B, mid.P];
  const scoped = async () => ({
    c: (await db.from('collaborators').select('id', { count: 'exact', head: true }).in('merchant_system_id', MIDS)).count ?? 0,
    a: (await db.from('audit_events').select('id', { count: 'exact', head: true }).in('details->>merchant_id', MIDS)).count ?? 0,
  });
  // an application as the OLD code could leave it after a failed audit write: pending, this Merchant's, Members code shape, with NO audit event.
  // Its date is set by the DATABASE clock, never by the test host's, so a drifting VM clock cannot move a row across the 30-second boundary.
  const seedLegacy = async (n: string, registered: string) => {
    const m = member(n);
    const { data, error } = await db.from('collaborators').insert({ merchant_system_id: mid.A, collaborators_code: memberCode(), collaborators_name: m.collaborators_name, collaborators_phone: m.collaborators_phone,
      collaborators_email: m.collaborators_email, collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: '2020-01-01T00:00:00Z' }).select('id').single();
    if (error) throw new Error(error.message); const id = data!.id as string; seededIds.add(id);
    psql(`update public.collaborators set collaborators_registered_date = ${registered === 'now' ? 'now()' : `'${registered}'::timestamptz`} where id = '${id}'`);
    return { body: m, id };
  };
  let adminMadeId = '';
  const dtoOf = (m: { collaborators_name: string; collaborators_phone: string; collaborators_email: string }) => ({ collaborators_name: m.collaborators_name, collaborators_phone: m.collaborators_phone, collaborators_email: m.collaborators_email });

  const fi1 = member('fi1');
  await ok('FI-1 the audit write FAILS: the request fails and NOTHING persists (no application row, no audit row)', async () => {
    const before = await scoped();
    injectAuditFault(CREATED);
    try {
      const r = await api(token.mA, 'POST', '/merchants/members', fi1);
      assert.equal(r.status, 500, r.text);
      assert.equal((await rowsByEmail(fi1.collaborators_email)).length, 0, 'an application whose creation audit event could not be written must not survive');
      assert.deepEqual(await scoped(), before, 'nothing may be added: no collaborators row and no audit row');
      assert.equal(r.json?.code, 'MEMBER_CREATE_FAILED'); assert.match(r.json.message, VIETNAMESE); assert.doesNotMatch(r.text, /injected|trigger|audit_events|XX000/i, 'no internal detail may reach the caller');
    } finally { clearAuditFault(); }
  });
  await ok('FI-1b after the fault clears, the SAME retry creates exactly one application with exactly one created-audit event (and is not reported as a replay)', async () => {
    const r = await api(token.mA, 'POST', '/merchants/members', fi1); assert.equal(r.status, 201, r.text); assert.equal(r.json.idempotent_replay, false);
    assert.equal((await rowsByEmail(fi1.collaborators_email)).length, 1); assert.equal(await auditCount(CREATED, r.json.id), 1); assert.equal(await auditCount(RECONCILED, r.json.id), 0);
  });
  await ok('FI-2 six parallel identical submissions while the audit write fails: every one fails, nothing persists; once it recovers, six parallel produce one application, one audit event', async () => {
    const body = member('fi2'); const before = await scoped();
    injectAuditFault(CREATED);
    try {
      const rs = await Promise.all(Array.from({ length: 6 }, () => api(token.mA, 'POST', '/merchants/members', body)));
      assert.ok(rs.every((r) => r.status === 500), JSON.stringify(rs.map((r) => r.status)));
      assert.deepEqual(await scoped(), before);
    } finally { clearAuditFault(); }
    const rs = await Promise.all(Array.from({ length: 6 }, () => api(token.mA, 'POST', '/merchants/members', body)));
    assert.ok(rs.every((r) => r.status === 201)); assert.equal(new Set(rs.map((r) => r.json.id)).size, 1); assert.equal(rs.filter((r) => r.json.idempotent_replay === false).length, 1);
    assert.equal((await rowsByEmail(body.collaborators_email)).length, 1); assert.equal(await auditCount(CREATED, rs[0].json.id), 1);
  });
  await ok('FI-3 two API instances racing on ONE e-mail (10 parallel calls, separate in-process locks): exactly one application, one created-audit event, nine replays, no error', async () => {
    const x = makeMerchants({}); const y = makeMerchants({}); const dto = dtoOf(member('xinst'));
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? x : y).createMember(uid.mA, dto)));
    assert.equal(rs.filter((r) => r.idempotent_replay === false).length, 1); assert.equal(new Set(rs.map((r) => r.id)).size, 1);
    assert.equal((await rowsByEmail(dto.collaborators_email)).length, 1); assert.equal(await auditCount(CREATED, rs[0].id), 1); assert.equal(await auditCount(RECONCILED, rs[0].id), 0);
  });
  await ok('FI-4 two API instances racing on one e-mail with DIFFERENT details: one winner, the rest replay the winner or get the generic 409 (never a 500), one row, one audit event', async () => {
    const x = makeMerchants({}); const y = makeMerchants({}); const base = dtoOf(member('xdiff'));
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? x : y).createMember(uid.mA, { ...base, collaborators_name: i % 2 ? 'Tên Một' : 'Tên Hai' }).then((v) => ({ ok: true as const, v }), (err) => ({ ok: false as const, err }))));
    const wins = rs.filter((r) => r.ok && !(r as any).v.idempotent_replay) as any[]; assert.equal(wins.length, 1, 'exactly one request creates the application');
    for (const r of rs) {
      if (r.ok) assert.equal((r as any).v.id, wins[0].v.id, 'a replay always points at the winner');
      else { assert.equal((r as any).err.getStatus(), 409); assert.equal((r as any).err.getResponse().code, 'MEMBER_EMAIL_UNAVAILABLE'); }
    }
    const rows = await rowsByEmail(base.collaborators_email); assert.equal(rows.length, 1); assert.equal(rows[0].id, wins[0].v.id);
    assert.equal(await auditCount(CREATED, wins[0].v.id), 1);
  });
  await ok('FI-5 an application whose ORIGINAL audit is missing: the replay records exactly ONE distinct reconciliation event, never a second "created" event, and never repeats', async () => {
    const { body, id } = await seedLegacy('gap1', '2020-02-02T00:00:00Z');
    const r1 = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(r1.status, 201, r1.text); assert.equal(r1.json.idempotent_replay, true); assert.equal(r1.json.id, id);
    assert.equal(await auditCount(CREATED, id), 0, 'a replay must never claim a creation'); assert.equal(await auditCount(RECONCILED, id), 1);
    const { data } = await db.from('audit_events').select('*').eq('entity_id', id).eq('action', RECONCILED); const ev = data![0];
    assert.equal(ev.actor_auth_user_id, uid.mA); assert.equal(ev.actor_role, 'merchant'); assert.equal(ev.entity_type, 'collaborator');
    assert.equal(ev.details.merchant_id, mid.A); assert.equal(ev.details.reason, 'creation_audit_missing'); assert.ok(String(ev.details.application_registered_at).startsWith('2020-02-02'));
    assert.doesNotMatch(JSON.stringify(ev), new RegExp(`${body.collaborators_email}|0911222333|Thành viên`, 'i'), 'no personal data in the event');
    for (let i = 0; i < 3; i += 1) { const again = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(again.status, 201); assert.equal(again.json.idempotent_replay, true); }
    assert.equal(await auditCount(RECONCILED, id), 1, 'repeated replays must not repeat the reconciliation'); assert.equal(await auditCount(CREATED, id), 0);
  });
  await ok('FI-5b a pending row created by ANOTHER path (Admin create: COL-<16 hex>, with its own audit trail) is not this API\'s application: an identical submission gets the generic 409 and NO audit event is written for it', async () => {
    const m = member('adminmade'); adminMadeId = randomUUID(); seededIds.add(adminMadeId);
    await must(db.from('collaborators').insert({ id: adminMadeId, merchant_system_id: mid.A, collaborators_code: `COL-${randomBytes(8).toString('hex').toUpperCase()}`, collaborators_name: m.collaborators_name, collaborators_phone: m.collaborators_phone,
      collaborators_email: m.collaborators_email, collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: '2020-01-01T00:00:00Z' }));
    await must(db.from('audit_events').insert({ actor_auth_user_id: uid.admin, actor_role: 'admin', action: 'collaborator.created', entity_type: 'collaborator', entity_id: adminMadeId, source: 'v2-admin-api', details: { merchant_id: mid.A } }));
    const r = await api(token.mA, 'POST', '/merchants/members', m); assert.equal(r.status, 409, r.text); assert.equal(r.json.code, 'MEMBER_EMAIL_UNAVAILABLE');
    assert.equal(await auditCount(CREATED, adminMadeId), 0); assert.equal(await auditCount(RECONCILED, adminMadeId), 0);
    assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', adminMadeId)).count, 1, 'only the Admin\'s own event exists');
  });
  await ok('FI-6 an API-created application younger than 30 s with no audit event (its creator may still be writing it: rolling deploy): the replay is a retryable 409 MEMBER_AUDIT_PENDING with NO audit write; once old enough the replay reconciles it', async () => {
    const { body, id } = await seedLegacy('gap2', 'now');
    const r = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(r.status, 409, r.text); assert.equal(r.json.code, 'MEMBER_AUDIT_PENDING'); assert.match(r.json.message, VIETNAMESE); assert.equal(r.json.retry_after_seconds, 30);
    assert.equal(await auditCount(CREATED, id), 0); assert.equal(await auditCount(RECONCILED, id), 0);
    psql(`update public.collaborators set collaborators_registered_date = now() - interval '2 minutes' where id = '${id}'`);
    const r2 = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(r2.status, 201, r2.text); assert.equal(r2.json.idempotent_replay, true); assert.equal(r2.json.id, id);
    assert.equal(await auditCount(RECONCILED, id), 1); assert.equal(await auditCount(CREATED, id), 0);
  });
  await ok('FI-7 the reconciliation write FAILS: the replay fails (a 2xx always implies an audit trail), nothing is written or changed; after recovery exactly one event is recorded', async () => {
    const { body, id } = await seedLegacy('gap3', '2020-03-03T00:00:00Z'); const before = (await db.from('collaborators').select('*').eq('id', id).single()).data;
    injectAuditFault(RECONCILED);
    try {
      const r = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(r.status, 500, r.text); assert.equal(r.json?.code, 'MEMBER_AUDIT_FAILED'); assert.match(r.json.message, VIETNAMESE);
      assert.doesNotMatch(r.text, /injected|trigger|audit_events|XX000/i);
      assert.equal(await auditCount(RECONCILED, id), 0); assert.deepEqual((await db.from('collaborators').select('*').eq('id', id).single()).data, before, 'the application row is untouched');
    } finally { clearAuditFault(); }
    const r = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(r.status, 201); assert.equal(r.json.idempotent_replay, true); assert.equal(await auditCount(RECONCILED, id), 1);
  });
  await ok('FI-8 an already-audited application is replayed with NO audit write at all (neither created nor reconciliation)', async () => {
    assert.equal(await auditCount(RECONCILED, A1id), 0); assert.equal(await auditCount(CREATED, A1id), 1);
    const r = await api(token.mA, 'POST', '/merchants/members', A1); assert.equal(r.status, 201); assert.equal(r.json.idempotent_replay, true);
    assert.equal(await auditCount(RECONCILED, A1id), 0); assert.equal(await auditCount(CREATED, A1id), 1);
  });
  await ok('FI-9 the database functions enforce their own guards: wrong actor / Merchant / state -> NOT_ALLOWED or NOT_ELIGIBLE, invalid arguments -> error; nothing is written', async () => {
    const e = `guard-${tag}@rehearsal.invalid`; const args = (actor: string, merchant: string) => ({ p_actor_user_id: actor, p_merchant_id: merchant, p_code: 'COLGUARD1', p_name: 'Guard Test', p_phone: '0911222333', p_email: e });
    const before = await scoped();
    for (const [label, a, m] of [['inactive profile', uid.mInactive, mid.B], ['Merchant not active/verified', uid.mPending, mid.P], ['profile bound to another Merchant', uid.mA, mid.B], ['Partner', uid.partnerH, mid.A], ['Admin', uid.admin, mid.A]] as const) {
      const r = await db.rpc('create_merchant_member_application', args(a, m)); assert.equal(r.error, null, label); assert.deepEqual(r.data, { outcome: 'NOT_ALLOWED' }, label);
    }
    for (const blank of ['  ', '\t \n', '']) { const bad = await db.rpc('create_merchant_member_application', { ...args(uid.mA, mid.A), p_name: blank }); assert.equal(bad.error?.code, '22023', JSON.stringify(blank)); }
    for (const [label, a, m, member] of [['another Merchant\'s application', uid.mB, mid.B, A1id], ['an active Partner', uid.mA, mid.A, colId.H], ['an unassigned Partner', uid.mA, mid.A, colId.U], ['a pending row created by ANOTHER path (Admin)', uid.mA, mid.A, adminMadeId]] as const) {
      const r = await db.rpc('reconcile_merchant_member_audit', { p_actor_user_id: a, p_merchant_id: m, p_member_id: member }); assert.equal(r.error, null, label); assert.equal(r.data, 'NOT_ELIGIBLE', label);
    }
    assert.equal((await db.rpc('reconcile_merchant_member_audit', { p_actor_user_id: uid.mInactive, p_merchant_id: mid.B, p_member_id: A1id })).data, 'NOT_ALLOWED');
    assert.deepEqual(await scoped(), before); assert.equal((await rowsByEmail(e)).length, 0);
  });
  await ok('FI-10 anon and authenticated database roles cannot call either function (nothing is written) and the ACL is service_role-only, SECURITY INVOKER, search_path pinned', async () => {
    const jwtFor = (role: string) => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ role, iss: 'rehearsal', exp: Math.floor(Date.now() / 1000) + 3600 });
      return `${h}.${p}.${createHmac('sha256', 'rehearsal-jwt-secret-0123456789-abcdefghij').update(`${h}.${p}`).digest('base64url')}`; };
    const before = await scoped(); const e = `priv-${tag}@rehearsal.invalid`;
    for (const role of ['anon', 'authenticated']) for (const [fn, body] of [
      ['create_merchant_member_application', { p_actor_user_id: uid.mA, p_merchant_id: mid.A, p_code: 'COLPRIV01', p_name: 'Priv Test', p_phone: '0911222333', p_email: e }],
      ['reconcile_merchant_member_audit', { p_actor_user_id: uid.mA, p_merchant_id: mid.A, p_member_id: A1id }]] as const) {
      const r = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwtFor(role)}` }, body: JSON.stringify(body) });
      const j: any = await r.json().catch(() => ({}));
      // 42501 = "permission denied for function": a wrong JWT secret would be 401 PGRST301 and must NOT satisfy this control
      assert.ok([401, 403].includes(r.status) && j.code === '42501', `${role} -> ${fn}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
    }
    assert.deepEqual(await scoped(), before); assert.equal((await rowsByEmail(e)).length, 0);
    // ... and the ACL itself: EXECUTE for service_role only (never PUBLIC, anon or authenticated)
    for (const sig of ['public.create_merchant_member_application(uuid,uuid,text,text,text,text,text,text)', 'public.reconcile_merchant_member_audit(uuid,uuid,uuid)']) {
      const acl = execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-At', '-c', `select coalesce(proacl::text, 'NULL') || '|' || prosecdef::text || '|' || coalesce(proconfig::text, '') from pg_proc where oid = '${sig}'::regprocedure`]).toString().trim();
      const [grants, secdef, config] = acl.split('|');
      assert.notEqual(grants, 'NULL', `${sig}: a NULL ACL would grant EXECUTE to PUBLIC`);
      assert.ok(!/(^|[{,])=X\//.test(grants), `${sig}: PUBLIC must not execute (${grants})`);
      assert.ok(!/(^|[{,])(anon|authenticated)=X\//.test(grants), `${sig}: anon / authenticated must not execute (${grants})`);
      assert.ok(/service_role=X\//.test(grants), `${sig}: service_role must execute (${grants})`);
      assert.equal(secdef, 'false', `${sig}: SECURITY INVOKER`); assert.match(config, /search_path=pg_catalog, public/, `${sig}: search_path pinned`);
    }
  });
  await ok('FI-13 the per-e-mail lock is a CONTRACT: while another session holds it with an UNCOMMITTED competing row, the API call WAITS, then sees the committed row and answers the generic 409 (exactly one row)', async () => {
    const body = member('fi13'); const before = await scoped();
    const holder = spawn('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-q', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const finished = new Promise<void>((resolve, reject) => { holder.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`lock holder exited ${code}`)))); });
    holder.stdin.write(`begin; select pg_advisory_xact_lock(hashtextextended('vno:merchant-member-email:${body.collaborators_email}', 0));
      insert into public.collaborators (merchant_system_id, collaborators_code, collaborators_name, collaborators_phone, collaborators_email, collaborators_status, collaborators_verified, collaborators_registered_date)
      values ('${mid.A}', 'COL-LOCK-${tag}', 'Người giữ khoá', '0900000009', '${body.collaborators_email}', 'pending', false, now()); select pg_sleep(3); commit;\n`);
    holder.stdin.end();
    for (let i = 0; i < 50; i += 1) {   // wait until the holder really owns the lock (deterministic, not a fixed delay)
      const held = execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-At', '-c', "select count(*) from pg_locks where locktype = 'advisory' and granted"]).toString().trim();
      if (Number(held) > 0) break; await new Promise((r) => setTimeout(r, 100));
    }
    const t0 = Date.now(); const r = await api(token.mA, 'POST', '/merchants/members', body); const waited = Date.now() - t0; await finished;
    assert.ok(waited >= 800, `the call must have waited for the lock holder (waited ${waited} ms)`);
    assert.equal(r.status, 409, r.text); assert.equal(r.json.code, 'MEMBER_EMAIL_UNAVAILABLE');
    assert.equal((await rowsByEmail(body.collaborators_email)).length, 1, 'exactly the lock holder\'s row'); const after = await scoped();
    assert.equal(after.c, before.c + 1); assert.equal(after.a, before.a, 'we wrote no audit event');
  });
  await ok('FI-14 an insert that yields NO row (e.g. a BEFORE INSERT trigger on the hosted table) aborts the whole call: no orphan audit event, the API answers 500 and writes nothing', async () => {
    const body = member('fi14'); const before = await scoped();
    psql(`create or replace function public.vno_test_swallow() returns trigger language plpgsql as $f$ begin return null; end $f$; drop trigger if exists vno_test_swallow on public.collaborators; create trigger vno_test_swallow before insert on public.collaborators for each row when (new.collaborators_email = '${body.collaborators_email}') execute function public.vno_test_swallow();`);
    try {
      const r = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(r.status, 500, r.text); assert.equal(r.json?.code, 'MEMBER_CREATE_FAILED');
      assert.deepEqual(await scoped(), before, 'no application and NO orphan audit event');
      assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('action', CREATED).is('entity_id', null).in('details->>merchant_id', MIDS)).count, 0, 'no created event without an entity');
    } finally { psql(`drop trigger if exists vno_test_swallow on public.collaborators; drop function if exists public.vno_test_swallow();`); }
  });
  await ok('FI-12 rollback drill: the REAL rollback script drops both functions and touches no data; the API then FAILS CLOSED (create and replay -> 500, nothing written); re-applying the migration restores everything', async () => {
    const migration = readFileSync(path.join(__dirname, '../../supabase/migrations/20261111000001_vno_merchant_member_atomic_create.sql'), 'utf8');
    const rollback = readFileSync(path.join(__dirname, '../../migration/v2/rollback/20261111000001_vno_merchant_member_atomic_create_rollback.sql'), 'utf8');
    const run = (sql: string) => execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
    const fnCount = () => Number(execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-At', '-c', "select count(*) from pg_proc where proname in ('create_merchant_member_application','reconcile_merchant_member_audit')"]).toString().trim());
    // PostgREST reloads its schema cache asynchronously after NOTIFY. A call fails as soon as the DATABASE lacks the function, even while PostgREST's cache is stale,
    // so "an error" is not enough: wait for PGRST202 (not in the cache) from BOTH functions after the drop, and for 5 consecutive successes from both after re-apply.
    const probes = () => Promise.all([
      db.rpc('create_merchant_member_application', { p_actor_user_id: uid.partnerH, p_merchant_id: mid.A, p_code: 'COLPROBE01', p_name: 'Probe', p_phone: '0911222333', p_email: `probe-${tag}@rehearsal.invalid` }),   // a Partner: NOT_ALLOWED, writes nothing
      db.rpc('reconcile_merchant_member_audit', { p_actor_user_id: uid.partnerH, p_merchant_id: mid.A, p_member_id: colId.U }),
    ]);
    const waitFor = async (present: boolean) => {
      let streak = 0;
      for (let i = 0; i < 150; i += 1) {
        const rs = await probes(); const good = present ? rs.every((r) => !r.error) : rs.every((r) => r.error?.code === 'PGRST202');
        streak = good ? streak + 1 : 0; if (streak >= 5) return; await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`PostgREST schema cache did not settle (wanted functions ${present ? 'present' : 'absent'})`);
    };
    const snap = scoped;
    const before = await snap(); const body = member('fi12'); const audited = await api(token.mA, 'POST', '/merchants/members', member('fi12-audited')); assert.equal(audited.status, 201);
    const before2 = await snap();
    try {
      run(rollback); assert.equal(fnCount(), 0, 'both functions must be gone'); await waitFor(false);
      assert.deepEqual(await snap(), before2, 'the rollback must not touch a single row');
      const create = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(create.status, 500, create.text); assert.equal(create.json?.code, 'MEMBER_CREATE_FAILED'); assert.match(create.json.message, VIETNAMESE);
      assert.doesNotMatch(create.text, /PGRST|function|schema cache|public\./i, 'no internal detail may reach the caller');
      const replay = await api(token.mA, 'POST', '/merchants/members', member('fi12-audited')); assert.equal(replay.status, 500, replay.text); assert.equal(replay.json?.code, 'MEMBER_AUDIT_FAILED');
      assert.equal((await rowsByEmail(body.collaborators_email)).length, 0); assert.deepEqual(await snap(), before2, 'fail closed means nothing is written');
      assert.equal((await api(token.mA, 'GET', '/merchants/members')).status, 200, 'listing does not depend on the functions');
    } finally { run(migration); await waitFor(true); }
    assert.equal(fnCount(), 2); const again = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(again.status, 201, again.text); assert.equal(again.json.idempotent_replay, false);
    assert.equal(await auditCount(CREATED, again.json.id), 1); assert.ok((await snap()).c > before.c);
  });
  await ok('FI-11 invariants after everything above: each API-created application has exactly ONE created event and no reconciliation; no event points at a missing application; nothing was deleted', async () => {
    const { data: rows } = await db.from('collaborators').select('id,collaborators_code').like('collaborators_email', `%${tag}@rehearsal.invalid`);
    const apiRows = (rows ?? []).filter((r: any) => /^COL[0-9A-F]{7}$/.test(r.collaborators_code) && !seededIds.has(r.id)); assert.ok(apiRows.length >= 10, `expected many API-created rows, got ${apiRows.length}`);
    for (const r of apiRows) { assert.equal(await auditCount(CREATED, r.id), 1, `created events for ${r.collaborators_code}`); assert.equal(await auditCount(RECONCILED, r.id), 0, `reconciliations for ${r.collaborators_code}`); }
    const { data: events } = await db.from('audit_events').select('entity_id,action').in('action', [CREATED, RECONCILED]).in('details->>merchant_id', [mid.A, mid.B, mid.P]);
    const ids = [...new Set((events ?? []).map((x: any) => x.entity_id))]; const { data: existing } = await db.from('collaborators').select('id').in('id', ids);
    assert.equal((existing ?? []).length, ids.length, 'no audit event may reference an application that does not exist');
    for (const id of ids) { const c = await auditCount(CREATED, id); const rc = await auditCount(RECONCILED, id); assert.ok(c + rc >= 1 && c <= 1 && rc <= 1, `entity ${id}: created ${c}, reconciled ${rc}`); }
  });

  // ======================================================= 8. retired route did not disturb the Merchant route; final integrity =====================================
  await ok('final integrity: no Partner was approved, activated, linked or assigned by any member creation; every created row is a pending, unverified application with no login', async () => {
    const { data } = await db.from('collaborators').select('id,collaborators_status,collaborators_verified,collaborators_password').like('collaborators_email', `%-${tag}@rehearsal.invalid`).eq('collaborators_verified', false);
    assert.ok((data ?? []).length >= 6); for (const r of data!) { assert.equal(r.collaborators_status, 'pending'); assert.equal(r.collaborators_password, null); }
    const created = (data ?? []).map((r: any) => r.id);
    const { data: profiles } = await db.from('user_profiles').select('id').in('collaborator_id', created); assert.equal((profiles ?? []).length, 0, 'no sign-in was created or linked for any member application');
    assert.deepEqual((await db.from('collaborators').select('merchant_system_id').eq('id', colId.U).single()).data, { merchant_system_id: null }, 'an unassigned Partner stays unassigned');
  });

  await app.close(); proxy.close();
  if (failed.length) { console.error(`\nmerchant-members integration: ${controls} controls PASS, ${failed.length} FAIL:\n${failed.map((f) => `  - ${f}`).join('\n')}`); process.exit(1); }
  console.log(`merchant-members integration (real Nest app -> supabase-js -> PostgREST -> Postgres): ${controls} controls PASS`);
  process.exit(0);
})().catch((e) => { console.error(e); proxy.close(); process.exit(1); });
