// Everything written to disk or stdout goes through redact().
const SECRET_ENV = ['PASSWORD', 'ANON_KEY', 'TOKEN'];
export function secretValues(): string[] {
  return Object.entries(process.env)
    .filter(([k, v]) => v && v.length >= 6 && k.startsWith('E2E_') && SECRET_ENV.some((s) => k.includes(s)))
    .map(([, v]) => v as string);
}
export function redact(input: unknown): string {
  let s = typeof input === 'string' ? input : JSON.stringify(input, null, 2) ?? '';
  for (const v of secretValues()) s = s.split(v).join('[REDACTED]');
  return s
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[REDACTED_JWT]')
    .replace(/https?:\/\/[^\s"']*(?:\/auth\/v1\/verify|[?&#](?:token|access_token|refresh_token|token_hash)=)[^\s"']*/g, '[REDACTED_LINK]')
    .replace(/(["']?(?:access_token|refresh_token|invite_link|password|bank_account(?:_number)?|account_number)["']?\s*[:=]\s*)(["'])[^"']*\2/gi, '$1$2[REDACTED]$2');
}
