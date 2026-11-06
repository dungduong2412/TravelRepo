import { createHmac, timingSafeEqual } from 'node:crypto';
import { renderEmail } from './email-templates';

/**
 * Pure helpers for the Supabase Auth "Send Email" hook gateway.
 * Supabase Auth's own mailer will mail ANY address once custom SMTP exists (signup, recovery, invite, magic link), so the only place the
 * tester allowlist can be enforced is here: with the hook enabled, Auth hands us the message and nothing leaves unless this policy allows it.
 */

export type HookDecision =
  | { action: 'send' }
  | { action: 'suppress'; reason: 'not_allowlisted' | 'migrated_identity' | 'delivery_disabled' };

import { isAllowlisted } from '../../common/email/recipient-policy';
export { parseAllowlist, isAllowlisted } from '../../common/email/recipient-policy';

/** `allowed` (when given) is the already-evaluated effective allowlist verdict (see isRecipientAllowed); otherwise `allowlist` is checked. */
export function decide(input: { email: string; userId?: string; migratedUserIds: Set<string>; allowlist: string[]; enabled: boolean; allowed?: boolean }): HookDecision {
  if (!input.enabled) return { action: 'suppress', reason: 'delivery_disabled' };
  // A migrated V1 identity is never mailed, even if somebody mistakenly put its address on the allowlist.
  if (input.migratedUserIds.has('*') || (input.userId && input.migratedUserIds.has(input.userId.toLowerCase()))) return { action: 'suppress', reason: 'migrated_identity' };
  if (!(input.allowed ?? isAllowlisted(input.email, input.allowlist))) return { action: 'suppress', reason: 'not_allowlisted' };
  return { action: 'send' };
}

/**
 * Standard Webhooks verification (what Supabase Auth hooks use): secret "v1,whsec_<base64>",
 * signature header "v1,<base64 hmac-sha256(secretBytes, `${id}.${timestamp}.${rawBody}`)>" (space separated when rotating).
 */
export function verifyHookSignature(opts: { secret: string; id?: string; timestamp?: string; signature?: string; rawBody: Buffer | string; now?: number; toleranceSeconds?: number }): boolean {
  const { secret, id, timestamp, signature, rawBody } = opts;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (opts.toleranceSeconds ?? 300)) return false;
  const keyB64 = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  const key = Buffer.from(keyB64, 'base64');
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(rawBody).digest();
  return signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export type AuthEmailPayload = {
  user: { id?: string; email: string };
  email_data: { token?: string; token_hash?: string; redirect_to?: string; email_action_type: string; site_url?: string; token_new?: string; token_hash_new?: string };
};

/** Builds the Supabase verify URL exactly like Auth's own templates ({{ .SiteURL }}/auth/v1/verify?token=...&type=...&redirect_to=...). */
export function actionLink(supabaseUrl: string, data: AuthEmailPayload['email_data']): string {
  const qs = new URLSearchParams({ token: data.token_hash || '', type: data.email_action_type });
  if (data.redirect_to) qs.set('redirect_to', data.redirect_to);
  return `${supabaseUrl.replace(/\/$/, '')}/auth/v1/verify?${qs}`;
}

export type AppLinkRefusal = 'no_token' | 'web_base_unset' | 'web_base_insecure' | 'redirect_invalid' | 'redirect_origin_mismatch';
export type AppLinkResult = { link: string } | { refused: AppLinkRefusal };

/** Raised when a recovery/signup message cannot be given a safe application link. The caller must NOT send anything. */
export class UnsafeAuthLinkError extends Error {
  constructor(readonly reason: AppLinkRefusal) { super(`unsafe_auth_link:${reason}`); }
}

/**
 * Application-level confirmation link for signup and recovery. Supabase's own /auth/v1/verify consumes the one-time token on the first GET,
 * so a mail scanner, link preview or browser prefetch can burn it before the person clicks. This link points at the web app instead; the token
 * is only spent when the page calls verifyOtp after an explicit click. When the link cannot be built safely (web base unset or not https,
 * redirect_to on another origin, no token) the result carries a stable refusal reason; composeMessage turns that into an error so nothing is
 * sent. It never falls back to the Supabase verify URL for these two actions.
 */
export function appActionLinkResult(webBaseUrl: string, data: AuthEmailPayload['email_data']): AppLinkResult {
  const type = data.email_action_type;
  if (!data.token_hash) return { refused: 'no_token' };
  if (!webBaseUrl) return { refused: 'web_base_unset' };
  let base: URL;
  try { base = new URL(webBaseUrl); } catch { return { refused: 'web_base_unset' }; }
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') return { refused: 'web_base_insecure' };
  let next = '/login';
  if (data.redirect_to) {
    let target: URL;
    try { target = new URL(data.redirect_to); } catch { return { refused: 'redirect_invalid' }; }
    if (target.origin !== base.origin) return { refused: 'redirect_origin_mismatch' };
    next = `${target.pathname}${target.search}`;
  }
  const qs = new URLSearchParams({ token_hash: data.token_hash, type });
  if (type === 'recovery') return { link: `${base.origin}/reset-password?${qs}` };
  qs.set('next', next);
  return { link: `${base.origin}/auth/confirm?${qs}` };
}

/** Link or null for the two app-link actions; any other action type keeps the Supabase link and returns null here. */
export function appActionLink(webBaseUrl: string, data: AuthEmailPayload['email_data']): string | null {
  const type = data.email_action_type;
  if (type !== 'recovery' && type !== 'signup') return null;
  const r = appActionLinkResult(webBaseUrl, data);
  return 'link' in r ? r.link : null;
}

export function composeMessage(supabaseUrl: string, payload: AuthEmailPayload, uatBanner: string, webBaseUrl = '') {
  const type = payload.email_data.email_action_type;
  let link: string | undefined;
  if (type === 'reauthentication') link = undefined;
  else if (type === 'recovery' || type === 'signup') {
    const r = appActionLinkResult(webBaseUrl, payload.email_data);
    if (!('link' in r)) throw new UnsafeAuthLinkError(r.refused); // fail safe: never degrade to the scanner-consumable Supabase URL
    link = r.link;
  } else link = actionLink(supabaseUrl, payload.email_data);
  return renderEmail({ type, link, code: payload.email_data.token, subjectPrefix: uatBanner });
}
