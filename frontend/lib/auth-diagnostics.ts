/**
 * Safe, structured auth diagnostics. Only allow-listed scalar fields ever leave the browser:
 * flow, stage, an error CODE (never a message), and a per-page correlation id.
 * Never pass tokens, URLs, emails, passwords or session objects here.
 */
export type AuthFlow = 'recovery' | 'signup_confirm' | 'recovery_request';
export type AuthStage =
  | 'page_load' | 'token_present' | 'token_missing' | 'hash_error' | 'legacy_recovery_event'
  | 'verify_start' | 'verify_ok' | 'verify_failed'
  | 'update_start' | 'update_ok' | 'update_failed'
  | 'request_start' | 'request_ok' | 'request_failed';

const CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

export function newCorrelationId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  } catch {
    return Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  }
}

/** Normalises any Supabase/network error to a short snake_case code. Never returns message text. */
export function errorCode(err: unknown): string {
  const e = err as { code?: unknown; status?: unknown; name?: unknown } | null;
  if (e && typeof e.code === 'string' && CODE_PATTERN.test(e.code)) return e.code;
  if (e && typeof e.status === 'number') return `http_${e.status}`;
  if (e && typeof e.name === 'string' && /fetch|network/i.test(e.name)) return 'network_error';
  return 'unknown_error';
}

export function logAuthEvent(cid: string, flow: AuthFlow, stage: AuthStage, code?: string) {
  const safeCode = code && CODE_PATTERN.test(code) ? code : undefined;
  const event = { evt: 'auth_flow', cid, flow, stage, ...(safeCode ? { code: safeCode } : {}) };
  console.info(JSON.stringify(event));
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  if (!base) return;
  try {
    void fetch(`${base.replace(/\/$/, '')}/auth/diagnostics`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), keepalive: true,
    }).catch(() => undefined);
  } catch { /* diagnostics must never break the flow */ }
}
