import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Partner activation token: the credential inside the "your Partner account is approved" e-mail.
 *
 * It is a compact, signed, account-bound claim set — `base64url(json).base64url(hmac-sha256)` — and nothing more. It carries NO secret that could be
 * replayed on its own: it is accepted only if ALL of these hold at redemption time (see ActivationService.redeem):
 *   1. the signature is ours and the token has not expired            (this module)
 *   2. `u` is the Auth user linked to Partner record `c`              (database)
 *   3. `n` equals the nonce currently stored on that Auth user         (a newer e-mail supersedes every older one)
 *   4. the account has never been entered yet (login_count 0)          (single use: consumed by an atomic compare-and-set)
 *
 * The raw token is never logged, never stored and never returned by an API: it exists only in the e-mail and, after the click, in the browser's
 * address-bar FRAGMENT (which is not sent to any server) until the page moves it into a POST body.
 */
export type ActivationClaims = { u: string; c: string; n: string; e: number };
export type TokenCheck = { ok: true; claims: ActivationClaims } | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

export const DEFAULT_TTL_HOURS = 24;
export const MAX_TTL_HOURS = 72;

const b64 = (buf: Buffer) => buf.toString('base64url');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Signing key. ACTIVATION_TOKEN_SECRET wins when set; otherwise a purpose-bound key is derived from the service-role secret that only the API holds,
 * so no new secret has to be provisioned and rotating the service key also invalidates every outstanding link.
 */
export function activationSecret(env: NodeJS.ProcessEnv = process.env): Buffer {
  const explicit = env.ACTIVATION_TOKEN_SECRET?.trim();
  if (explicit) {
    if (explicit.length < 32) throw new Error('ACTIVATION_TOKEN_SECRET must be at least 32 characters');
    return Buffer.from(explicit, 'utf8');
  }
  const base = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error('No secret is available to sign activation links');
  return createHmac('sha256', base).update('vno:partner-activation:v1').digest();
}

/** Link lifetime in hours: ACTIVATION_LINK_TTL_HOURS, clamped to 1..72, default 24. */
export function activationTtlHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ACTIVATION_LINK_TTL_HOURS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_HOURS;
  return Math.min(Math.max(Math.round(raw), 1), MAX_TTL_HOURS);
}

export const newNonce = () => randomBytes(18).toString('base64url');

export function signActivationToken(claims: ActivationClaims, secret: Buffer): string {
  const payload = b64(Buffer.from(JSON.stringify(claims), 'utf8'));
  return `${payload}.${b64(createHmac('sha256', secret).update(payload).digest())}`;
}

export function verifyActivationToken(token: unknown, secret: Buffer, nowMs: number = Date.now()): TokenCheck {
  if (typeof token !== 'string' || token.length < 40 || token.length > 600 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return { ok: false, reason: 'malformed' };
  const [payload, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: 'signature' };
  let claims: ActivationClaims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!claims || typeof claims.u !== 'string' || typeof claims.c !== 'string' || typeof claims.n !== 'string' || typeof claims.e !== 'number' ||
      !UUID.test(claims.u) || !UUID.test(claims.c) || claims.n.length < 16 || claims.n.length > 64) return { ok: false, reason: 'malformed' };
  if (claims.e <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

/** Constant-time string comparison for nonces held in the database. */
export function sameSecret(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
