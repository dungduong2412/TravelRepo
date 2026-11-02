// Local end-to-end tests for every e-mail path, against an isolated local SMTP server (no network, no provider, no Supabase, no real address):
//   config   provider-neutral SMTP settings (accepted / rejected combinations, secrets never described)
//   wire     the real nodemailer transport against STARTTLS / implicit TLS / plain-loopback servers and provider failure modes
//   hook     the real Nest HTTP route (raw-body signature check) -> gateway -> SMTP: signup, confirmation, recovery/reset, invite, magic link, reauth
//   invite   admin invitations in e-mail and capture mode, revoke, expired / revoked / used links, same allowlist as the hook
// Usage: node -r ts-node/register/transpile-only scripts/test-email-delivery.ts
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as express from 'express';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { AuthEmailHookController } from '../src/modules/auth-email-hook/auth-email-hook.controller';
import { AuthEmailHookService } from '../src/modules/auth-email-hook/auth-email-hook.service';
import { captureHookRawBody } from '../src/common/http/hook-raw-body';
import { InvitationsService } from '../src/modules/invitations/invitations.service';
import { classifySmtpError, createSmtpTransport, describeSmtp, readSmtpSettings } from '../src/modules/auth-email-hook/smtp-config';
import { MiniSmtp, parseCaptured } from './support/mini-smtp';

// The self-signed test certificate is trusted through NODE_EXTRA_CA_CERTS (certificate verification stays ON in the code under test), which Node
// reads at start-up: generate the certificates, then re-run this file once with the variable set.
if (!process.env.VNO_TEST_CERT_DIR) {
  const dir = mkdtempSync(join(tmpdir(), 'vno-smtp-'));
  const mk = (name: string) => execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.crt`), '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  mk('trusted'); mk('untrusted');
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, VNO_TEST_CERT_DIR: dir, NODE_EXTRA_CA_CERTS: join(dir, 'trusted.crt') } });
  rmSync(dir, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}
const CERTS = process.env.VNO_TEST_CERT_DIR!;
const trusted = { key: readFileSync(join(CERTS, 'trusted.key'), 'utf8'), cert: readFileSync(join(CERTS, 'trusted.crt'), 'utf8') };
const untrusted = { key: readFileSync(join(CERTS, 'untrusted.key'), 'utf8'), cert: readFileSync(join(CERTS, 'untrusted.crt'), 'utf8') };

let passed = 0; let failed = 0;
const t = async (name: string, fn: () => void | Promise<void>) => {
  try { await fn(); passed++; console.log(`PASS ${name}`); } catch (e: any) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`); }
};
const env = (o: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

const SUPABASE_URL = 'https://projectref.supabase.co';
const WEB = 'https://web.example.test';
const PASSWORD = 'S3cret-Pa55-do-not-leak';
const ALLOWED = ['tester+admin@example.org', 'tester+merchant@example.org', 'tester+partner@example.org'];
const key = Buffer.from('gateway-e2e-secret-bytes-0123456789');
const HOOK_SECRET = `v1,whsec_${key.toString('base64')}`;
const MIGRATED_ID = '11111111-1111-4111-8111-111111111111';
const MIGRATED_ADDR = 'former.customer@real-business.vn';
const sha = (e: string) => createHash('sha256').update(e.trim().toLowerCase()).digest('hex');

const baseEnv = (smtp: Record<string, string | undefined>) => env({
  AUTH_EMAIL_HOOK_SECRET: HOOK_SECRET, AUTH_EMAIL_ALLOWLIST: ALLOWED.join(', '), INVITATION_EMAIL_ALLOWLIST: undefined, AUTH_EMAIL_DELIVERY: 'enabled',
  AUTH_EMAIL_SUBJECT_PREFIX: '[UAT] ', SUPABASE_URL, FRONTEND_URL: WEB,
  SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_SECURITY: undefined, SMTP_AUTH: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: 'no-reply@uat.example.org',
  SMTP_FROM_NAME: 'VNO UAT', SMTP_REPLY_TO: 'support@uat.example.org', SMTP_TLS_SERVERNAME: undefined, SMTP_TIMEOUT_MS: undefined, ...smtp,
});

/* ───────────── fake Supabase (identity map, invitations, Auth admin) ───────────── */
type Row = Record<string, any>;
class FakeDb {
  tables: Record<string, Row[]> = { legacy_identity_map: [{ auth_user_id: MIGRATED_ID, source_email_sha256: sha(MIGRATED_ADDR) }], invitations: [], user_profiles: [], merchant_details: [], collaborators: [] };
  lookupFails = false; inviteFails = false; authCalls: Array<{ fn: string; args: any[] }> = []; authUsers: Row[] = []; inserted: Row[] = [];
  from(table: string) { return new Q(this, table); }
  get auth() {
    const calls = this.authCalls;
    return { admin: {
      inviteUserByEmail: async (...args: any[]) => { calls.push({ fn: 'inviteUserByEmail', args }); return this.inviteFails ? { data: null, error: { message: 'Error sending invite email SECRET-DETAIL', status: 500 } } : { data: {}, error: null }; },
      generateLink: async (...args: any[]) => { calls.push({ fn: 'generateLink', args }); return { data: { properties: { action_link: `${SUPABASE_URL}/auth/v1/verify?token=ONE-TIME-SECRET&type=${args[0].type}` } }, error: null }; },
      listUsers: async () => ({ data: { users: this.authUsers }, error: null }),
      deleteUser: async (...args: any[]) => { calls.push({ fn: 'deleteUser', args }); return { error: null }; },
      getUserById: async (id: string) => ({ data: { user: this.authUsers.find((u) => u.id === id) }, error: null }),
    } };
  }
  client() { return this as any; }
}
class Q implements PromiseLike<any> {
  private filters: Array<(r: Row) => boolean> = []; private op: 'select' | 'insert' | 'update' = 'select'; private payload: Row = {};
  constructor(private db: FakeDb, private table: string) {}
  select() { return this; }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this; }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] < v); return this; }
  gt(c: string, v: any) { this.filters.push((r) => r[c] > v); return this; }
  or(f: string) { const conds = f.split(',').map((c) => c.split('.eq.')); this.filters.push((r) => conds.some(([c, v]) => r[c] === v)); return this; }
  limit() { return this; } order() { return this; }
  private run(): { data: Row[] | null; error: any } {
    if (this.table === 'legacy_identity_map' && this.db.lookupFails) return { data: null, error: { message: 'down' } };
    const rows = this.db.tables[this.table] ??= [];
    if (this.op === 'insert') { const row = { id: `inv-${rows.length + 1}`, status: 'pending', created_at: new Date().toISOString(), ...this.payload }; rows.push(row); this.db.inserted.push({ ...this.payload }); return { data: [row], error: null }; }
    const hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') hit.forEach((r) => Object.assign(r, this.payload));
    return { data: hit, error: null };
  }
  maybeSingle() { const r = this.run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); }
  single() { const r = this.run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.data?.length ? null : { message: 'none' } }); }
  then<T1, T2>(a?: (v: any) => T1 | PromiseLike<T1>, b?: (e: any) => T2 | PromiseLike<T2>) { return Promise.resolve(this.run()).then(a, b); }
}

/* ───────────── HTTP harness: the real route, raw-body capture and signature check ───────────── */
const logs: string[] = [];
const captureLogger = { log: (m: any) => logs.push(String(m)), error: (m: any) => logs.push(String(m)), warn: (m: any) => logs.push(String(m)), debug: () => undefined, verbose: () => undefined };
async function boot(db: FakeDb) {
  @Module({ controllers: [AuthEmailHookController], providers: [AuthEmailHookService, { provide: SupabaseService, useValue: { getClient: () => db.client() } }] })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: captureLogger as any });
  app.use(express.json({ limit: '15mb', verify: captureHookRawBody }));
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const post = async (payload: any, opts: { secretKey?: Buffer; ts?: number; unsigned?: boolean } = {}) => {
    const body = JSON.stringify(payload); const ts = opts.ts ?? Math.floor(Date.now() / 1000); const id = `msg_${Math.random().toString(16).slice(2)}`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!opts.unsigned) Object.assign(headers, { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${createHmac('sha256', opts.secretKey ?? key).update(`${id}.${ts}.${body}`).digest('base64')}` });
    const r = await fetch(`${url}/auth/hooks/send-email`, { method: 'POST', headers, body });
    const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, text, json };
  };
  return { post, close: () => app.close() };
}
const hookPayload = (email: string, type: string, extra: Row = {}, id = '22222222-2222-4222-8222-222222222222') =>
  ({ user: { id, email }, email_data: { token: '482915', token_hash: 'hash_abc123', email_action_type: type, redirect_to: `${WEB}/reset-password`, site_url: SUPABASE_URL, ...extra } });

async function withSmtp<T>(opts: ConstructorParameters<typeof MiniSmtp>[0], envOverrides: (port: number) => Record<string, string | undefined>, fn: (ctx: { smtp: MiniSmtp; db: FakeDb; post: Awaited<ReturnType<typeof boot>>['post'] }) => Promise<T>) {
  const smtp = new MiniSmtp(opts); const port = await smtp.start(); baseEnv(envOverrides(port));
  const db = new FakeDb(); const app = await boot(db); logs.length = 0;
  try { return await fn({ smtp, db, post: app.post }); } finally { await app.close(); await smtp.stop(); }
}
const starttls = (port: number) => ({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURITY: 'starttls', SMTP_USER: 'uat-user', SMTP_PASS: PASSWORD });
const AUTH = { user: 'uat-user', pass: PASSWORD };

(async () => {
  /* ═══ config ═══ */
  await t('config: accepted provider combinations (587 STARTTLS, 465 TLS, custom port with explicit mode, credential-less loopback relay, "Name <addr>" sender)', () => {
    const ok = (o: Record<string, string>) => readSmtpSettings({ SMTP_HOST: 'smtp.example.org', SMTP_FROM: 'VNO <no-reply@uat.example.org>', SMTP_USER: 'u', SMTP_PASS: 'p', ...o });
    assert.deepEqual([ok({ SMTP_PORT: '587' }).security, ok({ SMTP_PORT: '465' }).security, ok({ SMTP_PORT: '2525', SMTP_SECURITY: 'starttls' }).security, ok({ SMTP_SECURITY: 'tls' }).port, ok({ SMTP_SECURITY: 'starttls' }).port], ['starttls', 'tls', 'starttls', 465, 587]);
    assert.deepEqual(ok({ SMTP_PORT: '587' }).from, { name: 'VNO', address: 'no-reply@uat.example.org' });
    assert.equal(ok({ SMTP_PORT: '587', SMTP_FROM_NAME: 'VNO UAT' }).from.name, 'VNO UAT');
    assert.equal(readSmtpSettings({ SMTP_HOST: 'localhost', SMTP_PORT: '1025', SMTP_SECURITY: 'plain', SMTP_AUTH: 'none', SMTP_FROM: 'a@b.co' }).user, undefined);
  });
  await t('config: every unsafe or ambiguous value is rejected (no guessing, no plain text off-loopback, no 465/587 mix-up, no missing credentials, no cert-check switch)', () => {
    const base = { SMTP_HOST: 'smtp.example.org', SMTP_PORT: '587', SMTP_FROM: 'a@b.co', SMTP_USER: 'u', SMTP_PASS: 'p' };
    const bad = (o: Record<string, string | undefined>, re: RegExp) => assert.throws(() => readSmtpSettings({ ...base, ...o }), re);
    bad({ SMTP_HOST: undefined }, /SMTP_HOST/); bad({ SMTP_FROM: undefined }, /SMTP_FROM/); bad({ SMTP_FROM: 'not an address' }, /valid sender/);
    bad({ SMTP_PORT: undefined }, /SMTP_SECURITY/); bad({ SMTP_PORT: '2525' }, /explicitly/); bad({ SMTP_PORT: '99999' }, /range/); bad({ SMTP_PORT: 'abc' }, /port number/);
    bad({ SMTP_SECURITY: 'ssl' }, /starttls, tls or plain/); bad({ SMTP_SECURITY: 'plain' }, /loopback/); bad({ SMTP_SECURITY: 'tls' }, /587 is STARTTLS/); bad({ SMTP_PORT: '465', SMTP_SECURITY: 'starttls' }, /465 is implicit TLS/);
    bad({ SMTP_PASS: undefined }, /SMTP_USER and SMTP_PASS/); bad({ SMTP_AUTH: 'none' }, /contradicts/); bad({ SMTP_TIMEOUT_MS: '60000' }, /1000 and 4000/); bad({ SMTP_REPLY_TO: 'nope' }, /SMTP_REPLY_TO/);
    assert.equal(readSmtpSettings({ ...base, SMTP_TLS_REJECT_UNAUTHORIZED: 'false' } as any).host, 'smtp.example.org'); // unknown knob is ignored, certificates are still verified (see the untrusted-certificate wire test)
  });
  await t('config: the logged description contains neither the password nor the full user name', () => {
    const d = describeSmtp(readSmtpSettings({ SMTP_HOST: 'smtp.example.org', SMTP_PORT: '587', SMTP_FROM: 'a@b.co', SMTP_USER: 'AKIA-user-name', SMTP_PASS: PASSWORD }));
    assert.ok(!d.includes(PASSWORD) && !d.includes('AKIA-user-name') && d.includes('starttls') && d.includes('smtp.example.org:587'), d);
  });
  await t('config: failures classify into stable classes without server text', () => {
    assert.equal(classifySmtpError({ code: 'EAUTH', responseCode: 535 }), 'auth_failed');
    assert.equal(classifySmtpError({ code: 'EENVELOPE', rejected: ['x@y.z'], responseCode: 550 }), 'recipient_rejected');
    assert.equal(classifySmtpError({ code: 'ETIMEDOUT' }), 'timeout');
    assert.equal(classifySmtpError({ code: 'ECONNREFUSED' }), 'connection_failed');
    assert.equal(classifySmtpError({ responseCode: 451 }), 'temporary_failure');
    assert.equal(classifySmtpError(new Error('?')), 'unknown');
  });

  /* ═══ wire: the transport against provider behaviours ═══ */
  const deliver = async (smtp: MiniSmtp, envVars: Record<string, string | undefined>, to = ALLOWED[0]) => {
    baseEnv(envVars); const settings = readSmtpSettings();
    return createSmtpTransport(settings).sendMail({ from: settings.from, to, subject: 'wire test', text: 'hello', html: '<p>hello</p>' });
  };
  await t('wire: STARTTLS (587-style) with credentials delivers over an encrypted, authenticated session', async () => {
    const smtp = new MiniSmtp({ mode: 'starttls', cert: trusted, ...AUTH }); const port = await smtp.start();
    try { await deliver(smtp, starttls(port)); assert.equal(smtp.messages.length, 1); assert.ok(smtp.messages[0].encrypted && smtp.messages[0].authUser === 'uat-user'); } finally { await smtp.stop(); }
  });
  await t('wire: implicit TLS (465-style) delivers', async () => {
    const smtp = new MiniSmtp({ mode: 'tls', cert: trusted, ...AUTH }); const port = await smtp.start();
    try { await deliver(smtp, { ...starttls(port), SMTP_SECURITY: 'tls' }); assert.equal(smtp.messages.length, 1); assert.ok(smtp.messages[0].encrypted); } finally { await smtp.stop(); }
  });
  await t('wire: credential-less loopback relay in plain mode delivers (local test mode only)', async () => {
    const smtp = new MiniSmtp({ mode: 'plain' }); const port = await smtp.start();
    try { await deliver(smtp, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURITY: 'plain', SMTP_AUTH: 'none' }); assert.equal(smtp.messages.length, 1); assert.equal(smtp.messages[0].encrypted, false); } finally { await smtp.stop(); }
  });
  await t('wire: no downgrade — a server that does not offer STARTTLS is refused and the password is never sent', async () => {
    const smtp = new MiniSmtp({ mode: 'starttls', cert: trusted, offerStarttls: false, ...AUTH }); const port = await smtp.start();
    try {
      const err: any = await deliver(smtp, starttls(port)).then(() => null, (e) => e);
      assert.ok(err, 'must fail'); assert.equal(classifySmtpError(err), 'tls_failed'); assert.equal(smtp.authAttempts, 0, 'credentials must not be offered on a clear-text channel'); assert.equal(smtp.messages.length, 0);
    } finally { await smtp.stop(); }
  });
  await t('wire: certificate verification is on — an untrusted certificate and a wrong server name are both refused', async () => {
    for (const [cert, extra] of [[untrusted, {}], [trusted, { SMTP_TLS_SERVERNAME: 'wrong.example.test' }]] as const) {
      const smtp = new MiniSmtp({ mode: 'starttls', cert, ...AUTH }); const port = await smtp.start();
      try { const err: any = await deliver(smtp, { ...starttls(port), ...extra }).then(() => null, (e) => e); assert.ok(err); assert.equal(classifySmtpError(err), 'tls_failed', String(err?.code) + ' ' + String(err?.message)); assert.equal(smtp.authAttempts, 0); assert.equal(smtp.messages.length, 0); } finally { await smtp.stop(); }
    }
  });
  await t('wire: wrong password -> auth_failed (nothing delivered)', async () => {
    const smtp = new MiniSmtp({ mode: 'starttls', cert: trusted, ...AUTH }); const port = await smtp.start();
    try { const err: any = await deliver(smtp, { ...starttls(port), SMTP_PASS: 'wrong' }).then(() => null, (e) => e); assert.equal(classifySmtpError(err), 'auth_failed'); assert.equal(smtp.messages.length, 0); } finally { await smtp.stop(); }
  });
  await t('wire: invalid recipient (550) -> recipient_rejected; 451 on DATA -> temporary_failure; refused connection -> connection_failed; stalled greeting -> timeout', async () => {
    let smtp = new MiniSmtp({ mode: 'starttls', cert: trusted, ...AUTH, rejectRcpt: (a) => (a.startsWith('ghost') ? '550 5.1.1 mailbox unavailable' : null) }); let port = await smtp.start();
    try { assert.equal(classifySmtpError(await deliver(smtp, starttls(port), 'ghost@example.org').then(() => null, (e) => e)), 'recipient_rejected'); } finally { await smtp.stop(); }
    smtp = new MiniSmtp({ mode: 'starttls', cert: trusted, ...AUTH, dataReply: '451 4.3.0 try again later' }); port = await smtp.start();
    try { assert.equal(classifySmtpError(await deliver(smtp, starttls(port)).then(() => null, (e) => e)), 'temporary_failure'); } finally { await smtp.stop(); }
    smtp = new MiniSmtp({ mode: 'starttls', cert: trusted, ...AUTH }); port = await smtp.start(); await smtp.stop();
    assert.equal(classifySmtpError(await deliver(smtp, starttls(port)).then(() => null, (e) => e)), 'connection_failed');
    smtp = new MiniSmtp({ mode: 'starttls', cert: trusted, ...AUTH, stallMs: 6000 }); port = await smtp.start();
    const started = Date.now();
    try { assert.equal(classifySmtpError(await deliver(smtp, { ...starttls(port), SMTP_TIMEOUT_MS: '1000' }).then(() => null, (e) => e)), 'timeout'); assert.ok(Date.now() - started < 3500, 'must give up well inside the Auth hook budget'); } finally { await smtp.stop(); }
  });

  /* ═══ hook: the real HTTP route -> gateway -> SMTP, every Auth e-mail scenario ═══ */
  const scenarios: Array<{ name: string; type: string; to: string; extra?: Row; redirect: string; subject: RegExp; button: RegExp; id?: string }> = [
    { name: 'signup confirmation', type: 'signup', to: ALLOWED[1], redirect: `${WEB}/merchant/onboard?confirmed=1`, subject: /Xác nhận email đăng ký VNO \/ Confirm your VNO email/, button: /Xác nhận email/ },
    { name: 'password recovery / reset', type: 'recovery', to: ALLOWED[0], redirect: `${WEB}/reset-password`, subject: /Đặt lại mật khẩu VNO \/ Reset your VNO password/, button: /Đặt lại mật khẩu/ },
    { name: 'admin invitation (merchant claim)', type: 'invite', to: ALLOWED[1], redirect: `${WEB}/claim/merchant/33333333-3333-4333-8333-333333333333`, subject: /Lời mời tham gia VNO \/ You are invited to VNO/, button: /Nhận tài khoản/ },
    { name: 'admin invitation (partner claim)', type: 'invite', to: ALLOWED[2], redirect: `${WEB}/claim/collaborator/44444444-4444-4444-8444-444444444444`, subject: /Lời mời tham gia VNO/, button: /Nhận tài khoản/ },
    { name: 'magic link (existing account fallback)', type: 'magiclink', to: ALLOWED[0], redirect: `${WEB}/claim/merchant/33333333-3333-4333-8333-333333333333`, subject: /Liên kết đăng nhập VNO \/ Your VNO sign-in link/, button: /Đăng nhập/ },
    { name: 'email change (current address only)', type: 'email_change', to: ALLOWED[0], redirect: `${WEB}/login`, subject: /Xác nhận thay đổi email VNO/, button: /Xác nhận thay đổi/ },
  ];
  for (const sc of scenarios) {
    await t(`hook/${sc.name}: exactly one bilingual message, correct recipient, verify link keeps the exact redirect, plain-text twin, sender identity`, () =>
      withSmtp({ mode: 'starttls', cert: trusted, ...AUTH }, starttls, async ({ smtp, post }) => {
        const r = await post(hookPayload(sc.to, sc.type, { redirect_to: sc.redirect }));
        assert.equal(r.status, 200); assert.deepEqual(r.json, { sent: true }); assert.equal(smtp.messages.length, 1);
        const m = smtp.messages[0]; assert.deepEqual(m.to, [sc.to]); assert.ok(m.encrypted);
        const mail = parseCaptured(m.raw);
        assert.match(mail.subject, sc.subject); assert.ok(mail.subject.startsWith('[UAT] '));
        assert.match(mail.headers['from'], /VNO UAT.*<no-reply@uat\.example\.org>/); assert.equal(mail.headers['reply-to'], 'support@uat.example.org'); assert.equal(mail.headers['auto-submitted'], 'auto-generated');
        const link = `${SUPABASE_URL}/auth/v1/verify?token=hash_abc123&type=${sc.type}&redirect_to=${encodeURIComponent(sc.redirect)}`;
        assert.ok(mail.text.includes(link), 'plain-text part carries the link'); assert.ok(mail.html.includes(link.replace(/&/g, '&amp;')), 'html carries the link (button + fallback)');
        assert.equal((mail.html.match(/href="[^"]*auth\/v1\/verify/g) || []).length, 2, 'button + visible fallback link'); assert.match(mail.html, sc.button); assert.match(mail.html, /Nếu nút không hoạt động/);
        assert.ok(!mail.html.includes(PASSWORD) && !mail.text.includes(PASSWORD));
      }));
  }
  await t('hook/reauthentication: the numeric code is delivered, no link', () => withSmtp({ mode: 'starttls', cert: trusted, ...AUTH }, starttls, async ({ smtp, post }) => {
    assert.equal((await post(hookPayload(ALLOWED[0], 'reauthentication'))).status, 200);
    const mail = parseCaptured(smtp.messages[0].raw); assert.ok(mail.text.includes('482915') && mail.html.includes('482915') && !mail.html.includes('auth/v1/verify'));
  }));
  await t('hook/templates survive the wire intact (UTF-8 Vietnamese, doctype, viewport, UAT notice, 48px tap target)', () => withSmtp({ mode: 'starttls', cert: trusted, ...AUTH }, starttls, async ({ smtp, post }) => {
    await post(hookPayload(ALLOWED[0], 'recovery')); const mail = parseCaptured(smtp.messages[0].raw);
    assert.ok(mail.html.startsWith('<!doctype html>') && /name="viewport"/.test(mail.html) && /lang="vi"/.test(mail.html));
    assert.ok(mail.html.includes('Đặt lại mật khẩu') && mail.html.includes('Reset your password') && /môi trường thử nghiệm \(UAT\)/.test(mail.html) && /padding:12px 24px/.test(mail.html));
    assert.ok(mail.html.indexOf('Đặt lại mật khẩu') < mail.html.indexOf('Reset your password'), 'Vietnamese first');
  }));

  await t('hook/recipient policy: non-allowlisted, base-of-alias, migrated-but-allowlisted, malformed and header-injection recipients get HTTP 200 and ZERO SMTP traffic', () =>
    withSmtp({ mode: 'starttls', cert: trusted, ...AUTH }, starttls, async ({ smtp, db, post }) => {
      env({ AUTH_EMAIL_ALLOWLIST: `${ALLOWED.join(',')},${MIGRATED_ADDR}` }); // somebody mistakenly allowlists a migrated customer
      const probes: Array<[string, string?]> = [['customer@real-business.vn'], ['tester@example.org'], [MIGRATED_ADDR, MIGRATED_ID], [MIGRATED_ADDR.toUpperCase(), '99999999-9999-4999-8999-999999999999'], ['not-an-email'], [`${ALLOWED[0]}\r\nBcc: victim@real-business.vn`], ['a@b.co, victim@real-business.vn']];
      for (const [addr, id] of probes) for (const type of ['signup', 'recovery', 'invite']) { const r = await post(hookPayload(addr, type, {}, id)); assert.equal(r.status, 200, `${addr}`); assert.deepEqual(r.json, { suppressed: true }); }
      assert.equal(smtp.connections, 0); assert.equal(smtp.messages.length, 0); void db;
    }));
  await t('hook/delivery switch: AUTH_EMAIL_DELIVERY unset or "disabled" suppresses even an allowlisted tester (0 SMTP connections); flipping it back sends', () =>
    withSmtp({ mode: 'starttls', cert: trusted, ...AUTH }, starttls, async ({ smtp, post }) => {
      for (const v of [undefined, 'disabled', 'ENABLED', 'true']) { env({ AUTH_EMAIL_DELIVERY: v }); assert.deepEqual((await post(hookPayload(ALLOWED[0], 'recovery'))).json, { suppressed: true }); }
      assert.equal(smtp.connections, 0);
      env({ AUTH_EMAIL_DELIVERY: 'enabled' }); assert.deepEqual((await post(hookPayload(ALLOWED[0], 'recovery'))).json, { sent: true }); assert.equal(smtp.messages.length, 1);
    }));
  await t('hook/authentication: unsigned, wrong secret, stale timestamp -> 401; no secret configured -> 503; none of them touch SMTP', () =>
    withSmtp({ mode: 'starttls', cert: trusted, ...AUTH }, starttls, async ({ smtp, post }) => {
      const p = hookPayload(ALLOWED[0], 'recovery');
      assert.equal((await post(p, { unsigned: true })).status, 401); assert.equal((await post(p, { secretKey: Buffer.from('another-secret') })).status, 401); assert.equal((await post(p, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
      env({ AUTH_EMAIL_HOOK_SECRET: undefined }); assert.equal((await post(p)).status, 503);
      assert.equal(smtp.connections, 0);
    }));
  await t('hook/fail closed: identity lookup unavailable -> 503 and nothing sent', () => withSmtp({ mode: 'starttls', cert: trusted, ...AUTH }, starttls, async ({ smtp, db, post }) => {
    db.lookupFails = true; assert.equal((await post(hookPayload(ALLOWED[0], 'recovery'))).status, 503); assert.equal(smtp.connections, 0);
  }));

  const failureCase = (name: string, smtpOpts: ConstructorParameters<typeof MiniSmtp>[0], cfg: (port: number) => Record<string, string | undefined>, to: string, expect: string, ms = 5000) =>
    t(`hook/delivery failure: ${name} -> HTTP 503 "${expect}", no credentials or server text in the response or the logs`, () => withSmtp(smtpOpts, cfg, async ({ post }) => {
      const started = Date.now(); const r = await post(hookPayload(to, 'recovery'));
      assert.equal(r.status, 503); assert.equal(r.json?.message, `Email delivery failed (${expect})`, r.text);
      assert.ok(Date.now() - started < ms, `took ${Date.now() - started} ms`);
      for (const blob of [r.text, logs.join('\n')]) { assert.ok(!blob.includes(PASSWORD) && !blob.includes('uat-user') && !blob.includes('127.0.0.1') && !blob.includes(to), 'leak: ' + blob.slice(0, 200)); }
    }));
  await failureCase('provider rejects the recipient (550)', { mode: 'starttls', cert: trusted, ...AUTH, rejectRcpt: () => '550 5.1.1 mailbox unavailable' }, starttls, ALLOWED[0], 'recipient_rejected');
  await failureCase('provider credentials rejected (535)', { mode: 'starttls', cert: trusted, ...AUTH }, (p) => ({ ...starttls(p), SMTP_PASS: 'rotated-away' }), ALLOWED[0], 'auth_failed');
  await failureCase('provider temporary failure (451)', { mode: 'starttls', cert: trusted, ...AUTH, dataReply: '451 4.3.0 try again later' }, starttls, ALLOWED[0], 'temporary_failure');
  await failureCase('provider does not offer STARTTLS (no downgrade)', { mode: 'starttls', cert: trusted, offerStarttls: false, ...AUTH }, starttls, ALLOWED[0], 'tls_failed');
  await failureCase('provider certificate not trusted', { mode: 'starttls', cert: untrusted, ...AUTH }, starttls, ALLOWED[0], 'tls_failed');
  await failureCase('provider stalls (Auth would abandon the hook after ~5 s)', { mode: 'starttls', cert: trusted, ...AUTH, stallMs: 8000 }, (p) => ({ ...starttls(p), SMTP_TIMEOUT_MS: '1000' }), ALLOWED[0], 'timeout', 3500);
  await t('hook/delivery failure: provider unreachable -> 503 connection_failed', async () => {
    const dead = new MiniSmtp({ mode: 'starttls', cert: trusted, ...AUTH }); const port = await dead.start(); await dead.stop();
    baseEnv(starttls(port)); const app = await boot(new FakeDb());
    try { const r = await app.post(hookPayload(ALLOWED[0], 'recovery')); assert.equal(r.status, 503); assert.equal(r.json?.message, 'Email delivery failed (connection_failed)'); } finally { await app.close(); }
  });
  await t('hook/misconfiguration: unsafe SMTP settings -> 503 "SMTP is not configured", no connection attempted, reason logged without secrets', async () => {
    for (const bad of [{ SMTP_HOST: 'mail.example.org', SMTP_PORT: '2525', SMTP_SECURITY: 'plain', SMTP_USER: 'u', SMTP_PASS: PASSWORD }, { SMTP_HOST: undefined }, { SMTP_PORT: '2525', SMTP_SECURITY: undefined }]) {
      baseEnv({ SMTP_HOST: 'mail.example.org', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: PASSWORD, ...bad }); const app = await boot(new FakeDb()); logs.length = 0;
      try { const r = await app.post(hookPayload(ALLOWED[0], 'recovery')); assert.equal(r.status, 503); assert.match(r.text, /SMTP is not configured/); assert.ok(!logs.join('\n').includes(PASSWORD)); } finally { await app.close(); }
    }
  });
  await t('hook/implicit TLS and credential-less loopback relay deliver through the real route', async () => {
    await withSmtp({ mode: 'tls', cert: trusted, ...AUTH }, (p) => ({ ...starttls(p), SMTP_SECURITY: 'tls' }), async ({ smtp, post }) => { assert.deepEqual((await post(hookPayload(ALLOWED[0], 'signup'))).json, { sent: true }); assert.ok(smtp.messages[0].encrypted); });
    await withSmtp({ mode: 'plain' }, (p) => ({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(p), SMTP_SECURITY: 'plain', SMTP_AUTH: 'none' }), async ({ smtp, post }) => { assert.deepEqual((await post(hookPayload(ALLOWED[0], 'signup'))).json, { sent: true }); assert.equal(smtp.messages.length, 1); });
  });

  /* ═══ invite: admin invitations, same policy, revoke, expired / revoked / used ═══ */
  const entityId = '33333333-3333-4333-8333-333333333333';
  const inviteSetup = (ownerEmail: string, mode: 'email' | 'capture' = 'email', allowlist: string | null = ALLOWED.join(',')) => {
    env({ INVITATION_DELIVERY: mode, AUTH_EMAIL_DELIVERY: 'enabled', AUTH_EMAIL_ALLOWLIST: allowlist ?? undefined, INVITATION_EMAIL_ALLOWLIST: undefined, FRONTEND_URL: WEB });
    const db = new FakeDb(); db.tables.merchant_details.push({ merchant_system_id: entityId, owner_email: ownerEmail });
    const profiles: any[] = []; const audits: any[] = []; const svc = new InvitationsService({ getClient: () => db.client() } as any, { record: async (...a: any[]) => { audits.push(a); } } as any, { createOrUpdate: async (p: any) => { profiles.push(p); } } as any);
    return { db, svc, profiles, audits };
  };
  const admin = { id: 'admin-1' } as any; const INV = '55555555-5555-4555-8555-555555555555';
  await t('invite/email mode: allowlisted tester -> one Auth invitation with the claim redirect; no link in the response or the database', async () => {
    const { db, svc } = inviteSetup(ALLOWED[1]); const out: any = await svc.create(admin, { entity_type: 'merchant', entity_id: entityId } as any);
    const calls = db.authCalls.filter((c) => c.fn === 'inviteUserByEmail'); assert.equal(calls.length, 1); assert.equal(calls[0].args[0], ALLOWED[1]); assert.equal(calls[0].args[1].redirectTo, `${WEB}/claim/merchant/${entityId}`);
    assert.equal(out.delivery, 'email'); assert.equal(out.delivery_status, 'handed_to_auth'); assert.ok(!('invite_link' in out)); assert.ok(db.inserted.every((r) => !('invite_link' in r)));
    assert.equal(db.authCalls.filter((c) => c.fn === 'generateLink').length, 0);
  });
  await t('invite/email mode: refused BEFORE any Auth call and with no database row for a non-allowlisted address, a migrated customer (even if allowlisted), an unset allowlist and an unavailable identity lookup', async () => {
    const cases: Array<[string, string, string | null, boolean, RegExp]> = [
      ['real customer', 'customer@real-business.vn', ALLOWED.join(','), false, /allowlist/], ['base of an alias', 'tester@example.org', ALLOWED.join(','), false, /allowlist/],
      ['migrated + allowlisted', MIGRATED_ADDR, `${ALLOWED.join(',')},${MIGRATED_ADDR}`, false, /migrated/], ['allowlist unset', ALLOWED[0], null, false, /allowlist/], ['lookup down', ALLOWED[0], ALLOWED.join(','), true, /unavailable/],
    ];
    for (const [label, owner, list, down, re] of cases) {
      const { db, svc } = inviteSetup(owner, 'email', list); db.lookupFails = down;
      await assert.rejects(() => svc.create(admin, { entity_type: 'merchant', entity_id: entityId } as any), re, label);
      assert.equal(db.authCalls.length, 0, `${label}: no Auth call`); assert.equal(db.tables.invitations.length, 0, `${label}: no invitation row`);
    }
  });
  await t('invite/delivery failure is distinguishable from a claim status: e-mail switch off or Auth send error -> coded error, NO invitation row, unused invited identity removed, no token anywhere', async () => {
    { const { db, svc } = inviteSetup(ALLOWED[1]); env({ AUTH_EMAIL_DELIVERY: 'disabled' });
      const e: any = await svc.create(admin, { entity_type: 'merchant', entity_id: entityId } as any).then(() => null, (x) => x);
      assert.equal(e?.getResponse?.().code, 'INVITATION_DELIVERY_DISABLED'); assert.equal(db.authCalls.length, 0); assert.equal(db.tables.invitations.length, 0); }
    { const { db, svc, audits } = inviteSetup(ALLOWED[1]); db.authUsers.push({ id: 'u9', email: ALLOWED[1], invited_at: '2026-11-02' });
      db.inviteFails = true;
      const e: any = await svc.create(admin, { entity_type: 'merchant', entity_id: entityId } as any).then(() => null, (x) => x);
      assert.equal(e?.getStatus?.(), 502); assert.equal(e.getResponse().code, 'INVITATION_EMAIL_FAILED'); assert.ok(!JSON.stringify(e.getResponse()).includes('SECRET-DETAIL'));
      assert.equal(db.tables.invitations.length, 0, 'no pending invitation is left behind'); assert.ok(db.authCalls.some((c) => c.fn === 'deleteUser'), 'unused invited identity removed');
      assert.ok(audits.some((a) => a[1] === 'invitation.delivery_failed')); assert.ok(!JSON.stringify(audits).includes(ALLOWED[1]), 'audit carries no address'); }
    env({ AUTH_EMAIL_DELIVERY: 'enabled' });
  });
  await t('invite/capture mode (default): the Auth link is returned exactly once and never stored or re-served', async () => {
    const { db, svc } = inviteSetup('anyone@real-business.vn', 'capture'); const out: any = await svc.create(admin, { entity_type: 'merchant', entity_id: entityId } as any);
    assert.match(out.invite_link, /ONE-TIME-SECRET/); assert.equal(out.delivery, 'capture'); assert.equal(out.delivery_status, 'link_captured'); assert.ok(db.inserted.every((r) => !('invite_link' in r)) && !JSON.stringify(db.tables.invitations).includes('ONE-TIME-SECRET'));
    assert.ok(!JSON.stringify(await svc.findById(out.id)).includes('ONE-TIME-SECRET')); assert.ok(!JSON.stringify(await svc.findForEntity('merchant', entityId)).includes('ONE-TIME-SECRET'));
  });
  await t('policy parity: the hook and the invitation path give the SAME verdict for every probe, including when the legacy INVITATION_EMAIL_ALLOWLIST narrows the list', async () => {
    const probes = [...ALLOWED, 'tester@example.org', 'customer@real-business.vn', 'TESTER+ADMIN@EXAMPLE.ORG', MIGRATED_ADDR, 'x@gmail.com', 'tester+admin@example.org.evil.test'];
    for (const narrow of [undefined, 'tester+admin@example.org', 'someone-else@example.org']) {
      for (const probe of probes) {
        const allowedByInvite = await (async () => { const { db, svc } = inviteSetup(probe, 'email', `${ALLOWED.join(',')},${MIGRATED_ADDR},@gmail.com`); env({ INVITATION_EMAIL_ALLOWLIST: narrow }); try { await svc.create(admin, { entity_type: 'merchant', entity_id: entityId } as any); return db.authCalls.some((c) => c.fn === 'inviteUserByEmail'); } catch { return false; } })();
        const allowedByHook = await (async () => { baseEnv({}); env({ AUTH_EMAIL_ALLOWLIST: `${ALLOWED.join(',')},${MIGRATED_ADDR},@gmail.com`, INVITATION_EMAIL_ALLOWLIST: narrow });
          const db = new FakeDb(); const svc = new AuthEmailHookService({ getClient: () => db.client() } as any); const sent: any[] = []; svc.useSender(async (m) => { sent.push(m); });
          const body = Buffer.from(JSON.stringify(hookPayload(probe, 'invite'))); const ts = Math.floor(Date.now() / 1000);
          await svc.handle({ 'webhook-id': 'm', 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${createHmac('sha256', key).update(`m.${ts}.${body}`).digest('base64')}` }, body); return sent.length === 1; })();
        assert.equal(allowedByInvite, allowedByHook, `${probe} (narrow=${narrow})`);
        if (probe === MIGRATED_ADDR || probe === 'x@gmail.com' || probe === 'customer@real-business.vn') assert.equal(allowedByHook, false, probe);
      }
    }
    env({ INVITATION_EMAIL_ALLOWLIST: undefined });
  });
  await t('invite/revoke: an unused invited Auth identity is deleted (kills the emailed link); a confirmed or signed-in identity is kept', async () => {
    for (const [user, expectDelete] of [[{ id: 'u1', email: ALLOWED[1], invited_at: '2026-11-02' }, true], [{ id: 'u2', email: ALLOWED[1], invited_at: '2026-11-02', email_confirmed_at: '2026-11-02' }, false], [{ id: 'u3', email: ALLOWED[1], invited_at: '2026-11-02', last_sign_in_at: '2026-11-02' }, false]] as const) {
      const { db, svc } = inviteSetup(ALLOWED[1]); db.authUsers.push({ ...user }); const out: any = await svc.create(admin, { entity_type: 'merchant', entity_id: entityId } as any);
      const r: any = await svc.revoke(admin, out.id); assert.equal(r.status, 'revoked'); assert.equal(db.authCalls.some((c) => c.fn === 'deleteUser'), expectDelete);
      await assert.rejects(() => svc.revoke(admin, out.id), /Only pending/);
    }
  });
  await t('invite/claim states: expired, revoked, already used, wrong mailbox and unconfirmed e-mail are all refused, consume nothing and create no profile', async () => {
    const mk = (status: string, expires: string, owner = ALLOWED[1], callerConfirmed = true) => {
      const { db, svc, profiles } = inviteSetup(owner); db.tables.invitations.push({ id: INV, entity_type: 'merchant', entity_id: entityId, owner_email: owner, status, expires_at: expires });
      db.authUsers.push({ id: 'caller', email: ALLOWED[1], email_confirmed_at: callerConfirmed ? '2026-11-02' : null }); return { db, svc, profiles };
    };
    const future = new Date(Date.now() + 86_400_000).toISOString(); const past = new Date(Date.now() - 86_400_000).toISOString();
    const cases: Array<[string, ReturnType<typeof mk>, RegExp]> = [
      ['expired', mk('pending', past), /expired/], ['revoked', mk('revoked', future), /revoked/], ['already used', mk('accepted', future), /accepted/], ['wrong mailbox', mk('pending', future, 'someone.else@example.org'), /does not match/], ['unconfirmed', mk('pending', future, ALLOWED[1], false), /confirmation/],
    ];
    for (const [label, { db, svc, profiles }, re] of cases) { const before = db.tables.invitations[0].status; const e: any = await svc.claim('caller', ALLOWED[1], 'merchant', entityId, INV).then(() => null, (x) => x); assert.ok(e && re.test(String(e.message)), `${label}: ${e?.message}`); assert.equal(profiles.length, 0, label); assert.ok([before, 'expired'].includes(db.tables.invitations[0].status), `${label}: status must not be consumed`); }
    const ok = mk('pending', future); const res: any = await ok.svc.claim('caller', ALLOWED[1], 'merchant', entityId, INV); assert.equal(res.status, 'accepted'); assert.equal(ok.profiles.length, 1);
    await assert.rejects(() => ok.svc.claim('caller', ALLOWED[1], 'merchant', entityId, INV), /already has an account|accepted|no longer/); // replay of the same link
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
