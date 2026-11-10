// Integration test for the MEMBERS routes after the security change: a REAL Nest app (real JwtGuard / AdminGuard / controllers / pipes) over the REAL MerchantsService
// and CollaboratorsService -> the REAL supabase-js client -> PostgREST v14.5 -> the REAL migrated Postgres.
// Only two things are stood in for, because the disposable rehearsal database has no Supabase Auth:
//   - GET /auth/v1/user (what JwtGuard calls to turn a bearer token into a user)  -> a loopback fake that maps test tokens to the seeded users
//   - UserProfilesService.assertIdentityAvailable (calls auth.admin.listUsers)       -> checks user_profiles in the real database + an in-memory "auth-only" set
//
// Proves: the retired Partner route (410 for every authenticated role, 401 anonymous, nothing written) · Merchant create (normalised row, minimal answer, audit without
// personal data) · idempotent replay · duplicate-e-mail answers that do not enumerate · LIKE-wildcard safety · validation over HTTP · concurrency · cross-instance
// convergence · rate limits (429) · the pending cap (409) · authorization matrix · isolation between Merchants · masked contact details and no bank data anywhere.
//
// Needs the rehearsal database (migration/v2/rehearsal/start-rehearsal-stack.sh). It talks to the hosted environment NEVER and refuses any non-loopback target.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

let controls = 0;
const ok = async (label: string, fn: () => Promise<void>) => { try { await fn(); controls += 1; } catch (e) { console.error(`FAIL: ${label}`); throw e; } };
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
  await ok('another API instance inserting the same e-mail between our check and our insert: the earliest row wins and we remove only OUR row (other Merchant -> 409; same data -> replay)', async () => {
    // (a) the competing row belongs to ANOTHER Merchant and is older: we must end with 409 and the competing row intact
    const a = member('race-a'); let competing = '';
    beforeInsertHook = async (email) => { beforeInsertHook = null; const { data } = await db.from('collaborators').insert({ merchant_system_id: mid.B, collaborators_code: `COL-RACE-${tag}-a`, collaborators_name: 'Competing', collaborators_phone: '0900000001', collaborators_email: email, collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: '2020-01-01T00:00:00Z' }).select('id').single(); competing = data!.id; };
    const ra = await api(token.mA, 'POST', '/merchants/members', a); assert.equal(ra.status, 409, ra.text); assert.equal(ra.json.code, 'MEMBER_EMAIL_UNAVAILABLE');
    const rowsA = await rowsByEmail(a.collaborators_email); assert.equal(rowsA.length, 1); assert.equal(rowsA[0].id, competing); assert.equal(rowsA[0].merchant_system_id, mid.B);
    assert.equal((await db.from('audit_events').select('id', { count: 'exact', head: true }).eq('entity_id', competing).eq('action', 'collaborator.member_application_created')).count, 0, 'the loser writes no audit entry');
    // (b) the competing row is the SAME submission by the SAME Merchant and older: we return it as a replay
    const b = member('race-b'); let same = '';
    beforeInsertHook = async (email) => { beforeInsertHook = null; const { data } = await db.from('collaborators').insert({ merchant_system_id: mid.A, collaborators_code: `COL-RACE-${tag}-b`, collaborators_name: b.collaborators_name, collaborators_phone: b.collaborators_phone, collaborators_email: email, collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: '2020-01-01T00:00:00Z' }).select('id').single(); same = data!.id; };
    const rb = await api(token.mA, 'POST', '/merchants/members', b); assert.equal(rb.status, 201, rb.text); assert.equal(rb.json.idempotent_replay, true); assert.equal(rb.json.id, same);
    assert.equal((await rowsByEmail(b.collaborators_email)).length, 1);
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

  // ======================================================= 8. retired route did not disturb the Merchant route; final integrity =====================================
  await ok('final integrity: no Partner was approved, activated, linked or assigned by any member creation; every created row is a pending, unverified application with no login', async () => {
    const { data } = await db.from('collaborators').select('id,collaborators_status,collaborators_verified,collaborators_password').like('collaborators_email', `%-${tag}@rehearsal.invalid`).eq('collaborators_verified', false);
    assert.ok((data ?? []).length >= 6); for (const r of data!) { assert.equal(r.collaborators_status, 'pending'); assert.equal(r.collaborators_password, null); }
    const created = (data ?? []).map((r: any) => r.id);
    const { data: profiles } = await db.from('user_profiles').select('id').in('collaborator_id', created); assert.equal((profiles ?? []).length, 0, 'no sign-in was created or linked for any member application');
    assert.deepEqual((await db.from('collaborators').select('merchant_system_id').eq('id', colId.U).single()).data, { merchant_system_id: null }, 'an unassigned Partner stays unassigned');
  });

  await app.close(); proxy.close();
  console.log(`merchant-members integration (real Nest app -> supabase-js -> PostgREST -> Postgres): ${controls} controls PASS`);
  process.exit(0);
})().catch((e) => { console.error(e); proxy.close(); process.exit(1); });
