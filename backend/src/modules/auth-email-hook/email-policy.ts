import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pure helpers for the Supabase Auth "Send Email" hook gateway.
 * Supabase Auth's own mailer will mail ANY address once custom SMTP exists (signup, recovery, invite, magic link), so the only place the
 * tester allowlist can be enforced is here: with the hook enabled, Auth hands us the message and nothing leaves unless this policy allows it.
 */

export type HookDecision =
  | { action: 'send' }
  | { action: 'suppress'; reason: 'not_allowlisted' | 'migrated_identity' | 'delivery_disabled' };

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

/** Entries are exact addresses (plus-aliases are matched literally, "a+uat1@x.com" != "a@x.com") or a whole domain written "@example.org". */
export function isAllowlisted(email: string, allowlist: string[]): boolean {
  const target = email.trim().toLowerCase();
  return allowlist.some((entry) => (entry.startsWith('@') ? target.endsWith(entry) : target === entry));
}

export function decide(input: { email: string; userId?: string; migratedUserIds: Set<string>; allowlist: string[]; enabled: boolean }): HookDecision {
  if (!input.enabled) return { action: 'suppress', reason: 'delivery_disabled' };
  // A migrated V1 identity is never mailed, even if somebody mistakenly put its address on the allowlist.
  if (input.userId && input.migratedUserIds.has(input.userId.toLowerCase())) return { action: 'suppress', reason: 'migrated_identity' };
  if (!isAllowlisted(input.email, input.allowlist)) return { action: 'suppress', reason: 'not_allowlisted' };
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

const SUBJECT: Record<string, string> = {
  signup: 'Xác nhận email đăng ký VNO',
  invite: 'Lời mời tham gia VNO',
  magiclink: 'Liên kết đăng nhập VNO',
  recovery: 'Đặt lại mật khẩu VNO',
  email_change: 'Xác nhận thay đổi email VNO',
  reauthentication: 'Mã xác minh VNO',
};

/** Builds the Supabase verify URL exactly like Auth's own templates ({{ .SiteURL }}/auth/v1/verify?token=...&type=...&redirect_to=...). */
export function actionLink(supabaseUrl: string, data: AuthEmailPayload['email_data']): string {
  const qs = new URLSearchParams({ token: data.token_hash || '', type: data.email_action_type });
  if (data.redirect_to) qs.set('redirect_to', data.redirect_to);
  return `${supabaseUrl.replace(/\/$/, '')}/auth/v1/verify?${qs}`;
}

export function composeMessage(supabaseUrl: string, payload: AuthEmailPayload, uatBanner: string) {
  const type = payload.email_data.email_action_type;
  const subject = `${uatBanner}${SUBJECT[type] || 'Thông báo từ VNO'}`;
  if (type === 'reauthentication') {
    return { subject, html: `<p>Mã xác minh của bạn: <strong>${escapeHtml(payload.email_data.token || '')}</strong></p>` };
  }
  const link = actionLink(supabaseUrl, payload.email_data);
  return {
    subject,
    html: `<!doctype html><html lang="vi"><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><p>${escapeHtml(SUBJECT[type] || 'Thông báo')}.</p><p><a href="${escapeHtml(link)}">Tiếp tục</a></p><p>Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.</p></body></html>`,
  };
}

function escapeHtml(v: string) { return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)); }
