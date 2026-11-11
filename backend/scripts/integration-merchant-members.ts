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
// REPLAY VERIFICATION (a replay succeeds only when a matching creation audit event can be read; a row without one - old or young, API-shaped code or not - fails
// closed, is flagged in the log and nothing is ever written to repair it; a late audit write by the creator is the only thing that makes it succeed), the database
// function's own guards and ACL, an unavailable function (revoked / dropped) and the ROLLBACK DRILL (the real rollback script; re-apply, twice, restores).
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
  const CREATED = 'collaborator.member_application_created';
  const auditCount = async (action: string, entityId?: string) => { let q = db.from('audit_events').select('id', { count: 'exact', head: true }).eq('action', action); if (entityId) q = q.eq('entity_id', entityId); return (await q).count ?? 0; };
  const anyAuditCount = async (entityId: string) => (await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', entityId)).count ?? 0;
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
  await ok('a competing row committed between our pre-check and our insert: the function reports EMAIL_HELD and writes nothing; another Merchant\'s row -> generic 409; our own identical row WITH its audit event -> replay; WITHOUT one -> fail closed', async () => {
    // (a) the competing row belongs to ANOTHER Merchant and is older: we must end with 409 and the competing row intact
    const a = member('race-a'); let competing = '';
    beforeInsertHook = async (email) => { beforeInsertHook = null; const { data } = await db.from('collaborators').insert({ merchant_system_id: mid.B, collaborators_code: `COL-RACE-${tag}-a`, collaborators_name: 'Competing', collaborators_phone: '0900000001', collaborators_email: email, collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: '2020-01-01T00:00:00Z' }).select('id').single(); competing = data!.id; };
    const ra = await api(token.mA, 'POST', '/merchants/members', a); assert.equal(ra.status, 409, ra.text); assert.equal(ra.json.code, 'MEMBER_EMAIL_UNAVAILABLE');
    const rowsA = await rowsByEmail(a.collaborators_email); assert.equal(rowsA.length, 1); assert.equal(rowsA[0].id, competing); assert.equal(rowsA[0].merchant_system_id, mid.B);
    assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', competing).eq('action', 'collaborator.member_application_created')).count, 0, 'the loser writes no audit entry');
    assert.equal(await anyAuditCount(competing), 0, 'nothing is ever written for another Merchant\'s application');
    // (b) a competing INSTANCE creates the SAME submission by the SAME Merchant between our pre-check and our insert (it runs the real function: row + audit event in one
    //     transaction): our call reports EMAIL_HELD, finds the winner's row WITH its audit event and returns it as a replay; we write nothing
    const b = member('race-b'); let same = '';
    beforeInsertHook = async (email) => { beforeInsertHook = null; const r = await db.rpc('create_merchant_member_application', { p_actor_user_id: uid.mA, p_merchant_id: mid.A, p_code: memberCode(), p_name: b.collaborators_name, p_phone: b.collaborators_phone, p_email: email });
      same = r.data?.member?.id; };
    const rb = await api(token.mA, 'POST', '/merchants/members', b); assert.equal(rb.status, 201, rb.text); assert.equal(rb.json.idempotent_replay, true); assert.ok(same && rb.json.id === same);
    assert.equal((await rowsByEmail(b.collaborators_email)).length, 1); assert.equal(await auditCount(CREATED, same), 1, 'exactly the competing instance\'s creation event'); assert.equal(await anyAuditCount(same), 1);
    // (c) the competing row is the SAME submission but was left WITHOUT an audit event (the previous API\'s partial write): the loser must not turn it into a success
    const c = member('race-c'); let partial = '';
    beforeInsertHook = async (email) => { beforeInsertHook = null; const { data } = await db.from('collaborators').insert({ merchant_system_id: mid.A, collaborators_code: memberCode(), collaborators_name: c.collaborators_name, collaborators_phone: c.collaborators_phone, collaborators_email: email, collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: '2020-01-01T00:00:00Z' }).select('id').single(); partial = data!.id; seededIds.add(partial); };
    const rc = await api(token.mA, 'POST', '/merchants/members', c); assert.equal(rc.status, 500, rc.text); assert.equal(rc.json?.code, 'MEMBER_AUDIT_MISSING');
    assert.equal((await rowsByEmail(c.collaborators_email)).length, 1); assert.equal(await anyAuditCount(partial), 0, 'the loser writes no audit event');
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
  const REMOVED = 'collaborator.member_application_audit_reconciled';        // the action of the REMOVED reconciliation design: the API must never write it
  const plantedRemoved = new Set<string>();                                 // entities for which a control deliberately planted such an event (to prove it does not count)
  const psql = (sql: string) => execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  const FAULT = 'vno_test_fail_audit';
  const injectAuditFault = (action: string) => psql(`create or replace function public.${FAULT}() returns trigger language plpgsql as $f$ begin if new.action = '${action}' then raise exception 'injected audit failure (test only)' using errcode = 'XX000'; end if; return new; end $f$; drop trigger if exists ${FAULT} on public.audit_events; create trigger ${FAULT} before insert on public.audit_events for each row execute function public.${FAULT}();`);
  const clearAuditFault = () => psql(`drop trigger if exists ${FAULT} on public.audit_events; drop function if exists public.${FAULT}();`);
  // counts scoped to THIS run's Merchants (random per run): nothing else writing to the shared rehearsal database can disturb a control
  const MIDS = [mid.A, mid.B, mid.P];
  const scoped = async () => ({
    c: (await db.from('collaborators').select('id', { count: 'exact', head: true }).in('merchant_system_id', MIDS)).count ?? 0,
    a: (await db.from('audit_events').select('id', { count: 'exact', head: true }).in('details->>merchant_id', MIDS)).count ?? 0,
  });
  // the audit-capture of the service under test: a refused replay is flagged for manual investigation with ids only
  const flagged: string[] = []; (mainSvc as any).logger = { error: (m: unknown) => { flagged.push(String(m)); } };
  // an application as the PREVIOUS code could leave it after a failed audit write: pending, this Merchant's, with the code shape the Members API generates, and NO audit event.
  const seedPartialWrite = async (n: string, registered: string) => {
    const m = member(n);
    const { data, error } = await db.from('collaborators').insert({ merchant_system_id: mid.A, collaborators_code: memberCode(), collaborators_name: m.collaborators_name, collaborators_phone: m.collaborators_phone,
      collaborators_email: m.collaborators_email, collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: registered }).select('id').single();
    if (error) throw new Error(error.message); const id = data!.id as string; seededIds.add(id);
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
    assert.equal((await rowsByEmail(fi1.collaborators_email)).length, 1); assert.equal(await auditCount(CREATED, r.json.id), 1); assert.equal(await anyAuditCount(r.json.id), 1);
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
  await ok('FI-3 three API instances racing on ONE e-mail (15 parallel calls, separate in-process locks): exactly one application, one creation audit event, fourteen replays, no error', async () => {
    const x = makeMerchants({}); const y = makeMerchants({}); const z = makeMerchants({}); const dto = dtoOf(member('xinst')); const before = await scoped();
    const rs = await Promise.all(Array.from({ length: 15 }, (_, i) => [x, y, z][i % 3].createMember(uid.mA, dto)));
    assert.equal(rs.filter((r) => r.idempotent_replay === false).length, 1); assert.equal(new Set(rs.map((r) => r.id)).size, 1);
    assert.equal((await rowsByEmail(dto.collaborators_email)).length, 1); assert.equal(await auditCount(CREATED, rs[0].id), 1); assert.equal(await anyAuditCount(rs[0].id), 1);
    assert.deepEqual(await scoped(), { c: before.c + 1, a: before.a + 1 }, 'exactly one row and one audit event were added');
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
  await ok('FI-5 replay of an application that has NO creation audit event (the partial write the previous API could leave): fail closed 500 MEMBER_AUDIT_MISSING, flagged in the log, NOTHING written - however old or young the row is', async () => {
    for (const [n, registered] of [['gap-old', '2020-02-02T00:00:00Z'], ['gap-young', new Date().toISOString()]] as const) {
      const { body, id } = await seedPartialWrite(n, registered); const before = await scoped(); const rowBefore = (await db.from('collaborators').select('*').eq('id', id).single()).data;
      flagged.length = 0;
      for (let i = 0; i < 3; i += 1) {
        const r = await api(token.mA, 'POST', '/merchants/members', body);
        assert.equal(r.status, 500, r.text); assert.equal(r.json?.code, 'MEMBER_AUDIT_MISSING'); assert.match(r.json.message, VIETNAMESE); assert.deepEqual(Object.keys(r.json).sort(), ['code', 'message']);
        assert.ok(!r.text.includes(id) && !r.text.includes(body.collaborators_email) && !/audit_events|injected|reconcil/i.test(r.text), 'no internal detail or personal data may reach the caller');
      }
      assert.equal(await anyAuditCount(id), 0, 'the API must not write ANY audit event for an application it did not create'); assert.equal(await auditCount(REMOVED, id), 0);
      assert.deepEqual(await scoped(), before, 'no row and no audit event added'); assert.deepEqual((await db.from('collaborators').select('*').eq('id', id).single()).data, rowBefore, 'the application is untouched');
      assert.equal(flagged.length, 3, 'every refused replay is flagged for manual investigation');
      for (const line of flagged) { assert.ok(line.includes('MEMBER_AUDIT_MISSING') && line.includes(id) && line.includes(mid.A) && line.includes(uid.mA)); assert.ok(!line.includes(body.collaborators_email) && !line.includes(body.collaborators_phone) && !line.includes(body.collaborators_name), 'ids only: no personal data in the log'); }
    }
  });
  await ok('FI-5b a pending row created by ANOTHER path (Admin create: code COL-<16 hex>, its own "collaborator.created" audit event) is not proof of a Members creation: an identical submission fails closed and NOTHING is written', async () => {
    const m = member('adminmade'); adminMadeId = randomUUID(); seededIds.add(adminMadeId);
    await must(db.from('collaborators').insert({ id: adminMadeId, merchant_system_id: mid.A, collaborators_code: `COL-${randomBytes(8).toString('hex').toUpperCase()}`, collaborators_name: m.collaborators_name, collaborators_phone: m.collaborators_phone,
      collaborators_email: m.collaborators_email, collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: '2020-01-01T00:00:00Z' }));
    await must(db.from('audit_events').insert({ actor_auth_user_id: uid.admin, actor_role: 'admin', action: 'collaborator.created', entity_type: 'collaborator', entity_id: adminMadeId, source: 'v2-admin-api', details: { merchant_id: mid.A } }));
    const before = await scoped();
    const r = await api(token.mA, 'POST', '/merchants/members', m); assert.equal(r.status, 500, r.text); assert.equal(r.json?.code, 'MEMBER_AUDIT_MISSING');
    assert.equal(await auditCount(CREATED, adminMadeId), 0); assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', adminMadeId)).count, 1, 'only the Admin\'s own event exists');
    assert.deepEqual(await scoped(), before);
  });
  await ok('FI-5c EXTERNAL records that merely LOOK like Members applications (API-shaped code COL+7 hex, pending, same Merchant, same details) never earn a success: no event / a different action / another Merchant / another application / a non-merchant actor / the removed reconciliation action -> all fail closed, nothing written', async () => {
    const ev = (action: string, entity: string, details: Record<string, unknown>, role = 'merchant') => ({ actor_auth_user_id: uid.mA, actor_role: role, action, entity_type: 'collaborator', entity_id: entity, source: 'v2-admin-api', details });
    const variants: Array<[string, (id: string) => any[]]> = [
      ['no event at all', () => []],
      ['an Admin "collaborator.created" event', (id) => [ev('collaborator.created', id, { merchant_id: mid.A }, 'admin')]],
      ['a creation event naming ANOTHER Merchant', (id) => [ev(CREATED, id, { merchant_id: mid.B, auth_invitation_required: true })]],
      ['a creation event written by an Admin actor', (id) => [ev(CREATED, id, { merchant_id: mid.A }, 'admin')]],
      ['a creation event without a Merchant in its details', (id) => [ev(CREATED, id, {})]],
      ['an event of the removed reconciliation design', (id) => [ev(REMOVED, id, { merchant_id: mid.A, reason: 'creation_audit_missing' })]],
    ];
    for (const [i, [label, mk]] of variants.entries()) {
      const { body, id } = await seedPartialWrite(`ext-v${i}`, '2020-04-04T00:00:00Z');
      const events = mk(id); if (events.length) await must(db.from('audit_events').insert(events)); if (events.some((e) => e.action === REMOVED)) plantedRemoved.add(id);
      const before = await scoped(); const mine = await anyAuditCount(id);
      const r = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(r.status, 500, `${label}: ${r.text}`); assert.equal(r.json?.code, 'MEMBER_AUDIT_MISSING', label);
      assert.equal(await anyAuditCount(id), mine, `${label}: no event may be added for it`); assert.deepEqual(await scoped(), before, label);
      assert.equal((await rowsByEmail(body.collaborators_email)).length, 1, label);
    }
    // another application's valid creation event never counts for this one: Q has its own valid event, P (same Merchant, API-shaped code) has none
    const P = await seedPartialWrite('ext-p', '2020-05-05T00:00:00Z'); const Q = await seedPartialWrite('ext-q', '2020-05-05T00:00:00Z');
    await must(db.from('audit_events').insert(ev(CREATED, Q.id, { merchant_id: mid.A, auth_invitation_required: true })));
    const rp = await api(token.mA, 'POST', '/merchants/members', P.body); assert.equal(rp.status, 500, rp.text); assert.equal(rp.json?.code, 'MEMBER_AUDIT_MISSING'); assert.equal(await anyAuditCount(P.id), 0);
    const rq = await api(token.mA, 'POST', '/merchants/members', Q.body); assert.equal(rq.status, 201, rq.text); assert.equal(rq.json.idempotent_replay, true); assert.equal(rq.json.id, Q.id); assert.equal(await anyAuditCount(Q.id), 1);
  });
  await ok('FI-6 an attempted LATE audit write: the API and the create function both refuse to back-fill; only the creator\'s own late write (the previous API auditing after its insert) makes the NEXT replay succeed, and the API adds no event of its own', async () => {
    const { body, id } = await seedPartialWrite('late', new Date().toISOString());
    // (a) replays are refused while no matching event exists, and write nothing
    for (let i = 0; i < 2; i += 1) { const r = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(r.status, 500, r.text); assert.equal(r.json?.code, 'MEMBER_AUDIT_MISSING'); }
    assert.equal(await anyAuditCount(id), 0);
    // (b) the create function cannot be used to back-fill either: for a held e-mail it answers EMAIL_HELD and writes nothing
    const direct = await db.rpc('create_merchant_member_application', { p_actor_user_id: uid.mA, p_merchant_id: mid.A, p_code: memberCode(), p_name: body.collaborators_name, p_phone: body.collaborators_phone, p_email: body.collaborators_email });
    assert.equal(direct.error, null); assert.deepEqual(direct.data, { outcome: 'EMAIL_HELD' }); assert.equal(await anyAuditCount(id), 0); assert.equal((await rowsByEmail(body.collaborators_email)).length, 1);
    // (c) the creator's own late write arrives (simulated): from then on the replay is a plain success...
    await must(db.from('audit_events').insert({ actor_auth_user_id: uid.mA, actor_role: 'merchant', action: CREATED, entity_type: 'collaborator', entity_id: id, source: 'v2-admin-api', details: { merchant_id: mid.A, auth_invitation_required: true } }));
    const before = await scoped();
    for (let i = 0; i < 3; i += 1) { const r = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(r.status, 201, r.text); assert.equal(r.json.idempotent_replay, true); assert.equal(r.json.id, id); }
    // ... and the API still added nothing: exactly the one event the creator wrote
    assert.equal(await anyAuditCount(id), 1); assert.equal(await auditCount(CREATED, id), 1); assert.deepEqual(await scoped(), before);
  });
  await ok('FI-8 replay of an application that HAS its creation audit event: success, and the API writes no audit event at all (counts identical before and after, three replays)', async () => {
    const before = await scoped(); assert.equal(await auditCount(CREATED, A1id), 1); assert.equal(await anyAuditCount(A1id), 1);
    for (let i = 0; i < 3; i += 1) { const r = await api(token.mA, 'POST', '/merchants/members', A1); assert.equal(r.status, 201, r.text); assert.equal(r.json.idempotent_replay, true); assert.equal(r.json.id, A1id); }
    assert.equal(await auditCount(CREATED, A1id), 1); assert.equal(await anyAuditCount(A1id), 1); assert.deepEqual(await scoped(), before);
  });
  await ok('FI-9 the database function enforces its own guards: wrong actor / Merchant / state -> NOT_ALLOWED, blank arguments -> error 22023; nothing is written', async () => {
    const e = `guard-${tag}@rehearsal.invalid`; const args = (actor: string, merchant: string) => ({ p_actor_user_id: actor, p_merchant_id: merchant, p_code: 'COLGUARD1', p_name: 'Guard Test', p_phone: '0911222333', p_email: e });
    const before = await scoped();
    for (const [label, a, m] of [['inactive profile', uid.mInactive, mid.B], ['Merchant not active/verified', uid.mPending, mid.P], ['profile bound to another Merchant', uid.mA, mid.B], ['Partner', uid.partnerH, mid.A], ['Admin', uid.admin, mid.A]] as const) {
      const r = await db.rpc('create_merchant_member_application', args(a, m)); assert.equal(r.error, null, label); assert.deepEqual(r.data, { outcome: 'NOT_ALLOWED' }, label);
    }
    // each half of "the Merchant must be active AND verified" is enforced on its own (a Merchant that is active but not verified, and one verified but not active)
    for (const [i, label, verified, status] of [[1, 'active but NOT verified', false, 'active'], [2, 'verified but NOT active', true, 'inactive']] as const) {
      const m = randomUUID(); const u = randomUUID();
      execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `insert into auth.users (id,email,instance_id,aud,role) values ('${u}','half${i}-${tag}@rehearsal.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated')`]);
      await must(db.from('merchant_details').insert({ merchant_system_id: m, merchant_code: `MH${i}-${tag}`, merchant_name: `Merchant half ${i} ${tag}`, merchant_verified: verified, merchants_status: status, ...baseMerchant }));
      await must(db.from('user_profiles').insert({ user_id: u, email: `half${i}-${tag}@rehearsal.invalid`, role: 'merchant', merchant_id: m, user_profiles_status: 'active' }));
      const r = await db.rpc('create_merchant_member_application', args(u, m)); assert.equal(r.error, null, label); assert.deepEqual(r.data, { outcome: 'NOT_ALLOWED' }, `Merchant ${label}`);
    }
    for (const blank of ['  ', '\t \n', '']) { const bad = await db.rpc('create_merchant_member_application', { ...args(uid.mA, mid.A), p_name: blank }); assert.equal(bad.error?.code, '22023', JSON.stringify(blank)); }
    // the function normalises the e-mail itself (trim + lower-case): a direct call cannot dodge the duplicate check with case or padding
    const held = await db.rpc('create_merchant_member_application', { ...args(uid.mA, mid.A), p_code: 'COLGUARD2', p_email: `  ${A1email.toUpperCase()}\t` });
    assert.equal(held.error, null); assert.deepEqual(held.data, { outcome: 'EMAIL_HELD' });
    assert.deepEqual(await scoped(), before); assert.equal((await rowsByEmail(e)).length, 0);
  });
  await ok('FI-10 anon and authenticated database roles cannot call the function (nothing is written) and its ACL is service_role-only, SECURITY INVOKER, search_path pinned', async () => {
    const jwtFor = (role: string) => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ role, iss: 'rehearsal', exp: Math.floor(Date.now() / 1000) + 3600 });
      return `${h}.${p}.${createHmac('sha256', 'rehearsal-jwt-secret-0123456789-abcdefghij').update(`${h}.${p}`).digest('base64url')}`; };
    const before = await scoped(); const e = `priv-${tag}@rehearsal.invalid`;
    for (const role of ['anon', 'authenticated']) {
      const r = await fetch(`${REST}/rpc/create_merchant_member_application`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwtFor(role)}` },
        body: JSON.stringify({ p_actor_user_id: uid.mA, p_merchant_id: mid.A, p_code: 'COLPRIV01', p_name: 'Priv Test', p_phone: '0911222333', p_email: e }) });
      const j: any = await r.json().catch(() => ({}));
      // 42501 = "permission denied for function": a wrong JWT secret would be 401 PGRST301 and must NOT satisfy this control
      assert.ok([401, 403].includes(r.status) && j.code === '42501', `${role}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
    }
    assert.deepEqual(await scoped(), before); assert.equal((await rowsByEmail(e)).length, 0);
    // ... and the ACL itself: EXECUTE for service_role only (never PUBLIC, anon or authenticated)
    const sig = 'public.create_merchant_member_application(uuid,uuid,text,text,text,text,text,text)';
    const acl = execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-At', '-c', `select coalesce(proacl::text, 'NULL') || '|' || prosecdef::text || '|' || coalesce(proconfig::text, '') from pg_proc where oid = '${sig}'::regprocedure`]).toString().trim();
    const [grants, secdef, config] = acl.split('|');
    assert.notEqual(grants, 'NULL', `${sig}: a NULL ACL would grant EXECUTE to PUBLIC`);
    assert.ok(!/(^|[{,])=X\//.test(grants), `${sig}: PUBLIC must not execute (${grants})`);
    assert.ok(!/(^|[{,])(anon|authenticated)=X\//.test(grants), `${sig}: anon / authenticated must not execute (${grants})`);
    assert.ok(/service_role=X\//.test(grants), `${sig}: service_role must execute (${grants})`);
    assert.equal(secdef, 'false', `${sig}: SECURITY INVOKER`); assert.match(config, /search_path=pg_catalog, public/, `${sig}: search_path pinned`);
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
  await ok('FI-15 the function exists but is NOT executable (EXECUTE revoked from service_role, e.g. a mis-applied grant): create fails closed (500 MEMBER_CREATE_FAILED, generic text, nothing written); replay of an audited application still works (it only reads)', async () => {
    const SIG = 'public.create_merchant_member_application(uuid,uuid,text,text,text,text,text,text)'; const body = member('fi15'); const before = await scoped();
    psql(`revoke execute on function ${SIG} from service_role`);
    try {
      const r = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(r.status, 500, r.text); assert.equal(r.json?.code, 'MEMBER_CREATE_FAILED'); assert.match(r.json.message, VIETNAMESE);
      assert.doesNotMatch(r.text, /permission|42501|function|public\./i, 'no internal detail may reach the caller');
      assert.equal((await rowsByEmail(body.collaborators_email)).length, 0); assert.deepEqual(await scoped(), before, 'fail closed: nothing written');
      const rep = await api(token.mA, 'POST', '/merchants/members', A1); assert.equal(rep.status, 201, rep.text); assert.equal(rep.json.idempotent_replay, true);
    } finally { psql(`grant execute on function ${SIG} to service_role`); }
    const again = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(again.status, 201, again.text); assert.equal(again.json.idempotent_replay, false); assert.equal(await auditCount(CREATED, again.json.id), 1);
  });
  await ok('FI-16 the audit lookup itself FAILS (SELECT revoked on audit_events): a replay never "assumes" success - it fails closed with a generic 500 MEMBER_LOOKUP_FAILED, nothing written; after recovery the same replay succeeds', async () => {
    const before = await scoped(); psql('revoke select on public.audit_events from service_role');
    try {
      const r = await api(token.mA, 'POST', '/merchants/members', A1); assert.equal(r.status, 500, r.text); assert.equal(r.json?.code, 'MEMBER_LOOKUP_FAILED'); assert.match(r.json.message, VIETNAMESE);
      assert.doesNotMatch(r.text, /permission|42501|audit_events|public\./i, 'no internal detail may reach the caller');
      assert.notEqual(r.json?.idempotent_replay, true);
    } finally { psql('grant select on public.audit_events to service_role'); }
    assert.deepEqual(await scoped(), before);
    const again = await api(token.mA, 'POST', '/merchants/members', A1); assert.equal(again.status, 201, again.text); assert.equal(again.json.idempotent_replay, true);
  });
  await ok('FI-12 rollback drill: the REAL rollback script drops the function and touches no data; the API then FAILS CLOSED to create (500, nothing written) while replays of audited applications still work; re-applying the migration restores everything', async () => {
    const migration = readFileSync(path.join(__dirname, '../../supabase/migrations/20261111000001_vno_merchant_member_atomic_create.sql'), 'utf8');
    const rollback = readFileSync(path.join(__dirname, '../../migration/v2/rollback/20261111000001_vno_merchant_member_atomic_create_rollback.sql'), 'utf8');
    const run = (sql: string) => execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
    const fnCount = () => Number(execFileSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-h', '127.0.0.1', '-At', '-c', "select count(*) from pg_proc where proname in ('create_merchant_member_application','reconcile_merchant_member_audit')"]).toString().trim());
    // PostgREST reloads its schema cache asynchronously after NOTIFY. A call fails as soon as the DATABASE lacks the function, even while PostgREST's cache is stale,
    // so "an error" is not enough: wait for PGRST202 (not in the cache) after the drop, and for 5 consecutive successes after re-apply.
    const probe = () => db.rpc('create_merchant_member_application', { p_actor_user_id: uid.partnerH, p_merchant_id: mid.A, p_code: 'COLPROBE01', p_name: 'Probe', p_phone: '0911222333', p_email: `probe-${tag}@rehearsal.invalid` });   // a Partner: NOT_ALLOWED, writes nothing
    const waitFor = async (present: boolean) => {
      let streak = 0;
      for (let i = 0; i < 150; i += 1) {
        const r = await probe(); const good = present ? !r.error : r.error?.code === 'PGRST202';
        streak = good ? streak + 1 : 0; if (streak >= 5) return; await new Promise((res) => setTimeout(res, 100));
      }
      throw new Error(`PostgREST schema cache did not settle (wanted the function ${present ? 'present' : 'absent'})`);
    };
    const snap = scoped;
    const before = await snap(); const body = member('fi12'); const audited = await api(token.mA, 'POST', '/merchants/members', member('fi12-audited')); assert.equal(audited.status, 201);
    assert.equal(fnCount(), 1, 'exactly one function before the rollback');
    const before2 = await snap();
    try {
      run(rollback); assert.equal(fnCount(), 0, 'the function must be gone'); await waitFor(false);
      assert.deepEqual(await snap(), before2, 'the rollback must not touch a single row');
      const create = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(create.status, 500, create.text); assert.equal(create.json?.code, 'MEMBER_CREATE_FAILED'); assert.match(create.json.message, VIETNAMESE);
      assert.doesNotMatch(create.text, /PGRST|function|schema cache|public\./i, 'no internal detail may reach the caller');
      const replay = await api(token.mA, 'POST', '/merchants/members', member('fi12-audited')); assert.equal(replay.status, 201, replay.text); assert.equal(replay.json.idempotent_replay, true, 'a replay only reads: it does not need the function');
      assert.equal((await rowsByEmail(body.collaborators_email)).length, 0); assert.deepEqual(await snap(), before2, 'fail closed means nothing is written');
      assert.equal((await api(token.mA, 'GET', '/merchants/members')).status, 200, 'listing does not depend on the function');
    } finally { run(migration); await waitFor(true); }
    assert.equal(fnCount(), 1); const again = await api(token.mA, 'POST', '/merchants/members', body); assert.equal(again.status, 201, again.text); assert.equal(again.json.idempotent_replay, false);
    assert.equal(await auditCount(CREATED, again.json.id), 1); assert.ok((await snap()).c > before.c);
    // applying the migration TWICE is harmless (create or replace + idempotent grants): still one function, same ACL, API unaffected
    run(migration); await waitFor(true); assert.equal(fnCount(), 1);
    const third = await api(token.mA, 'POST', '/merchants/members', member('fi12-third')); assert.equal(third.status, 201, third.text); assert.equal(await auditCount(CREATED, third.json.id), 1);
  });
  await ok('FI-11 invariants after everything above: each API-created application has exactly ONE creation event; the removed reconciliation action never appears; no event points at a missing application; the API never wrote an event for a hand-made row', async () => {
    const { data: rows } = await db.from('collaborators').select('id,collaborators_code').like('collaborators_email', `%${tag}@rehearsal.invalid`);
    const apiRows = (rows ?? []).filter((r: any) => /^COL[0-9A-F]{7}$/.test(r.collaborators_code) && !seededIds.has(r.id)); assert.ok(apiRows.length >= 10, `expected many API-created rows, got ${apiRows.length}`);
    for (const r of apiRows) { assert.equal(await auditCount(CREATED, r.id), 1, `creation events for ${r.collaborators_code}`); assert.equal(await anyAuditCount(r.id), 1, `any events for ${r.collaborators_code}`); }
    const runIds = (rows ?? []).map((r: any) => r.id);
    const { data: removed } = await db.from('audit_events').select('entity_id').eq('action', REMOVED).in('entity_id', runIds);
    for (const x of removed ?? []) assert.ok(plantedRemoved.has(x.entity_id), `the removed reconciliation action was written for ${x.entity_id}: only the events this test planted may exist`);
    for (const r of apiRows) assert.ok(!plantedRemoved.has(r.id));
    const { data: events } = await db.from('audit_events').select('entity_id,action').eq('action', CREATED).in('details->>merchant_id', MIDS);
    const ids = [...new Set((events ?? []).map((x: any) => x.entity_id))]; const { data: existing } = await db.from('collaborators').select('id').in('id', ids);
    assert.equal((existing ?? []).length, ids.length, 'no audit event may reference an application that does not exist');
    for (const id of ids) assert.ok((await auditCount(CREATED, id)) <= 1, `entity ${id}: more than one creation event`);
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
