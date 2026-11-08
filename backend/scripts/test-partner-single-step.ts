// Single-step Partner flow, end to end against an in-memory Supabase fake (no network, no mail, no real data):
//   register once -> Admin Pending -> approve -> activation e-mail -> redeem the link once.
// Covers: atomic create + rollback, existing-email states, orphan identities, races, honeypot, rate limits, approval ownership + idempotency,
// e-mail outcomes + retry, token validity (tamper / expiry / superseded / single use / not-approved) and that no raw token is ever logged.
import assert from 'node:assert/strict';
import { PartnerRegistrationService } from '../src/modules/partner-registration/partner-registration.service';
import { PartnerRegistrationSchema } from '../src/modules/partner-registration/partner-registration.dto';
import { ActivationService } from '../src/modules/activation/activation.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { CollaboratorsService } from '../src/modules/collaborators/collaborators.service';
import { activationSecret, signActivationToken, verifyActivationToken } from '../src/modules/activation/activation-token';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-service-key';
process.env.FRONTEND_URL = 'https://web.example.test';
process.env.PARTNER_REGISTRATION_HOURLY_CAP = '1000';

// ---- in-memory Supabase ------------------------------------------------------------------------------------------------------------------------
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
class Fake {
  tables: Record<string, any[]> = { user_profiles: [], collaborators: [], audit_events: [], merchant_details: [], invitations: [] };
  users = new Map<string, any>();
  passwordResets: string[] = [];
  failProfileInsert = false;
  deletedUsers: string[] = [];

  from(table: string) {
    const db = this; const rows = () => db.tables[table];
    const filters: Array<(r: any) => boolean> = []; let mode: 'select' | 'update' | 'delete' | 'insert' = 'select'; let patch: any; let ins: any[]; let limit = Infinity;
    let head = false; let wantCount = false; let order: { col: string; asc: boolean } | null = null;
    const run = () => {
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (mode === 'insert') {
        const out: any[] = [];
        for (const r of ins) {
          if (table === 'user_profiles' && db.failProfileInsert) return { data: null, error: { code: 'XX000', message: 'forced failure' } };
          if (table === 'user_profiles' && rows().some((x) => (x.email || '').toLowerCase() === (r.email || '').toLowerCase())) return { data: null, error: { code: '23505', message: 'duplicate email' } };
          const row = { id: uuid(), created_at: new Date().toISOString(), ...(table === 'audit_events' ? { occurred_at: new Date().toISOString() } : {}), ...r };
          rows().push(row); out.push(row);
        }
        return { data: out, error: null };
      }
      if (mode === 'update') { hit.forEach((r) => Object.assign(r, patch)); return { data: hit, error: null }; }
      if (mode === 'delete') { db.tables[table] = rows().filter((r) => !hit.includes(r)); return { data: hit, error: null }; }
      let out = [...hit];
      if (order) out.sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
      out = out.slice(0, limit);
      return { data: head ? null : out, error: null, count: wantCount ? hit.length : undefined };
    };
    const q: any = {
      select: (_c?: string, o?: any) => { if (mode === 'select') { head = Boolean(o?.head); wantCount = o?.count === 'exact'; } return q; },
      insert: (r: any) => { mode = 'insert'; ins = Array.isArray(r) ? r : [r]; return q; },
      update: (p: any) => { mode = 'update'; patch = p; return q; },
      delete: () => { mode = 'delete'; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      ilike: (c: string, v: string) => { const plain = v.replace(/\\([\\%_])/g, '$1'); filters.push((r) => String(r[c] ?? '').toLowerCase() === plain.toLowerCase()); return q; },
      in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return q; },
      or: (expr: string) => { if (expr === 'login_count.eq.0,login_count.is.null') filters.push((r) => !r.login_count); else throw new Error(`unsupported or(): ${expr}`); return q; },
      order: (col: string, o?: any) => { order = { col, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { limit = n; return q; },
      single: async () => { const r = run(); const row = (r.data || [])[0]; return row ? { data: row, error: null } : { data: null, error: r.error || { message: 'no rows', code: 'PGRST116' } }; },
      maybeSingle: async () => { const r = run(); return { data: (r.data || [])[0] ?? null, error: r.error }; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  }

  auth = {
    admin: {
      createUser: async (a: any) => {
        const email = String(a.email).toLowerCase();
        if ([...this.users.values()].some((u) => u.email === email)) return { data: { user: null }, error: { code: 'email_exists', message: 'exists' } };
        const user = { id: uuid(), email, email_confirmed_at: a.email_confirm ? new Date().toISOString() : null, user_metadata: a.user_metadata || {}, app_metadata: a.app_metadata || {}, hasPassword: Boolean(a.password) };
        this.users.set(user.id, user); return { data: { user }, error: null };
      },
      getUserById: async (id: string) => { const user = this.users.get(id); return { data: { user: user ?? null }, error: user ? null : { message: 'not found' } }; },
      updateUserById: async (id: string, a: any) => {
        const u = this.users.get(id); if (!u) return { data: null, error: { message: 'not found' } };
        if (a.password) { u.hasPassword = true; this.passwordResets.push(id); }
        if (a.app_metadata) u.app_metadata = a.app_metadata;
        return { data: { user: u }, error: null };
      },
      listUsers: async () => ({ data: { users: [...this.users.values()] }, error: null }),
      deleteUser: async (id: string) => { this.users.delete(id); this.deletedUsers.push(id); return { data: null, error: null }; },
    },
  };
}

// ---- harness -----------------------------------------------------------------------------------------------------------------------------------
type Sent = { to: string; activationUrl: string; partnerName: string; ttlHours: number };
function world() {
  const db = new Fake();
  const supabase: any = { getClient: () => db };
  const audit = new AuditService(supabase);
  const sent: Sent[] = [];
  const mailer = { suppression: null as string | null, failWith: null as string | null };
  const appEmail: any = {
    suppressionFor: async () => mailer.suppression,
    sendPartnerActivation: async (to: string, p: any) => {
      if (mailer.failWith) return { status: 'failed', reason: mailer.failWith };
      sent.push({ to, activationUrl: p.activationUrl, partnerName: p.partnerName, ttlHours: p.ttlHours }); return { status: 'sent' };
    },
  };
  const activation = new ActivationService(supabase, audit, appEmail);
  const registration = new PartnerRegistrationService(supabase, audit);
  const collaborators = new CollaboratorsService(supabase, { createOrUpdate: async (d: any) => {
    const p = db.tables.user_profiles.find((x) => x.email === d.email); if (p) p.user_profiles_status = d.status; return p;
  } } as any, audit, activation);
  /** A pre-existing Auth identity (e.g. from the old two-step signup): returns its id. */
  const auth = async (email: string, confirmedAt: string | null, meta: Record<string, unknown>, hasPassword: boolean) => {
    const id = uuid(); db.users.set(id, { id, email, email_confirmed_at: confirmedAt, user_metadata: meta, app_metadata: {}, hasPassword }); return id;
  };
  return { db, sent, mailer, activation, registration, collaborators, auth };
}
const dto = (email: string, extra: Record<string, unknown> = {}) => PartnerRegistrationSchema.parse({ full_name: 'Nguyen Van A', phone: '+84 912 345 678', email, ...extra });
const code = (e: any) => e?.getResponse?.().code; const http = (e: any) => e?.getStatus?.();
const token = (url: string) => decodeURIComponent(url.split('#token=')[1]);
const admin = { id: 'admin-1', role: 'admin' };
let controls = 0; const ok = (label: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(() => { controls += 1; }, (e) => { console.error(`FAIL: ${label}`); throw e; });

(async () => {
  // ---- registration ----------------------------------------------------------------------------------------------------------------------------
  await ok('R1 one call creates identity + pending Partner + linked pending profile; no password, no confirmation', async () => {
    const w = world(); const r: any = await w.registration.register(dto('New.Person@Example.test'), '1.1.1.1');
    assert.equal(r.outcome, 'created'); assert.equal(r.status, 'pending'); assert.match(r.reference, /^COL-[0-9A-F]{16}$/);
    assert.equal(w.db.users.size, 1); const u = [...w.db.users.values()][0];
    assert.equal(u.email, 'new.person@example.test'); assert.equal(u.email_confirmed_at, null); assert.equal(u.hasPassword, false); assert.equal(u.user_metadata.requested_role, 'collaborator');
    assert.equal(w.db.tables.collaborators.length, 1); const c = w.db.tables.collaborators[0];
    assert.deepEqual([c.collaborators_status, c.collaborators_verified, c.collaborators_phone, c.collaborators_name], ['pending', false, '+84912345678', 'Nguyen Van A']);
    assert.equal(w.db.tables.user_profiles.length, 1); const p = w.db.tables.user_profiles[0];
    assert.deepEqual([p.user_profiles_status, p.role, p.collaborator_id, p.user_id, p.login_count], ['pending', 'collaborator', c.id, u.id, 0]);
    assert.equal(w.db.tables.audit_events.filter((e) => e.action === 'collaborator.application_submitted').length, 1);
    assert.equal(w.sent.length, 0, 'registration itself sends no e-mail');
  });
  await ok('R2 the same address (any case) never creates a second identity, profile or Partner', async () => {
    const w = world(); await w.registration.register(dto('dup@example.test'), '1.1.1.1');
    const again: any = await w.registration.register(dto('DUP@Example.test'), '1.1.1.2');
    assert.deepEqual(again, { outcome: 'exists', state: 'pending' });
    assert.deepEqual([w.db.users.size, w.db.tables.collaborators.length, w.db.tables.user_profiles.length], [1, 1, 1]);
  });
  await ok('R3 existing states: active -> login, rejected/suspended/inactive -> support, record without account -> support', async () => {
    for (const [status, expected] of [['active', 'active'], ['blocked', 'support'], ['inactive', 'support'], ['pending', 'pending']] as const) {
      const w = world(); await w.registration.register(dto('s@example.test'), '1.1.1.1');
      w.db.tables.user_profiles[0].user_profiles_status = status;
      assert.deepEqual(await w.registration.register(dto('s@example.test'), '1.1.1.2'), { outcome: 'exists', state: expected }, status);
      assert.equal(w.db.users.size, 1, 'no identity was created for a known address');
    }
    const w = world(); w.db.tables.collaborators.push({ id: uuid(), collaborators_email: 'orphan-record@example.test', collaborators_status: 'pending' });
    assert.deepEqual(await w.registration.register(dto('orphan-record@example.test'), '8.8.8.8'), { outcome: 'exists', state: 'support' });
    assert.equal(w.db.users.size, 0);
  });
  await ok('R4 a failure after the identity was created rolls EVERYTHING back (no orphan Auth user, Partner or profile)', async () => {
    const w = world(); w.db.failProfileInsert = true;
    await assert.rejects(w.registration.register(dto('rollback@example.test'), '2.2.2.2'), (e: any) => code(e) === 'REGISTRATION_FAILED' && http(e) === 500);
    assert.deepEqual([w.db.users.size, w.db.tables.collaborators.length, w.db.tables.user_profiles.length], [0, 0, 0]);
    assert.equal(w.db.deletedUsers.length, 1);
    w.db.failProfileInsert = false;
    assert.equal(((await w.registration.register(dto('rollback@example.test'), '2.2.2.3')) as any).outcome, 'created', 'a clean retry works');
  });
  await ok('R5 two simultaneous submissions of one address produce exactly one application', async () => {
    const w = world();
    const results: any[] = await Promise.all([w.registration.register(dto('race@example.test'), '3.3.3.1'), w.registration.register(dto('race@example.test'), '3.3.3.2')]);
    assert.equal(results.filter((r) => r.outcome === 'created').length, 1, JSON.stringify(results));
    assert.deepEqual([w.db.users.size, w.db.tables.collaborators.length, w.db.tables.user_profiles.length], [1, 1, 1]);
  });
  await ok('R6 an unfinished two-step identity is ADOPTED (no second identity); an unconfirmed one loses its old password', async () => {
    const w = world();
    const a = (await w.auth('unconfirmed@example.test', null, { requested_role: 'collaborator' }, true));
    const b = (await w.auth('confirmed@example.test', new Date().toISOString(), { requested_role: 'collaborator' }, true));
    await w.registration.register(dto('unconfirmed@example.test'), '4.4.4.1');
    await w.registration.register(dto('confirmed@example.test'), '4.4.4.2');
    assert.deepEqual([w.db.users.size, w.db.tables.collaborators.length, w.db.tables.user_profiles.length], [2, 2, 2]);
    assert.deepEqual(w.db.passwordResets, [a], 'only the unconfirmed identity had its password invalidated');
    assert.ok(w.db.tables.user_profiles.some((p) => p.user_id === b && p.user_profiles_status === 'pending'));
  });
  await ok('R7 an identity that started as a Merchant is never adopted as a Partner', async () => {
    const w = world(); await w.auth('merchant-wanna-be@example.test', new Date().toISOString(), { requested_role: 'merchant' }, true);
    assert.deepEqual(await w.registration.register(dto('merchant-wanna-be@example.test'), '5.5.5.5'), { outcome: 'exists', state: 'support' });
    assert.deepEqual([w.db.tables.collaborators.length, w.db.tables.user_profiles.length], [0, 0]);
  });
  await ok('R8 honeypot: looks successful, creates and spends nothing', async () => {
    const w = world(); const r: any = await w.registration.register(dto('bot@example.test', { website: 'http://spam.test' }), '6.6.6.6');
    assert.equal(r.outcome, 'created'); assert.deepEqual([w.db.users.size, w.db.tables.collaborators.length, w.db.tables.user_profiles.length], [0, 0, 0]);
  });
  await ok('R9 rate limits: per address and per client, with a stable code', async () => {
    const w = world();
    for (let i = 0; i < 3; i += 1) await w.registration.register(dto('limit@example.test'), '7.7.7.7');
    await assert.rejects(w.registration.register(dto('limit@example.test'), '7.7.7.8'), (e: any) => code(e) === 'REGISTRATION_RATE_LIMITED' && http(e) === 429);
    const w2 = world();
    for (let i = 0; i < 10; i += 1) await w2.registration.register(dto(`ip${i}@example.test`), '7.7.7.9');
    await assert.rejects(w2.registration.register(dto('ip-extra@example.test'), '7.7.7.9'), (e: any) => http(e) === 429);
  });
  await ok('R10 input validation: strict keys, e-mail, phone, name', () => {
    const bad = (v: Record<string, unknown>) => assert.equal(PartnerRegistrationSchema.safeParse(v).success, false, JSON.stringify(v));
    bad({ full_name: 'A', phone: '0912345678', email: 'a@b.test' }); bad({ full_name: 'Ok Name', phone: '12', email: 'a@b.test' });
    bad({ full_name: 'Ok Name', phone: '0912345678', email: 'not-an-email' }); bad({ full_name: 'Ok Name', phone: '0912345678', email: 'a@b.test', password: 'x' });
    assert.equal(PartnerRegistrationSchema.safeParse({ full_name: 'Ok Name', phone: '0912.345.678', email: ' A@B.test ' }).success, true);
  });

  await ok('R11 lookups are case-insensitive and "_" / "%" are NOT wildcards', async () => {
    const w = world(); w.db.tables.user_profiles.push({ id: uuid(), user_id: uuid(), email: 'Mixed.Case@Example.test', role: 'collaborator', user_profiles_status: 'pending' });
    assert.deepEqual(await w.registration.register(dto('mixed.case@example.test'), '11.0.0.1'), { outcome: 'exists', state: 'pending' });
    w.db.tables.user_profiles.push({ id: uuid(), user_id: uuid(), email: 'a_b@example.test', role: 'collaborator', user_profiles_status: 'active' });
    assert.equal(((await w.registration.register(dto('axb@example.test'), '11.0.0.2')) as any).outcome, 'created', '"_" must not match another address');
    assert.equal(((await w.registration.register(dto('a_b@example.test'), '11.0.0.3')) as any).state, 'active');
  });
  await ok('R12 an address owned by a Merchant, or with a pending invitation, is never turned into a Partner identity', async () => {
    const w = world();
    w.db.tables.merchant_details.push({ merchant_system_id: uuid(), owner_email: 'Owner@Shop.test' });
    w.db.tables.invitations.push({ id: uuid(), owner_email: 'invited@shop.test', status: 'pending' });
    w.db.tables.invitations.push({ id: uuid(), owner_email: 'old-invite@shop.test', status: 'expired' });
    assert.deepEqual(await w.registration.register(dto('owner@shop.test'), '12.0.0.1'), { outcome: 'exists', state: 'support' });
    assert.deepEqual(await w.registration.register(dto('invited@shop.test'), '12.0.0.2'), { outcome: 'exists', state: 'support' });
    assert.equal(((await w.registration.register(dto('old-invite@shop.test'), '12.0.0.3')) as any).outcome, 'created', 'an expired invitation does not block');
    assert.equal(w.db.users.size, 1);
  });

  // ---- approval + activation e-mail ------------------------------------------------------------------------------------------------------------
  const approved = async (email = 'p@example.test') => {
    const w = world(); await w.registration.register(dto(email), '10.0.0.1');
    const id = w.db.tables.collaborators[0].id; const res: any = await w.collaborators.approve(admin, id);
    return { w, id, res };
  };
  await ok('A1 approval activates record + profile together, audits it once and e-mails ONE link', async () => {
    const { w, id, res } = await approved();
    assert.equal(res.collaborators_status, 'active'); assert.equal(res.collaborators_verified, true); assert.ok(res.collaborators_qr_code);
    assert.equal(w.db.tables.user_profiles[0].user_profiles_status, 'active');
    assert.equal(w.db.tables.audit_events.filter((e) => e.action === 'collaborator.approved').length, 1);
    assert.equal(res.activation_email.status, 'sent'); assert.equal(w.sent.length, 1);
    assert.match(w.sent[0].activationUrl, /^https:\/\/web\.example\.test\/auth\/activate#token=/, 'token is in the URL fragment, which no server or log ever sees');
    assert.equal(w.sent[0].ttlHours, 24);
    assert.equal(w.db.tables.audit_events.filter((e) => e.action === 'collaborator.activation_email_sent' && e.entity_id === id).length, 1);
  });
  await ok('A2 approving twice does not approve twice (no second audit event, no second e-mail)', async () => {
    const { w, id } = await approved(); const again: any = await w.collaborators.approve(admin, id);
    assert.equal(again.already_approved, true);
    assert.equal(w.db.tables.audit_events.filter((e) => e.action === 'collaborator.approved').length, 1); assert.equal(w.sent.length, 1);
  });
  await ok('A3 a suppressed recipient: approval still succeeds, the outcome is audited, the account is left untouched', async () => {
    const w = world(); w.mailer.suppression = 'not_allowlisted'; await w.registration.register(dto('s@example.test'), '10.0.0.2');
    const res: any = await w.collaborators.approve(admin, w.db.tables.collaborators[0].id);
    assert.equal(res.collaborators_status, 'active'); assert.deepEqual([res.activation_email.status, res.activation_email.reason], ['suppressed', 'not_allowlisted']);
    assert.equal([...w.db.users.values()][0].app_metadata.activation_nonce, undefined, 'no nonce is written for a message that is not sent');
    assert.equal(w.sent.length, 0);
  });
  await ok('A4 a failed e-mail is retryable without approving or creating anything again', async () => {
    const w = world(); w.mailer.failWith = 'connection_failed'; await w.registration.register(dto('f@example.test'), '10.0.0.3');
    const id = w.db.tables.collaborators[0].id; const res: any = await w.collaborators.approve(admin, id);
    assert.deepEqual([res.collaborators_status, res.activation_email.status, res.activation_email.reason], ['active', 'failed', 'connection_failed']);
    assert.ok(![...w.db.users.values()][0].app_metadata.activation_nonce, 'a failed send leaves no usable link behind (previous state restored)');
    const before = JSON.stringify([w.db.tables.collaborators, w.db.tables.user_profiles, [...w.db.users.keys()]]);
    w.mailer.failWith = null; const retry: any = await w.collaborators.resendActivation(admin, id);
    assert.equal(retry.status, 'sent'); assert.equal(retry.trigger, 'admin_resend'); assert.equal(w.sent.length, 1);
    assert.equal(JSON.stringify([w.db.tables.collaborators, w.db.tables.user_profiles, [...w.db.users.keys()]]), before, 'no record changed');
    assert.equal(w.db.tables.audit_events.filter((e) => e.action === 'collaborator.approved').length, 1, 'still approved exactly once');
    const st: any = await w.collaborators.activationStatus(id);
    assert.deepEqual([st.activated, st.last_attempt.status, st.attempts.length], [false, 'sent', 2]);
  });
  await ok('A5 approval verifies the applicant: unclaimed / mismatched / ambiguous records are refused before ANY write', async () => {
    const w = world(); const cid = uuid();
    w.db.tables.collaborators.push({ id: cid, collaborators_email: 'x@example.test', collaborators_status: 'pending', collaborators_verified: false, collaborators_code: 'COL-X' });
    await assert.rejects(w.collaborators.approve(admin, cid), (e: any) => code(e) === 'OWNER_NOT_CLAIMED' && http(e) === 409);
    const uid = (await w.auth('other@example.test', null, {}, false));
    w.db.tables.user_profiles.push({ id: uuid(), user_id: uid, email: 'other@example.test', role: 'collaborator', collaborator_id: cid, user_profiles_status: 'pending' });
    await assert.rejects(w.collaborators.approve(admin, cid), (e: any) => code(e) === 'OWNER_EMAIL_MISMATCH' && http(e) === 409);
    w.db.tables.user_profiles.push({ id: uuid(), user_id: uid, email: 'x@example.test', role: 'collaborator', collaborator_id: cid, user_profiles_status: 'pending' });
    await assert.rejects(w.collaborators.approve(admin, cid), (e: any) => code(e) === 'OWNER_AMBIGUOUS');
    assert.equal(w.db.tables.collaborators[0].collaborators_status, 'pending'); assert.equal(w.db.tables.audit_events.length, 0);
  });

  // ---- activation link -------------------------------------------------------------------------------------------------------------------------
  await ok('T1 the link is account-bound and SINGLE USE', async () => {
    const { w, id } = await approved(); const t = token(w.sent[0].activationUrl);
    const v = await w.activation.verify(t, '20.0.0.1');
    assert.equal(v.profile.collaborator_id, id); assert.equal(v.authUser.email, 'p@example.test');
    assert.equal(await w.activation.consume(v.profile.id), true); assert.equal(await w.activation.consume(v.profile.id), false, 'a second redemption loses');
    await assert.rejects(w.activation.verify(t, '20.0.0.1'), (e: any) => code(e) === 'ACTIVATION_LINK_USED');
    await w.activation.spendNonce(v.authUser);
    await assert.rejects(w.activation.verify(t, '20.0.0.1'), (e: any) => code(e) === 'ACTIVATION_LINK_INVALID');
  });
  await ok('T2 concurrent redemption: exactly one wins', async () => {
    const { w } = await approved(); const v = await w.activation.verify(token(w.sent[0].activationUrl), '20.0.0.2');
    const wins = await Promise.all([w.activation.consume(v.profile.id), w.activation.consume(v.profile.id), w.activation.consume(v.profile.id)]);
    assert.equal(wins.filter(Boolean).length, 1);
  });
  await ok('T3 tampered, truncated, expired, foreign-secret and wrong-account tokens are all refused', async () => {
    const { w, id } = await approved(); const t = token(w.sent[0].activationUrl);
    const invalid = (x: unknown) => assert.rejects(w.activation.verify(x, '20.0.0.3'), (e: any) => code(e) === 'ACTIVATION_LINK_INVALID' && http(e) === 401);
    await invalid(t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA')); await invalid(t.slice(0, 30)); await invalid(''); await invalid(undefined); await invalid({ token: t });
    const claims: any = (verifyActivationToken(t, activationSecret()) as any).claims;
    await invalid(signActivationToken({ ...claims, e: Date.now() - 1000 }, activationSecret()));
    await invalid(signActivationToken(claims, Buffer.from('some other secret that is long enough')));
    await invalid(signActivationToken({ ...claims, u: uuid() }, activationSecret()));
    await invalid(signActivationToken({ ...claims, c: uuid() }, activationSecret()));
    assert.ok((await w.activation.verify(t, '20.0.0.3')).profile.collaborator_id === id, 'the genuine token still works');
  });
  await ok('T4 a newer e-mail supersedes every older link', async () => {
    const { w, id } = await approved(); const first = token(w.sent[0].activationUrl);
    await w.collaborators.resendActivation(admin, id); const second = token(w.sent[1].activationUrl);
    assert.notEqual(first, second);
    await assert.rejects(w.activation.verify(first, '20.0.0.4'), (e: any) => code(e) === 'ACTIVATION_LINK_INVALID');
    assert.ok(await w.activation.verify(second, '20.0.0.4'));
  });
  await ok('T5 a link for an account that is not (or no longer) approved is refused', async () => {
    const { w, id } = await approved(); const t = token(w.sent[0].activationUrl);
    w.db.tables.user_profiles[0].user_profiles_status = 'pending';
    await assert.rejects(w.activation.verify(t, '20.0.0.5'), (e: any) => code(e) === 'ACTIVATION_NOT_APPROVED' && http(e) === 403);
    w.db.tables.user_profiles[0].user_profiles_status = 'active'; w.db.tables.collaborators.find((c) => c.id === id).collaborators_status = 'inactive';
    await assert.rejects(w.activation.verify(t, '20.0.0.5'), (e: any) => code(e) === 'ACTIVATION_LINK_INVALID');
  });
  await ok('T6 public "send me a new link": one answer for everybody, mail only for an eligible approved account, with a cool-down', async () => {
    const { w } = await approved('real@example.test');
    assert.equal(await w.activation.resendNow('nobody@example.test'), null); assert.equal(w.sent.length, 1, 'unknown address: nothing sent');
    assert.equal(await w.activation.resendNow('real@example.test'), null, 'cool-down: a link was e-mailed seconds ago'); assert.equal(w.sent.length, 1);
    for (const e of w.db.tables.audit_events) if (e.action.startsWith('collaborator.activation_email_')) e.occurred_at = new Date(Date.now() - 10 * 60_000).toISOString();
    const d = await w.activation.resendNow('real@example.test'); assert.equal(d?.status, 'sent'); assert.equal(d?.trigger, 'user_resend'); assert.equal(w.sent.length, 2);
    const v = await w.activation.verify(token(w.sent[1].activationUrl), '20.0.0.6'); await w.activation.consume(v.profile.id);
    for (const e of w.db.tables.audit_events) if (e.action.startsWith('collaborator.activation_email_')) e.occurred_at = new Date(Date.now() - 10 * 60_000).toISOString();
    const used = await w.activation.resendNow('real@example.test');
    assert.deepEqual([used?.status, used?.reason], ['not_eligible', 'already_activated']);
    assert.equal(w.sent.length, 2, 'an account that already entered the portal gets no activation mail');
    assert.doesNotThrow(() => w.activation.requestLink('not an email', '1.1.1.1')); assert.doesNotThrow(() => w.activation.requestLink(undefined, '1.1.1.1'));
  });
  await ok('T7 no raw token is ever written to the audit trail or returned to the Admin', async () => {
    const { w, id, res } = await approved(); const t = token(w.sent[0].activationUrl);
    const everything = JSON.stringify([w.db.tables.audit_events, res, await w.collaborators.activationStatus(id)]);
    assert.equal(everything.includes(t), false); assert.equal(/token/i.test(everything.replace(/activation_email_/g, '')), false);
  });

  console.log(JSON.stringify({ status: 'PASS', controls }));
})().catch((e) => { console.error(e); process.exit(1); });

