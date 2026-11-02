// Contract tests for the Auth "Send Email" hook gateway: signature, allowlist, migrated-identity block, fail-closed behaviour.
// No network, no SMTP: the sender and the identity lookup are injected.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { composeMessage } from '../src/modules/auth-email-hook/email-policy';
import { AuthEmailHookService } from '../src/modules/auth-email-hook/auth-email-hook.service';
import { actionLink, decide, isAllowlisted, parseAllowlist, verifyHookSignature } from '../src/modules/auth-email-hook/email-policy';

let n = 0;
const t = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`PASS ${name}`); };

const key = Buffer.from('unit-test-secret-bytes-0123456789');
const SECRET = `v1,whsec_${key.toString('base64')}`;
const sign = (id: string, ts: number, body: string) => `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
const body = (email: string, id = 'u-1', type = 'recovery') => Buffer.from(JSON.stringify({ user: { id, email }, email_data: { token_hash: 'th', email_action_type: type, redirect_to: 'https://web/reset-password' } }));
const hdr = (b: Buffer, ts = Math.floor(Date.now() / 1000)) => ({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': sign('msg_1', ts, b.toString()) });

// Mirrors the REAL schema: legacy_identity_map(auth_user_id, source_email_sha256, legacy_user_id); the gateway filters with .or("auth_user_id.eq.<id>,source_email_sha256.eq.<hash>").
const sha = (e: string) => createHash('sha256').update(e.trim().toLowerCase()).digest('hex');
function service(opts: { migrated?: string[]; migratedEmails?: string[]; lookupFails?: boolean } = {}) {
  const sent: any[] = [];
  const rows = [...(opts.migrated || []).map((id) => ({ auth_user_id: id, source_email_sha256: 'x' })), ...(opts.migratedEmails || []).map((e) => ({ auth_user_id: 'other', source_email_sha256: sha(e) }))];
  const run = async (filter: string) => {
    if (opts.lookupFails) return { data: null, error: { message: 'down' } };
    const conds = filter.split(',').map((c) => c.split('.eq.'));
    return { data: rows.filter((r: any) => conds.some(([col, val]) => r[col] === val)).slice(0, 1), error: null };
  };
  const supabase: any = { getClient: () => ({ from: (t: string) => { assert.equal(t, 'legacy_identity_map'); return { select: (c: string) => { assert.equal(c, 'auth_user_id'); return { or: (f: string) => ({ limit: () => run(f) }) }; } }; } }) };
  const s = new AuthEmailHookService(supabase); s.useSender(async (m) => { sent.push(m); });
  return { s, sent };
}
const env = (o: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

(async () => {
  await t('allowlist: exact address, plus-alias literal, domain entry, case-insensitive', () => {
    const a = parseAllowlist(' Tester+uat1@Example.com , @vno-testers.example ');
    assert.ok(isAllowlisted('tester+uat1@example.com', a));
    assert.ok(!isAllowlisted('tester@example.com', a), 'a plus alias must not widen to the base address');
    assert.ok(!isAllowlisted('tester+uat2@example.com', a));
    assert.ok(isAllowlisted('anyone@vno-testers.example', a));
    assert.ok(!isAllowlisted('anyone@evil-vno-testers.example', a));
    assert.ok(!isAllowlisted('x@notvno-testers.example.org', a));
    assert.ok(!isAllowlisted('anyone@example.com', parseAllowlist('')));
  });
  await t('decision: disabled, migrated and non-allowlisted are suppressed; only allowlisted non-migrated is sent', () => {
    const base = { allowlist: ['a@x.com'], migratedUserIds: new Set(['m-1']), enabled: true };
    assert.deepEqual(decide({ ...base, email: 'a@x.com' }), { action: 'send' });
    assert.deepEqual(decide({ ...base, email: 'a@x.com', enabled: false }), { action: 'suppress', reason: 'delivery_disabled' });
    assert.deepEqual(decide({ ...base, email: 'a@x.com', userId: 'M-1' }), { action: 'suppress', reason: 'migrated_identity' });
    assert.deepEqual(decide({ ...base, email: 'customer@real.vn' }), { action: 'suppress', reason: 'not_allowlisted' });
  });
  await t('signature: valid, tampered body, wrong secret, stale timestamp, missing headers', () => {
    const b = body('a@x.com'); const h = hdr(b); const now = Date.now();
    const v = (o: any = {}) => verifyHookSignature({ secret: SECRET, id: h['webhook-id'], timestamp: h['webhook-timestamp'], signature: h['webhook-signature'], rawBody: b, now, ...o });
    assert.ok(v());
    assert.ok(!v({ rawBody: body('b@x.com') }));
    assert.ok(!v({ secret: `v1,whsec_${Buffer.from('other').toString('base64')}` }));
    assert.ok(!v({ now: now + 10 * 60_000 }));
    assert.ok(!v({ signature: undefined }));
  });
  await t('action link follows the Supabase verify URL shape', () => {
    assert.equal(actionLink('https://p.supabase.co/', { token_hash: 'abc', email_action_type: 'recovery', redirect_to: 'https://w/x' }), 'https://p.supabase.co/auth/v1/verify?token=abc&type=recovery&redirect_to=https%3A%2F%2Fw%2Fx');
  });

  env({ AUTH_EMAIL_HOOK_SECRET: SECRET, AUTH_EMAIL_ALLOWLIST: 'tester+uat1@example.com', AUTH_EMAIL_DELIVERY: 'enabled', SMTP_FROM: 'VNO UAT <uat@example.org>', SUPABASE_URL: 'https://p.supabase.co' });
  await t('templates: bilingual VI+EN, branded, mobile-safe, escaped, with plain-text and fallback link for every Auth action type', () => {
    for (const type of ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'reauthentication', 'unknown_future_type']) {
      const m = composeMessage('https://p.supabase.co', { user: { id: 'u', email: 'a@x.com' }, email_data: { token: '123456', token_hash: 'th"><script>', email_action_type: type, redirect_to: 'https://web/reset?x=1&y=2' } }, '[UAT] ');
      assert.ok(m.subject.startsWith('[UAT] ') && m.subject.includes(' / '), `${type}: bilingual subject`);
      assert.ok(/lang="vi"/.test(m.html) && /name="viewport"/.test(m.html) && /Vietnam Number One/.test(m.html), `${type}: html shell`);
      assert.ok(!m.html.includes('<script>'), `${type}: user-controlled values are escaped`);
      assert.ok(/UAT/.test(m.html) && /UAT/.test(m.text), `${type}: UAT notice`);
      if (type === 'reauthentication') { assert.ok(m.html.includes('123456') && m.text.includes('123456') && !m.html.includes('/auth/v1/verify')); continue; }
      assert.ok(/padding:12px 24px/.test(m.html) && /line-height:24px/.test(m.html), `${type}: >=48px tap target (24px line + 2x12px padding)`);
      assert.equal((m.html.match(/href="https:\/\/p\.supabase\.co\/auth\/v1\/verify\?token=/g) || []).length, 2, `${type}: button + visible fallback link`);
      assert.ok(m.text.includes('https://p.supabase.co/auth/v1/verify?token='), `${type}: plain-text link`);
      assert.ok(m.html.includes('&amp;redirect_to=') && !m.html.includes('&redirect_to='), `${type}: ampersands escaped in href`);
    }
  });
  await t('gateway sends to an allowlisted recipient (subject carries the [UAT] marker)', async () => {
    const { s, sent } = service(); const b = body('tester+uat1@example.com');
    assert.deepEqual(await s.handle(hdr(b), b), { sent: true });
    assert.equal(sent.length, 1); assert.match(sent[0].subject, /^\[UAT\] /); assert.equal(sent[0].to, 'tester+uat1@example.com');
  });
  await t('gateway suppresses (200, nothing sent) a real customer address', async () => {
    const { s, sent } = service(); const b = body('customer@real-business.vn');
    assert.deepEqual(await s.handle(hdr(b), b), { suppressed: true }); assert.equal(sent.length, 0);
  });
  await t('gateway never mails a migrated V1 identity, even if its address is on the allowlist', async () => {
    const { s, sent } = service({ migrated: ['11111111-1111-4111-8111-111111111111'] }); const b = body('tester+uat1@example.com', '11111111-1111-4111-8111-111111111111');
    assert.deepEqual(await s.handle(hdr(b), b), { suppressed: true }); assert.equal(sent.length, 0);
  });
  await t('gateway blocks a migrated address by e-mail hash even when the Auth id is not in the map', async () => {
    const { s, sent } = service({ migratedEmails: ['Tester+uat1@Example.com'] }); const b = body('tester+uat1@example.com', '22222222-2222-4222-8222-222222222222');
    assert.deepEqual(await s.handle(hdr(b), b), { suppressed: true }); assert.equal(sent.length, 0);
  });
  await t('gateway fails closed when the migrated-identity lookup is unavailable', async () => {
    const { s, sent } = service({ lookupFails: true }); const b = body('tester+uat1@example.com');
    await assert.rejects(() => s.handle(hdr(b), b)); assert.equal(sent.length, 0);
  });
  await t('gateway rejects bad / stale signatures with 401 and sends nothing', async () => {
    const { s, sent } = service(); const b = body('tester+uat1@example.com');
    await assert.rejects(() => s.handle({ ...hdr(b), 'webhook-signature': 'v1,AAAA' }, b), /signature/i);
    await assert.rejects(() => s.handle(hdr(b, Math.floor(Date.now() / 1000) - 3600), b), /signature/i);
    assert.equal(sent.length, 0);
  });
  await t('gateway is inert without a secret, and sends nothing while AUTH_EMAIL_DELIVERY is not "enabled"', async () => {
    const b = body('tester+uat1@example.com');
    env({ AUTH_EMAIL_DELIVERY: undefined }); { const { s, sent } = service(); assert.deepEqual(await s.handle(hdr(b), b), { suppressed: true }); assert.equal(sent.length, 0); }
    env({ AUTH_EMAIL_HOOK_SECRET: undefined }); { const { s } = service(); await assert.rejects(() => s.handle(hdr(b), b), /not configured/); }
  });
  console.log(`${n} passed`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
